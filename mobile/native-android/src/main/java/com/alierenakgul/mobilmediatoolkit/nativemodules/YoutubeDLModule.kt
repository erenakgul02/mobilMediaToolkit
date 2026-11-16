package com.alierenakgul.mobilmediatoolkit.nativemodules

import android.app.Dialog
import android.content.Context
import android.content.Intent
import android.content.pm.ActivityInfo
import android.content.res.ColorStateList
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.CornerPathEffect
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Typeface
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
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
import android.os.Handler
import android.os.Looper
import android.os.StatFs
import android.provider.Settings
import android.text.TextUtils
import android.util.Log
import android.util.TypedValue
import android.view.GestureDetector
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.Window
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.SeekBar
import android.widget.TextView
import android.widget.VideoView
import androidx.core.content.FileProvider
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

    @Volatile
    private var isInitialized = false

    init {
        MusicPlayerService.reactContextRef = reactContext
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

    private fun resolveExistingFile(filePathOrUrl: String?, filename: String?): File? {
        if (!filePathOrUrl.isNullOrBlank()) {
            val clean = filePathOrUrl.removePrefix("file://")
            val direct = File(clean)
            if (direct.exists()) return direct
        }
        if (!filename.isNullOrBlank()) {
            val inStorage = File(getStorageDir(), filename)
            if (inStorage.exists()) return inStorage
            val inPublicDownloads = File(
                Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),
                "MediaToolkit/$filename"
            )
            if (inPublicDownloads.exists()) return inPublicDownloads
        }
        return null
    }

    private fun getMimeTypeForFile(file: File): String {
        val ext = file.extension.lowercase()
        return when (ext) {
            "m4a", "mp4a", "aac" -> "audio/mp4"
            "mp3" -> "audio/mpeg"
            "webm", "ogg", "opus" -> "audio/*"
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
                    playVideoInAppInternal(targetFile, filename.removeSuffix(".mp4"), "MediaToolkit", promise)
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
                        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    }
                }

                val chooserTitle = if (actionType == "open") "Medya Oynatıcı Seçin" else "Dosyayı Paylaş"
                val chooser = Intent.createChooser(intent, chooserTitle).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }

                val currentActivity = reactContext.currentActivity
                if (currentActivity != null) {
                    currentActivity.startActivity(chooser)
                } else {
                    reactContext.startActivity(chooser)
                }
                promise.resolve(true)
            } catch (e: Exception) {
                Log.e(TAG, "openOrShareFile hatası", e)
                promise.reject("FILE_OPEN_ERROR", e.localizedMessage ?: "Dosya açılamadı", e)
            }
        }
    }

    private fun dpToPx(dp: Int): Int {
        return TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP,
            dp.toFloat(),
            reactContext.resources.displayMetrics
        ).toInt()
    }

    private fun formatTimeMs(ms: Int): String {
        val totalSec = (ms / 1000).coerceAtLeast(0)
        val mins = totalSec / 60
        val secs = totalSec % 60
        return String.format("%02d:%02d", mins, secs)
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
                    candidates.add(File(filePathOrUrl.removePrefix("file://")))
                }
                if (filename.isNotBlank()) {
                    candidates.add(File(getStorageDir(), filename))
                    candidates.add(
                        File(
                            Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),
                            "MediaToolkit/$filename"
                        )
                    )
                    val extFiles = reactContext.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)
                    if (extFiles != null) {
                        candidates.add(File(extFiles, "MediaToolkit/$filename"))
                    }
                    candidates.add(File(reactContext.filesDir, "MediaToolkit/$filename"))
                }

                val deletedPaths = mutableListOf<String>()
                for (f in candidates) {
                    try {
                        if (f.exists()) {
                            val abs = f.absolutePath
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

    private fun applyImmersiveFullscreen(window: Window?) {
        if (window == null) return
        try {
            window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            window.addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                val lp = window.attributes
                lp.layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
                window.attributes = lp
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                window.setDecorFitsSystemWindows(false)
                window.insetsController?.let { controller ->
                    controller.hide(WindowInsets.Type.statusBars() or WindowInsets.Type.navigationBars())
                    controller.systemBarsBehavior =
                        WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                }
            }
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = (
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    or View.SYSTEM_UI_FLAG_FULLSCREEN
                )
        } catch (_: Exception) {}
    }

    @ReactMethod
    fun playVideoInApp(
        filePathOrUrl: String,
        filename: String,
        title: String,
        uploader: String,
        promise: Promise
    ) {
        executor.execute {
            try {
                val targetFile = resolveExistingFile(filePathOrUrl, filename)
                    ?: throw IOException("Video dosyası cihazda bulunamadı: $filename")
                playVideoInAppInternal(
                    targetFile,
                    title.ifBlank { filename },
                    uploader.ifBlank { "MediaToolkit" },
                    promise
                )
            } catch (e: Exception) {
                Log.e(TAG, "playVideoInApp hatası", e)
                promise.reject("VIDEO_PLAYER_ERROR", e.localizedMessage ?: "Video oynatılamadı", e)
            }
        }
    }

    /**
     * Profesyonel vektörel medya ikonları çizen özel View (Emoji veya metin sembolü kullanmaz).
     * Her ekran yoğunluğunda (DPI) jilet gibi keskin vektör çizimi yapar.
     */
    private inner class PlayerVectorIconView(
        context: Context,
        var iconType: String
    ) : View(context) {

        private val strokePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.WHITE
            style = Paint.Style.STROKE
            strokeWidth = dpToPx(2).toFloat().coerceAtLeast(4f)
            strokeCap = Paint.Cap.ROUND
            strokeJoin = Paint.Join.ROUND
        }

        private val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.WHITE
            style = Paint.Style.FILL
            pathEffect = CornerPathEffect(dpToPx(2).toFloat())
        }

        private val labelPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.WHITE
            textAlign = Paint.Align.CENTER
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
        }

        private val path = Path()
        private val rect = RectF()

        fun updateIcon(newType: String) {
            iconType = newType
            invalidate()
        }

        override fun onDraw(canvas: Canvas) {
            super.onDraw(canvas)
            val w = width.toFloat()
            val h = height.toFloat()
            if (w <= 0f || h <= 0f) return
            val cx = w / 2f
            val cy = h / 2f

            when (iconType) {
                "back" -> {
                    // Sol ok (Arrow Left)
                    val s = minOf(w, h) * 0.28f
                    path.reset()
                    path.moveTo(cx + s * 0.2f, cy - s)
                    path.lineTo(cx - s * 0.8f, cy)
                    path.lineTo(cx + s * 0.2f, cy + s)
                    path.moveTo(cx - s * 0.7f, cy)
                    path.lineTo(cx + s * 0.95f, cy)
                    canvas.drawPath(path, strokePaint)
                }

                "play" -> {
                    // Yuvarlatılmış köşeli Oynat üçgeni
                    val r = minOf(w, h) * 0.30f
                    path.reset()
                    path.moveTo(cx - r * 0.65f, cy - r * 0.95f)
                    path.lineTo(cx + r * 1.05f, cy)
                    path.lineTo(cx - r * 0.65f, cy + r * 0.95f)
                    path.close()
                    canvas.drawPath(path, fillPaint)
                }

                "pause" -> {
                    // İki yuvarlatılmış dikey çubuk
                    val barW = minOf(w, h) * 0.13f
                    val barH = minOf(w, h) * 0.52f
                    val gap = minOf(w, h) * 0.14f
                    val corner = barW / 2f

                    rect.set(cx - gap - barW, cy - barH / 2f, cx - gap, cy + barH / 2f)
                    canvas.drawRoundRect(rect, corner, corner, fillPaint)

                    rect.set(cx + gap, cy - barH / 2f, cx + gap + barW, cy + barH / 2f)
                    canvas.drawRoundRect(rect, corner, corner, fillPaint)
                }

                "rewind10" -> {
                    // Çift sol ok (<<) + "10"
                    val s = minOf(w, h) * 0.17f
                    val topY = cy - s * 0.75f
                    path.reset()
                    path.moveTo(cx - s * 0.1f, topY - s * 0.75f)
                    path.lineTo(cx - s * 0.95f, topY)
                    path.lineTo(cx - s * 0.1f, topY + s * 0.75f)

                    path.moveTo(cx + s * 0.85f, topY - s * 0.75f)
                    path.lineTo(cx, topY)
                    path.lineTo(cx + s * 0.85f, topY + s * 0.75f)
                    canvas.drawPath(path, strokePaint)

                    labelPaint.textSize = minOf(w, h) * 0.23f
                    canvas.drawText("10s", cx, cy + s * 1.55f, labelPaint)
                }

                "forward10" -> {
                    // Çift sağ ok (>>) + "10"
                    val s = minOf(w, h) * 0.17f
                    val topY = cy - s * 0.75f
                    path.reset()
                    path.moveTo(cx - s * 0.85f, topY - s * 0.75f)
                    path.lineTo(cx, topY)
                    path.lineTo(cx - s * 0.85f, topY + s * 0.75f)

                    path.moveTo(cx + s * 0.1f, topY - s * 0.75f)
                    path.lineTo(cx + s * 0.95f, topY)
                    path.lineTo(cx + s * 0.1f, topY + s * 0.75f)
                    canvas.drawPath(path, strokePaint)

                    labelPaint.textSize = minOf(w, h) * 0.23f
                    canvas.drawText("10s", cx, cy + s * 1.55f, labelPaint)
                }

                "fullscreen" -> {
                    // 4 köşe dışa bakan tam ekran çerçeve ikonu
                    val r = minOf(w, h) * 0.27f
                    val arm = r * 0.55f
                    path.reset()
                    // Sol üst
                    path.moveTo(cx - r, cy - r + arm)
                    path.lineTo(cx - r, cy - r)
                    path.lineTo(cx - r + arm, cy - r)
                    // Sağ üst
                    path.moveTo(cx + r - arm, cy - r)
                    path.lineTo(cx + r, cy - r)
                    path.lineTo(cx + r, cy - r + arm)
                    // Sağ alt
                    path.moveTo(cx + r, cy + r - arm)
                    path.lineTo(cx + r, cy + r)
                    path.lineTo(cx + r - arm, cy + r)
                    // Sol alt
                    path.moveTo(cx - r + arm, cy + r)
                    path.lineTo(cx - r, cy + r)
                    path.lineTo(cx - r, cy + r - arm)
                    canvas.drawPath(path, strokePaint)
                }

                "exit_fullscreen" -> {
                    // 4 köşe içe bakan tam ekrandan çıkış (küçültme) ikonu
                    val r = minOf(w, h) * 0.28f
                    val inner = r * 0.36f
                    path.reset()
                    // Sol üst
                    path.moveTo(cx - r, cy - inner)
                    path.lineTo(cx - inner, cy - inner)
                    path.lineTo(cx - inner, cy - r)
                    // Sağ üst
                    path.moveTo(cx + inner, cy - r)
                    path.lineTo(cx + inner, cy - inner)
                    path.lineTo(cx + r, cy - inner)
                    // Sağ alt
                    path.moveTo(cx + r, cy + inner)
                    path.lineTo(cx + inner, cy + inner)
                    path.lineTo(cx + inner, cy + r)
                    // Sol alt
                    path.moveTo(cx - inner, cy + r)
                    path.lineTo(cx - inner, cy + inner)
                    path.lineTo(cx - r, cy + inner)
                    canvas.drawPath(path, strokePaint)
                }
            }
        }
    }

    private fun playVideoInAppInternal(
        targetFile: File,
        title: String,
        uploader: String,
        promise: Promise
    ) {
        // Arka planda şarkı çalıyorsa çakışmaması için duraklat
        MusicPlayerService.pauseIfPlaying()

        val activity = reactContext.currentActivity
        if (activity == null) {
            promise.reject("NO_ACTIVITY", "Aktif ekran bulunamadı.")
            return
        }

        val uiHandler = Handler(Looper.getMainLooper())
        uiHandler.post {
            try {
                val dialog = Dialog(activity, android.R.style.Theme_Black_NoTitleBar_Fullscreen)
                dialog.requestWindowFeature(Window.FEATURE_NO_TITLE)

                var isLandscape = false
                var isSeeking = false
                var controlsVisible = true
                var durationMs = 0
                var videoW = 16
                var videoH = 9

                val rootLayout = FrameLayout(activity).apply {
                    setBackgroundColor(Color.BLACK)
                    layoutParams = ViewGroup.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT
                    )
                }

                // Merkez VideoView
                val videoContainer = FrameLayout(activity).apply {
                    setBackgroundColor(Color.BLACK)
                    layoutParams = FrameLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        Gravity.CENTER
                    )
                }

                val videoView = VideoView(activity).apply {
                    layoutParams = FrameLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        Gravity.CENTER
                    )
                    setVideoPath(targetFile.absolutePath)
                }
                videoContainer.addView(videoView)
                rootLayout.addView(videoContainer)

                fun updateVideoBounds(explicitW: Int = 0, explicitH: Int = 0) {
                    dialog.window?.setLayout(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT
                    )
                    val dm = activity.resources.displayMetrics
                    val containerW = when {
                        explicitW > 0 -> explicitW
                        rootLayout.width > 0 -> rootLayout.width
                        else -> dm.widthPixels
                    }
                    val containerH = when {
                        explicitH > 0 -> explicitH
                        rootLayout.height > 0 -> rootLayout.height
                        else -> dm.heightPixels
                    }
                    if (containerW <= 0 || containerH <= 0 || videoW <= 0 || videoH <= 0) return
                    val vAspect = videoW.toFloat() / videoH.toFloat()
                    val cAspect = containerW.toFloat() / containerH.toFloat()
                    val (fittedW, fittedH) = if (vAspect > cAspect) {
                        containerW to (containerW / vAspect).toInt()
                    } else {
                        (containerH * vAspect).toInt() to containerH
                    }
                    val targetW = fittedW.coerceAtLeast(1)
                    val targetH = fittedH.coerceAtLeast(1)
                    val currentLp = videoView.layoutParams
                    if (currentLp == null || currentLp.width != targetW || currentLp.height != targetH) {
                        videoView.layoutParams = FrameLayout.LayoutParams(
                            targetW,
                            targetH,
                            Gravity.CENTER
                        )
                    }
                }

                // Tüm Kontrolleri Taşıyan Katman (Yumuşak geçişli sinema arayüzü)
                val overlayContainer = FrameLayout(activity).apply {
                    layoutParams = FrameLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT
                    )
                }

                val topFullscreenIconView = PlayerVectorIconView(activity, "fullscreen")
                val bottomFullscreenIconView = PlayerVectorIconView(activity, "fullscreen")
                val bottomFullscreenLabelTv = TextView(activity).apply {
                    text = "Tam Ekran"
                    setTextColor(Color.WHITE)
                    setTextSize(TypedValue.COMPLEX_UNIT_SP, 11.5f)
                    typeface = Typeface.DEFAULT_BOLD
                }

                fun syncFullscreenUiState() {
                    if (isLandscape) {
                        topFullscreenIconView.updateIcon("exit_fullscreen")
                        bottomFullscreenIconView.updateIcon("exit_fullscreen")
                        bottomFullscreenLabelTv.text = "Tam Ekrandan Çık"
                    } else {
                        topFullscreenIconView.updateIcon("fullscreen")
                        bottomFullscreenIconView.updateIcon("fullscreen")
                        bottomFullscreenLabelTv.text = "Tam Ekran"
                    }
                }

                fun toggleOrientation() {
                    isLandscape = !isLandscape
                    syncFullscreenUiState()
                    activity.requestedOrientation = if (isLandscape) {
                        ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                    } else {
                        ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
                    }
                    for (delayMs in listOf(80L, 220L, 420L)) {
                        uiHandler.postDelayed({
                            if (dialog.isShowing) {
                                applyImmersiveFullscreen(dialog.window)
                                updateVideoBounds()
                                rootLayout.requestLayout()
                            }
                        }, delayMs)
                    }
                }

                // 1. ÜST SİNEMA GRADYAN BARI (Geri İkonu + Başlık + Tam Ekran İkonu)
                val topBar = LinearLayout(activity).apply {
                    orientation = LinearLayout.HORIZONTAL
                    gravity = Gravity.CENTER_VERTICAL
                    background = GradientDrawable(
                        GradientDrawable.Orientation.TOP_BOTTOM,
                        intArrayOf(Color.parseColor("#E6000000"), Color.TRANSPARENT)
                    )
                    setPadding(dpToPx(18), dpToPx(18), dpToPx(18), dpToPx(28))
                    layoutParams = FrameLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.WRAP_CONTENT,
                        Gravity.TOP
                    )
                }

                val backBtnHolder = FrameLayout(activity).apply {
                    layoutParams = LinearLayout.LayoutParams(dpToPx(42), dpToPx(42))
                    background = GradientDrawable().apply {
                        shape = GradientDrawable.OVAL
                        setColor(Color.parseColor("#660F172A"))
                        setStroke(dpToPx(1), Color.parseColor("#33FFFFFF"))
                    }
                    addView(
                        PlayerVectorIconView(activity, "back"),
                        FrameLayout.LayoutParams(
                            ViewGroup.LayoutParams.MATCH_PARENT,
                            ViewGroup.LayoutParams.MATCH_PARENT
                        )
                    )
                    setOnClickListener {
                        dialog.dismiss()
                    }
                }

                val titleCol = LinearLayout(activity).apply {
                    orientation = LinearLayout.VERTICAL
                    layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
                        marginStart = dpToPx(14)
                        marginEnd = dpToPx(14)
                    }
                }

                val titleTv = TextView(activity).apply {
                    text = title
                    setTextColor(Color.WHITE)
                    setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
                    typeface = Typeface.DEFAULT_BOLD
                    maxLines = 1
                    ellipsize = TextUtils.TruncateAt.END
                }

                val subTv = TextView(activity).apply {
                    text = uploader
                    setTextColor(Color.parseColor("#94A3B8"))
                    setTextSize(TypedValue.COMPLEX_UNIT_SP, 11.5f)
                    maxLines = 1
                    ellipsize = TextUtils.TruncateAt.END
                }

                titleCol.addView(titleTv)
                titleCol.addView(subTv)

                val fullscreenTopBtn = FrameLayout(activity).apply {
                    layoutParams = LinearLayout.LayoutParams(dpToPx(42), dpToPx(42))
                    background = GradientDrawable().apply {
                        shape = GradientDrawable.OVAL
                        setColor(Color.parseColor("#660F172A"))
                        setStroke(dpToPx(1), Color.parseColor("#33FFFFFF"))
                    }
                    addView(
                        topFullscreenIconView,
                        FrameLayout.LayoutParams(
                            ViewGroup.LayoutParams.MATCH_PARENT,
                            ViewGroup.LayoutParams.MATCH_PARENT
                        )
                    )
                    setOnClickListener {
                        toggleOrientation()
                    }
                }

                topBar.addView(backBtnHolder)
                topBar.addView(titleCol)
                topBar.addView(fullscreenTopBtn)
                overlayContainer.addView(topBar)

                // 2. MERKEZ YÜZEN OYNATMA KONTROLLERİ (YouTube / Netflix tarzı yuvarlak cam butonlar)
                val centerControlsRow = LinearLayout(activity).apply {
                    orientation = LinearLayout.HORIZONTAL
                    gravity = Gravity.CENTER
                    layoutParams = FrameLayout.LayoutParams(
                        ViewGroup.LayoutParams.WRAP_CONTENT,
                        ViewGroup.LayoutParams.WRAP_CONTENT,
                        Gravity.CENTER
                    )
                }

                val playPauseIconView = PlayerVectorIconView(activity, "pause")

                val rwCircleBtn = FrameLayout(activity).apply {
                    layoutParams = LinearLayout.LayoutParams(dpToPx(54), dpToPx(54)).apply {
                        marginEnd = dpToPx(28)
                    }
                    background = GradientDrawable().apply {
                        shape = GradientDrawable.OVAL
                        setColor(Color.parseColor("#73090D16"))
                        setStroke(dpToPx(1), Color.parseColor("#40FFFFFF"))
                    }
                    addView(
                        PlayerVectorIconView(activity, "rewind10"),
                        FrameLayout.LayoutParams(
                            ViewGroup.LayoutParams.MATCH_PARENT,
                            ViewGroup.LayoutParams.MATCH_PARENT
                        )
                    )
                }

                val playPauseCircleBtn = FrameLayout(activity).apply {
                    layoutParams = LinearLayout.LayoutParams(dpToPx(70), dpToPx(70))
                    background = GradientDrawable().apply {
                        shape = GradientDrawable.OVAL
                        setColor(Color.parseColor("#E62563EB"))
                        setStroke(dpToPx(2), Color.parseColor("#66FFFFFF"))
                    }
                    addView(
                        playPauseIconView,
                        FrameLayout.LayoutParams(
                            ViewGroup.LayoutParams.MATCH_PARENT,
                            ViewGroup.LayoutParams.MATCH_PARENT
                        )
                    )
                }

                val ffCircleBtn = FrameLayout(activity).apply {
                    layoutParams = LinearLayout.LayoutParams(dpToPx(54), dpToPx(54)).apply {
                        marginStart = dpToPx(28)
                    }
                    background = GradientDrawable().apply {
                        shape = GradientDrawable.OVAL
                        setColor(Color.parseColor("#73090D16"))
                        setStroke(dpToPx(1), Color.parseColor("#40FFFFFF"))
                    }
                    addView(
                        PlayerVectorIconView(activity, "forward10"),
                        FrameLayout.LayoutParams(
                            ViewGroup.LayoutParams.MATCH_PARENT,
                            ViewGroup.LayoutParams.MATCH_PARENT
                        )
                    )
                }

                centerControlsRow.addView(rwCircleBtn)
                centerControlsRow.addView(playPauseCircleBtn)
                centerControlsRow.addView(ffCircleBtn)
                overlayContainer.addView(centerControlsRow)

                // 3. ALT SİNEMA GRADYAN BARI (İlerleme Çubuğu + Saniye Sayacı + Tam Ekran Butonu)
                val bottomBar = LinearLayout(activity).apply {
                    orientation = LinearLayout.VERTICAL
                    background = GradientDrawable(
                        GradientDrawable.Orientation.BOTTOM_TOP,
                        intArrayOf(Color.parseColor("#E6000000"), Color.TRANSPARENT)
                    )
                    setPadding(dpToPx(18), dpToPx(28), dpToPx(18), dpToPx(22))
                    layoutParams = FrameLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.WRAP_CONTENT,
                        Gravity.BOTTOM
                    )
                }

                val currentTimeTv = TextView(activity).apply {
                    text = "00:00"
                    setTextColor(Color.WHITE)
                    setTextSize(TypedValue.COMPLEX_UNIT_SP, 12.5f)
                    typeface = Typeface.create(Typeface.MONOSPACE, Typeface.BOLD)
                }

                val totalTimeTv = TextView(activity).apply {
                    text = "00:00"
                    setTextColor(Color.parseColor("#94A3B8"))
                    setTextSize(TypedValue.COMPLEX_UNIT_SP, 12.5f)
                    typeface = Typeface.create(Typeface.MONOSPACE, Typeface.NORMAL)
                }

                val seekBar = SeekBar(activity).apply {
                    max = 1000
                    progressTintList = ColorStateList.valueOf(Color.parseColor("#38BDF8"))
                    thumbTintList = ColorStateList.valueOf(Color.WHITE)
                    progressBackgroundTintList = ColorStateList.valueOf(Color.parseColor("#4DFFFFFF"))
                    layoutParams = LinearLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.WRAP_CONTENT
                    )
                    setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
                        override fun onProgressChanged(sb: SeekBar?, progress: Int, fromUser: Boolean) {
                            if (fromUser && durationMs > 0) {
                                val target = ((progress.toLong() * durationMs) / 1000L).toInt()
                                currentTimeTv.text = formatTimeMs(target)
                            }
                        }

                        override fun onStartTrackingTouch(sb: SeekBar?) {
                            isSeeking = true
                        }

                        override fun onStopTrackingTouch(sb: SeekBar?) {
                            if (durationMs > 0 && sb != null) {
                                val target = ((sb.progress.toLong() * durationMs) / 1000L).toInt()
                                videoView.seekTo(target)
                            }
                            isSeeking = false
                        }
                    })
                }

                val bottomMetaRow = LinearLayout(activity).apply {
                    orientation = LinearLayout.HORIZONTAL
                    gravity = Gravity.CENTER_VERTICAL
                    layoutParams = LinearLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.WRAP_CONTENT
                    ).apply {
                        topMargin = dpToPx(4)
                    }
                }

                val timeLeftContainer = LinearLayout(activity).apply {
                    orientation = LinearLayout.HORIZONTAL
                    gravity = Gravity.CENTER_VERTICAL
                    layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
                }

                val slashTv = TextView(activity).apply {
                    text = "  /  "
                    setTextColor(Color.parseColor("#64748B"))
                    setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
                }

                timeLeftContainer.addView(currentTimeTv)
                timeLeftContainer.addView(slashTv)
                timeLeftContainer.addView(totalTimeTv)

                val rotatePillBtn = LinearLayout(activity).apply {
                    orientation = LinearLayout.HORIZONTAL
                    gravity = Gravity.CENTER_VERTICAL
                    setPadding(dpToPx(12), dpToPx(6), dpToPx(12), dpToPx(6))
                    background = GradientDrawable().apply {
                        setColor(Color.parseColor("#33FFFFFF"))
                        cornerRadius = dpToPx(8).toFloat()
                    }
                    addView(
                        bottomFullscreenIconView,
                        LinearLayout.LayoutParams(dpToPx(18), dpToPx(18)).apply {
                            marginEnd = dpToPx(6)
                        }
                    )
                    addView(bottomFullscreenLabelTv)
                    setOnClickListener {
                        toggleOrientation()
                    }
                }

                bottomMetaRow.addView(timeLeftContainer)
                bottomMetaRow.addView(rotatePillBtn)

                bottomBar.addView(seekBar)
                bottomBar.addView(bottomMetaRow)
                overlayContainer.addView(bottomBar)
                rootLayout.addView(overlayContainer)

                rwCircleBtn.setOnClickListener {
                    val target = (videoView.currentPosition - 10000).coerceAtLeast(0)
                    videoView.seekTo(target)
                    currentTimeTv.text = formatTimeMs(target)
                }

                ffCircleBtn.setOnClickListener {
                    val maxPos = if (durationMs > 0) durationMs else Int.MAX_VALUE
                    val target = (videoView.currentPosition + 10000).coerceAtMost(maxPos)
                    videoView.seekTo(target)
                    currentTimeTv.text = formatTimeMs(target)
                }

                playPauseCircleBtn.setOnClickListener {
                    if (videoView.isPlaying) {
                        videoView.pause()
                        playPauseIconView.updateIcon("play")
                    } else {
                        videoView.start()
                        playPauseIconView.updateIcon("pause")
                    }
                }

                // Ekran boyutu veya yönü değiştiğinde (döndürüldüğünde) video oranını koruyarak yeniden boyutlandır
                rootLayout.addOnLayoutChangeListener { _, left, top, right, bottom, _, _, _, _ ->
                    val newW = (right - left).coerceAtLeast(0)
                    val newH = (bottom - top).coerceAtLeast(0)
                    uiHandler.post {
                        applyImmersiveFullscreen(dialog.window)
                        updateVideoBounds(newW, newH)
                    }
                }

                // Çift tıklama geri/ileri sarma (-10s / +10s) görsel bildirimi
                val doubleTapFeedbackTv = TextView(activity).apply {
                    text = "+10 sn"
                    setTextColor(Color.WHITE)
                    setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
                    typeface = Typeface.DEFAULT_BOLD
                    setPadding(dpToPx(18), dpToPx(10), dpToPx(18), dpToPx(10))
                    background = GradientDrawable().apply {
                        setColor(Color.parseColor("#B30F172A"))
                        cornerRadius = dpToPx(20).toFloat()
                        setStroke(dpToPx(1), Color.parseColor("#4DFFFFFF"))
                    }
                    visibility = View.GONE
                    alpha = 0f
                }
                rootLayout.addView(doubleTapFeedbackTv)

                fun showDoubleTapSkipBadge(isForward: Boolean) {
                    doubleTapFeedbackTv.text = if (isForward) "+10 sn >>" else "<< -10 sn"
                    val lp = FrameLayout.LayoutParams(
                        ViewGroup.LayoutParams.WRAP_CONTENT,
                        ViewGroup.LayoutParams.WRAP_CONTENT,
                        (if (isForward) Gravity.END else Gravity.START) or Gravity.CENTER_VERTICAL
                    ).apply {
                        marginStart = dpToPx(36)
                        marginEnd = dpToPx(36)
                    }
                    doubleTapFeedbackTv.layoutParams = lp
                    doubleTapFeedbackTv.visibility = View.VISIBLE
                    doubleTapFeedbackTv.animate().cancel()
                    doubleTapFeedbackTv.alpha = 1f
                    doubleTapFeedbackTv.animate()
                        .alpha(0f)
                        .setStartDelay(420L)
                        .setDuration(220L)
                        .withEndAction {
                            doubleTapFeedbackTv.visibility = View.GONE
                        }
                        .start()
                }

                // Ekrana tek dokununca kontrolleri gizle/göster, çift dokununca sol (-10s) / sağ (+10s) sar
                val gestureDetector = GestureDetector(
                    activity,
                    object : GestureDetector.SimpleOnGestureListener() {
                        override fun onDown(e: MotionEvent): Boolean = true

                        override fun onSingleTapConfirmed(e: MotionEvent): Boolean {
                            controlsVisible = !controlsVisible
                            if (controlsVisible) {
                                overlayContainer.visibility = View.VISIBLE
                                overlayContainer.animate().alpha(1f).setDuration(180L).start()
                            } else {
                                overlayContainer.animate().alpha(0f).setDuration(180L).withEndAction {
                                    if (!controlsVisible) overlayContainer.visibility = View.GONE
                                }.start()
                            }
                            applyImmersiveFullscreen(dialog.window)
                            return true
                        }

                        override fun onDoubleTap(e: MotionEvent): Boolean {
                            val totalW = videoContainer.width.coerceAtLeast(1)
                            val isRightSide = e.x >= totalW / 2f
                            if (isRightSide) {
                                val maxPos = if (durationMs > 0) durationMs else Int.MAX_VALUE
                                val target = (videoView.currentPosition + 10000).coerceAtMost(maxPos)
                                videoView.seekTo(target)
                                currentTimeTv.text = formatTimeMs(target)
                                showDoubleTapSkipBadge(true)
                            } else {
                                val target = (videoView.currentPosition - 10000).coerceAtLeast(0)
                                videoView.seekTo(target)
                                currentTimeTv.text = formatTimeMs(target)
                                showDoubleTapSkipBadge(false)
                            }
                            applyImmersiveFullscreen(dialog.window)
                            return true
                        }
                    }
                )

                videoContainer.setOnTouchListener { _, event ->
                    gestureDetector.onTouchEvent(event)
                }

                val ticker = object : Runnable {
                    override fun run() {
                        if (dialog.isShowing) {
                            try {
                                if (videoView.isPlaying && !isSeeking) {
                                    val pos = videoView.currentPosition
                                    currentTimeTv.text = formatTimeMs(pos)
                                    if (durationMs > 0) {
                                        seekBar.progress = ((pos.toLong() * 1000L) / durationMs).toInt().coerceIn(0, 1000)
                                    }
                                }
                            } catch (_: Exception) {}
                            uiHandler.postDelayed(this, 350L)
                        }
                    }
                }

                videoView.setOnPreparedListener { mp ->
                    durationMs = mp.duration.coerceAtLeast(0)
                    if (mp.videoWidth > 0 && mp.videoHeight > 0) {
                        videoW = mp.videoWidth
                        videoH = mp.videoHeight
                    }
                    mp.setOnVideoSizeChangedListener { _, w, h ->
                        if (w > 0 && h > 0) {
                            videoW = w
                            videoH = h
                            updateVideoBounds()
                        }
                    }
                    totalTimeTv.text = formatTimeMs(durationMs)
                    updateVideoBounds()
                    videoView.start()
                    playPauseIconView.updateIcon("pause")
                    uiHandler.post(ticker)
                }

                videoView.setOnCompletionListener {
                    playPauseIconView.updateIcon("play")
                    seekBar.progress = 1000
                    controlsVisible = true
                    overlayContainer.visibility = View.VISIBLE
                    overlayContainer.alpha = 1f
                }

                dialog.setOnDismissListener {
                    uiHandler.removeCallbacksAndMessages(null)
                    try {
                        videoView.stopPlayback()
                    } catch (_: Exception) {}
                    try {
                        activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
                        for (delayMs in listOf(100L, 280L)) {
                            uiHandler.postDelayed({
                                activity.window?.decorView?.requestLayout()
                            }, delayMs)
                        }
                    } catch (_: Exception) {}
                }

                dialog.setContentView(rootLayout)
                dialog.window?.setBackgroundDrawable(ColorDrawable(Color.BLACK))
                dialog.window?.setLayout(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT
                )
                dialog.show()
                applyImmersiveFullscreen(dialog.window)
                promise.resolve(true)
            } catch (e: Exception) {
                Log.e(TAG, "Uygulama içi video oynatıcı hatası", e)
                promise.reject("VIDEO_DIALOG_ERROR", e.localizedMessage ?: "Video ekranı açılamadı", e)
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
                        uploader = map.getString("uploader") ?: map.getString("channel") ?: "MediaToolkit",
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
                MusicPlayerService.reactContextRef = reactContext
                ensureInit()
                val info = StreamInfo.getInfo(url)

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
                ensureInit()
                val playlistInfo = PlaylistInfo.getInfo(ServiceList.YouTube, url)
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
                val outFile = File(getStorageDir(), outName)
                if (outFile.exists()) outFile.delete()

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
                try {
                    extractor.release()
                } catch (_: Exception) {}
                try {
                    muxer?.release()
                } catch (_: Exception) {}
            }
        }
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
                        val tempVideo = File(reactContext.cacheDir, "temp_vid_${System.currentTimeMillis()}.mp4")
                        val tempAudio = File(reactContext.cacheDir, "temp_aud_${System.currentTimeMillis()}.m4a")
                        tempFiles.add(tempVideo)
                        tempFiles.add(tempAudio)

                        val vidLen = adaptiveVideo.itagItem?.contentLength ?: -1L
                        val audLen = adaptiveAudio.itagItem?.contentLength ?: -1L

                        downloadStreamToFile(adaptiveVideo.content, vidLen, tempVideo, 5.0, 78.0)
                        downloadStreamToFile(adaptiveAudio.content, audLen, tempAudio, 78.0, 94.0)

                        emitProgress(96.0, 1.0, "HD görüntü ve ses birleştiriliyor...")
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
                    val mime = getMimeTypeForFile(finalFile)
                    MediaScannerConnection.scanFile(
                        reactContext.applicationContext,
                        arrayOf(finalFile.absolutePath),
                        arrayOf(mime),
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
