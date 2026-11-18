package com.alierenakgul.mobilmediatoolkit.nativemodules

import android.app.Activity
import android.app.PictureInPictureParams
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.content.res.ColorStateList
import android.graphics.*
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.TextUtils
import android.util.TypedValue
import android.util.Rational
import android.view.*
import android.widget.*
import java.io.File
import java.lang.ref.WeakReference

/** Owns video playback so Android can move only the video into picture-in-picture. */
class VideoPlayerActivity : Activity() {
    companion object {
        private var active = WeakReference<VideoPlayerActivity>(null)
        fun closeActive() { active.get()?.finish() }
    }

    private var playingVideo: VideoView? = null
    private var pipUi: ((Boolean) -> Unit)? = null
    private var onPlayerClose: (() -> Unit)? = null
    private var savePosition: (() -> Unit)? = null
    private var restorePlayerUi: (() -> Unit)? = null
    private var pipAspect = 16f / 9f
    private var lastPipState = ""
    private var resumeAfterStop = false
    private var foregroundVisible = false
    private val audioEffects = VideoAudioEffects()
    private var sleepDeadlineMs = 0L
    private var sleepAtEnd = false
    private var refreshOptions: (() -> Unit)? = null
    private var optionsPanel: View? = null
    private var autoPipConfigured = false
    private var backCallback: android.window.OnBackInvokedCallback? = null
    private var switchingToPipSettings = false
    private val pipAction = "com.alierenakgul.mobilmediatoolkit.VIDEO_PIP_TOGGLE"
    private val pipReceiver = object : android.content.BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action != pipAction || active.get() !== this@VideoPlayerActivity) return
            val video = playingVideo ?: return
            if (video.isPlaying) video.pause() else video.start()
            restorePlayerUi?.invoke()
            savePosition?.invoke()
            updatePipParams()
        }
    }

    private fun pipSupported(): Boolean = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
        packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)

    private fun pipParams(): PictureInPictureParams {
        val aspect = pipAspect.coerceIn(1f / 2.39f, 2.39f)
        return PictureInPictureParams.Builder().apply {
            setAspectRatio(Rational((aspect * 1000).toInt(), 1000))
            val playing = playingVideo?.isPlaying == true
            val label = if (playing) "Duraklat" else "Oynat"
            val actionIntent = android.app.PendingIntent.getBroadcast(this@VideoPlayerActivity, 0,
                Intent(pipAction).setPackage(packageName),
                android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE)
            setActions(listOf(android.app.RemoteAction(
                android.graphics.drawable.Icon.createWithResource(this@VideoPlayerActivity,
                    if (playing) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play),
                label, label, actionIntent)))
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                setAutoEnterEnabled(playingVideo?.isPlaying == true && !switchingToPipSettings && pipAllowed())
                setSeamlessResizeEnabled(true)
            }
        }.build()
    }

    private fun updatePipParams() {
        if (!pipSupported() || isFinishing) return
        val state = "$pipAspect:${playingVideo?.isPlaying}"
        if (state == lastPipState) return
        try {
            setPictureInPictureParams(pipParams())
            lastPipState = state
            autoPipConfigured = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && pipAllowed()
        } catch (_: RuntimeException) { }
    }

    private fun pipAllowed(): Boolean {
        if (!pipSupported()) return false
        val ops = getSystemService(Context.APP_OPS_SERVICE) as android.app.AppOpsManager
        val mode = ops.checkOpNoThrow(android.app.AppOpsManager.OPSTR_PICTURE_IN_PICTURE, android.os.Process.myUid(), packageName)
        return mode == android.app.AppOpsManager.MODE_ALLOWED || mode == android.app.AppOpsManager.MODE_DEFAULT
    }

    private fun enterVideoPip(showError: Boolean = false): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N && isInPictureInPictureMode) return true
        optionsPanel?.visibility = View.GONE
        refreshOptions?.invoke()
        val entered = if (pipAllowed() && !isFinishing) {
            try { enterPictureInPictureMode(pipParams()) }
            catch (_: RuntimeException) { false }
        } else false
        if (!entered && showError) {
            if (!pipSupported()) Toast.makeText(this, "Bu cihaz küçük video penceresini desteklemiyor.", Toast.LENGTH_LONG).show()
            else android.app.AlertDialog.Builder(this)
                .setTitle("Küçük pencere izni")
                .setMessage("Videonun başka uygulamaların üzerinde görünmesi için Media Toolkit'in resim içinde resim iznini açın.")
                .setNegativeButton("Vazgeç", null)
                .setPositiveButton("Ayarlara git") { _, _ ->
                    switchingToPipSettings = true
                    lastPipState = ""
                    updatePipParams()
                    runCatching { startActivity(Intent(android.provider.Settings.ACTION_PICTURE_IN_PICTURE_SETTINGS,
                        android.net.Uri.parse("package:$packageName"))) }
                }.show()
        }
        return entered
    }

    private fun leaveVideo() {
        if (optionsPanel?.visibility == View.VISIBLE) {
            optionsPanel?.visibility = View.GONE
            refreshOptions?.invoke()
            return
        }
        if (playingVideo?.isPlaying == true && pipSupported()) { enterVideoPip(true); return }
        finish()
    }

    @Deprecated("Handled through OnBackInvokedDispatcher on Android 13+")
    override fun onBackPressed() { leaveVideo() }

    private fun checkSleepTimer() {
        if (sleepDeadlineMs == 0L || android.os.SystemClock.elapsedRealtime() < sleepDeadlineMs) return
        sleepDeadlineMs = 0L
        sleepAtEnd = false
        playingVideo?.pause()
        resumeAfterStop = false
        savePosition?.invoke()
        restorePlayerUi?.invoke()
        refreshOptions?.invoke()
        updatePipParams()
        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        requestWindowFeature(Window.FEATURE_NO_TITLE)
        closeActive()
        active = WeakReference(this)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val callback = android.window.OnBackInvokedCallback { leaveVideo() }
            backCallback = callback
            onBackInvokedDispatcher.registerOnBackInvokedCallback(android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, callback)
        }
        val filter = android.content.IntentFilter(pipAction)
        androidx.core.content.ContextCompat.registerReceiver(this, pipReceiver, filter,
            androidx.core.content.ContextCompat.RECEIVER_NOT_EXPORTED)
        val targetFile = intent.getStringExtra("filePath")?.let { File(it) }
        if (targetFile == null || !targetFile.isFile) { finish(); return }
        MusicPlayerService.pauseIfPlaying()
        try { showPlayer(targetFile, intent.getStringExtra("title") ?: targetFile.name,
            intent.getStringExtra("uploader") ?: "Media Toolkit") }
        catch (_: Exception) {
            Toast.makeText(this, "Video oynatıcı açılamadı", Toast.LENGTH_SHORT).show()
            finish()
        }
    }

    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        // Android 12+ uses auto-enter for smooth gesture navigation.
        if (!switchingToPipSettings && playingVideo?.isPlaying == true &&
            (Build.VERSION.SDK_INT < Build.VERSION_CODES.S || !autoPipConfigured)) enterVideoPip()
    }

    override fun onPictureInPictureModeChanged(inPip: Boolean, newConfig: Configuration) {
        super.onPictureInPictureModeChanged(inPip, newConfig)
        pipUi?.invoke(inPip)
    }

    override fun onStart() {
        super.onStart()
        foregroundVisible = true
    }

    override fun onPause() {
        savePosition?.invoke()
        super.onPause()
    }

    override fun onStop() {
        foregroundVisible = false
        resumeAfterStop = playingVideo?.isPlaying == true
        playingVideo?.pause()
        savePosition?.invoke()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N && isInPictureInPictureMode) finish()
        super.onStop()
    }

    override fun onResume() {
        super.onResume()
        switchingToPipSettings = false
        lastPipState = ""
        checkSleepTimer()
        if (resumeAfterStop) { playingVideo?.start(); resumeAfterStop = false }
        restorePlayerUi?.invoke()
        updatePipParams()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        savePosition?.invoke()
        super.onSaveInstanceState(outState)
    }

    override fun onDestroy() {
        onPlayerClose?.invoke()
        audioEffects.release()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) backCallback?.let { onBackInvokedDispatcher.unregisterOnBackInvokedCallback(it) }
        runCatching { unregisterReceiver(pipReceiver) }
        playingVideo = null
        if (active.get() === this) active.clear()
        super.onDestroy()
    }

    private fun showPlayer(targetFile: File, title: String, uploader: String) {
        val activity = this
        val uiHandler = Handler(Looper.getMainLooper())
        val dark = intent.getBooleanExtra("isDarkMode", false)
        val accent = Color.parseColor(if (dark) "#FF9B45" else "#176B46")
        val onAccent = Color.parseColor(if (dark) "#16100B" else "#FFFFFF")
        val surface = Color.parseColor(if (dark) "#181818" else "#F5F7F6")
        val foreground = Color.parseColor(if (dark) "#F5F5F5" else "#18221D")
        val border = Color.parseColor(if (dark) "#343434" else "#DDE5E0")
        var audioPreset = "NORMAL"
        var isMini = false
        var completed = false
        var prepared = false
        var videoPlayer: android.media.MediaPlayer? = null
        var videoSpeed = 1f
        val resumePrefs = getSharedPreferences("MediaToolkitVideoResume", android.content.Context.MODE_PRIVATE)
        val resumeKey = "${targetFile.absolutePath}:${targetFile.length()}:${targetFile.lastModified()}"
        var lastSaveTime = 0L
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
        playingVideo = videoView
        videoContainer.addView(videoView)
        rootLayout.addView(videoContainer)

        fun updateVideoBounds(explicitW: Int = 0, explicitH: Int = 0) {
            if (!isMini) window?.setLayout(
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

        fun saveVideoPosition() {
            if (!prepared) return
            try {
                val position = videoView.currentPosition.coerceAtLeast(0)
                if (completed || position >= durationMs - 1000) resumePrefs.edit().remove(resumeKey).apply()
                else resumePrefs.edit().putInt(resumeKey, position).apply()
            } catch (_: IllegalStateException) { /* Player may already be released. */ }
        }

        // Tüm Kontrolleri Taşıyan Katman (Yumuşak geçişli sinema arayüzü)
        val overlayContainer = FrameLayout(activity).apply {
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        }

        val topPipIconView = PlayerVectorIconView(activity, "pip")
        val bottomPipIconView = PlayerVectorIconView(activity, "pip")
        val bottomPipLabelTv = TextView(activity).apply {
            text = "Küçük pencere"
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 11.5f)
            typeface = Typeface.DEFAULT_BOLD
        }

        // 1. ÜST SİNEMA GRADYAN BARI (Geri İkonu + Başlık + Küçük Pencere İkonu)
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
                setColor(Color.parseColor("#66181818"))
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
                leaveVideo()
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

        val pipTopBtn = FrameLayout(activity).apply {
            contentDescription = "Küçük pencere"
            layoutParams = LinearLayout.LayoutParams(dpToPx(42), dpToPx(42))
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(Color.parseColor("#66181818"))
                setStroke(dpToPx(1), Color.parseColor("#33FFFFFF"))
            }
            addView(
                topPipIconView,
                FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT
                )
            )
            setOnClickListener {
                enterVideoPip(true)
            }
        }

        topBar.addView(backBtnHolder)
        topBar.addView(titleCol)
        topBar.addView(pipTopBtn)
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
                setColor(Color.parseColor("#73080808"))
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
                setColor(accent)
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
                setColor(Color.parseColor("#73080808"))
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
            progressTintList = ColorStateList.valueOf(accent)
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
                        completed = false
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

        val pipPillBtn = LinearLayout(activity).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dpToPx(12), dpToPx(6), dpToPx(12), dpToPx(6))
            background = GradientDrawable().apply {
                setColor(Color.parseColor("#33FFFFFF"))
                cornerRadius = dpToPx(8).toFloat()
            }
            addView(
                bottomPipIconView,
                LinearLayout.LayoutParams(dpToPx(18), dpToPx(18)).apply {
                    marginEnd = dpToPx(6)
                }
            )
            addView(bottomPipLabelTv)
            setOnClickListener {
                enterVideoPip(true)
            }
        }

        val speedButton = TextView(activity).apply {
            text = "1× · EQ"
            contentDescription = "Çalma hızı ve ses ayarları"
            gravity = Gravity.CENTER
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
            layoutParams = LinearLayout.LayoutParams(dpToPx(92), dpToPx(44)).apply { marginEnd = dpToPx(6) }
            isEnabled = false
        }
        fun applyVideoSpeed(speed: Float): Boolean {
            val player = videoPlayer ?: return false
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return false
            val wasPlaying = videoView.isPlaying
            return try {
                player.playbackParams = android.media.PlaybackParams().setSpeed(speed).setPitch(1f)
                if (!wasPlaying) videoView.pause()
                videoSpeed = speed
                speedButton.text = "${speed}× · EQ"
                true
            } catch (_: Exception) {
                if (!wasPlaying) runCatching { videoView.pause() }
                android.widget.Toast.makeText(activity, "Bu video için oynatma hızı değiştirilemedi", android.widget.Toast.LENGTH_SHORT).show()
                false
            }
        }
        val sleepButton = TextView(activity).apply {
            text = "Uyku"
            gravity = Gravity.CENTER
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
            layoutParams = LinearLayout.LayoutParams(0, dpToPx(44), 1f).apply { marginEnd = dpToPx(6) }
        }
        fun styleChip(view: TextView, selected: Boolean) {
            view.setTextColor(if (selected) onAccent else foreground)
            view.background = GradientDrawable().apply {
                setColor(if (selected) accent else surface)
                cornerRadius = dpToPx(12).toFloat()
                setStroke(dpToPx(1), if (selected) accent else border)
            }
        }
        val panelContent = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dpToPx(12), dpToPx(8), dpToPx(12), dpToPx(12))
        }
        val panel = ScrollView(activity).apply {
            visibility = View.GONE
            background = GradientDrawable().apply {
                setColor(surface)
                cornerRadius = dpToPx(16).toFloat()
                setStroke(dpToPx(1), border)
            }
            addView(panelContent)
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dpToPx(210)).apply { topMargin = dpToPx(8) }
        }
        optionsPanel = panel
        var panelMode = "sound"
        fun heading(label: String) {
            panelContent.addView(TextView(activity).apply {
                text = label
                setTextColor(accent)
                setTypeface(null, android.graphics.Typeface.BOLD)
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
                setPadding(0, dpToPx(5), 0, dpToPx(7))
            })
        }
        fun choices(labels: List<String>, selected: Int, select: (Int) -> Unit) {
            val row = LinearLayout(activity).apply { orientation = LinearLayout.HORIZONTAL }
            labels.forEachIndexed { index, label ->
                row.addView(TextView(activity).apply {
                    text = label
                    gravity = Gravity.CENTER
                    setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
                    setTypeface(null, android.graphics.Typeface.BOLD)
                    layoutParams = LinearLayout.LayoutParams(0, dpToPx(48), 1f).apply {
                        if (index > 0) marginStart = dpToPx(5)
                    }
                    styleChip(this, selected == index)
                    setOnClickListener { select(index); refreshOptions?.invoke() }
                })
            }
            panelContent.addView(row)
        }
        refreshOptions = {
            styleChip(speedButton, panel.visibility == View.VISIBLE && panelMode == "sound")
            styleChip(sleepButton, sleepDeadlineMs > 0 || sleepAtEnd)
            sleepButton.text = if (sleepAtEnd) "Video sonu" else if (sleepDeadlineMs > 0) "Uyku açık" else "Uyku"
            centerControlsRow.visibility = if (panel.visibility == View.VISIBLE) View.GONE else View.VISIBLE
            if (panel.visibility == View.VISIBLE) {
                panelContent.removeAllViews()
                if (panelMode == "sound") {
                    heading("Çalma hızı")
                    val speeds = listOf(0.75f, 1f, 1.5f, 2f)
                    choices(listOf("0.75×", "1×", "1.5×", "2×"), speeds.indexOf(videoSpeed)) { applyVideoSpeed(speeds[it]) }
                    heading("Ses ayarları")
                    val presets = listOf("NORMAL", "BASS", "VOCAL", "LOUD")
                    choices(listOf("Normal", "Bas+", "Vokal", "Yüksek ses"), presets.indexOf(audioPreset)) {
                        val preset = presets[it]
                        if (audioEffects.apply(videoPlayer?.audioSessionId ?: 0, preset)) audioPreset = preset
                        else {
                            audioPreset = "NORMAL"
                            Toast.makeText(activity, "Bu cihazda bu ses ayarı desteklenmiyor.", Toast.LENGTH_SHORT).show()
                        }
                    }
                } else {
                    heading("Uyku zamanlayıcısı")
                    val remaining = ((sleepDeadlineMs - android.os.SystemClock.elapsedRealtime()).coerceAtLeast(0) + 59999) / 60000
                    heading(if (sleepAtEnd) "Video bittiğinde duracak" else if (sleepDeadlineMs > 0) "$remaining dakika sonra duracak" else "Oynatma otomatik durdurulsun")
                    choices(listOf("15 dk", "30 dk", "60 dk"), -1) {
                        sleepDeadlineMs = android.os.SystemClock.elapsedRealtime() + listOf(15L, 30L, 60L)[it] * 60000L
                        sleepAtEnd = false
                    }
                    heading("Diğer seçenekler")
                    choices(listOf("Kapalı", "Video sonu"), if (sleepAtEnd) 1 else if (sleepDeadlineMs == 0L) 0 else -1) {
                        sleepDeadlineMs = 0L
                        sleepAtEnd = it == 1
                    }
                }
            }
        }
        fun togglePanel(mode: String) {
            panel.visibility = if (panel.visibility == View.VISIBLE && panelMode == mode) View.GONE else View.VISIBLE
            panelMode = mode
            refreshOptions?.invoke()
        }
        speedButton.setOnClickListener { togglePanel("sound") }
        sleepButton.setOnClickListener { togglePanel("sleep") }
        bottomMetaRow.addView(timeLeftContainer)
        val optionsRow = LinearLayout(activity).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        optionsRow.addView(sleepButton)
        optionsRow.addView(speedButton)
        optionsRow.addView(pipPillBtn)
        bottomBar.addView(seekBar)
        bottomBar.addView(bottomMetaRow)
        bottomBar.addView(optionsRow)
        bottomBar.addView(panel)
        refreshOptions?.invoke()
        overlayContainer.addView(bottomBar)
        rootLayout.addView(overlayContainer)

        rwCircleBtn.setOnClickListener {
            val target = (videoView.currentPosition - 10000).coerceAtLeast(0)
            completed = false
            videoView.seekTo(target)
            currentTimeTv.text = formatTimeMs(target)
        }

        ffCircleBtn.setOnClickListener {
            val maxPos = if (durationMs > 0) durationMs else Int.MAX_VALUE
            val target = (videoView.currentPosition + 10000).coerceAtMost(maxPos)
            completed = false
            videoView.seekTo(target)
            currentTimeTv.text = formatTimeMs(target)
        }

        playPauseCircleBtn.setOnClickListener {
            if (videoView.isPlaying) {
                videoView.pause()
                playPauseIconView.updateIcon("play")
            } else {
                completed = false
                videoView.start()
                playPauseIconView.updateIcon("pause")
            }
            updatePipParams()
        }

        // Ekran boyutu veya yönü değiştiğinde (döndürüldüğünde) video oranını koruyarak yeniden boyutlandır
        rootLayout.addOnLayoutChangeListener { _, left, top, right, bottom, _, _, _, _ ->
            val newW = (right - left).coerceAtLeast(0)
            val newH = (bottom - top).coerceAtLeast(0)
            uiHandler.post {
                if (!isMini) applyImmersiveFullscreen(window)
                val panelHeight = minOf(dpToPx(245), (newH * 0.45f).toInt())
                if (panel.layoutParams.height != panelHeight) panel.layoutParams = panel.layoutParams.apply { height = panelHeight }
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
                setColor(Color.parseColor("#B3181818"))
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
                    if (isMini) return true
                    controlsVisible = !controlsVisible
                    if (controlsVisible) {
                        overlayContainer.visibility = View.VISIBLE
                        overlayContainer.animate().alpha(1f).setDuration(180L).start()
                    } else {
                        overlayContainer.animate().alpha(0f).setDuration(180L).withEndAction {
                            if (!controlsVisible) overlayContainer.visibility = View.GONE
                        }.start()
                    }
                    applyImmersiveFullscreen(window)
                    return true
                }

                override fun onDoubleTap(e: MotionEvent): Boolean {
                    val totalW = videoContainer.width.coerceAtLeast(1)
                    val isRightSide = e.rawX >= videoContainer.run {
                        val location = IntArray(2)
                        getLocationOnScreen(location)
                        location[0] + totalW / 2f
                    }
                    if (isRightSide) {
                        val maxPos = if (durationMs > 0) durationMs else Int.MAX_VALUE
                        val target = (videoView.currentPosition + 10000).coerceAtMost(maxPos)
                        completed = false
                        videoView.seekTo(target)
                        currentTimeTv.text = formatTimeMs(target)
                        showDoubleTapSkipBadge(true)
                    } else {
                        val target = (videoView.currentPosition - 10000).coerceAtLeast(0)
                        completed = false
                        videoView.seekTo(target)
                        currentTimeTv.text = formatTimeMs(target)
                        showDoubleTapSkipBadge(false)
                    }
                    saveVideoPosition()
                    if (!isMini) applyImmersiveFullscreen(window)
                    return true
                }
            }
        )

        val videoTouchListener = View.OnTouchListener { _, event ->
            gestureDetector.onTouchEvent(event)
            true
        }
        videoContainer.setOnTouchListener(videoTouchListener)
        videoView.setOnTouchListener(videoTouchListener)
        overlayContainer.setOnTouchListener(videoTouchListener)

        val ticker = object : Runnable {
            override fun run() {
                if (!isFinishing) {
                    try {
                        checkSleepTimer()
                        updatePipParams()
                        if (videoView.isPlaying) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                        else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                        if (System.currentTimeMillis() - lastSaveTime >= 2000L) {
                            saveVideoPosition()
                            lastSaveTime = System.currentTimeMillis()
                        }
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
            videoPlayer = mp
            if (!audioEffects.apply(mp.audioSessionId, audioPreset)) audioPreset = "NORMAL"
            speedButton.isEnabled = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
            durationMs = mp.duration.coerceAtLeast(0)
            if (!prepared) {
                val saved = resumePrefs.getInt(resumeKey, 0)
                if (saved > 0 && saved < durationMs - 1000) videoView.seekTo(saved)
            }
            prepared = true
            if (mp.videoWidth > 0 && mp.videoHeight > 0) {
                videoW = mp.videoWidth
                videoH = mp.videoHeight
                pipAspect = videoW.toFloat() / videoH
            }
            mp.setOnVideoSizeChangedListener { _, w, h ->
                if (w > 0 && h > 0) {
                    videoW = w
                    videoH = h
                    pipAspect = w.toFloat() / h
                    updatePipParams()
                    updateVideoBounds()
                }
            }
            totalTimeTv.text = formatTimeMs(durationMs)
            updateVideoBounds()
            if (videoSpeed != 1f) applyVideoSpeed(videoSpeed)
            if (foregroundVisible || (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N && isInPictureInPictureMode)) videoView.start()
            else resumeAfterStop = true
            updatePipParams()
            playPauseIconView.updateIcon(if (videoView.isPlaying) "pause" else "play")
            uiHandler.removeCallbacks(ticker)
            uiHandler.post(ticker)
        }

        videoView.setOnCompletionListener {
            completed = true
            sleepAtEnd = false
            sleepDeadlineMs = 0L
            refreshOptions?.invoke()
            updatePipParams()
            resumePrefs.edit().remove(resumeKey).apply()
            playPauseIconView.updateIcon("play")
            seekBar.progress = 1000
            controlsVisible = true
            overlayContainer.visibility = if (isMini) View.GONE else View.VISIBLE
            overlayContainer.alpha = 1f
        }

        savePosition = { saveVideoPosition() }
        restorePlayerUi = {
            if (videoView.isPlaying) completed = false
            playPauseIconView.updateIcon(if (videoView.isPlaying) "pause" else "play")
        }
        pipUi = { inPip ->
            isMini = inPip
            controlsVisible = !inPip
            overlayContainer.visibility = if (inPip) View.GONE else View.VISIBLE
            overlayContainer.alpha = 1f
            doubleTapFeedbackTv.visibility = View.GONE
            optionsPanel?.visibility = View.GONE
            refreshOptions?.invoke()
            if (!inPip) applyImmersiveFullscreen(window)
            rootLayout.post { updateVideoBounds() }
        }
        onPlayerClose = {
            // onPause/onStop already saved before the video surface was released.
            videoPlayer = null
            uiHandler.removeCallbacksAndMessages(null)
            try {
                videoView.stopPlayback()
            } catch (_: Exception) {}

        }

        setContentView(rootLayout)
        window?.setBackgroundDrawable(ColorDrawable(Color.BLACK))
        window?.setLayout(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        )
        applyImmersiveFullscreen(window)

    }

    private fun dpToPx(dp: Int): Int {
        return TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP,
            dp.toFloat(),
            resources.displayMetrics
        ).toInt()
    }

    private fun formatTimeMs(ms: Int): String {
        val totalSec = (ms / 1000).coerceAtLeast(0)
        val mins = totalSec / 60
        val secs = totalSec % 60
        return String.format("%02d:%02d", mins, secs)
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
                "pip" -> {
                    canvas.drawRoundRect(RectF(w * 0.18f, h * 0.22f, w * 0.82f, h * 0.78f), 3f, 3f, strokePaint)
                    canvas.drawRect(w * 0.48f, h * 0.49f, w * 0.75f, h * 0.70f, fillPaint)
                }
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

}
