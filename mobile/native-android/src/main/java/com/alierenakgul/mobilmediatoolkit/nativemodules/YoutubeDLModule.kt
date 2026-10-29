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
import com.yausername.youtubedl_android.YoutubeDLRequest
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

    @ReactMethod
    fun initEngine(promise: Promise) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                ensureInit()
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("INIT_ERROR", e.localizedMessage ?: e.message ?: "Başlatma başarısız", e)
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
                promise.reject("INFO_ERROR", e.localizedMessage ?: e.message ?: "Bilgi alınamadı", e)
            }
        }
    }

    @ReactMethod
    fun download(url: String, format: String, quality: String, promise: Promise) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                ensureInit()

                val downloadDir = getStorageDir()

                val request = YoutubeDLRequest(url)
                val isMp3 = format.equals("mp3", ignoreCase = true)

                if (isMp3) {
                    request.addOption("-x")
                    request.addOption("--audio-format", "mp3")
                    request.addOption("--audio-quality", "0")
                } else {
                    val maxH = if (quality == "1080p") "1080" else "720"
                    request.addOption("-f", "bestvideo[height<=${maxH}][ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best")
                    request.addOption("--merge-output-format", "mp4")
                }

                request.addOption("-o", "${downloadDir.absolutePath}/%(title)s.%(ext)s")
                request.addOption("--no-mtime")
                request.addOption("--no-playlist")

                val response = YoutubeDL.getInstance().execute(request) { progress, etaInSeconds, line ->
                    val eventMap = Arguments.createMap().apply {
                        putDouble("progress", progress.toDouble())
                        putDouble("eta", etaInSeconds.toDouble())
                        putString("line", line ?: "")
                    }
                    reactContext
                        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                        .emit("onNativeDownloadProgress", eventMap)
                }

                val files = downloadDir.listFiles()
                val latestFile = files?.maxByOrNull { it.lastModified() }

                val resultMap = Arguments.createMap().apply {
                    putBoolean("success", true)
                    putString("outputDir", downloadDir.absolutePath)
                    putString("filePath", latestFile?.absolutePath ?: "")
                    putString("fileName", latestFile?.name ?: "")
                    putString("log", response.out ?: "")
                }
                promise.resolve(resultMap)
            } catch (e: Exception) {
                Log.e(TAG, "Download hatası", e)
                promise.reject("DOWNLOAD_ERROR", e.localizedMessage ?: e.message ?: "İndirme başarısız oldu", e)
            }
        }
    }
}
