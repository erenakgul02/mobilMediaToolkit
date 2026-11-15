package com.alierenakgul.mobilmediatoolkit.nativemodules

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.BitmapShader
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Shader
import android.media.AudioAttributes
import android.media.MediaMetadata
import android.media.MediaPlayer
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.util.Log
import android.util.LruCache
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import kotlin.math.min

data class PlaylistTrack(
    val id: String,
    val title: String,
    val uploader: String,
    val filePath: String,
    val filename: String,
    val thumbnail: String = "",
    val durationSec: Int = 0
)

class MusicPlayerService : Service() {

    companion object {
        private const val TAG = "MusicPlayerService"
        const val CHANNEL_ID = "MediaToolkit_Music_Channel"
        const val NOTIFICATION_ID = 4042

        const val ACTION_PLAY_PAUSE = "com.alierenakgul.mobilmediatoolkit.ACTION_PLAY_PAUSE"
        const val ACTION_NEXT = "com.alierenakgul.mobilmediatoolkit.ACTION_NEXT"
        const val ACTION_PREV = "com.alierenakgul.mobilmediatoolkit.ACTION_PREV"
        const val ACTION_STOP = "com.alierenakgul.mobilmediatoolkit.ACTION_STOP"

        @Volatile
        var reactContextRef: ReactApplicationContext? = null

        @Volatile
        private var instance: MusicPlayerService? = null

        private val playlist = mutableListOf<PlaylistTrack>()
        private var currentIndex: Int = -1
        private var isPlayingState: Boolean = false
        private var currentPositionMs: Int = 0
        private var currentDurationMs: Int = 0

        private val bitmapCache = object : LruCache<String, Bitmap>(16) {}
        private val artExecutor = Executors.newSingleThreadExecutor()

        @Synchronized
        fun startPlayback(context: Context, tracks: List<PlaylistTrack>, startIndex: Int) {
            playlist.clear()
            playlist.addAll(tracks)
            currentIndex = startIndex.coerceIn(0, (tracks.size - 1).coerceAtLeast(0))

            val intent = Intent(context, MusicPlayerService::class.java).apply {
                action = "START_TRACK"
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun sendCommand(context: Context, actionName: String) {
            val svc = instance
            if (svc != null) {
                svc.handleAction(actionName)
            } else if (playlist.isNotEmpty()) {
                val intent = Intent(context, MusicPlayerService::class.java).apply {
                    action = actionName
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(intent)
                } else {
                    context.startService(intent)
                }
            }
        }

        fun pauseIfPlaying() {
            val svc = instance ?: return
            if (isPlayingState) {
                svc.handleAction(ACTION_PLAY_PAUSE)
            }
        }

        fun seekToPosition(posMs: Int) {
            instance?.seekToInternal(posMs)
        }

        fun getCurrentStateMap() = Arguments.createMap().apply {
            val track = playlist.getOrNull(currentIndex)
            putBoolean("isActive", track != null && instance != null)
            putBoolean("isPlaying", isPlayingState)
            putInt("currentIndex", currentIndex)
            putInt("playlistCount", playlist.size)
            putDouble("positionMs", currentPositionMs.toDouble())
            putDouble("durationMs", currentDurationMs.toDouble())
            if (track != null) {
                putString("id", track.id)
                putString("title", track.title)
                putString("uploader", track.uploader)
                putString("filename", track.filename)
                putString("filePath", track.filePath)
                putString("thumbnail", track.thumbnail)
            }
        }

        private fun emitStateToRN() {
            val ctx = reactContextRef ?: return
            try {
                val map = getCurrentStateMap()
                ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                    .emit("onMusicPlayerStateChanged", map)
            } catch (_: Exception) {
            }
        }

        /**
         * Video kapak resmini şık bir "Plak (Vinyl Record)" tasarımına dönüştürür.
         * Bildirim çubuğunda her şarkı geçişinde yalnızca 1 kez üretilip önbelleğe alındığı için
         * telefonun işlemcisini veya pilini kesinlikle yormaz (%0 arka plan CPU kullanımı).
         */
        fun createVinylRecordBitmap(source: Bitmap?): Bitmap {
            val size = 320
            val center = size / 2f
            val outerRadius = size / 2f - 4f
            val output = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
            val canvas = Canvas(output)
            val paint = Paint(Paint.ANTI_ALIAS_FLAG)

            // 1. Dış Siyah Plak Gövdesi
            paint.style = Paint.Style.FILL
            paint.color = Color.parseColor("#111827")
            canvas.drawCircle(center, center, outerRadius, paint)

            // 2. İnce Plak İzleri (Grooves)
            paint.style = Paint.Style.STROKE
            paint.strokeWidth = 1.5f
            paint.color = Color.parseColor("#1F2937")
            canvas.drawCircle(center, center, outerRadius - 10f, paint)
            canvas.drawCircle(center, center, outerRadius - 20f, paint)
            paint.color = Color.parseColor("#374151")
            canvas.drawCircle(center, center, outerRadius - 28f, paint)

            // 3. İç Kapak Resmi (Yuvarlak Kesim - Plak Etiketi)
            val coverRadius = outerRadius * 0.72f
            if (source != null && !source.isRecycled) {
                val shader = BitmapShader(source, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP)
                val matrix = Matrix()
                val minDim = min(source.width, source.height).toFloat().coerceAtLeast(1f)
                val scale = (coverRadius * 2f) / minDim
                matrix.setScale(scale, scale)
                matrix.postTranslate(
                    center - (source.width * scale) / 2f,
                    center - (source.height * scale) / 2f
                )
                shader.setLocalMatrix(matrix)

                val coverPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                    this.shader = shader
                    style = Paint.Style.FILL
                }
                canvas.drawCircle(center, center, coverRadius, coverPaint)
            } else {
                paint.style = Paint.Style.FILL
                paint.color = Color.parseColor("#4F46E5")
                canvas.drawCircle(center, center, coverRadius, paint)
            }

            // 4. Kapak Etrafı İnce Mor/İndigo Halka
            paint.style = Paint.Style.STROKE
            paint.strokeWidth = 3f
            paint.color = Color.parseColor("#6366F1")
            canvas.drawCircle(center, center, coverRadius, paint)

            // 5. Plak Merkez Göbek Halkası ve Deliği
            paint.style = Paint.Style.FILL
            paint.color = Color.parseColor("#111827")
            canvas.drawCircle(center, center, 22f, paint)

            paint.color = Color.parseColor("#E5E7EB")
            canvas.drawCircle(center, center, 9f, paint)

            return output
        }
    }

    private var mediaPlayer: MediaPlayer? = null
    private var mediaSession: MediaSession? = null
    private val mainHandler = Handler(Looper.getMainLooper())
    private var currentVinylBitmap: Bitmap? = null

    private val progressRunnable = object : Runnable {
        override fun run() {
            val mp = mediaPlayer
            if (mp != null && isPlayingState) {
                try {
                    currentPositionMs = mp.currentPosition
                    currentDurationMs = mp.duration.coerceAtLeast(0)
                    updateMediaSessionPlaybackState()
                    emitStateToRN()
                } catch (_: Exception) {
                }
            }
            mainHandler.postDelayed(this, 800L)
        }
    }

    override fun onCreate() {
        super.onCreate()
        instance = this
        createNotificationChannel()
        initMediaSession()
        mainHandler.post(progressRunnable)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            "START_TRACK" -> playCurrentTrack()
            ACTION_PLAY_PAUSE -> togglePlayPause()
            ACTION_NEXT -> skipToNext()
            ACTION_PREV -> skipToPrevious()
            ACTION_STOP -> stopPlayerAndService()
        }
        return START_NOT_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        mainHandler.removeCallbacksAndMessages(null)
        releaseMediaPlayer()
        try {
            mediaSession?.isActive = false
            mediaSession?.release()
        } catch (_: Exception) {}
        mediaSession = null
        isPlayingState = false
        instance = null
        emitStateToRN()
        super.onDestroy()
    }

    fun handleAction(action: String) {
        mainHandler.post {
            when (action) {
                ACTION_PLAY_PAUSE -> togglePlayPause()
                ACTION_NEXT -> skipToNext()
                ACTION_PREV -> skipToPrevious()
                ACTION_STOP -> stopPlayerAndService()
            }
        }
    }

    fun seekToInternal(posMs: Int) {
        mainHandler.post {
            try {
                val mp = mediaPlayer ?: return@post
                val target = posMs.coerceIn(0, currentDurationMs.coerceAtLeast(0))
                mp.seekTo(target)
                currentPositionMs = target
                updateMediaSessionPlaybackState()
                emitStateToRN()
            } catch (_: Exception) {}
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            val channel = NotificationChannel(
                CHANNEL_ID,
                "MediaToolkit Müzik Çalar",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "İndirilen şarkıları arka planda oynatma kontrolleri"
                setShowBadge(false)
            }
            nm.createNotificationChannel(channel)
        }
    }

    private fun initMediaSession() {
        mediaSession = MediaSession(this, "MediaToolkitMusicSession").apply {
            setCallback(object : MediaSession.Callback() {
                override fun onPlay() {
                    if (!isPlayingState) togglePlayPause()
                }

                override fun onPause() {
                    if (isPlayingState) togglePlayPause()
                }

                override fun onSkipToNext() {
                    skipToNext()
                }

                override fun onSkipToPrevious() {
                    skipToPrevious()
                }

                override fun onSeekTo(pos: Long) {
                    seekToInternal(pos.toInt())
                }

                override fun onStop() {
                    stopPlayerAndService()
                }
            })
            isActive = true
        }
    }

    private fun loadVinylArtworkForTrack(track: PlaylistTrack) {
        val thumbUrl = track.thumbnail.trim()
        if (thumbUrl.isEmpty()) {
            val fallbackVinyl = bitmapCache.get("__default_vinyl__")
                ?: createVinylRecordBitmap(null).also { bitmapCache.put("__default_vinyl__", it) }
            currentVinylBitmap = fallbackVinyl
            updateMediaSessionMetadata(track, currentDurationMs.toLong(), fallbackVinyl)
            startOrUpdateForegroundNotification(track)
            return
        }

        val cached = bitmapCache.get(thumbUrl)
        if (cached != null) {
            currentVinylBitmap = cached
            updateMediaSessionMetadata(track, currentDurationMs.toLong(), cached)
            startOrUpdateForegroundNotification(track)
            return
        }

        // Önce varsayılan plak görselini hazırla, ardından kapak resmini arka planda indirip güncelle
        val defaultVinyl = bitmapCache.get("__default_vinyl__")
            ?: createVinylRecordBitmap(null).also { bitmapCache.put("__default_vinyl__", it) }
        currentVinylBitmap = defaultVinyl

        artExecutor.execute {
            try {
                val conn = (URL(thumbUrl).openConnection() as HttpURLConnection).apply {
                    connectTimeout = 8000
                    readTimeout = 8000
                    instanceFollowRedirects = true
                }
                val rawBmp = conn.inputStream.use { BitmapFactory.decodeStream(it) }
                conn.disconnect()
                if (rawBmp != null) {
                    val vinylBmp = createVinylRecordBitmap(rawBmp)
                    bitmapCache.put(thumbUrl, vinylBmp)
                    mainHandler.post {
                        val activeTrack = playlist.getOrNull(currentIndex)
                        if (activeTrack != null && activeTrack.id == track.id) {
                            currentVinylBitmap = vinylBmp
                            updateMediaSessionMetadata(activeTrack, currentDurationMs.toLong(), vinylBmp)
                            startOrUpdateForegroundNotification(activeTrack)
                        }
                    }
                }
            } catch (e: Exception) {
                Log.w(TAG, "Kapak resmi indirilemedi: ${e.message}")
            }
        }
    }

    private fun playCurrentTrack() {
        val track = playlist.getOrNull(currentIndex)
        if (track == null) {
            stopPlayerAndService()
            return
        }

        val cleanPath = track.filePath.removePrefix("file://")
        val file = File(cleanPath)
        if (!file.exists()) {
            Log.e(TAG, "Ses dosyası bulunamadı: $cleanPath")
            stopPlayerAndService()
            return
        }

        releaseMediaPlayer()
        loadVinylArtworkForTrack(track)

        try {
            val mp = MediaPlayer().apply {
                setWakeMode(applicationContext, PowerManager.PARTIAL_WAKE_LOCK)
                setAudioAttributes(
                    AudioAttributes.Builder()
                        .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .build()
                )
                setDataSource(file.absolutePath)
                setOnPreparedListener { player ->
                    currentDurationMs = player.duration.coerceAtLeast(0)
                    currentPositionMs = 0
                    player.start()
                    isPlayingState = true
                    updateMediaSessionMetadata(track, currentDurationMs.toLong(), currentVinylBitmap)
                    updateMediaSessionPlaybackState()
                    startOrUpdateForegroundNotification(track)
                    emitStateToRN()
                }
                setOnCompletionListener {
                    if (playlist.size > 1) {
                        skipToNext()
                    } else {
                        isPlayingState = false
                        currentPositionMs = 0
                        it.seekTo(0)
                        updateMediaSessionPlaybackState()
                        startOrUpdateForegroundNotification(track)
                        emitStateToRN()
                    }
                }
                setOnErrorListener { _, what, extra ->
                    Log.e(TAG, "MediaPlayer hatası: what=$what extra=$extra")
                    isPlayingState = false
                    emitStateToRN()
                    true
                }
                prepareAsync()
            }
            mediaPlayer = mp
            startOrUpdateForegroundNotification(track)
        } catch (e: Exception) {
            Log.e(TAG, "Şarkı başlatılamadı", e)
            isPlayingState = false
            emitStateToRN()
        }
    }

    private fun togglePlayPause() {
        val mp = mediaPlayer
        val track = playlist.getOrNull(currentIndex) ?: return
        if (mp == null) {
            playCurrentTrack()
            return
        }
        try {
            if (mp.isPlaying) {
                mp.pause()
                isPlayingState = false
            } else {
                mp.start()
                isPlayingState = true
            }
            currentPositionMs = mp.currentPosition
            updateMediaSessionPlaybackState()
            startOrUpdateForegroundNotification(track)
            emitStateToRN()
        } catch (e: Exception) {
            Log.e(TAG, "togglePlayPause hatası", e)
        }
    }

    private fun skipToNext() {
        if (playlist.isEmpty()) return
        currentIndex = (currentIndex + 1) % playlist.size
        playCurrentTrack()
    }

    private fun skipToPrevious() {
        if (playlist.isEmpty()) return
        val mp = mediaPlayer
        if (mp != null && mp.currentPosition > 4000) {
            mp.seekTo(0)
            currentPositionMs = 0
            updateMediaSessionPlaybackState()
            emitStateToRN()
            return
        }
        currentIndex = if (currentIndex - 1 < 0) playlist.size - 1 else currentIndex - 1
        playCurrentTrack()
    }

    private fun stopPlayerAndService() {
        releaseMediaPlayer()
        isPlayingState = false
        currentPositionMs = 0
        currentDurationMs = 0
        currentIndex = -1
        emitStateToRN()
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                stopForeground(STOP_FOREGROUND_REMOVE)
            } else {
                @Suppress("DEPRECATION")
                stopForeground(true)
            }
        } catch (_: Exception) {}
        stopSelf()
    }

    private fun releaseMediaPlayer() {
        try {
            mediaPlayer?.stop()
        } catch (_: Exception) {}
        try {
            mediaPlayer?.release()
        } catch (_: Exception) {}
        mediaPlayer = null
    }

    private fun updateMediaSessionMetadata(track: PlaylistTrack, durationMs: Long, artwork: Bitmap?) {
        val session = mediaSession ?: return
        val builder = MediaMetadata.Builder()
            .putString(MediaMetadata.METADATA_KEY_TITLE, track.title)
            .putString(MediaMetadata.METADATA_KEY_ARTIST, track.uploader.ifEmpty { "MediaToolkit" })
            .putLong(MediaMetadata.METADATA_KEY_DURATION, durationMs)

        if (artwork != null && !artwork.isRecycled) {
            builder.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, artwork)
            builder.putBitmap(MediaMetadata.METADATA_KEY_ART, artwork)
            builder.putBitmap(MediaMetadata.METADATA_KEY_DISPLAY_ICON, artwork)
        }
        session.setMetadata(builder.build())
    }

    private fun updateMediaSessionPlaybackState() {
        val session = mediaSession ?: return
        val stateInt = if (isPlayingState) PlaybackState.STATE_PLAYING else PlaybackState.STATE_PAUSED
        val speed = if (isPlayingState) 1.0f else 0.0f
        val state = PlaybackState.Builder()
            .setActions(
                PlaybackState.ACTION_PLAY or
                    PlaybackState.ACTION_PAUSE or
                    PlaybackState.ACTION_PLAY_PAUSE or
                    PlaybackState.ACTION_SKIP_TO_NEXT or
                    PlaybackState.ACTION_SKIP_TO_PREVIOUS or
                    PlaybackState.ACTION_SEEK_TO or
                    PlaybackState.ACTION_STOP
            )
            .setState(stateInt, currentPositionMs.toLong(), speed)
            .build()
        session.setPlaybackState(state)
    }

    private fun createServiceActionIntent(action: String, requestCode: Int): PendingIntent {
        val intent = Intent(this, MusicPlayerService::class.java).apply {
            this.action = action
        }
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or
            (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0)
        return PendingIntent.getService(this, requestCode, intent, flags)
    }

    private fun buildNotification(track: PlaylistTrack): Notification {
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)?.apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val contentPendingIntent = if (launchIntent != null) {
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or
                (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0)
            PendingIntent.getActivity(this, 100, launchIntent, flags)
        } else null

        val prevPending = createServiceActionIntent(ACTION_PREV, 101)
        val playPausePending = createServiceActionIntent(ACTION_PLAY_PAUSE, 102)
        val nextPending = createServiceActionIntent(ACTION_NEXT, 103)
        val stopPending = createServiceActionIntent(ACTION_STOP, 104)

        val playPauseIcon = if (isPlayingState) {
            android.R.drawable.ic_media_pause
        } else {
            android.R.drawable.ic_media_play
        }
        val playPauseLabel = if (isPlayingState) "Duraklat" else "Oynat"

        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }

        val mediaStyle = Notification.MediaStyle()
            .setMediaSession(mediaSession?.sessionToken)
            .setShowActionsInCompactView(0, 1, 2)

        builder
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentTitle(track.title)
            .setContentText(track.uploader.ifEmpty { "MediaToolkit Müzik Çalar" })
            .setSubText("${currentIndex + 1} / ${playlist.size}")
            .setOngoing(isPlayingState)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setDeleteIntent(stopPending)
            .setStyle(mediaStyle)
            .addAction(Notification.Action.Builder(android.R.drawable.ic_media_previous, "Önceki", prevPending).build())
            .addAction(Notification.Action.Builder(playPauseIcon, playPauseLabel, playPausePending).build())
            .addAction(Notification.Action.Builder(android.R.drawable.ic_media_next, "Sonraki", nextPending).build())
            .addAction(Notification.Action.Builder(android.R.drawable.ic_menu_close_clear_cancel, "Kapat", stopPending).build())

        val bmp = currentVinylBitmap
        if (bmp != null && !bmp.isRecycled) {
            builder.setLargeIcon(bmp)
        }

        if (contentPendingIntent != null) {
            builder.setContentIntent(contentPendingIntent)
        }

        return builder.build()
    }

    private fun startOrUpdateForegroundNotification(track: PlaylistTrack) {
        val notification = buildNotification(track)
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(
                    NOTIFICATION_ID,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
                )
            } else {
                startForeground(NOTIFICATION_ID, notification)
            }
        } catch (e: Exception) {
            Log.w(TAG, "Foreground bildirim hatası, NotificationManager ile güncelleniyor: ${e.message}")
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.notify(NOTIFICATION_ID, notification)
        }
    }
}
