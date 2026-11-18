package com.alierenakgul.mobilmediatoolkit.nativemodules

import android.media.audiofx.BassBoost
import android.media.audiofx.Equalizer
import android.media.audiofx.LoudnessEnhancer

/** Effects are attached only to the video's audio session, never the global output. */
class VideoAudioEffects {
    private var session = 0
    private var bass: BassBoost? = null
    private var equalizer: Equalizer? = null
    private var loudness: LoudnessEnhancer? = null

    fun apply(sessionId: Int, preset: String): Boolean {
        if (sessionId <= 0) return preset == "NORMAL"
        if (session != sessionId) { release(); session = sessionId }
        return try {
            bass?.enabled = false
            equalizer?.enabled = false
            loudness?.enabled = false
            when (preset) {
                "BASS" -> {
                    if (bass == null) bass = BassBoost(0, sessionId)
                    bass?.setStrength(850.toShort())
                    bass?.enabled = true
                }
                "VOCAL" -> {
                    if (equalizer == null) equalizer = Equalizer(0, sessionId)
                    equalizer?.let { eq ->
                        val range = eq.bandLevelRange
                        for (band in 0 until eq.numberOfBands.toInt()) {
                            val frequency = eq.getCenterFreq(band.toShort()) / 1000
                            val level = if (frequency in 500..4000) 400 else -150
                            eq.setBandLevel(band.toShort(), level.coerceIn(range[0].toInt(), range[1].toInt()).toShort())
                        }
                        eq.enabled = true
                    }
                }
                "LOUD" -> {
                    if (loudness == null) loudness = LoudnessEnhancer(sessionId)
                    loudness?.setTargetGain(600)
                    loudness?.enabled = true
                }
            }
            true
        } catch (_: Exception) { release(); false }
    }

    fun release() {
        runCatching { bass?.release() }
        runCatching { equalizer?.release() }
        runCatching { loudness?.release() }
        bass = null; equalizer = null; loudness = null; session = 0
    }
}
