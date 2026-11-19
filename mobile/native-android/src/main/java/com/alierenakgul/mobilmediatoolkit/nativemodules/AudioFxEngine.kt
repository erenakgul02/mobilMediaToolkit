package com.alierenakgul.mobilmediatoolkit.nativemodules

import android.media.audiofx.BassBoost
import android.media.audiofx.DynamicsProcessing
import android.media.audiofx.Equalizer
import android.media.audiofx.LoudnessEnhancer
import android.os.Build
import android.util.Log
import androidx.annotation.RequiresApi
import kotlin.math.ln

/**
 * Müzik ve video oynatıcının ortak ses efekt motoru.
 *
 * Efektler yalnızca verilen audio session'a bağlanır, sistemin genel ses çıkışına dokunmaz.
 *
 * - Android 9+ (API 28): DynamicsProcessing ile 10 bantlı hassas EQ + giriş kazancı + limiter.
 *   Cihazın kendi 5 bantlı Equalizer'ına ve çoğu cihazda etkisiz kalan BassBoost'a bağlı
 *   olmadığı için profiller arasındaki fark net duyulur; limiter sayesinde bas/yüksek ses
 *   artışında cızırtı (clipping) olmaz.
 * - Daha eski cihazlar: aynı eğri cihazın Equalizer bantlarına interpolasyonla uygulanır,
 *   gerekirse BassBoost ve LoudnessEnhancer ile desteklenir.
 */
class AudioFxEngine {

    companion object {
        private const val TAG = "AudioFxEngine"

        /** Sıra arayüzdeki sıralamayla aynıdır. */
        val PRESETS = listOf("NORMAL", "BASS", "TREBLE", "VOCAL", "PARTY", "LOUD")
        val LABELS = listOf("Normal", "Bas+", "Tiz+", "Vokal", "Parti", "Yüksek ses")

        /** 10 bandın merkez frekansları (Hz) – eski Equalizer'a interpolasyon için. */
        private val BAND_CENTERS = floatArrayOf(31f, 63f, 125f, 250f, 500f, 1000f, 2000f, 4000f, 8000f, 16000f)

        /** DynamicsProcessing bantlarının üst kesim frekansları (Hz). */
        private val BAND_EDGES = floatArrayOf(45f, 90f, 180f, 355f, 710f, 1400f, 2800f, 5600f, 11200f, 20000f)

        private class Profile(val gainsDb: FloatArray, val inputGainDb: Float)

        private val PROFILES = mapOf(
            // Derin ve dolgun bas; orta/tiz olduğu gibi kalır.
            "BASS" to Profile(floatArrayOf(10f, 9f, 6.5f, 3f, 0.5f, 0f, 0f, 0f, 0f, 0f), -2f),
            // Parlak ve net tizler (zil, hi-hat, nefes sesi).
            "TREBLE" to Profile(floatArrayOf(-1f, -1f, 0f, 0f, 0f, 1f, 3f, 6f, 7.5f, 6.5f), -2f),
            // Sesi öne çıkarır, alt frekans uğultusunu azaltır (podcast, konuşma, vokal).
            "VOCAL" to Profile(floatArrayOf(-6f, -5f, -2.5f, 0f, 2.5f, 4.5f, 5f, 3f, 0.5f, -1.5f), 0f),
            // "V" eğrisi: güçlü bas + parlak tiz.
            "PARTY" to Profile(floatArrayOf(8f, 7f, 4f, 0.5f, -2f, -1.5f, 1f, 4f, 5.5f, 5f), -2f),
            // Genel ses seviyesini limiter korumasıyla yükseltir.
            "LOUD" to Profile(floatArrayOf(2f, 1.5f, 0.5f, 0f, 0f, 0f, 0.5f, 1f, 1f, 0.5f), 9f)
        )

        fun normalize(preset: String?): String {
            val p = preset?.trim()?.uppercase().orEmpty()
            return if (p in PRESETS) p else "NORMAL"
        }

        /** Logaritmik frekans ekseninde iki bant arası kazanç interpolasyonu. */
        private fun gainAt(gains: FloatArray, hz: Float): Float {
            if (hz <= BAND_CENTERS.first()) return gains.first()
            if (hz >= BAND_CENTERS.last()) return gains.last()
            for (i in 0 until BAND_CENTERS.size - 1) {
                val lo = BAND_CENTERS[i]
                val hi = BAND_CENTERS[i + 1]
                if (hz <= hi) {
                    val t = (ln(hz / lo) / ln(hi / lo)).coerceIn(0f, 1f)
                    return gains[i] + (gains[i + 1] - gains[i]) * t
                }
            }
            return 0f
        }
    }

    private var sessionId = 0
    private var dynamics: Any? = null // DynamicsProcessing (API 28+)
    private var equalizer: Equalizer? = null
    private var bassBoost: BassBoost? = null
    private var loudness: LoudnessEnhancer? = null

    /**
     * Profili uygular. "NORMAL" tüm efektleri kaldırır.
     * @return profil uygulanabildiyse true; desteklenmiyorsa efektler kapatılır ve false döner.
     */
    fun apply(session: Int, preset: String?): Boolean {
        val p = normalize(preset)
        if (p == "NORMAL") {
            release()
            return true
        }
        if (session <= 0) return false
        if (session != sessionId) {
            release()
            sessionId = session
        }
        val profile = PROFILES[p] ?: return false

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && applyDynamics(session, profile)) {
            releaseLegacy()
            return true
        }
        releaseDynamics()
        if (applyLegacy(session, p, profile)) return true
        release()
        return false
    }

    @RequiresApi(Build.VERSION_CODES.P)
    private fun applyDynamics(session: Int, profile: Profile): Boolean {
        return try {
            val dp = (dynamics as? DynamicsProcessing) ?: run {
                val config = DynamicsProcessing.Config.Builder(
                    DynamicsProcessing.VARIANT_FAVOR_FREQUENCY_RESOLUTION,
                    2,                       // kanal sayısı (stereo)
                    true, BAND_EDGES.size,   // pre-EQ
                    false, 0,                // multi-band compressor
                    false, 0,                // post-EQ
                    true                     // limiter
                ).build()
                DynamicsProcessing(0, session, config).also { dynamics = it }
            }
            dp.setInputGainAllChannelsTo(profile.inputGainDb)
            BAND_EDGES.forEachIndexed { index, edge ->
                dp.setPreEqBandAllChannelsTo(index, DynamicsProcessing.EqBand(true, edge, profile.gainsDb[index]))
            }
            // Bas/yüksek ses artışında taşmayı (cızırtıyı) engelleyen tepe sınırlayıcı.
            dp.setLimiterAllChannelsTo(
                DynamicsProcessing.Limiter(
                    true, true, 0,
                    1f,    // attack (ms)
                    80f,   // release (ms)
                    10f,   // ratio
                    -1f,   // threshold (dB)
                    0f     // post gain (dB)
                )
            )
            dp.enabled = true
            true
        } catch (e: Throwable) {
            Log.w(TAG, "DynamicsProcessing kullanılamadı, klasik EQ'ya geçiliyor: ${e.message}")
            releaseDynamics()
            false
        }
    }

    private fun applyLegacy(session: Int, preset: String, profile: Profile): Boolean {
        val eqOk = try {
            val eq = equalizer ?: Equalizer(0, session).also { equalizer = it }
            val range = eq.bandLevelRange
            for (band in 0 until eq.numberOfBands.toInt()) {
                val hz = eq.getCenterFreq(band.toShort()) / 1000f
                val milliBel = (gainAt(profile.gainsDb, hz) * 100f).toInt()
                    .coerceIn(range[0].toInt(), range[1].toInt())
                eq.setBandLevel(band.toShort(), milliBel.toShort())
            }
            eq.enabled = true
            true
        } catch (e: Throwable) {
            Log.w(TAG, "Equalizer uygulanamadı: ${e.message}")
            runCatching { equalizer?.release() }
            equalizer = null
            false
        }

        val bassStrength = when (preset) {
            "BASS" -> 1000
            "PARTY" -> 650
            else -> 0
        }
        val bassOk = if (bassStrength > 0) runCatching {
            val bb = bassBoost ?: BassBoost(0, session).also { bassBoost = it }
            if (bb.strengthSupported) bb.setStrength(bassStrength.toShort())
            bb.enabled = true
        }.isSuccess else {
            runCatching { bassBoost?.enabled = false }
            false
        }

        val loudGainMb = (profile.inputGainDb.coerceAtLeast(0f) * 100f).toInt()
        val loudOk = if (loudGainMb > 0) runCatching {
            val le = loudness ?: LoudnessEnhancer(session).also { loudness = it }
            le.setTargetGain(loudGainMb)
            le.enabled = true
        }.isSuccess else {
            runCatching { loudness?.enabled = false }
            false
        }

        return eqOk || bassOk || loudOk
    }

    private fun releaseDynamics() {
        runCatching { (dynamics as? android.media.audiofx.AudioEffect)?.release() }
        dynamics = null
    }

    private fun releaseLegacy() {
        runCatching { equalizer?.release() }
        runCatching { bassBoost?.release() }
        runCatching { loudness?.release() }
        equalizer = null
        bassBoost = null
        loudness = null
    }

    fun release() {
        releaseDynamics()
        releaseLegacy()
        sessionId = 0
    }
}
