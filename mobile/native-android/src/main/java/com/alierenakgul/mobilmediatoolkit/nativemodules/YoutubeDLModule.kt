package com.alierenakgul.mobilmediatoolkit.nativemodules

import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat as AndroidMediaFormat
import android.media.MediaMuxer
import android.media.MediaScannerConnection
import android.os.Environment
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import org.schabi.newpipe.extractor.MediaFormat
import org.schabi.newpipe.extractor.NewPipe
import org.schabi.newpipe.extractor.downloader.Downloader
import org.schabi.newpipe.extractor.downloader.Request
import org.schabi.newpipe.extractor.downloader.Response
import org.schabi.newpipe.extractor.exceptions.ReCaptchaException
import org.schabi.newpipe.extractor.localization.ContentCountry
import org.schabi.newpipe.extractor.localization.Localization
import org.schabi.newpipe.extractor.services.youtube.YoutubeParsingHelper
import org.schabi.newpipe.extractor.stream.AudioStream
import org.schabi.newpipe.extractor.stream.AudioTrackType
import org.schabi.newpipe.extractor.stream.StreamInfo
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

    @Volatile
    private var isInitialized = false

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

    private fun getStorageDir(): File {
        return try {
            val publicDir = File(
                Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),
                "MediaToolkit"
            )
            if (publicDir.exists() || publicDir.mkdirs()) {
                publicDir
            } else {
                val appDir = File(
                    reactContext.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS) ?: reactContext.filesDir,
                    "MediaToolkit"
                )
                if (!appDir.exists()) appDir.mkdirs()
                appDir
            }
        } catch (e: Exception) {
            val fallback = File(reactContext.filesDir, "MediaToolkit")
            if (!fallback.exists()) fallback.mkdirs()
            fallback
        }
    }

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
    fun getVideoInfo(url: String, promise: Promise) {
        executor.execute {
            try {
                ensureInit()
                val info = StreamInfo.getInfo(url)
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

    private fun selectBestAdaptiveVideoStream(streams: List<VideoStream>, maxHeight: Int): VideoStream? {
        val valid = streams.filter { it.isUrl() && it.content.isNotEmpty() }
        if (valid.isEmpty()) return null

        // MediaMuxer ve tüm cihazlarla %100 uyum için MPEG_4 + avc1 (H.264) tercih et
        val mp4Avc = valid.filter {
            it.format == MediaFormat.MPEG_4 &&
                (it.codec.isNullOrEmpty() || it.codec.startsWith("avc1", ignoreCase = true))
        }
        val mp4All = valid.filter { it.format == MediaFormat.MPEG_4 }
        val pool = when {
            mp4Avc.isNotEmpty() -> mp4Avc
            mp4All.isNotEmpty() -> mp4All
            else -> valid
        }

        val withinTarget = pool.filter { it.height in 1..maxHeight }
        val targetPool = withinTarget.ifEmpty { pool }

        return targetPool.maxWithOrNull(compareBy<VideoStream> { it.height }.thenBy { it.bitrate })
    }

    private fun selectBestMuxedVideoStream(streams: List<VideoStream>, maxHeight: Int): VideoStream? {
        val valid = streams.filter { it.isUrl() && it.content.isNotEmpty() }
        if (valid.isEmpty()) return null

        val mp4Pool = valid.filter { it.format == MediaFormat.MPEG_4 }.ifEmpty { valid }
        val withinTarget = mp4Pool.filter { it.height in 1..maxHeight }
        val targetPool = withinTarget.ifEmpty { mp4Pool }

        return targetPool.maxWithOrNull(compareBy<VideoStream> { it.height }.thenBy { it.bitrate })
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
        if (outputFile.exists()) outputFile.delete()
        val totalBytes = resolveContentLength(streamUrl, expectedLength)
        val startTimeMs = System.currentTimeMillis()
        var downloadedBytes = 0L

        fun report(currentBytes: Long) {
            val elapsedSec = max(0.2, (System.currentTimeMillis() - startTimeMs) / 1000.0)
            val speedBps = currentBytes / elapsedSec
            val speedStr = if (speedBps >= 1024 * 1024) {
                String.format("%.1f MB/s", speedBps / (1024.0 * 1024.0))
            } else {
                String.format("%.0f KB/s", speedBps / 1024.0)
            }

            if (totalBytes > 0L) {
                val ratio = (currentBytes.toDouble() / totalBytes.toDouble()).coerceIn(0.0, 1.0)
                val mappedProgress = progressStart + ratio * (progressEnd - progressStart)
                val remainingBytes = (totalBytes - currentBytes).coerceAtLeast(0L)
                val etaSec = if (speedBps > 1024) remainingBytes / speedBps else 0.0
                emitProgress(mappedProgress, etaSec, speedStr)
            } else {
                emitProgress((progressStart + progressEnd) / 2.0, 0.0, speedStr)
            }
        }

        // YouTube hız kısıtlamasını (throttling) aşmak için 2 MB bloklar halinde indir
        if (totalBytes > 0L) {
            val chunkSize = 2L * 1024L * 1024L // 2 MB
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
                                    report(downloadedBytes)
                                }
                            }
                            chunkSuccess = true
                            if (code == 200) {
                                // Sunucu tüm dosyayı tek seferde gönderdi
                                return
                            }
                        } catch (e: Exception) {
                            lastError = e
                            Log.w(TAG, "Parça indirme denemesi $attempt başarısız ($rangeStart-$rangeEnd): ${e.message}")
                            Thread.sleep(300L * attempt)
                        } finally {
                            conn?.disconnect()
                        }
                    }

                    if (!chunkSuccess) {
                        throw IOException("Akış indirilemedi: ${lastError?.localizedMessage ?: "Bağlantı hatası"}")
                    }
                }
            }
        } else {
            // Boyut bilinmiyorsa doğrudan tek akış olarak indir
            val conn = openStreamConnection(streamUrl, -1L, -1L, usePost = false)
            try {
                val code = conn.responseCode
                if (code !in 200..299) {
                    throw IOException("HTTP $code")
                }
                FileOutputStream(outputFile).use { fos ->
                    conn.inputStream.use { input ->
                        val buffer = ByteArray(64 * 1024)
                        var read: Int
                        while (input.read(buffer).also { read = it } != -1) {
                            fos.write(buffer, 0, read)
                            downloadedBytes += read
                            report(downloadedBytes)
                        }
                    }
                }
            } finally {
                conn.disconnect()
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
        val buffer = ByteBuffer.allocateDirect(512 * 1024)
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

            copyTrackSamples(videoExtractor, muxer, muxVideoTrack)
            copyTrackSamples(audioExtractor, muxer, muxAudioTrack)

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
    fun download(url: String, format: String, quality: String, promise: Promise) {
        executor.execute {
            val tempFiles = mutableListOf<File>()
            try {
                ensureInit()
                emitProgress(2.0, 0.0, "Akış çözümleniyor...")

                val info = StreamInfo.getInfo(url)
                val downloadDir = getStorageDir()
                val safeTitle = sanitizeFileName(info.name ?: "YouTube_Medya")

                val isAudioOnly = format.equals("mp3", ignoreCase = true) ||
                    format.equals("m4a", ignoreCase = true) ||
                    format.equals("audio", ignoreCase = true)

                val finalFile: File

                if (isAudioOnly) {
                    val audioStream = selectBestAudioStream(info.audioStreams, quality)
                        ?: throw IOException("Bu video için uygun ses akışı bulunamadı.")

                    val ext = if (audioStream.format == MediaFormat.M4A) "m4a" else (audioStream.format?.suffix ?: "m4a")
                    finalFile = File(downloadDir, "$safeTitle.$ext")
                    val tempAudio = File(reactContext.cacheDir, "temp_audio_${System.currentTimeMillis()}.$ext")
                    tempFiles.add(tempAudio)

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
                    val maxH = if (quality.contains("1080")) 1080 else 720
                    finalFile = File(downloadDir, "${safeTitle}_${maxH}p.mp4")

                    // Önce hedef çözünürlükte hazır birleşik (muxed) MP4 var mı kontrol et
                    val muxedCandidate = selectBestMuxedVideoStream(info.videoStreams, maxH)
                    val adaptiveVideo = selectBestAdaptiveVideoStream(info.videoOnlyStreams, maxH)
                    val adaptiveAudio = selectBestAudioStream(info.audioStreams, "high")

                    val useAdaptiveMux = adaptiveVideo != null &&
                        adaptiveAudio != null &&
                        adaptiveAudio.format == MediaFormat.M4A &&
                        (muxedCandidate == null || adaptiveVideo.height > muxedCandidate.height)

                    if (useAdaptiveMux && adaptiveVideo != null && adaptiveAudio != null) {
                        val tempVideo = File(reactContext.cacheDir, "temp_vid_${System.currentTimeMillis()}.mp4")
                        val tempAudio = File(reactContext.cacheDir, "temp_aud_${System.currentTimeMillis()}.m4a")
                        tempFiles.add(tempVideo)
                        tempFiles.add(tempAudio)

                        val vidLen = adaptiveVideo.itagItem?.contentLength ?: -1L
                        val audLen = adaptiveAudio.itagItem?.contentLength ?: -1L

                        downloadStreamToFile(adaptiveVideo.content, vidLen, tempVideo, 5.0, 78.0)
                        downloadStreamToFile(adaptiveAudio.content, audLen, tempAudio, 78.0, 94.0)

                        emitProgress(96.0, 1.0, "Görüntü ve ses birleştiriliyor...")
                        muxVideoAndAudio(tempVideo, tempAudio, finalFile)
                    } else if (muxedCandidate != null) {
                        val len = muxedCandidate.itagItem?.contentLength ?: -1L
                        downloadStreamToFile(muxedCandidate.content, len, finalFile, 5.0, 98.0)
                    } else {
                        throw IOException("Bu video için uygun MP4 akışı bulunamadı.")
                    }
                }

                // Geçici dosyaları temizle
                tempFiles.forEach {
                    try {
                        if (it.exists()) it.delete()
                    } catch (_: Exception) {}
                }

                if (!finalFile.exists() || finalFile.length() == 0L) {
                    throw IOException("İndirilen dosya oluşturulamadı.")
                }

                emitProgress(100.0, 0.0, "Tamamlandı")

                // Galeri ve Müzik çalarların dosyayı anında görmesi için MediaScanner'a bildir
                try {
                    MediaScannerConnection.scanFile(
                        reactContext.applicationContext,
                        arrayOf(finalFile.absolutePath),
                        null,
                        null
                    )
                } catch (_: Exception) {}

                val resultMap = Arguments.createMap().apply {
                    putBoolean("success", true)
                    putString("outputDir", downloadDir.absolutePath)
                    putString("filePath", finalFile.absolutePath)
                    putString("fileName", finalFile.name)
                    putString("fileSize", formatFileSize(finalFile.length()))
                    putString("log", "Tamamlandı: ${finalFile.name}")
                }
                promise.resolve(resultMap)
            } catch (e: Exception) {
                tempFiles.forEach {
                    try {
                        if (it.exists()) it.delete()
                    } catch (_: Exception) {}
                }
                Log.e(TAG, "Download hatası", e)
                promise.reject("DOWNLOAD_ERROR", e.localizedMessage ?: e.message ?: "İndirme başarısız oldu", e)
            }
        }
    }
}
