package com.alierenakgul.mobilmediatoolkit.nativemodules

import android.os.Environment
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.yausername.ffmpeg.FFmpeg
import com.yausername.youtubedl_android.YoutubeDL
import com.yausername.youtubedl_android.YoutubeDL.UpdateChannel
import com.yausername.youtubedl_android.YoutubeDLRequest
import com.yausername.youtubedl_android.YoutubeDLResponse
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.io.File

class YoutubeDLModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    private val TAG = "YoutubeDLModule"
    private var isInitialized = false

    override fun getName(): String = "YoutubeDLNative"

    @ReactMethod
    fun isAvailable(promise: Promise) {
        promise.resolve(true)
    }

    @Synchronized
    private fun ensureInit() {
        if (!isInitialized) {
            try {
                Log.d(TAG, "YoutubeDL başlatılıyor...")
                YoutubeDL.getInstance().init(reactContext.applicationContext)
                isInitialized = true
                Log.d(TAG, "YoutubeDL başarıyla başlatıldı.")
            } catch (e: Exception) {
                val msg = e.localizedMessage ?: e.message ?: "Bilinmeyen hata"
                Log.e(TAG, "YoutubeDL init hatası: $msg", e)
                if (msg.contains("already initialized", ignoreCase = true)) {
                    isInitialized = true
                } else {
                    throw RuntimeException("Motor başlatılamadı: $msg", e)
                }
            }

            try {
                Log.d(TAG, "FFmpeg başlatılıyor...")
                FFmpeg.getInstance().init(reactContext.applicationContext)
                Log.d(TAG, "FFmpeg başarıyla başlatıldı.")
            } catch (fe: Exception) {
                Log.w(TAG, "FFmpeg init uyarısı (isteğe bağlı): ${fe.localizedMessage}")
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

    private fun cleanErrorMessage(rawMsg: String): String {
        val lines = rawMsg.lines()
        // WARNING veya uzun bilgilendirmeleri temizleyip sadece gerçek ERROR satırını göster
        val errorLine = lines.lastOrNull { it.trim().startsWith("ERROR:", ignoreCase = true) }
        if (errorLine != null) {
            return errorLine.replace("ERROR:", "").trim()
        }
        val nonWarningLines = lines.filter { !it.trim().startsWith("WARNING:", ignoreCase = true) && it.isNotBlank() }
        if (nonWarningLines.isNotEmpty()) {
            return nonWarningLines.last().trim()
        }
        return rawMsg.take(200)
    }

    @ReactMethod
    fun initEngine(promise: Promise) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                ensureInit()
                // Motoru arka planda en güncel sürüme güncelle (YouTube SABR ve 403 engellerini tamamen çözer)
                try {
                    Log.d(TAG, "yt-dlp en güncel sürüme güncelleniyor...")
                    YoutubeDL.getInstance().updateYoutubeDL(reactContext.applicationContext, UpdateChannel.NIGHTLY)
                    Log.d(TAG, "yt-dlp başarıyla güncellendi.")
                } catch (ue: Exception) {
                    Log.w(TAG, "yt-dlp güncelleme uyarısı: ${ue.localizedMessage}")
                }
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("INIT_ERROR", cleanErrorMessage(e.localizedMessage ?: e.message ?: "Başlatma başarısız"), e)
            }
        }
    }

    @ReactMethod
    fun updateEngine(promise: Promise) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                ensureInit()
                val status = YoutubeDL.getInstance().updateYoutubeDL(reactContext.applicationContext, UpdateChannel.NIGHTLY)
                promise.resolve(status?.name ?: "DONE")
            } catch (e: Exception) {
                Log.w(TAG, "updateEngine hatası", e)
                promise.reject("UPDATE_ERROR", cleanErrorMessage(e.localizedMessage ?: e.message ?: "Güncelleme hatası"), e)
            }
        }
    }

    @ReactMethod
    fun getVideoInfo(url: String, promise: Promise) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                ensureInit()
                val request = YoutubeDLRequest(url)
                request.addOption("--dump-single-json")
                request.addOption("--no-playlist")
                request.addOption("--no-update")
                // YouTube SABR 403 engeli için android/web istemcisi
                request.addOption("--extractor-args", "youtube:player-client=android,web")

                val streamInfo = YoutubeDL.getInstance().getInfo(request)
                
                val map = Arguments.createMap().apply {
                    putString("title", streamInfo.title ?: "YouTube Medya")
                    putString("thumbnail", streamInfo.thumbnail ?: "")
                    putInt("duration", streamInfo.duration)
                    putString("uploader", streamInfo.uploader ?: "")
                    putString("url", url)
                }
                promise.resolve(map)
            } catch (e: Exception) {
                Log.e(TAG, "getVideoInfo hatası", e)
                promise.reject("INFO_ERROR", cleanErrorMessage(e.localizedMessage ?: e.message ?: "Bilgi alınamadı"), e)
            }
        }
    }

    @ReactMethod
    fun download(url: String, format: String, quality: String, promise: Promise) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                ensureInit()

                val downloadDir = getStorageDir()
                val isMp3 = format.equals("mp3", ignoreCase = true)

                fun buildRequest(playerClient: String): YoutubeDLRequest {
                    val req = YoutubeDLRequest(url)
                    req.addOption("--no-update")
                    req.addOption("--no-mtime")
                    req.addOption("--no-playlist")
                    req.addOption("--extractor-args", "youtube:player-client=$playerClient")

                    if (isMp3) {
                        req.addOption("-x")
                        req.addOption("--audio-format", "mp3")
                        req.addOption("--audio-quality", "0")
                    } else {
                        val maxH = if (quality == "1080p") "1080" else "720"
                        req.addOption("-f", "bestvideo[height<=${maxH}][ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best")
                        req.addOption("--merge-output-format", "mp4")
                    }
                    req.addOption("-o", "${downloadDir.absolutePath}/%(title)s.%(ext)s")
                    return req
                }

                var response: YoutubeDLResponse? = null

                try {
                    val primaryReq = buildRequest("android,web")
                    response = YoutubeDL.getInstance().execute(primaryReq) { progress, etaInSeconds, line ->
                        val eventMap = Arguments.createMap().apply {
                            putDouble("progress", progress.toDouble())
                            putDouble("eta", etaInSeconds.toDouble())
                            putString("line", line ?: "")
                        }
                        reactContext
                            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                            .emit("onNativeDownloadProgress", eventMap)
                    }
                } catch (firstErr: Exception) {
                    val errMsg = firstErr.message ?: ""
                    if (errMsg.contains("403") || errMsg.contains("SABR", ignoreCase = true)) {
                        Log.w(TAG, "İlk denemede 403/SABR alındı, TV istemcisiyle tekrar deneniyor...")
                        val fallbackReq = buildRequest("tv")
                        response = YoutubeDL.getInstance().execute(fallbackReq) { progress, etaInSeconds, line ->
                            val eventMap = Arguments.createMap().apply {
                                putDouble("progress", progress.toDouble())
                                putDouble("eta", etaInSeconds.toDouble())
                                putString("line", line ?: "")
                            }
                            reactContext
                                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                                .emit("onNativeDownloadProgress", eventMap)
                        }
                    } else {
                        throw firstErr
                    }
                }

                val files = downloadDir.listFiles()
                val latestFile = files?.maxByOrNull { it.lastModified() }

                val resultMap = Arguments.createMap().apply {
                    putBoolean("success", true)
                    putString("outputDir", downloadDir.absolutePath)
                    putString("filePath", latestFile?.absolutePath ?: "")
                    putString("fileName", latestFile?.name ?: "")
                    putString("log", response?.out ?: "")
                }
                promise.resolve(resultMap)
            } catch (e: Exception) {
                Log.e(TAG, "Download hatası", e)
                promise.reject("DOWNLOAD_ERROR", cleanErrorMessage(e.localizedMessage ?: e.message ?: "İndirme başarısız oldu"), e)
            }
        }
    }
}
