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
import android.media.AudioManager
import android.media.AudioFocusRequest
import android.media.AudioRouting
import android.media.AudioAttributes
import android.media.MediaMetadata
import android.media.MediaPlayer
import android.media.PlaybackParams
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
import kotlin.random.Random

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
        private const val RESUME_PREFS_NAME = "MediaToolkitResumePrefs"

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

        // Karışık Çal (Shuffle) & Tekrarla (Repeat: "OFF", "ALL", "ONE")
        @Volatile
        private var shuffleEnabled: Boolean = false

        @Volatile
        private var repeatMode: String = "OFF"

        // Uyku Zamanlayıcısı (Sleep Timer)
        @Volatile
        private var sleepTimerEndTimeMs: Long = 0L

        @Volatile
        private var sleepStopAtEndOfTrack: Boolean = false

        // Oynatma Hızı & Ses Profili (Equalizer / BassBoost / LoudnessEnhancer)
        @Volatile
        private var playbackSpeed: Float = 1.0f

        @Volatile
        private var audioPreset: String = "NORMAL" // "NORMAL" | "BASS" | "VOCAL" | "LOUD"

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
            svc.mainHandler.post { svc.pausePlayback() }
        }

        fun seekToPosition(posMs: Int) {
            instance?.seekToInternal(posMs)
        }

        fun toggleShuffleMode(): Boolean {
            shuffleEnabled = !shuffleEnabled
            emitStateToRN()
            return shuffleEnabled
        }

        fun cycleRepeatModeState(): String {
            repeatMode = when (repeatMode) {
                "OFF" -> "ALL"
                "ALL" -> "ONE"
                else -> "OFF"
            }
            emitStateToRN()
            return repeatMode
        }

        fun setSleepTimerState(minutes: Int, stopAtTrackEnd: Boolean) {
            if (stopAtTrackEnd) {
                sleepStopAtEndOfTrack = true
                sleepTimerEndTimeMs = 0L
            } else if (minutes > 0) {
                sleepStopAtEndOfTrack = false
                sleepTimerEndTimeMs = System.currentTimeMillis() + minutes * 60_000L
            } else {
                sleepStopAtEndOfTrack = false
                sleepTimerEndTimeMs = 0L
            }
            emitStateToRN()
        }

        fun setPlaybackSpeedState(speed: Float) {
            playbackSpeed = speed.coerceIn(0.5f, 2.0f)
            instance?.applyPlaybackSpeedInternal()
            emitStateToRN()
        }

        fun setAudioPresetState(preset: String) {
            audioPreset = AudioFxEngine.normalize(preset)
            instance?.applyAudioPresetInternal()
            emitStateToRN()
        }

        fun getCurrentStateMap() = Arguments.createMap().apply {
            val track = playlist.getOrNull(currentIndex)
            putBoolean("isActive", track != null && instance != null)
            putBoolean("isPlaying", isPlayingState)
            putInt("currentIndex", currentIndex)
            putInt("playlistCount", playlist.size)
            putDouble("positionMs", currentPositionMs.toDouble())
            putDouble("durationMs", currentDurationMs.toDouble())
            putBoolean("shuffleEnabled", shuffleEnabled)
            putString("repeatMode", repeatMode)
            putDouble("playbackSpeed", playbackSpeed.toDouble())
            putString("audioPreset", audioPreset)
            putBoolean("sleepStopAtEndOfTrack", sleepStopAtEndOfTrack)

            val remainingSec = if (sleepTimerEndTimeMs > 0L) {
                ((sleepTimerEndTimeMs - System.currentTimeMillis()) / 1000L).coerceAtLeast(0L).toInt()
            } else 0
            putInt("sleepTimerRemainingSec", remainingSec)

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

        fun createVinylRecordBitmap(source: Bitmap?): Bitmap {
            val size = 320
            val center = size / 2f
            val outerRadius = size / 2f - 4f
            val output = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
            val canvas = Canvas(output)
            val paint = Paint(Paint.ANTI_ALIAS_FLAG)

            // 1. Dış Siyah Plak Gövdesi
            paint.style = Paint.Style.FILL
            paint.color = Color.parseColor("#181818")
            canvas.drawCircle(center, center, outerRadius, paint)

            // 2. İnce Plak İzleri (Grooves)
            paint.style = Paint.Style.STROKE
            paint.strokeWidth = 1.5f
            paint.color = Color.parseColor("#242424")
            canvas.drawCircle(center, center, outerRadius - 10f, paint)
            canvas.drawCircle(center, center, outerRadius - 20f, paint)
            paint.color = Color.parseColor("#343434")
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
                paint.color = Color.parseColor("#FF9B45")
                canvas.drawCircle(center, center, coverRadius, paint)
            }

            // 4. Kapak Etrafı İnce Mor/İndigo Halka
            paint.style = Paint.Style.STROKE
            paint.strokeWidth = 3f
            paint.color = Color.parseColor("#FF9B45")
            canvas.drawCircle(center, center, coverRadius, paint)

            // 5. Plak Merkez Göbek Halkası ve Deliği
            paint.style = Paint.Style.FILL
            paint.color = Color.parseColor("#181818")
            canvas.drawCircle(center, center, 22f, paint)

            paint.color = Color.parseColor("#E5E7EB")
            canvas.drawCircle(center, center, 9f, paint)

            return output
        }
    }

    private var mediaPlayer: MediaPlayer? = null
    private var mediaSession: MediaSession? = null
    private val audioFx = AudioFxEngine()

    private val mainHandler = Handler(Looper.getMainLooper())
    private val audioManager by lazy { getSystemService(Context.AUDIO_SERVICE) as AudioManager }
    private val mediaAudioAttributes = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_MEDIA)
        .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build()
    private var hasAudioFocus = false
    private var resumeOnFocusGain = false
    private var focusRegistered = false
    private var playerPrepared = false
    private var playWhenPrepared = false
    private val focusListener = AudioManager.OnAudioFocusChangeListener { change ->
        if (!focusRegistered) return@OnAudioFocusChangeListener
        when (change) {
            AudioManager.AUDIOFOCUS_GAIN -> {
                if (focusRegistered) {
                    hasAudioFocus = true
                    mediaPlayer?.setVolume(1f, 1f)
                    if (resumeOnFocusGain) {
                        resumeOnFocusGain = false
                        mediaPlayer?.let { startWithAudioFocus(it) }
                        publishPlaybackState()
                    }
                }
            }
            AudioManager.AUDIOFOCUS_LOSS -> {
                pausePlayback()
            }
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> {
                val shouldResume = isPlayingState || resumeOnFocusGain
                pausePlayback(releaseFocus = false)
                hasAudioFocus = false
                resumeOnFocusGain = shouldResume
            }
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> mediaPlayer?.setVolume(0.2f, 0.2f)
        }
    }
    private val focusRequest by lazy {
        AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
            .setAudioAttributes(mediaAudioAttributes)
            .setOnAudioFocusChangeListener(focusListener, mainHandler).build()
    }
    private val noisyReceiver = object : android.content.BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action == AudioManager.ACTION_AUDIO_BECOMING_NOISY) pausePlayback()
        }
    }
    private val routingListener = AudioRouting.OnRoutingChangedListener { router ->
        if (router === mediaPlayer && playerPrepared) {
            Log.d(TAG, "Media output changed: ${router.routedDevice?.type}")
            releaseAudioEffects()
            if (audioPreset != "NORMAL") applyAudioPresetInternal()
        }
    }

    private fun publishPlaybackState() {
        updateMediaSessionPlaybackState()
        playlist.getOrNull(currentIndex)?.let { startOrUpdateForegroundNotification(it) }
        emitStateToRN()
    }

    @Suppress("DEPRECATION")
    private fun startWithAudioFocus(player: MediaPlayer): Boolean {
        if (!playerPrepared) return false
        // Android 15+ requires a foreground service before background focus requests.
        playlist.getOrNull(currentIndex)?.let { startOrUpdateForegroundNotification(it) }
        val granted = hasAudioFocus || try {
            focusRegistered = true
            val result = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) audioManager.requestAudioFocus(focusRequest)
                else audioManager.requestAudioFocus(focusListener, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN)
            result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
        } catch (e: Exception) {
            Log.w(TAG, "Audio focus request failed", e)
            false
        }
        hasAudioFocus = granted
        resumeOnFocusGain = false
        if (!granted) {
            isPlayingState = false
            abandonAudioFocus()
            publishPlaybackState()
            android.widget.Toast.makeText(this, "Ses başka bir uygulamada kullanılıyor. Tekrar oynatmayı deneyin.", android.widget.Toast.LENGTH_SHORT).show()
            return false
        }
        player.setVolume(1f, 1f)
        player.start()
        isPlayingState = true
        return true
    }

    @Suppress("DEPRECATION")
    private fun abandonAudioFocus() {
        resumeOnFocusGain = false
        hasAudioFocus = false
        if (!focusRegistered) return
        focusRegistered = false
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) audioManager.abandonAudioFocusRequest(focusRequest)
        else audioManager.abandonAudioFocus(focusListener)
    }

    private fun pausePlayback(releaseFocus: Boolean = true) {
        playWhenPrepared = false
        resumeOnFocusGain = false
        if (playerPrepared) runCatching {
            mediaPlayer?.let { player ->
                currentPositionMs = player.currentPosition
                player.pause()
                player.setVolume(1f, 1f)
                saveCurrentTrackResumePosition()
            }
        }
        isPlayingState = false
        if (releaseFocus) abandonAudioFocus()
        publishPlaybackState()
    }

    private var currentVinylBitmap: Bitmap? = null
    private var resumeSaveCounter: Int = 0

    private val progressRunnable = object : Runnable {
        override fun run() {
            // Uyku zamanlayıcısı süresi dolduysa oynatıcıyı otomatik kapat
            if (sleepTimerEndTimeMs > 0L && System.currentTimeMillis() >= sleepTimerEndTimeMs) {
                sleepTimerEndTimeMs = 0L
                sleepStopAtEndOfTrack = false
                stopPlayerAndService()
                return
            }

            val mp = mediaPlayer
            if (mp != null && isPlayingState) {
                try {
                    currentPositionMs = mp.currentPosition
                    currentDurationMs = mp.duration.coerceAtLeast(0)
                    resumeSaveCounter++
                    if (resumeSaveCounter % 4 == 0) {
                        saveCurrentTrackResumePosition()
                    }
                    updateMediaSessionPlaybackState()
                    emitStateToRN()
                } catch (_: Exception) {
                }
            } else if (sleepTimerEndTimeMs > 0L) {
                emitStateToRN()
            }
            mainHandler.postDelayed(this, 800L)
        }
    }

    override fun onCreate() {
        super.onCreate()
        instance = this
        createNotificationChannel()
        initMediaSession()
        androidx.core.content.ContextCompat.registerReceiver(this, noisyReceiver,
            android.content.IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY),
            androidx.core.content.ContextCompat.RECEIVER_NOT_EXPORTED)
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

    // Uygulama "Son kullanılanlar" ekranından kaydırılıp kapatıldığında
    // müziği durdur ve oynatma bildirimini tamamen kaldır.
    override fun onTaskRemoved(rootIntent: Intent?) {
        // Sadece PiP video penceresi kapatıldıysa (ayrı görev) müziğe dokunma.
        val removedClass = rootIntent?.component?.className.orEmpty()
        if (removedClass.endsWith("VideoPlayerActivity")) {
            super.onTaskRemoved(rootIntent)
            return
        }
        mainHandler.removeCallbacksAndMessages(null)
        stopPlayerAndService()
        runCatching {
            (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).cancel(NOTIFICATION_ID)
        }
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        saveCurrentTrackResumePosition()
        mainHandler.removeCallbacksAndMessages(null)
        abandonAudioFocus()
        runCatching { unregisterReceiver(noisyReceiver) }
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
                saveCurrentTrackResumePosition()
                updateMediaSessionPlaybackState()
                emitStateToRN()
            } catch (_: Exception) {}
        }
    }

    private fun saveCurrentTrackResumePosition() {
        val track = playlist.getOrNull(currentIndex) ?: return
        if (track.id.startsWith("preview_")) return
        val key = track.filename.ifBlank { track.id }
        if (key.isBlank()) return
        try {
            val prefs = getSharedPreferences(RESUME_PREFS_NAME, Context.MODE_PRIVATE)
            if (currentPositionMs > 5000 && currentDurationMs > 0 && currentPositionMs < currentDurationMs - 5000) {
                prefs.edit().putInt(key, currentPositionMs).apply()
            } else if (currentDurationMs > 0) {
                prefs.edit().remove(key).apply()
            }
        } catch (_: Exception) {}
    }

    private fun clearTrackResumePosition(track: PlaylistTrack) {
        val key = track.filename.ifBlank { track.id }
        if (key.isBlank()) return
        try {
            val prefs = getSharedPreferences(RESUME_PREFS_NAME, Context.MODE_PRIVATE)
            prefs.edit().remove(key).apply()
        } catch (_: Exception) {}
    }

    private fun getSavedResumePosition(track: PlaylistTrack, durationMs: Int): Int {
        if (track.id.startsWith("preview_")) return 0
        val key = track.filename.ifBlank { track.id }
        if (key.isBlank()) return 0
        return try {
            val prefs = getSharedPreferences(RESUME_PREFS_NAME, Context.MODE_PRIVATE)
            val saved = prefs.getInt(key, 0)
            if (saved in 5000 until (durationMs - 5000).coerceAtLeast(5001)) saved else 0
        } catch (_: Exception) {
            0
        }
    }

    fun applyPlaybackSpeedInternal() {
        mainHandler.post {
            val mp = mediaPlayer ?: return@post
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                try {
                    val wasPlaying = mp.isPlaying
                    val params = mp.playbackParams ?: PlaybackParams()
                    params.speed = playbackSpeed
                    mp.playbackParams = params
                    if (!wasPlaying && isPlayingState) {
                        if (hasAudioFocus) mp.start()
                    } else if (!isPlayingState && mp.isPlaying) {
                        mp.pause()
                    }
                    updateMediaSessionPlaybackState()
                } catch (e: Exception) {
                    Log.w(TAG, "Oynatma hızı uygulanamadı: ${e.message}")
                }
            }
        }
    }

    fun applyAudioPresetInternal() {
        mainHandler.post {
            val mp = mediaPlayer ?: return@post
            if (!playerPrepared) return@post
            val ok = try {
                audioFx.apply(mp.audioSessionId, audioPreset)
            } catch (e: Exception) {
                Log.w(TAG, "Ses profili uygulanamadı: ${e.message}")
                false
            }
            if (!ok && audioPreset != "NORMAL") {
                audioPreset = "NORMAL"
                audioFx.release()
                emitStateToRN()
                android.widget.Toast.makeText(this, "Bu cihazda bu ses ayarı desteklenmiyor.", android.widget.Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun releaseAudioEffects() {
        audioFx.release()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Media Toolkit",
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
                    pausePlayback()
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
            setPlaybackToLocal(mediaAudioAttributes)
            isActive = true
        }
    }

    private fun loadVinylArtworkForTrack(track: PlaylistTrack) {
        val thumbUrl = track.thumbnail.trim()
        if (thumbUrl.isEmpty() || !thumbUrl.startsWith("https://", ignoreCase = true)) {
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
        playWhenPrepared = true
        loadVinylArtworkForTrack(track)

        try {
            val mp = MediaPlayer().apply {
                setWakeMode(applicationContext, PowerManager.PARTIAL_WAKE_LOCK)
                setAudioAttributes(mediaAudioAttributes)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) addOnRoutingChangedListener(routingListener, mainHandler)
                setDataSource(file.absolutePath)
                setOnPreparedListener { player ->
                    if (player !== mediaPlayer) return@setOnPreparedListener
                    playerPrepared = true
                    currentDurationMs = player.duration.coerceAtLeast(0)
                    val savedPos = getSavedResumePosition(track, currentDurationMs)
                    if (savedPos > 0) {
                        player.seekTo(savedPos)
                        currentPositionMs = savedPos
                    } else {
                        currentPositionMs = 0
                    }

                    updateMediaSessionMetadata(track, currentDurationMs.toLong(), currentVinylBitmap)
                    if (!playWhenPrepared) { publishPlaybackState(); return@setOnPreparedListener }
                    playWhenPrepared = false
                    if (!startWithAudioFocus(player)) return@setOnPreparedListener

                    if (playbackSpeed != 1.0f) {
                        applyPlaybackSpeedInternal()
                    }
                    if (audioPreset != "NORMAL") {
                        applyAudioPresetInternal()
                    }

                    updateMediaSessionMetadata(track, currentDurationMs.toLong(), currentVinylBitmap)
                    updateMediaSessionPlaybackState()
                    startOrUpdateForegroundNotification(track)
                    emitStateToRN()
                }
                setOnCompletionListener { player ->
                    clearTrackResumePosition(track)

                    // "Bu Şarkı Bitince Kapat" uyku modu aktifse durdur
                    if (sleepStopAtEndOfTrack) {
                        sleepStopAtEndOfTrack = false
                        sleepTimerEndTimeMs = 0L
                        stopPlayerAndService()
                        return@setOnCompletionListener
                    }

                    // Tek Şarkı Tekrarı ("ONE") aktifse aynı şarkıyı baştan çal
                    if (repeatMode == "ONE") {
                        currentPositionMs = 0
                        player.seekTo(0)
                        startWithAudioFocus(player)
                        updateMediaSessionPlaybackState()
                        startOrUpdateForegroundNotification(track)
                        emitStateToRN()
                        return@setOnCompletionListener
                    }

                    if (playlist.size > 1) {
                        if (shuffleEnabled) {
                            skipToNext()
                        } else if (currentIndex + 1 < playlist.size || repeatMode == "ALL") {
                            skipToNext()
                        } else {
                            isPlayingState = false
                            abandonAudioFocus()
                            currentPositionMs = 0
                            player.seekTo(0)
                            updateMediaSessionPlaybackState()
                            startOrUpdateForegroundNotification(track)
                            emitStateToRN()
                        }
                    } else if (repeatMode == "ALL") {
                        currentPositionMs = 0
                        player.seekTo(0)
                        startWithAudioFocus(player)
                        updateMediaSessionPlaybackState()
                        startOrUpdateForegroundNotification(track)
                        emitStateToRN()
                    } else {
                        isPlayingState = false
                        abandonAudioFocus()
                        currentPositionMs = 0
                        player.seekTo(0)
                        updateMediaSessionPlaybackState()
                        startOrUpdateForegroundNotification(track)
                        emitStateToRN()
                    }
                }
                setOnErrorListener { _, what, extra ->
                    Log.e(TAG, "MediaPlayer hatası: what=$what extra=$extra")
                    isPlayingState = false
                    abandonAudioFocus()
                    emitStateToRN()
                    true
                }
                prepareAsync()
            }
            mediaPlayer = mp
            startOrUpdateForegroundNotification(track)
        } catch (e: Exception) {
            Log.e(TAG, "Şarkı başlatılamadı", e)
            abandonAudioFocus()
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
        if (!playerPrepared) { playWhenPrepared = !playWhenPrepared; return }
        try {
            if (mp.isPlaying) {
                pausePlayback()
                return
            } else {
                if (!startWithAudioFocus(mp)) return
                if (playbackSpeed != 1.0f) {
                    applyPlaybackSpeedInternal()
                }
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
        saveCurrentTrackResumePosition()
        currentIndex = if (shuffleEnabled && playlist.size > 1) {
            val candidates = playlist.indices.filter { it != currentIndex }
            candidates[Random.nextInt(candidates.size)]
        } else {
            (currentIndex + 1) % playlist.size
        }
        playCurrentTrack()
    }

    private fun skipToPrevious() {
        if (playlist.isEmpty()) return
        val mp = mediaPlayer
        if (mp != null && mp.currentPosition > 4000) {
            mp.seekTo(0)
            currentPositionMs = 0
            saveCurrentTrackResumePosition()
            updateMediaSessionPlaybackState()
            emitStateToRN()
            return
        }
        saveCurrentTrackResumePosition()
        currentIndex = if (shuffleEnabled && playlist.size > 1) {
            val candidates = playlist.indices.filter { it != currentIndex }
            candidates[Random.nextInt(candidates.size)]
        } else {
            if (currentIndex - 1 < 0) playlist.size - 1 else currentIndex - 1
        }
        playCurrentTrack()
    }

    private fun stopPlayerAndService() {
        saveCurrentTrackResumePosition()
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
        playerPrepared = false
        playWhenPrepared = false
        isPlayingState = false
        abandonAudioFocus()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) mediaPlayer?.removeOnRoutingChangedListener(routingListener)
        releaseAudioEffects()
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
            .putString(MediaMetadata.METADATA_KEY_ARTIST, track.uploader.ifEmpty { "Media Toolkit" })
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
        val speed = if (isPlayingState) playbackSpeed else 0.0f
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
            .setContentText(track.uploader.ifEmpty { "Media Toolkit" })
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
