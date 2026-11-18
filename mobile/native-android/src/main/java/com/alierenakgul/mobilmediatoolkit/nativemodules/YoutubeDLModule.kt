package com.alierenakgul.mobilmediatoolkit.nativemodules

import android.content.Context
import android.content.ClipData
import android.content.Intent
import android.graphics.Path
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat as AndroidMediaFormat
import android.media.MediaMuxer
import android.media.MediaScannerConnection
import android.media.RingtoneManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.StatFs
import android.provider.Settings
import android.util.Log
import androidx.core.content.FileProvider
import com.facebook.react.bridge.BaseActivityEventListener
import org.json.JSONObject
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.modules.core.DeviceEventManagerModule
import org.schabi.newpipe.extractor.MediaFormat
import org.schabi.newpipe.extractor.NewPipe
import org.schabi.newpipe.extractor.ServiceList
import org.schabi.newpipe.extractor.downloader.Downloader
import org.schabi.newpipe.extractor.downloader.Request
import org.schabi.newpipe.extractor.downloader.Response
import org.schabi.newpipe.extractor.exceptions.ReCaptchaException
import org.schabi.newpipe.extractor.localization.ContentCountry
import org.schabi.newpipe.extractor.localization.Localization
import org.schabi.newpipe.extractor.playlist.PlaylistInfo
import org.schabi.newpipe.extractor.search.SearchInfo
import org.schabi.newpipe.extractor.services.youtube.YoutubeParsingHelper
import org.schabi.newpipe.extractor.services.youtube.linkHandler.YoutubeSearchQueryHandlerFactory
import org.schabi.newpipe.extractor.stream.AudioStream
import org.schabi.newpipe.extractor.stream.AudioTrackType
import org.schabi.newpipe.extractor.stream.StreamInfo
import org.schabi.newpipe.extractor.stream.StreamInfoItem
import org.schabi.newpipe.extractor.stream.VideoStream
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.RandomAccessFile
import java.net.HttpURLConnection
import java.net.URL
import java.nio.ByteBuffer
import java.nio.charset.StandardCharsets
import java.util.concurrent.Executors
import java.util.zip.GZIPInputStream
import kotlin.math.max

class NewPipeHttpDownloader private constructor() : Downloader() {
    companion object {
        const val USER_AGENT =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0"
        val instance: NewPipeHttpDownloader by lazy { NewPipeHttpDownloader() }
    }

    @Throws(IOException::class, ReCaptchaException::class)
    override fun execute(request: Request): Response {
        val httpMethod = request.httpMethod()
        val url = request.url()
        val headers = request.headers()
        val dataToSend = request.dataToSend()

        val conn = (URL(url).openConnection() as HttpURLConnection).apply {
            connectTimeout = 30000
            readTimeout = 30000
            instanceFollowRedirects = true
            requestMethod = httpMethod
            setRequestProperty("User-Agent", USER_AGENT)
            setRequestProperty("Accept-Encoding", "gzip")
            if (url.contains("youtube.com")) {
                setRequestProperty("Cookie", "SOCS=CAI; PREF=f2=8000000")
            }
        }

        for ((headerName, headerValueList) in headers.entries) {
            if (headerValueList.isNotEmpty()) {
                conn.setRequestProperty(headerName, headerValueList[0])
                for (i in 1 until headerValueList.size) {
                    conn.addRequestProperty(headerName, headerValueList[i])
                }
            }
        }

        if (dataToSend != null) {
            conn.doOutput = true
            conn.setFixedLengthStreamingMode(dataToSend.size)
            conn.outputStream.use { os ->
                os.write(dataToSend)
            }
        } else if (httpMethod.equals("POST", ignoreCase = true) || httpMethod.equals("PUT", ignoreCase = true)) {
            conn.doOutput = true
            conn.setFixedLengthStreamingMode(0)
            conn.outputStream.close()
        }

        val code = conn.responseCode
        val message = conn.responseMessage ?: ""

        if (code == 429) {
            conn.disconnect()
            throw ReCaptchaException("reCaptcha Challenge requested", url)
        }

        val rawStream = try {
            if (code in 200..399) conn.inputStream else conn.errorStream
        } catch (e: Exception) {
            conn.errorStream
        }

        val contentEncoding = conn.contentEncoding ?: ""
        val bodyString = if (rawStream != null) {
            val decodedStream = if (contentEncoding.contains("gzip", ignoreCase = true)) {
                GZIPInputStream(rawStream)
            } else {
                rawStream
            }
            decodedStream.bufferedReader(StandardCharsets.UTF_8).use { it.readText() }
        } else {
            ""
        }

        val responseHeaders = HashMap<String, List<String>>()
        for ((k, v) in conn.headerFields) {
            if (k != null && v != null) {
                responseHeaders[k] = v
            }
        }

        val latestUrl = conn.url?.toString() ?: url
        conn.disconnect()

        return Response(
            code,
            message,
            responseHeaders,
            bodyString,
            latestUrl
        )
    }
}

class YoutubeDLModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    private val TAG = "YoutubeDLModule"
    private val executor = Executors.newCachedThreadPool()
    private val archiveScanner by lazy { ArchiveScanner(reactContext) }

    @ReactMethod
    fun scanArchiveFolder(chooseFolder: Boolean, promise: Promise) = archiveScanner.scan(chooseFolder, promise)

    @Volatile
    private var isInitialized = false

    private var pendingShare: String? = null
    private val shareListener = object : BaseActivityEventListener() {
        override fun onNewIntent(intent: Intent) {
            captureShare(intent)
            try {
                reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                    .emit("onSharedYouTubeText", null)
            } catch (_: Exception) {
                // The pending text is consumed when the JS application becomes active.
            }
        }
    }

    init {
        MusicPlayerService.reactContextRef = reactContext
        reactContext.addActivityEventListener(shareListener)
    }

    @Synchronized
    private fun captureShare(intent: Intent?) {
        if (intent?.action != Intent.ACTION_SEND || intent.type != "text/plain") return
        val text = intent.getStringExtra(Intent.EXTRA_TEXT)?.take(8192)
        intent.removeExtra(Intent.EXTRA_TEXT)
        if (!text.isNullOrBlank()) pendingShare = text
    }

    @ReactMethod
    fun consumeSharedText(promise: Promise) {
        reactContext.runOnUiQueueThread {
            synchronized(this) {
                captureShare(reactContext.currentActivity?.intent)
                promise.resolve(pendingShare)
                pendingShare = null
            }
        }
    }

    override fun invalidate() {
        reactContext.runOnUiQueueThread { VideoPlayerActivity.closeActive() }
        archiveScanner.dispose()
        reactContext.removeActivityEventListener(shareListener)
        super.invalidate()
    }

    private fun resumeDirectory(taskId: String): File {
        require(Regex("^native_[A-Za-z0-9_]+$").matches(taskId)) { "Geçersiz indirme kimliği" }
        return File(reactContext.filesDir, "download-resume/$taskId").apply { mkdirs() }
    }

    @ReactMethod
    fun discardDownload(taskId: String, promise: Promise) {
        executor.execute {
            try { resumeDirectory(taskId).deleteRecursively(); promise.resolve(true) }
            catch (e: Exception) { promise.reject("CLEANUP_ERROR", e) }
        }
    }

    @ReactMethod
    fun mediaFileExists(path: String, filename: String, promise: Promise) {
        promise.resolve(resolveExistingFile(path, filename)?.let { it.length() > 0L } ?: false)
    }

    override fun getName(): String = "YoutubeDLNative"

    @Synchronized
    private fun ensureInit() {
        if (!isInitialized) {
            NewPipe.init(
                NewPipeHttpDownloader.instance,
                Localization("tr", "TR"),
                ContentCountry("TR")
            )
            isInitialized = true
            Log.d(TAG, "NewPipeExtractor başarıyla başlatıldı.")
        }
    }

    @ReactMethod
    fun isAvailable(promise: Promise) {
        promise.resolve(true)
    }

    @ReactMethod
    fun initEngine(promise: Promise) {
        executor.execute {
            try {
                MusicPlayerService.reactContextRef = reactContext
                ensureInit()
                promise.resolve(true)
            } catch (e: Exception) {
                Log.e(TAG, "initEngine hatası", e)
                promise.reject("INIT_ERROR", e.localizedMessage ?: "Motor başlatılamadı", e)
            }
        }
    }

    @ReactMethod
    fun updateEngine(promise: Promise) {
        promise.resolve("UP_TO_DATE")
    }

    @ReactMethod
    fun addListener(eventName: String) {
        // React Native NativeEventEmitter uyumluluğu için
    }

    @ReactMethod
    fun removeListeners(count: Int) {
        // React Native NativeEventEmitter uyumluluğu için
    }

    private val ALLOWED_MEDIA_EXTENSIONS = setOf(
        "m4a", "mp4a", "aac", "mp3", "webm", "ogg", "opus", "mp4", "m4v"
    )

    private fun getAllowedMediaRoots(): List<String> {
        val roots = mutableListOf<File>()
        try {
            roots.add(getStorageDir())
            roots.add(
                File(
                    Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),
                    "MediaToolkit"
                )
            )
            reactContext.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)?.let {
                roots.add(File(it, "MediaToolkit"))
            }
            roots.add(File(reactContext.filesDir, "MediaToolkit"))
            roots.add(reactContext.cacheDir)
        } catch (_: Exception) {}
        return roots.mapNotNull {
            try {
                it.canonicalPath
            } catch (_: Exception) {
                null
            }
        }
    }

    private fun isSafeMediaFile(candidate: File): Boolean {
        return try {
            if (!candidate.exists() || !candidate.isFile) return false
            val ext = candidate.extension.lowercase()
            if (ext !in ALLOWED_MEDIA_EXTENSIONS) return false
            val canonical = candidate.canonicalPath
            val allowedRoots = getAllowedMediaRoots()
            allowedRoots.any { root ->
                canonical.startsWith(root + File.separator) || canonical == root
            }
        } catch (_: Exception) {
            false
        }
    }

    private fun requireSafeYouTubeUrl(rawUrl: String): String {
        val trimmed = rawUrl.trim()
        if (trimmed.isEmpty() || trimmed.length > 2048) {
            throw IOException("Geçersiz bağlantı uzunluğu.")
        }
        val parsed = Uri.parse(trimmed)
        val scheme = parsed.scheme?.lowercase() ?: ""
        val host = parsed.host?.lowercase() ?: ""
        if (scheme != "https" && scheme != "http") {
            throw IOException("Yalnızca HTTPS bağlantıları desteklenir.")
        }
        val isYouTubeHost = host == "youtube.com" ||
            host.endsWith(".youtube.com") ||
            host == "youtu.be" ||
            host.endsWith(".youtu.be")
        if (!isYouTubeHost) {
            throw IOException("Güvenlik nedeniyle yalnızca resmi YouTube bağlantıları kabul edilir.")
        }
        return if (scheme == "http") "https://" + trimmed.removePrefix("http://") else trimmed
    }

    private fun resolveExistingFile(filePathOrUrl: String?, filename: String?): File? {
        if (!filePathOrUrl.isNullOrBlank()) {
            val clean = filePathOrUrl.removePrefix("file://").trim()
            val direct = File(clean)
            if (isSafeMediaFile(direct)) return direct
        }
        if (!filename.isNullOrBlank()) {
            // Path traversal (../) saldırılarını önlemek için yalnızca saf dosya adını al
            val safeName = File(filename.trim()).name
            if (safeName.isNotEmpty() && safeName != "." && safeName != "..") {
                val inStorage = File(getStorageDir(), safeName)
                if (isSafeMediaFile(inStorage)) return inStorage
                val inPublicDownloads = File(
                    Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),
                    "MediaToolkit/$safeName"
                )
                if (isSafeMediaFile(inPublicDownloads)) return inPublicDownloads
            }
        }
        return null
    }

    private fun getMimeTypeForFile(file: File): String {
        val ext = file.extension.lowercase()
        return when (ext) {
            "m4a", "mp4a" -> "audio/mp4"
            "aac" -> "audio/aac"
            "mp3" -> "audio/mpeg"
            "webm" -> "audio/webm"
            "ogg", "opus" -> "audio/ogg"
            "mp4", "m4v" -> "video/mp4"
            else -> "*/*"
        }
    }

    private fun getFileProviderUri(targetFile: File): Uri {
        return try {
            FileProvider.getUriForFile(
                reactContext,
                "${reactContext.packageName}.mediatoolkit.provider",
                targetFile
            )
        } catch (_: Exception) {
            FileProvider.getUriForFile(
                reactContext,
                "${reactContext.packageName}.SharingFileProvider",
                targetFile
            )
        }
    }

    @ReactMethod
    fun openOrShareFile(filePathOrUrl: String, filename: String, actionType: String, promise: Promise) {
        executor.execute {
            try {
                val targetFile = resolveExistingFile(filePathOrUrl, filename)
                    ?: throw IOException("Dosya cihazda bulunamadı: $filename")

                if (actionType == "open" && targetFile.extension.lowercase() in listOf("mp4", "m4v", "webm")) {
                    playVideoInAppInternal(targetFile, filename.removeSuffix(".mp4"), "Media Toolkit", promise)
                    return@execute
                }

                val mimeType = getMimeTypeForFile(targetFile)
                val uri: Uri = getFileProviderUri(targetFile)

                val intent = if (actionType == "open") {
                    Intent(Intent.ACTION_VIEW).apply {
                        setDataAndType(uri, mimeType)
                        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
                    }
                } else {
                    Intent(Intent.ACTION_SEND).apply {
                        type = mimeType
                        putExtra(Intent.EXTRA_STREAM, uri)
                        putExtra(Intent.EXTRA_TITLE, targetFile.name)
                        clipData = ClipData.newUri(reactContext.contentResolver, targetFile.name, uri)
                        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    }
                }

                val chooserTitle = if (actionType == "open") "Medya Oynatıcı Seçin" else "Dosyayı Paylaş"
                val chooser = Intent.createChooser(intent, chooserTitle).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    clipData = intent.clipData
                }

                reactContext.runOnUiQueueThread {
                    try {
                        val currentActivity = reactContext.currentActivity
                        if (currentActivity != null) currentActivity.startActivity(chooser)
                        else reactContext.startActivity(chooser)
                        promise.resolve(true)
                    } catch (e: Exception) {
                        promise.reject("FILE_SHARE_ERROR", "Dosya paylaşım ekranı açılamadı", e)
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "openOrShareFile hatası", e)
                promise.reject("FILE_OPEN_ERROR", e.localizedMessage ?: "Dosya açılamadı", e)
            }
        }
    }

    @ReactMethod
    fun deleteMediaFile(filePathOrUrl: String, filename: String, promise: Promise) {
        executor.execute {
            try {
                // Silinen dosya şu an müzik çalarda çalıyorsa durdur
                try {
                    val state = MusicPlayerService.getCurrentStateMap()
                    val activeFile = state.getString("filename") ?: ""
                    if (activeFile.isNotEmpty() && activeFile == filename) {
                        MusicPlayerService.sendCommand(reactContext, MusicPlayerService.ACTION_STOP)
                    }
                } catch (_: Exception) {}

                val candidates = mutableSetOf<File>()
                if (filePathOrUrl.isNotBlank()) {
                    candidates.add(File(filePathOrUrl.removePrefix("file://").trim()))
                }
                if (filename.isNotBlank()) {
                    val safeName = File(filename.trim()).name
                    if (safeName.isNotEmpty() && safeName != "." && safeName != "..") {
                        candidates.add(File(getStorageDir(), safeName))
                        candidates.add(
                            File(
                                Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),
                                "MediaToolkit/$safeName"
                            )
                        )
                        val extFiles = reactContext.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)
                        if (extFiles != null) {
                            candidates.add(File(extFiles, "MediaToolkit/$safeName"))
                        }
                        candidates.add(File(reactContext.filesDir, "MediaToolkit/$safeName"))
                    }
                }

                val deletedPaths = mutableListOf<String>()
                for (f in candidates) {
                    try {
                        // Yalnızca MediaToolkit dizini altındaki doğrulanmış medya dosyalarını sil
                        if (isSafeMediaFile(f)) {
                            val abs = f.canonicalPath
                            if (f.delete()) {
                                deletedPaths.add(abs)
                            }
                        }
                    } catch (_: Exception) {}
                }

                if (deletedPaths.isNotEmpty()) {
                    try {
                        MediaScannerConnection.scanFile(
                            reactContext.applicationContext,
                            deletedPaths.toTypedArray(),
                            null,
                            null
                        )
                    } catch (_: Exception) {}
                }

                promise.resolve(deletedPaths.isNotEmpty())
            } catch (e: Exception) {
                Log.e(TAG, "deleteMediaFile hatası", e)
                promise.reject("DELETE_ERROR", e.localizedMessage ?: "Dosya silinemedi", e)
            }
        }
    }

    @ReactMethod
    fun playVideoInApp(
        filePathOrUrl: String,
        filename: String,
        title: String,
        uploader: String,
        isDarkMode: Boolean,
        promise: Promise
    ) {
        executor.execute {
            try {
                val targetFile = resolveExistingFile(filePathOrUrl, filename)
                    ?: throw IOException("Video dosyası cihazda bulunamadı: $filename")
                playVideoInAppInternal(
                    targetFile,
                    title.ifBlank { filename },
                    uploader.ifBlank { "Media Toolkit" },
                    promise,
                    isDarkMode
                )
            } catch (e: Exception) {
                Log.e(TAG, "playVideoInApp hatası", e)
                promise.reject("VIDEO_PLAYER_ERROR", e.localizedMessage ?: "Video oynatılamadı", e)
            }
        }
    }

    private fun playVideoInAppInternal(targetFile: File, title: String, uploader: String, promise: Promise, isDarkMode: Boolean = false) {
        val activity = reactContext.currentActivity
        if (activity == null) { promise.reject("NO_ACTIVITY", "Aktif ekran bulunamadı."); return }
        reactContext.runOnUiQueueThread {
            try {
                activity.startActivity(Intent(activity, VideoPlayerActivity::class.java).apply {
                    putExtra("filePath", targetFile.absolutePath)
                    putExtra("title", title)
                    putExtra("uploader", uploader)
                    putExtra("isDarkMode", isDarkMode)
                })
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("VIDEO_PLAYER_ERROR", "Video oynatıcı açılamadı", e)
            }
        }
    }

    // --- ARKA PLAN MÜZİK ÇALAR METOTLARI ---

    @ReactMethod
    fun playPlaylist(tracksArray: ReadableArray, startIndex: Int, promise: Promise) {
        try {
            MusicPlayerService.reactContextRef = reactContext
            val list = mutableListOf<PlaylistTrack>()
            for (i in 0 until tracksArray.size()) {
                val map = tracksArray.getMap(i) ?: continue
                val rawUrl = map.getString("download_url") ?: map.getString("filePath") ?: ""
                val fname = map.getString("filename") ?: ""
                val resolvedFile = resolveExistingFile(rawUrl, fname) ?: continue

                list.add(
                    PlaylistTrack(
                        id = map.getString("id") ?: fname,
                        title = map.getString("title") ?: fname,
                        uploader = map.getString("uploader") ?: map.getString("channel") ?: "Media Toolkit",
                        filePath = resolvedFile.absolutePath,
                        filename = fname,
                        thumbnail = map.getString("thumbnail") ?: ""
                    )
                )
            }

            if (list.isEmpty()) {
                promise.reject("EMPTY_PLAYLIST", "Oynatılacak ses dosyası cihazda bulunamadı.")
                return
            }

            reactContext.runOnUiQueueThread { VideoPlayerActivity.closeActive() }
            MusicPlayerService.startPlayback(reactContext, list, startIndex)
            promise.resolve(true)
        } catch (e: Exception) {
            Log.e(TAG, "playPlaylist hatası", e)
            promise.reject("PLAYER_ERROR", e.localizedMessage ?: "Müzik çalar başlatılamadı", e)
        }
    }

    private fun downloadPreviewStreamSilently(
        streamUrl: String,
        expectedLength: Long,
        outputFile: File
    ) {
        if (outputFile.exists()) outputFile.delete()
        val totalBytes = resolveContentLength(streamUrl, expectedLength)
        var downloadedBytes = 0L

        if (totalBytes > 0L) {
            val chunkSize = 2L * 1024L * 1024L
            RandomAccessFile(outputFile, "rw").use { raf ->
                while (downloadedBytes < totalBytes) {
                    val rangeStart = downloadedBytes
                    val rangeEnd = minOf(rangeStart + chunkSize - 1L, totalBytes - 1L)
                    var attempt = 0
                    var chunkSuccess = false
                    var lastError: Exception? = null

                    while (attempt < 3 && !chunkSuccess) {
                        attempt++
                        val usePost = attempt >= 3
                        var conn: HttpURLConnection? = null
                        try {
                            conn = openStreamConnection(streamUrl, rangeStart, rangeEnd, usePost = usePost)
                            val code = conn.responseCode
                            if (code != 206 && code != 200) {
                                throw IOException("HTTP $code")
                            }
                            raf.seek(if (code == 206) rangeStart else 0L)
                            if (code == 200 && rangeStart > 0L) {
                                downloadedBytes = 0L
                            }
                            conn.inputStream.use { input ->
                                val buffer = ByteArray(64 * 1024)
                                var read: Int
                                while (input.read(buffer).also { read = it } != -1) {
                                    raf.write(buffer, 0, read)
                                    downloadedBytes += read
                                }
                            }
                            chunkSuccess = true
                            if (code == 200) return
                        } catch (e: Exception) {
                            lastError = e
                            Thread.sleep(250L * attempt)
                        } finally {
                            conn?.disconnect()
                        }
                    }
                    if (!chunkSuccess) {
                        throw IOException("Önizleme akışı alınamadı: ${lastError?.localizedMessage ?: "Bağlantı hatası"}")
                    }
                }
            }
        } else {
            val conn = openStreamConnection(streamUrl, -1L, -1L, usePost = false)
            try {
                val code = conn.responseCode
                if (code !in 200..299) throw IOException("HTTP $code")
                FileOutputStream(outputFile).use { fos ->
                    conn.inputStream.use { input ->
                        val buffer = ByteArray(64 * 1024)
                        var read: Int
                        while (input.read(buffer).also { read = it } != -1) {
                            fos.write(buffer, 0, read)
                        }
                    }
                }
            } finally {
                conn.disconnect()
            }
        }
    }

    @ReactMethod
    fun previewAudio(
        url: String,
        title: String,
        uploader: String,
        thumbnail: String,
        promise: Promise
    ) {
        executor.execute {
            var tempRaw: File? = null
            try {
                val safeUrl = requireSafeYouTubeUrl(url)
                MusicPlayerService.reactContextRef = reactContext
                ensureInit()
                val info = StreamInfo.getInfo(safeUrl)

                // Önizlemenin çok hızlı açılması için önce standart (düşük boyutlu M4A) akışı seç
                val audioStream = selectBestAudioStream(info.audioStreams, "128")
                    ?: selectBestAudioStream(info.audioStreams, "high")
                    ?: throw IOException("Bu medya için önizleme ses akışı bulunamadı.")

                val ext = if (audioStream.format == MediaFormat.M4A) "m4a" else (audioStream.format?.suffix ?: "m4a")

                // Eski önizleme önbellek dosyalarını temizle (telefonda yer kaplamasın)
                reactContext.cacheDir.listFiles()?.forEach { f ->
                    if (f.name.startsWith("preview_cache_")) {
                        try {
                            f.delete()
                        } catch (_: Exception) {}
                    }
                }

                val stamp = System.currentTimeMillis()
                tempRaw = File(reactContext.cacheDir, "preview_raw_$stamp.$ext")
                val previewFile = File(reactContext.cacheDir, "preview_cache_$stamp.$ext")

                val expectedLen = audioStream.itagItem?.contentLength ?: -1L
                downloadPreviewStreamSilently(audioStream.content, expectedLen, tempRaw)

                if (ext == "m4a") {
                    try {
                        remuxAudioToCleanM4a(tempRaw, previewFile)
                    } catch (_: Exception) {
                        tempRaw.copyTo(previewFile, overwrite = true)
                    }
                } else {
                    tempRaw.copyTo(previewFile, overwrite = true)
                }

                try {
                    tempRaw.delete()
                } catch (_: Exception) {}

                val resolvedTitle = title.ifBlank { info.name ?: "Şarkı Önizleme" }
                val resolvedUploader = uploader.ifBlank { info.uploaderName ?: "YouTube" }
                val resolvedThumb = thumbnail.ifBlank {
                    info.thumbnails.maxByOrNull { it.height }?.url
                        ?: info.thumbnails.lastOrNull()?.url
                        ?: ""
                }

                val previewTrack = PlaylistTrack(
                    id = "preview_$url",
                    title = "[Önizleme] $resolvedTitle",
                    uploader = resolvedUploader,
                    filePath = previewFile.absolutePath,
                    filename = previewFile.name,
                    thumbnail = resolvedThumb
                )

                reactContext.runOnUiQueueThread { VideoPlayerActivity.closeActive() }
                MusicPlayerService.startPlayback(reactContext, listOf(previewTrack), 0)
                promise.resolve(true)
            } catch (e: Exception) {
                try {
                    tempRaw?.delete()
                } catch (_: Exception) {}
                Log.e(TAG, "previewAudio hatası", e)
                promise.reject("PREVIEW_ERROR", e.localizedMessage ?: "Şarkı önizlemesi başlatılamadı", e)
            }
        }
    }

    @ReactMethod
    fun togglePlayPause(promise: Promise) {
        try {
            MusicPlayerService.sendCommand(reactContext, MusicPlayerService.ACTION_PLAY_PAUSE)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("PLAYER_ERROR", e.localizedMessage, e)
        }
    }

    @ReactMethod
    fun nextTrack(promise: Promise) {
        try {
            MusicPlayerService.sendCommand(reactContext, MusicPlayerService.ACTION_NEXT)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("PLAYER_ERROR", e.localizedMessage, e)
        }
    }

    @ReactMethod
    fun previousTrack(promise: Promise) {
        try {
            MusicPlayerService.sendCommand(reactContext, MusicPlayerService.ACTION_PREV)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("PLAYER_ERROR", e.localizedMessage, e)
        }
    }

    @ReactMethod
    fun stopPlayer(promise: Promise) {
        try {
            MusicPlayerService.sendCommand(reactContext, MusicPlayerService.ACTION_STOP)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("PLAYER_ERROR", e.localizedMessage, e)
        }
    }

    @ReactMethod
    fun seekTo(positionMs: Double, promise: Promise) {
        try {
            MusicPlayerService.seekToPosition(positionMs.toInt())
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("PLAYER_ERROR", e.localizedMessage, e)
        }
    }

    @ReactMethod
    fun getPlayerState(promise: Promise) {
        try {
            promise.resolve(MusicPlayerService.getCurrentStateMap())
        } catch (e: Exception) {
            promise.reject("PLAYER_ERROR", e.localizedMessage, e)
        }
    }

    @ReactMethod
    fun toggleShuffle(promise: Promise) {
        try {
            val enabled = MusicPlayerService.toggleShuffleMode()
            promise.resolve(enabled)
        } catch (e: Exception) {
            promise.reject("PLAYER_ERROR", e.localizedMessage, e)
        }
    }

    @ReactMethod
    fun cycleRepeatMode(promise: Promise) {
        try {
            val mode = MusicPlayerService.cycleRepeatModeState()
            promise.resolve(mode)
        } catch (e: Exception) {
            promise.reject("PLAYER_ERROR", e.localizedMessage, e)
        }
    }

    @ReactMethod
    fun setSleepTimer(minutes: Int, stopAtTrackEnd: Boolean, promise: Promise) {
        try {
            MusicPlayerService.setSleepTimerState(minutes, stopAtTrackEnd)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("PLAYER_ERROR", e.localizedMessage, e)
        }
    }

    @ReactMethod
    fun setPlaybackSpeed(speed: Double, promise: Promise) {
        try {
            MusicPlayerService.setPlaybackSpeedState(speed.toFloat())
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("PLAYER_ERROR", e.localizedMessage, e)
        }
    }

    @ReactMethod
    fun setAudioPreset(preset: String, promise: Promise) {
        try {
            MusicPlayerService.setAudioPresetState(preset)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("PLAYER_ERROR", e.localizedMessage, e)
        }
    }

    @ReactMethod
    fun getStorageStats(promise: Promise) {
        executor.execute {
            try {
                val path = Environment.getExternalStorageDirectory() ?: reactContext.filesDir
                val stat = StatFs(path.absolutePath)
                val freeBytes = stat.availableBlocksLong * stat.blockSizeLong
                val totalBytes = stat.blockCountLong * stat.blockSizeLong
                val freeGb = freeBytes.toDouble() / (1024.0 * 1024.0 * 1024.0)
                val totalGb = totalBytes.toDouble() / (1024.0 * 1024.0 * 1024.0)
                val map = Arguments.createMap().apply {
                    putDouble("freeBytes", freeBytes.toDouble())
                    putDouble("totalBytes", totalBytes.toDouble())
                    putString("freeGbFormatted", String.format("%.1f GB", freeGb))
                    putString("totalGbFormatted", String.format("%.1f GB", totalGb))
                }
                promise.resolve(map)
            } catch (e: Exception) {
                promise.reject("STORAGE_ERROR", e.localizedMessage ?: "Depolama bilgisi alınamadı", e)
            }
        }
    }

    @ReactMethod
    fun isWifiConnected(promise: Promise) {
        try {
            val cm = reactContext.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
            if (cm == null) {
                promise.resolve(true)
                return
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                val network = cm.activeNetwork
                val caps = if (network != null) cm.getNetworkCapabilities(network) else null
                val onWifiOrEthernet = caps != null && (
                    caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ||
                        caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)
                    )
                promise.resolve(onWifiOrEthernet)
            } else {
                @Suppress("DEPRECATION")
                val info = cm.activeNetworkInfo
                @Suppress("DEPRECATION")
                val onWifi = info != null && info.isConnected &&
                    (info.type == ConnectivityManager.TYPE_WIFI || info.type == ConnectivityManager.TYPE_ETHERNET)
                promise.resolve(onWifi)
            }
        } catch (e: Exception) {
            promise.resolve(true)
        }
    }

    @ReactMethod
    fun getPlaylistInfo(url: String, promise: Promise) {
        executor.execute {
            try {
                val safeUrl = requireSafeYouTubeUrl(url)
                ensureInit()
                val playlistInfo = PlaylistInfo.getInfo(ServiceList.YouTube, safeUrl)
                val items = playlistInfo.relatedItems
                    .filterIsInstance<StreamInfoItem>()
                    .filter { !it.url.isNullOrBlank() }

                val itemsArray = Arguments.createArray()
                for (item in items) {
                    val thumb = item.thumbnails.maxByOrNull { it.height }?.url
                        ?: item.thumbnails.lastOrNull()?.url
                        ?: ""
                    val itemMap = Arguments.createMap().apply {
                        putString("title", item.name ?: "YouTube Medya")
                        putString("url", item.url ?: "")
                        putString("thumbnail", thumb)
                        putString("uploader", item.uploaderName ?: playlistInfo.uploaderName ?: "YouTube")
                        putInt("duration", item.duration.toInt().coerceAtLeast(0))
                    }
                    itemsArray.pushMap(itemMap)
                }

                val bestPlaylistThumb = playlistInfo.thumbnails.maxByOrNull { it.height }?.url
                    ?: playlistInfo.thumbnails.lastOrNull()?.url
                    ?: ""

                val result = Arguments.createMap().apply {
                    putString("title", playlistInfo.name ?: "YouTube Çalma Listesi")
                    putString("uploader", playlistInfo.uploaderName ?: "YouTube")
                    putString("thumbnail", bestPlaylistThumb)
                    putInt("itemCount", items.size)
                    putArray("items", itemsArray)
                }
                promise.resolve(result)
            } catch (e: Exception) {
                Log.e(TAG, "getPlaylistInfo hatası", e)
                promise.reject("PLAYLIST_ERROR", e.localizedMessage ?: "YouTube oynatma listesi bilgileri alınamadı", e)
            }
        }
    }

    @ReactMethod
    fun trimAudioFile(
        filePathOrUrl: String,
        filename: String,
        startSec: Double,
        endSec: Double,
        setAsRingtone: Boolean,
        promise: Promise
    ) {
        executor.execute {
            val extractor = MediaExtractor()
            var muxer: MediaMuxer? = null
            var stagedTrimFile: File? = null
            try {
                val sourceFile = resolveExistingFile(filePathOrUrl, filename)
                    ?: throw IOException("Kırpılacak ses dosyası cihazda bulunamadı.")

                val startUs = (startSec.coerceAtLeast(0.0) * 1_000_000.0).toLong()
                val endUs = (endSec * 1_000_000.0).toLong()
                if (endUs <= startUs + 1_000_000L) {
                    throw IOException("Bitiş süresi başlangıç süresinden en az 1 saniye büyük olmalıdır.")
                }

                extractor.setDataSource(sourceFile.absolutePath)
                val audioTrackIdx = selectTrackByPrefix(extractor, "audio/")
                if (audioTrackIdx < 0) {
                    throw IOException("Ses izi bulunamadı.")
                }
                extractor.selectTrack(audioTrackIdx)
                val trackFormat = extractor.getTrackFormat(audioTrackIdx)

                val baseName = sanitizeFileName(sourceFile.nameWithoutExtension)
                val outName = "${baseName}_Kesit_${startSec.toInt()}s_${endSec.toInt()}s.m4a"
                var outFile = File.createTempFile("trim-", ".m4a", reactContext.cacheDir)
                val stagedFile = outFile
                stagedTrimFile = stagedFile

                muxer = MediaMuxer(outFile.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
                val dstTrack = muxer.addTrack(trackFormat)
                muxer.start()

                extractor.seekTo(startUs, MediaExtractor.SEEK_TO_CLOSEST_SYNC)

                val buffer = ByteBuffer.allocateDirect(512 * 1024)
                val bufferInfo = MediaCodec.BufferInfo()
                var firstPtsUs = -1L

                while (true) {
                    val sampleSize = extractor.readSampleData(buffer, 0)
                    if (sampleSize < 0) break
                    val sampleTimeUs = extractor.sampleTime
                    if (sampleTimeUs < 0L || sampleTimeUs > endUs) break

                    if (sampleTimeUs >= startUs) {
                        if (firstPtsUs < 0L) {
                            firstPtsUs = sampleTimeUs
                        }
                        bufferInfo.offset = 0
                        bufferInfo.size = sampleSize
                        bufferInfo.presentationTimeUs = (sampleTimeUs - firstPtsUs).coerceAtLeast(0L)
                        val sFlags = extractor.sampleFlags
                        bufferInfo.flags = if ((sFlags and MediaExtractor.SAMPLE_FLAG_SYNC) != 0) {
                            MediaCodec.BUFFER_FLAG_KEY_FRAME
                        } else 0
                        muxer.writeSampleData(dstTrack, buffer, bufferInfo)
                    }
                    extractor.advance()
                }

                muxer.stop()

                if (!outFile.exists() || outFile.length() == 0L) {
                    throw IOException("Seçilen zaman aralığında ses verisi kesilemedi.")
                }

                muxer.release()
                muxer = null
                outFile = SharedMediaStorage.publish(reactContext, stagedFile, outName)
                stagedFile.delete()

                try {
                    MediaScannerConnection.scanFile(
                        reactContext.applicationContext,
                        arrayOf(outFile.absolutePath),
                        arrayOf("audio/mp4"),
                        null
                    )
                } catch (_: Exception) {}

                var ringtoneSuccess = false
                var needsPermission = false

                if (setAsRingtone) {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.System.canWrite(reactContext)) {
                        needsPermission = true
                        try {
                            val permIntent = Intent(Settings.ACTION_MANAGE_WRITE_SETTINGS).apply {
                                data = Uri.parse("package:${reactContext.packageName}")
                                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                            }
                            reactContext.startActivity(permIntent)
                        } catch (_: Exception) {}
                    } else {
                        try {
                            val ringtonesDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_RINGTONES)
                            if (!ringtonesDir.exists()) ringtonesDir.mkdirs()
                            val ringtoneFile = File(ringtonesDir, outFile.name)
                            outFile.copyTo(ringtoneFile, overwrite = true)

                            val uri = getFileProviderUri(ringtoneFile)
                            RingtoneManager.setActualDefaultRingtoneUri(
                                reactContext,
                                RingtoneManager.TYPE_RINGTONE,
                                uri
                            )
                            ringtoneSuccess = true
                        } catch (ringErr: Exception) {
                            Log.w(TAG, "Zil sesi atama uyarısı: ${ringErr.message}")
                        }
                    }
                }

                val map = Arguments.createMap().apply {
                    putBoolean("success", true)
                    putString("fileName", outFile.name)
                    putString("filePath", outFile.absolutePath)
                    putString("fileSize", formatFileSize(outFile.length()))
                    putBoolean("ringtoneSet", ringtoneSuccess)
                    putBoolean("needsWriteSettingsPermission", needsPermission)
                }
                promise.resolve(map)
            } catch (e: Exception) {
                Log.e(TAG, "trimAudioFile hatası", e)
                promise.reject("TRIM_ERROR", e.localizedMessage ?: "Ses dosyası kırpılamadı", e)
            } finally {
                stagedTrimFile?.delete()
                try {
                    extractor.release()
                } catch (_: Exception) {}
                try {
                    muxer?.release()
                } catch (_: Exception) {}
            }
        }
    }

    private fun getStorageDir(): File = SharedMediaStorage.directory()

    private fun sanitizeFileName(raw: String): String {
        val cleaned = raw
            .replace(Regex("[\\\\/:*?\"<>|\\p{Cntrl}]"), "_")
            .replace(Regex("\\s+"), " ")
            .trim()
        return if (cleaned.isEmpty()) "YouTube_Medya" else cleaned.take(120)
    }

    private fun formatFileSize(bytes: Long): String {
        if (bytes <= 0) return ""
        val mb = bytes.toDouble() / (1024.0 * 1024.0)
        return if (mb >= 1.0) {
            String.format("%.1f MB", mb)
        } else {
            String.format("%d KB", (bytes / 1024L).coerceAtLeast(1L))
        }
    }

    private fun emitProgress(progress: Double, etaSeconds: Double, speedText: String) {
        try {
            val eventMap = Arguments.createMap().apply {
                putDouble("progress", progress.coerceIn(0.0, 100.0))
                putDouble("eta", etaSeconds.coerceAtLeast(0.0))
                putString("line", speedText)
            }
            reactContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit("onNativeDownloadProgress", eventMap)
        } catch (ignored: Exception) {
        }
    }

    @ReactMethod
    fun searchYouTube(query: String, promise: Promise) {
        executor.execute {
            try {
                val trimmed = query.trim()
                if (trimmed.isEmpty()) {
                    promise.resolve(Arguments.createArray())
                    return@execute
                }
                ensureInit()
                val service = ServiceList.YouTube
                val queryHandler = try {
                    service.searchQHFactory.fromQuery(
                        trimmed,
                        listOf(YoutubeSearchQueryHandlerFactory.VIDEOS),
                        ""
                    )
                } catch (_: Exception) {
                    service.searchQHFactory.fromQuery(trimmed)
                }

                val searchInfo = SearchInfo.getInfo(service, queryHandler)
                val items = searchInfo.relatedItems
                    .filterIsInstance<StreamInfoItem>()
                    .filter { !it.url.isNullOrBlank() && it.duration > 0 }
                    .take(15)

                val resultsArray = Arguments.createArray()
                for (item in items) {
                    val bestThumb = item.thumbnails
                        .maxByOrNull { it.height }?.url
                        ?: item.thumbnails.lastOrNull()?.url
                        ?: ""

                    val itemMap = Arguments.createMap().apply {
                        putString("title", item.name ?: "YouTube Video")
                        putString("url", item.url ?: "")
                        putString("thumbnail", bestThumb)
                        putString("uploader", item.uploaderName ?: "YouTube")
                        putInt("duration", item.duration.toInt().coerceAtLeast(0))
                        putDouble("viewCount", item.viewCount.toDouble().coerceAtLeast(0.0))
                    }
                    resultsArray.pushMap(itemMap)
                }
                promise.resolve(resultsArray)
            } catch (e: Exception) {
                Log.e(TAG, "searchYouTube hatası", e)
                promise.reject("SEARCH_ERROR", e.localizedMessage ?: "YouTube araması yapılamadı", e)
            }
        }
    }

    @ReactMethod
    fun getVideoInfo(url: String, promise: Promise) {
        executor.execute {
            try {
                val safeUrl = requireSafeYouTubeUrl(url)
                ensureInit()
                val info = StreamInfo.getInfo(safeUrl)
                val bestThumb = info.thumbnails
                    .maxByOrNull { it.height }?.url
                    ?: info.thumbnails.lastOrNull()?.url
                    ?: ""

                val map = Arguments.createMap().apply {
                    putString("title", info.name ?: "YouTube Medya")
                    putString("thumbnail", bestThumb)
                    putInt("duration", info.duration.toInt().coerceAtLeast(0))
                    putString("uploader", info.uploaderName ?: "YouTube")
                    putDouble("viewCount", info.viewCount.toDouble().coerceAtLeast(0.0))
                    putString("url", url)
                }
                promise.resolve(map)
            } catch (e: Exception) {
                Log.e(TAG, "getVideoInfo hatası", e)
                promise.reject("INFO_ERROR", e.localizedMessage ?: e.message ?: "Video bilgileri alınamadı", e)
            }
        }
    }

    private fun selectBestAudioStream(streams: List<AudioStream>, requestedQuality: String): AudioStream? {
        val valid = streams.filter { it.isUrl() && it.content.isNotEmpty() }
        if (valid.isEmpty()) return null

        // Öncelik: M4A (AAC) formatı (tüm telefonlarda FFmpeg olmadan doğrudan çalışır ve MediaMuxer ile uyumludur)
        val m4aStreams = valid.filter { it.format == MediaFormat.M4A }
        val pool = if (m4aStreams.isNotEmpty()) m4aStreams else valid

        // Orijinal ses izini dublaja tercih et
        val originalTrackPool = pool.filter {
            it.audioTrackType == null || it.audioTrackType == AudioTrackType.ORIGINAL
        }.ifEmpty { pool }

        return if (requestedQuality == "128" || requestedQuality == "standard") {
            originalTrackPool.minByOrNull { if (it.averageBitrate > 0) it.averageBitrate else Int.MAX_VALUE }
                ?: originalTrackPool.first()
        } else {
            originalTrackPool.maxByOrNull { it.averageBitrate }
                ?: originalTrackPool.first()
        }
    }

    private fun resolveVideoHeight(stream: VideoStream?): Int {
        if (stream == null) return 0
        if (stream.height > 0) return stream.height
        val itagH = stream.itagItem?.height ?: -1
        if (itagH > 0) return itagH
        val res = stream.resolution ?: ""
        val match = Regex("(\\d{3,4})p").find(res)
        if (match != null) {
            return match.groupValues[1].toIntOrNull() ?: 0
        }
        return when (stream.itag) {
            137, 299, 248, 399 -> 1080
            136, 298, 247, 398, 22 -> 720
            135, 244, 397 -> 480
            134, 243, 396, 18 -> 360
            133, 242, 395 -> 240
            160, 278, 394 -> 144
            else -> 0
        }
    }

    private fun resolveVideoBitrate(stream: VideoStream?): Int {
        if (stream == null) return 0
        if (stream.bitrate > 0) return stream.bitrate
        return stream.itagItem?.bitrate ?: 0
    }

    private fun isAvcStream(stream: VideoStream): Boolean {
        if (stream.itag in listOf(137, 299, 136, 298, 135, 134, 133, 160, 22, 18)) return true
        val codec = stream.codec ?: stream.itagItem?.codec ?: ""
        return codec.startsWith("avc1", ignoreCase = true)
    }

    private fun selectBestAdaptiveVideoStream(streams: List<VideoStream>, maxHeight: Int): VideoStream? {
        val valid = streams.filter { it.isUrl() && it.content.isNotEmpty() }
        if (valid.isEmpty()) return null

        // Kasma ve kalite kaybını önlemek için donanım hızlandırmalı H.264 (avc1) + MPEG_4 akışlarını seç
        val mp4Avc = valid.filter {
            it.format == MediaFormat.MPEG_4 && isAvcStream(it)
        }
        val mp4All = valid.filter { it.format == MediaFormat.MPEG_4 }
        val pool = when {
            mp4Avc.isNotEmpty() -> mp4Avc
            mp4All.isNotEmpty() -> mp4All
            else -> valid
        }

        val withinTarget = pool.filter { resolveVideoHeight(it) in 1..maxHeight }
        val targetPool = withinTarget.ifEmpty { pool }

        return targetPool.maxWithOrNull(
            compareBy<VideoStream> { resolveVideoHeight(it) }
                .thenBy { resolveVideoBitrate(it) }
        )
    }

    private fun selectBestMuxedVideoStream(streams: List<VideoStream>, maxHeight: Int): VideoStream? {
        val valid = streams.filter { it.isUrl() && it.content.isNotEmpty() }
        if (valid.isEmpty()) return null

        val mp4Pool = valid.filter { it.format == MediaFormat.MPEG_4 }.ifEmpty { valid }
        val withinTarget = mp4Pool.filter { resolveVideoHeight(it) in 1..maxHeight }
        val targetPool = withinTarget.ifEmpty { mp4Pool }

        return targetPool.maxWithOrNull(
            compareBy<VideoStream> { resolveVideoHeight(it) }
                .thenBy { resolveVideoBitrate(it) }
        )
    }

    private fun openStreamConnection(
        streamUrl: String,
        rangeStart: Long,
        rangeEnd: Long,
        usePost: Boolean = false
    ): HttpURLConnection {
        val isVisionOs = YoutubeParsingHelper.isVisionOsStreamingUrl(streamUrl)
        val userAgent = if (isVisionOs) {
            YoutubeParsingHelper.getVisionOsUserAgent(null)
        } else {
            NewPipeHttpDownloader.USER_AGENT
        }

        val conn = (URL(streamUrl).openConnection() as HttpURLConnection).apply {
            connectTimeout = 20000
            readTimeout = 25000
            instanceFollowRedirects = true
            setRequestProperty("User-Agent", userAgent)
            setRequestProperty("Accept", "*/*")
            setRequestProperty("Accept-Encoding", "identity")
            if (YoutubeParsingHelper.isWebStreamingUrl(streamUrl)) {
                setRequestProperty("Origin", "https://www.youtube.com")
                setRequestProperty("Referer", "https://www.youtube.com")
            }
            if (rangeStart >= 0L) {
                val rangeHeader = if (rangeEnd >= rangeStart) {
                    "bytes=$rangeStart-$rangeEnd"
                } else {
                    "bytes=$rangeStart-"
                }
                setRequestProperty("Range", rangeHeader)
            }
        }

        if (usePost) {
            val postBody = byteArrayOf(0x78, 0)
            conn.requestMethod = "POST"
            conn.doOutput = true
            conn.setFixedLengthStreamingMode(postBody.size)
            conn.connect()
            conn.outputStream.use { it.write(postBody) }
        } else {
            conn.requestMethod = "GET"
            conn.connect()
        }

        return conn
    }

    private fun resolveContentLength(streamUrl: String, hintLength: Long): Long {
        if (hintLength > 0L) return hintLength
        return try {
            val conn = openStreamConnection(streamUrl, 0L, 1L, usePost = false)
            val contentRange = conn.getHeaderField("Content-Range")
            val total = if (!contentRange.isNullOrEmpty() && contentRange.contains("/")) {
                contentRange.substringAfter("/").trim().toLongOrNull() ?: -1L
            } else {
                conn.contentLengthLong
            }
            conn.disconnect()
            total
        } catch (e: Exception) {
            -1L
        }
    }

    private fun downloadStreamToFile(
        streamUrl: String,
        expectedLength: Long,
        outputFile: File,
        progressStart: Double,
        progressEnd: Double
    ) {
        val totalBytes = resolveContentLength(streamUrl, expectedLength)
        // Signed URLs expire. Compare stable stream fields before appending to a partial file.
        val uri = Uri.parse(streamUrl)
        // The task directory is bound to a source URL. Do not compare the signed
        // CDN 'id' token: it may change when an expired URL is refreshed.
        val fields = listOf("itag", "lmt", "clen", "xtags").map { uri.getQueryParameter(it) ?: "" }
        val signature = fields.joinToString("|") + "|$totalBytes"
        val meta = File(outputFile.path + ".stream")
        val canResume = totalBytes > 0L && fields[0].isNotEmpty() && fields[1].isNotEmpty() &&
            meta.exists() && meta.readText() == signature && outputFile.length() <= totalBytes
        if (!canResume) {
            RandomAccessFile(outputFile, "rw").use { it.setLength(0L) }
            meta.writeText(signature)
        }
        var downloadedBytes = outputFile.length()
        val initialBytes = downloadedBytes
        val startTimeMs = System.currentTimeMillis()
        fun report() {
            val elapsed = max(0.2, (System.currentTimeMillis() - startTimeMs) / 1000.0)
            val speed = (downloadedBytes - initialBytes).coerceAtLeast(0L) / elapsed
            val ratio = if (totalBytes > 0L) (downloadedBytes.toDouble() / totalBytes).coerceIn(0.0, 1.0) else 0.0
            emitProgress(progressStart + ratio * (progressEnd - progressStart),
                if (speed > 1024 && totalBytes > 0) (totalBytes - downloadedBytes) / speed else 0.0,
                if (speed > 0) String.format("%.0f KB/s", speed / 1024) else "Kaldığı yerden devam ediyor...")
        }
        report()
        if (totalBytes <= 0L) {
            // Without a verified total, restarting is safer than appending unknown representations.
            val conn = openStreamConnection(streamUrl, -1L, -1L)
            try {
                if (conn.responseCode != 200) throw IOException("HTTP ${conn.responseCode}")
                FileOutputStream(outputFile).use { out -> conn.inputStream.use { input ->
                    val buffer = ByteArray(64 * 1024)
                    var read: Int
                    while (input.read(buffer).also { read = it } != -1) {
                        out.write(buffer, 0, read); downloadedBytes += read; report()
                    }
                    out.fd.sync()
                } }
            } finally { conn.disconnect() }
            return
        }
        RandomAccessFile(outputFile, "rw").use { file ->
            while (downloadedBytes < totalBytes) {
                val start = downloadedBytes
                val end = minOf(start + 2L * 1024 * 1024 - 1, totalBytes - 1)
                var success = false
                var lastError: Exception? = null
                for (attempt in 1..3) {
                    var conn: HttpURLConnection? = null
                    var rollback = start
                    try {
                        conn = openStreamConnection(streamUrl, start, end, usePost = attempt == 3)
                        val code = conn.responseCode
                        val expected: Long
                        when (code) {
                            206 -> {
                                val range = Regex("bytes (\\d+)-(\\d+)/(\\d+)").matchEntire(conn.getHeaderField("Content-Range") ?: "")
                                    ?: throw IOException("Geçersiz Content-Range")
                                if (range.groupValues[1].toLong() != start || range.groupValues[2].toLong() != end || range.groupValues[3].toLong() != totalBytes)
                                    throw IOException("Akış aralığı değişti; güvenli devam edilemiyor")
                                expected = end - start + 1
                            }
                            200 -> {
                                rollback = 0L
                                downloadedBytes = 0L
                                file.setLength(0L)
                                expected = totalBytes
                            }
                            else -> throw IOException("HTTP $code")
                        }
                        file.seek(downloadedBytes)
                        var received = 0L
                        conn.inputStream.use { input ->
                            val buffer = ByteArray(64 * 1024)
                            var read: Int
                            while (input.read(buffer).also { read = it } != -1) {
                                if (received + read > expected) throw IOException("Akış boyutu beklenenden büyük")
                                file.write(buffer, 0, read)
                                received += read
                                downloadedBytes += read
                                report()
                            }
                        }
                        if (received != expected) throw IOException("Bağlantı kesildi; eksik veri alındı")
                        file.fd.sync()
                        success = true
                        break
                    } catch (e: Exception) {
                        lastError = e
                        file.setLength(rollback)
                        downloadedBytes = rollback
                        // A server that ignores Range restarted the file; retry from zero next time.
                        if (rollback != start) break
                        if (attempt < 3) Thread.sleep(500L * attempt)
                    } finally { conn?.disconnect() }
                }
                if (!success) throw IOException("İndirme kesildi. Devam edebilirsiniz: ${lastError?.message}")
            }
        }
    }

    private fun selectTrackByPrefix(extractor: MediaExtractor, mimePrefix: String): Int {
        for (i in 0 until extractor.trackCount) {
            val format = extractor.getTrackFormat(i)
            val mime = format.getString(AndroidMediaFormat.KEY_MIME) ?: ""
            if (mime.startsWith(mimePrefix, ignoreCase = true)) {
                return i
            }
        }
        return -1
    }

    private fun copyTrackSamples(extractor: MediaExtractor, muxer: MediaMuxer, muxerTrackIndex: Int) {
        val buffer = ByteBuffer.allocateDirect(2 * 1024 * 1024)
        val bufferInfo = MediaCodec.BufferInfo()
        while (true) {
            val sampleSize = extractor.readSampleData(buffer, 0)
            if (sampleSize < 0) break
            bufferInfo.offset = 0
            bufferInfo.size = sampleSize
            bufferInfo.presentationTimeUs = extractor.sampleTime.coerceAtLeast(0L)
            val sampleFlags = extractor.sampleFlags
            var codecFlags = 0
            if ((sampleFlags and MediaExtractor.SAMPLE_FLAG_SYNC) != 0) {
                codecFlags = codecFlags or MediaCodec.BUFFER_FLAG_KEY_FRAME
            }
            bufferInfo.flags = codecFlags
            muxer.writeSampleData(muxerTrackIndex, buffer, bufferInfo)
            extractor.advance()
        }
    }

    private fun remuxAudioToCleanM4a(rawAudioFile: File, finalAudioFile: File) {
        if (finalAudioFile.exists()) finalAudioFile.delete()
        val extractor = MediaExtractor()
        var muxer: MediaMuxer? = null
        try {
            extractor.setDataSource(rawAudioFile.absolutePath)
            val audioTrackIndex = selectTrackByPrefix(extractor, "audio/")
            if (audioTrackIndex < 0) {
                throw IOException("Ses izi bulunamadı")
            }
            extractor.selectTrack(audioTrackIndex)
            val trackFormat = extractor.getTrackFormat(audioTrackIndex)

            muxer = MediaMuxer(finalAudioFile.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
            val dstTrack = muxer.addTrack(trackFormat)
            muxer.start()

            copyTrackSamples(extractor, muxer, dstTrack)
            muxer.stop()
        } finally {
            try {
                extractor.release()
            } catch (_: Exception) {}
            try {
                muxer?.release()
            } catch (_: Exception) {}
        }
    }

    /**
     * Görüntü ve ses paketlerini zaman damgasına (presentationTimeUs) göre sıralı (interleaved)
     * olarak birleştirir. Böylece oynatıcı diskte ileri-geri atlama yapmaz ve video kesinlikle kasmaz.
     */
    private fun muxVideoAndAudio(videoFile: File, audioFile: File, finalMp4File: File) {
        if (finalMp4File.exists()) finalMp4File.delete()
        val videoExtractor = MediaExtractor()
        val audioExtractor = MediaExtractor()
        var muxer: MediaMuxer? = null

        try {
            videoExtractor.setDataSource(videoFile.absolutePath)
            val videoTrackIdx = selectTrackByPrefix(videoExtractor, "video/")
            if (videoTrackIdx < 0) throw IOException("Video izi bulunamadı")
            videoExtractor.selectTrack(videoTrackIdx)
            val videoFormat = videoExtractor.getTrackFormat(videoTrackIdx)

            audioExtractor.setDataSource(audioFile.absolutePath)
            val audioTrackIdx = selectTrackByPrefix(audioExtractor, "audio/")
            if (audioTrackIdx < 0) throw IOException("Ses izi bulunamadı")
            audioExtractor.selectTrack(audioTrackIdx)
            val audioFormat = audioExtractor.getTrackFormat(audioTrackIdx)

            muxer = MediaMuxer(finalMp4File.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
            val muxVideoTrack = muxer.addTrack(videoFormat)
            val muxAudioTrack = muxer.addTrack(audioFormat)
            muxer.start()

            val buffer = ByteBuffer.allocateDirect(2 * 1024 * 1024) // 1080p kareler için 2 MB tampon
            val bufferInfo = MediaCodec.BufferInfo()
            var hasVideo = true
            var hasAudio = true

            while (hasVideo || hasAudio) {
                val vPts = if (hasVideo) videoExtractor.sampleTime else Long.MAX_VALUE
                val aPts = if (hasAudio) audioExtractor.sampleTime else Long.MAX_VALUE

                if (hasVideo && vPts < 0L) {
                    hasVideo = false
                    continue
                }
                if (hasAudio && aPts < 0L) {
                    hasAudio = false
                    continue
                }

                if (hasVideo && (!hasAudio || vPts <= aPts)) {
                    val sampleSize = videoExtractor.readSampleData(buffer, 0)
                    if (sampleSize < 0) {
                        hasVideo = false
                    } else {
                        bufferInfo.offset = 0
                        bufferInfo.size = sampleSize
                        bufferInfo.presentationTimeUs = vPts.coerceAtLeast(0L)
                        val sFlags = videoExtractor.sampleFlags
                        bufferInfo.flags = if ((sFlags and MediaExtractor.SAMPLE_FLAG_SYNC) != 0) {
                            MediaCodec.BUFFER_FLAG_KEY_FRAME
                        } else 0
                        muxer.writeSampleData(muxVideoTrack, buffer, bufferInfo)
                        videoExtractor.advance()
                    }
                } else if (hasAudio) {
                    val sampleSize = audioExtractor.readSampleData(buffer, 0)
                    if (sampleSize < 0) {
                        hasAudio = false
                    } else {
                        bufferInfo.offset = 0
                        bufferInfo.size = sampleSize
                        bufferInfo.presentationTimeUs = aPts.coerceAtLeast(0L)
                        val sFlags = audioExtractor.sampleFlags
                        bufferInfo.flags = if ((sFlags and MediaExtractor.SAMPLE_FLAG_SYNC) != 0) {
                            MediaCodec.BUFFER_FLAG_KEY_FRAME
                        } else 0
                        muxer.writeSampleData(muxAudioTrack, buffer, bufferInfo)
                        audioExtractor.advance()
                    }
                }
            }

            muxer.stop()
        } finally {
            try {
                videoExtractor.release()
            } catch (_: Exception) {}
            try {
                audioExtractor.release()
            } catch (_: Exception) {}
            try {
                muxer?.release()
            } catch (_: Exception) {}
        }
    }

    @ReactMethod
    fun downloadResumable(url: String, format: String, quality: String, taskId: String, promise: Promise) {
        executor.execute {
            try {
                val workDir = resumeDirectory(taskId)
                val safeUrl = requireSafeYouTubeUrl(url)
                val requestKey = "$safeUrl|$format|$quality"
                val requestFile = File(workDir, "request.txt")
                if (requestFile.exists() && requestFile.readText() != requestKey) {
                    throw IOException("İndirme kimliği başka bir içeriğe ait")
                }
                requestFile.writeText(requestKey)
                val receipt = File(workDir, "completed.json")
                if (receipt.exists()) {
                    val saved = JSONObject(receipt.readText())
                    val existing = resolveExistingFile(saved.getString("filePath"), saved.getString("fileName"))
                    if (existing != null && existing.length() > 0L) {
                        promise.resolve(Arguments.createMap().apply {
                            putString("filePath", existing.absolutePath)
                            putString("fileName", existing.name)
                            putString("fileSize", formatFileSize(existing.length()))
                        })
                        return@execute
                    }
                }
                ensureInit()
                emitProgress(2.0, 0.0, "Akış çözümleniyor...")

                val info = StreamInfo.getInfo(safeUrl)
                val downloadDir = workDir
                val safeTitle = sanitizeFileName(info.name ?: "YouTube_Medya").take(120) + "_" + taskId.removePrefix("native_")

                val isAudioOnly = format.equals("mp3", ignoreCase = true) ||
                    format.equals("m4a", ignoreCase = true) ||
                    format.equals("audio", ignoreCase = true)

                val finalFile: File

                if (isAudioOnly) {
                    val audioStream = selectBestAudioStream(info.audioStreams, quality)
                        ?: throw IOException("Bu video için uygun ses akışı bulunamadı.")

                    val ext = if (audioStream.format == MediaFormat.M4A) "m4a" else (audioStream.format?.suffix ?: "m4a")
                    finalFile = File(downloadDir, "$safeTitle.$ext")
                    val tempAudio = File(workDir, "audio.$ext.part")

                    val expectedLen = audioStream.itagItem?.contentLength ?: -1L
                    downloadStreamToFile(audioStream.content, expectedLen, tempAudio, 5.0, 92.0)

                    emitProgress(95.0, 1.0, "Ses dosyası hazırlanıyor...")
                    if (ext == "m4a") {
                        try {
                            remuxAudioToCleanM4a(tempAudio, finalFile)
                        } catch (remuxErr: Exception) {
                            Log.w(TAG, "M4A remux uyarısı, ham dosya kopyalanıyor: ${remuxErr.message}")
                            tempAudio.copyTo(finalFile, overwrite = true)
                        }
                    } else {
                        tempAudio.copyTo(finalFile, overwrite = true)
                    }
                } else {
                    val maxH = when {
                        quality.contains("1080") -> 1080
                        quality.contains("480") -> 480
                        else -> 720
                    }
                    finalFile = File(downloadDir, "${safeTitle}_${maxH}p.mp4")

                    val muxedCandidate = selectBestMuxedVideoStream(info.videoStreams, maxH)
                    val adaptiveVideo = selectBestAdaptiveVideoStream(info.videoOnlyStreams, maxH)
                    val adaptiveAudio = selectBestAudioStream(info.audioStreams, "high")

                    val adaptiveH = resolveVideoHeight(adaptiveVideo)
                    val muxedH = resolveVideoHeight(muxedCandidate)

                    // Gerçek HD (720p / 1080p) kalitesi için adaptive H.264 + M4A birleştirmesini tercih et
                    val useAdaptiveMux = adaptiveVideo != null &&
                        adaptiveAudio != null &&
                        adaptiveAudio.format == MediaFormat.M4A &&
                        (muxedCandidate == null || adaptiveH >= muxedH)

                    if (useAdaptiveMux && adaptiveVideo != null && adaptiveAudio != null) {
                        val tempVideo = File(workDir, "video.mp4.part")
                        val tempAudio = File(workDir, "audio.m4a.part")

                        val vidLen = adaptiveVideo.itagItem?.contentLength ?: -1L
                        val audLen = adaptiveAudio.itagItem?.contentLength ?: -1L

                        downloadStreamToFile(adaptiveVideo.content, vidLen, tempVideo, 5.0, 78.0)
                        downloadStreamToFile(adaptiveAudio.content, audLen, tempAudio, 78.0, 94.0)

                        emitProgress(96.0, 1.0, "HD görüntü ve ses birleştiriliyor...")
                        muxVideoAndAudio(tempVideo, tempAudio, finalFile)
                    } else if (muxedCandidate != null) {
                        val len = muxedCandidate.itagItem?.contentLength ?: -1L
                        val partial = File(workDir, "muxed.mp4.part")
                        downloadStreamToFile(muxedCandidate.content, len, partial, 5.0, 98.0)
                        partial.copyTo(finalFile, overwrite = true)
                    } else {
                        throw IOException("Bu video için uygun MP4 akışı bulunamadı.")
                    }
                }

                if (!finalFile.exists() || finalFile.length() == 0L) {
                    throw IOException("İndirilen dosya oluşturulamadı.")
                }

                val publishedFile = SharedMediaStorage.publish(reactContext, finalFile)
                emitProgress(100.0, 0.0, "Tamamlandı")

                // Galeri ve Müzik çalarların dosyayı anında görmesi için MediaScanner'a bildir
                try {
                    val mime = getMimeTypeForFile(publishedFile)
                    MediaScannerConnection.scanFile(
                        reactContext.applicationContext,
                        arrayOf(publishedFile.absolutePath),
                        arrayOf(mime),
                        null
                    )
                } catch (_: Exception) {}

                val resultMap = Arguments.createMap().apply {
                    putBoolean("success", true)
                    putString("outputDir", publishedFile.parentFile?.absolutePath)
                    putString("filePath", publishedFile.absolutePath)
                    putString("fileName", publishedFile.name)
                    putString("fileSize", formatFileSize(publishedFile.length()))
                    putString("log", "Tamamlandı: ${publishedFile.name}")
                }
                val receiptTemp = File(workDir, "completed.tmp")
                receiptTemp.writeText(JSONObject().put("filePath", publishedFile.absolutePath).put("fileName", publishedFile.name).toString())
                if (!receiptTemp.renameTo(receipt)) throw IOException("İndirme kaydı yazılamadı")
                workDir.listFiles()?.filter { it.name !in setOf("completed.json", "request.txt") }?.forEach { it.delete() }
                promise.resolve(resultMap)
            } catch (e: Exception) {
                Log.e(TAG, "Download hatası", e)
                promise.reject("DOWNLOAD_ERROR", e.localizedMessage ?: e.message ?: "İndirme başarısız oldu", e)
            }
        }
    }
}
