package com.confpresence.zero.ultrasonic

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaRecorder
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * ConfPresence / XConnect Ultrasonic Presence Module.
 * Implements Layer 1 S2 Ultrasonic token transmission (18.2 - 19.8 kHz M-FSK)
 * with a 2-Phase Synchronized State Machine and Goertzel DSP frequency filtering.
 */
class ConfPresenceUltrasonicModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "ConfPresenceUltrasonic"

    private val isBroadcasting = AtomicBoolean(false)
    private val isListening = AtomicBoolean(false)
    private var broadcastThread: Thread? = null
    private var listenThread: Thread? = null
    private var activeBroadcastToken: String? = null

    private enum class ReceiverFsmState {
        SEEK_PREAMBLE,
        READ_PAYLOAD
    }

    companion object {
        private const val SAMPLE_RATE = 48000
        private const val PREAMBLE_DURATION_MS = 80
        private const val SYMBOL_DURATION_MS = 45
        private const val SILENCE_BETWEEN_PULSES_MS = 3000L

        // Dual-carrier preamble header
        private const val FREQ_PREAMBLE_1 = 18200.0
        private const val FREQ_PREAMBLE_2 = 19800.0

        // 8-ary M-FSK Payload Frequencies (18.5 kHz - 19.55 kHz, 150 Hz bin spacing)
        private val SYMBOL_FREQUENCIES = doubleArrayOf(
            18500.0, // Symbol 0
            18650.0, // Symbol 1
            18800.0, // Symbol 2
            18950.0, // Symbol 3
            19100.0, // Symbol 4
            19250.0, // Symbol 5
            19400.0, // Symbol 6
            19550.0  // Symbol 7
        )

        // Sub-band & Super-band noise baseline check
        private const val NOISE_FLOOR_LOW_FREQ = 17500.0
        private const val NOISE_FLOOR_HIGH_FREQ = 20500.0
        private const val MIN_MAGNITUDE_THRESHOLD = 2500.0
    }

    @ReactMethod
    fun isSupported(promise: Promise) {
        val minBuf = AudioRecord.getMinBufferSize(
            SAMPLE_RATE,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT
        )
        promise.resolve(minBuf > 0)
    }

    @ReactMethod
    fun startBroadcasting(token: String, promise: Promise) {
        try {
            val sanitized = token.trim().uppercase(Locale.US).take(6)
            if (sanitized.isEmpty()) {
                promise.reject("INVALID_TOKEN", "Token cannot be empty")
                return
            }
            activeBroadcastToken = sanitized
            if (isBroadcasting.getAndSet(true)) {
                promise.resolve(null)
                return
            }

            broadcastThread = thread(start = true, name = "UltrasonicBroadcaster") {
                while (isBroadcasting.get()) {
                    try {
                        val currentToken = activeBroadcastToken ?: break
                        playAcousticToken(currentToken)

                        var slept = 0L
                        while (slept < SILENCE_BETWEEN_PULSES_MS && isBroadcasting.get()) {
                            Thread.sleep(200)
                            slept += 200
                        }
                    } catch (e: InterruptedException) {
                        break
                    } catch (e: Exception) {
                        Thread.sleep(1000)
                    }
                }
            }
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("BROADCAST_ERROR", "Failed to start ultrasonic broadcast: ${e.message}")
        }
    }

    @ReactMethod
    fun stopBroadcasting(promise: Promise) {
        isBroadcasting.set(false)
        activeBroadcastToken = null
        broadcastThread?.interrupt()
        broadcastThread = null
        promise.resolve(null)
    }

    @ReactMethod
    fun startListening(promise: Promise) {
        try {
            if (isListening.getAndSet(true)) {
                promise.resolve(null)
                return
            }

            listenThread = thread(start = true, name = "UltrasonicListener") {
                runAcousticListener()
            }
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("LISTEN_ERROR", "Failed to start ultrasonic listener: ${e.message}")
        }
    }

    @ReactMethod
    fun stopListening(promise: Promise) {
        isListening.set(false)
        listenThread?.interrupt()
        listenThread = null
        promise.resolve(null)
    }

    @ReactMethod
    fun addListener(eventName: String) {
        // Keep React Native NativeEventEmitter contract
    }

    @ReactMethod
    fun removeListeners(count: Int) {
        // Keep React Native NativeEventEmitter contract
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // TRANSMISSION SYNTHESIZER (Compact 260ms Burst)
    // ─────────────────────────────────────────────────────────────────────────────

    private fun playAcousticToken(token: String) {
        val audioData = synthesizeTokenAudio(token)
        val minBufferSize = AudioTrack.getMinBufferSize(
            SAMPLE_RATE,
            AudioFormat.CHANNEL_OUT_MONO,
            AudioFormat.ENCODING_PCM_16BIT
        )
        val bufferSize = audioData.size.coerceAtLeast(minBufferSize)

        val audioTrack = AudioTrack(
            AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                .build(),
            AudioFormat.Builder()
                .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                .setSampleRate(SAMPLE_RATE)
                .build(),
            bufferSize * 2,
            AudioTrack.MODE_STREAM,
            AudioManager.AUDIO_SESSION_ID_GENERATE
        )

        try {
            audioTrack.setVolume(1.0f)
            audioTrack.play()
            audioTrack.write(audioData, 0, audioData.size)
            val durationMs = (audioData.size.toDouble() / SAMPLE_RATE * 1000).toLong() + 30
            Thread.sleep(durationMs)
        } finally {
            try {
                audioTrack.stop()
                audioTrack.release()
            } catch (e: Exception) {
                // Ignore cleanup error
            }
        }
    }

    private fun synthesizeTokenAudio(token: String): ShortArray {
        val symbols = encodeTokenTo4Symbols(token)
        val samplesPerSymbol = (SAMPLE_RATE * SYMBOL_DURATION_MS / 1000)
        val samplesPerPreamble = (SAMPLE_RATE * PREAMBLE_DURATION_MS / 1000)
        val totalSamples = samplesPerPreamble + (symbols.size * samplesPerSymbol) + (SAMPLE_RATE * 10 / 1000)
        val buffer = ShortArray(totalSamples)

        var offset = 0

        // 1. Synthesize 80ms Preamble (Dual Tone Header) with Hann window
        for (i in 0 until samplesPerPreamble) {
            val t = i.toDouble() / SAMPLE_RATE
            val env = 0.5 * (1.0 - cos(2.0 * PI * i / samplesPerPreamble))
            val wave1 = sin(2.0 * PI * FREQ_PREAMBLE_1 * t)
            val wave2 = sin(2.0 * PI * FREQ_PREAMBLE_2 * t)
            val sample = (0.5 * (wave1 + wave2) * env * 30000).toInt()
            buffer[offset++] = sample.coerceIn(-32767, 32767).toShort()
        }

        // 2. Synthesize each of the 4 M-FSK payload symbols (45ms each)
        for (symbol in symbols) {
            val freq = SYMBOL_FREQUENCIES[symbol.coerceIn(0, SYMBOL_FREQUENCIES.size - 1)]
            for (i in 0 until samplesPerSymbol) {
                val t = i.toDouble() / SAMPLE_RATE
                val rampSamples = (SAMPLE_RATE * 0.004).toInt()
                val env = when {
                    i < rampSamples -> 0.5 * (1.0 - cos(PI * i / rampSamples))
                    i > samplesPerSymbol - rampSamples -> 0.5 * (1.0 - cos(PI * (samplesPerSymbol - i) / rampSamples))
                    else -> 1.0
                }
                val sample = (sin(2.0 * PI * freq * t) * env * 30000).toInt()
                buffer[offset++] = sample.coerceIn(-32767, 32767).toShort()
            }
        }

        return buffer
    }

    private fun encodeTokenTo4Symbols(token: String): IntArray {
        val clean = token.trim().uppercase(Locale.US)
        var prefixCode = 0 // 0: RM, 1: HL, 2: WK, 3: ST, 4: AUD, 5: CONF, 6: LAB, 7: GEN
        var rest = clean

        when {
            clean.startsWith("RM") || clean.startsWith("ROOM") -> {
                prefixCode = 0
                rest = clean.removePrefix("ROOM").removePrefix("RM").removePrefix("-").removePrefix("_").trim()
            }
            clean.startsWith("HL") || clean.startsWith("HALL") -> {
                prefixCode = 1
                rest = clean.removePrefix("HALL").removePrefix("HL").removePrefix("-").removePrefix("_").trim()
            }
            clean.startsWith("WK") || clean.startsWith("WORKSHOP") -> {
                prefixCode = 2
                rest = clean.removePrefix("WORKSHOP").removePrefix("WK").removePrefix("-").removePrefix("_").trim()
            }
            clean.startsWith("ST") || clean.startsWith("STAGE") -> {
                prefixCode = 3
                rest = clean.removePrefix("STAGE").removePrefix("ST").removePrefix("-").removePrefix("_").trim()
            }
            clean.startsWith("AUD") || clean.startsWith("AUDITORIUM") -> {
                prefixCode = 4
                rest = ""
            }
            clean.startsWith("CONF") || clean.startsWith("CONFERENCE") -> {
                prefixCode = 5
                rest = ""
            }
            clean.startsWith("LAB") -> {
                prefixCode = 6
                rest = clean.removePrefix("LAB").removePrefix("-").removePrefix("_").trim()
            }
            else -> {
                prefixCode = 7
            }
        }

        fun charToSymbol(ch: Char?): Int {
            if (ch == null) return 0
            return when (ch) {
                'A' -> 0
                'B' -> 1
                'C' -> 2
                'D' -> 3
                '1' -> 4
                '2' -> 5
                '3' -> 6
                '4' -> 7
                'E' -> 0
                'F' -> 1
                '5' -> 4
                '6' -> 5
                else -> (ch.code % 8)
            }
        }

        val sub1 = if (rest.isNotEmpty()) charToSymbol(rest[0]) else 0
        val sub2 = if (rest.length > 1) charToSymbol(rest[1]) else 0
        val checksum = (prefixCode + sub1 + sub2) % 8

        return intArrayOf(prefixCode, sub1, sub2, checksum)
    }

    private fun decode4SymbolsToToken(s: IntArray): String? {
        if (s.size < 4) return null
        val prefixCode = s[0] and 0x07
        val sub1 = s[1] and 0x07
        val sub2 = s[2] and 0x07
        val checksum = s[3] and 0x07

        // Validate Checksum
        if ((prefixCode + sub1 + sub2) % 8 != checksum) {
            return null
        }

        val prefix = when (prefixCode) {
            0 -> "RM"
            1 -> "HL"
            2 -> "WK"
            3 -> "ST"
            4 -> "AUD"
            5 -> "CONF"
            6 -> "LAB"
            else -> "GEN"
        }

        if (prefix == "AUD" || prefix == "CONF") {
            return prefix
        }

        fun symbolToChar(sym: Int): Char {
            return when (sym) {
                0 -> 'A'
                1 -> 'B'
                2 -> 'C'
                3 -> 'D'
                4 -> '1'
                5 -> '2'
                6 -> '3'
                7 -> '4'
                else -> 'A'
            }
        }

        val c1 = symbolToChar(sub1)
        return if (sub2 != 0) {
            val c2 = symbolToChar(sub2)
            "$prefix-$c1$c2"
        } else {
            "$prefix-$c1"
        }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // RECEPTION & 2-PHASE SYNCHRONIZED FSM
    // ─────────────────────────────────────────────────────────────────────────────

    private fun createAudioRecord(bufferSize: Int): AudioRecord? {
        val sources = intArrayOf(
            MediaRecorder.AudioSource.UNPROCESSED,
            MediaRecorder.AudioSource.MIC,
            MediaRecorder.AudioSource.DEFAULT
        )
        for (source in sources) {
            try {
                val record = AudioRecord(
                    source,
                    SAMPLE_RATE,
                    AudioFormat.CHANNEL_IN_MONO,
                    AudioFormat.ENCODING_PCM_16BIT,
                    bufferSize * 2
                )
                if (record.state == AudioRecord.STATE_INITIALIZED) {
                    return record
                } else {
                    record.release()
                }
            } catch (e: Exception) {
                // continue to next source
            }
        }
        return null
    }

    private fun runAcousticListener() {
        val bufferSize = AudioRecord.getMinBufferSize(
            SAMPLE_RATE,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT
        ).coerceAtLeast(4096)

        val recorder = createAudioRecord(bufferSize) ?: return

        try {
            recorder.startRecording()
            val audioBuffer = ShortArray(2048)
            var fsmState = ReceiverFsmState.SEEK_PREAMBLE
            var preambleHits = 0
            var payloadFramesCollected = 0
            val payloadSymbols = IntArray(4)
            var lastAvgSnr = 0.0
            var lastEmittedTime = 0L
            var lastEmittedToken = ""

            while (isListening.get()) {
                val readCount = recorder.read(audioBuffer, 0, audioBuffer.size)
                if (readCount <= 0) {
                    Thread.sleep(15)
                    continue
                }

                when (fsmState) {
                    ReceiverFsmState.SEEK_PREAMBLE -> {
                        // 1. Measure Dual-Tone Preamble Frequencies (18.2 kHz + 19.8 kHz)
                        val preambleMag1 = goertzelMagnitude(audioBuffer, readCount, FREQ_PREAMBLE_1, SAMPLE_RATE)
                        val preambleMag2 = goertzelMagnitude(audioBuffer, readCount, FREQ_PREAMBLE_2, SAMPLE_RATE)

                        // 2. Dual-Point Noise Floor Baseline (17.5 kHz & 20.5 kHz)
                        val noiseLow = goertzelMagnitude(audioBuffer, readCount, NOISE_FLOOR_LOW_FREQ, SAMPLE_RATE)
                        val noiseHigh = goertzelMagnitude(audioBuffer, readCount, NOISE_FLOOR_HIGH_FREQ, SAMPLE_RATE)
                        val noiseFloor = maxOf(noiseLow, noiseHigh, 400.0)

                        val snr1 = preambleMag1 / noiseFloor
                        val snr2 = preambleMag2 / noiseFloor
                        val avgSnr = (snr1 + snr2) / 2.0

                        val isPreamblePresent = (preambleMag1 > MIN_MAGNITUDE_THRESHOLD) &&
                                                (preambleMag2 > MIN_MAGNITUDE_THRESHOLD) &&
                                                (snr1 >= 2.2) &&
                                                (snr2 >= 2.2) &&
                                                (avgSnr >= 2.4)

                        if (isPreamblePresent) {
                            preambleHits++
                            lastAvgSnr = avgSnr
                            if (preambleHits >= 2) {
                                // Preamble confirmed (~85ms). Switch to capturing payload symbols.
                                fsmState = ReceiverFsmState.READ_PAYLOAD
                                preambleHits = 0
                                payloadFramesCollected = 0
                            }
                        } else {
                            if (preambleHits > 0) {
                                preambleHits--
                            }
                        }
                    }

                    ReceiverFsmState.READ_PAYLOAD -> {
                        // Extract dominant M-FSK frequency in this payload frame
                        var bestSymbol = 0
                        var bestMag = 0.0
                        for (i in SYMBOL_FREQUENCIES.indices) {
                            val mag = goertzelMagnitude(audioBuffer, readCount, SYMBOL_FREQUENCIES[i], SAMPLE_RATE)
                            if (mag > bestMag) {
                                bestMag = mag
                                bestSymbol = i
                            }
                        }

                        payloadSymbols[payloadFramesCollected] = bestSymbol
                        payloadFramesCollected++

                        if (payloadFramesCollected >= 4) {
                            // All 4 payload symbols received!
                            fsmState = ReceiverFsmState.SEEK_PREAMBLE
                            val decodedToken = decode4SymbolsToToken(payloadSymbols)

                            if (decodedToken != null) {
                                val now = System.currentTimeMillis()
                                if (now - lastEmittedTime > 2000 || decodedToken != lastEmittedToken) {
                                    val confidence = (lastAvgSnr / 3.0).coerceIn(0.85, 0.99)
                                    emitTokenDetectedEvent(decodedToken, confidence)
                                    lastEmittedTime = now
                                    lastEmittedToken = decodedToken
                                }
                            }
                            // Zero false fallbacks: If decodedToken is null (checksum error), drop silently
                        }
                    }
                }
            }
        } catch (e: Exception) {
            // Record loop interrupted
        } finally {
            try {
                recorder.stop()
                recorder.release()
            } catch (e: Exception) {
                // Ignore
            }
        }
    }

    /**
     * Highly optimized Goertzel DSP algorithm for detecting precise frequency magnitude.
     */
    private fun goertzelMagnitude(samples: ShortArray, count: Int, targetFreq: Double, sampleRate: Int): Double {
        val k = (0.5 + ((count * targetFreq) / sampleRate)).toInt()
        val omega = (2.0 * PI * k) / count
        val coeff = 2.0 * cos(omega)

        var q0: Double
        var q1 = 0.0
        var q2 = 0.0

        for (i in 0 until count) {
            q0 = coeff * q1 - q2 + samples[i]
            q2 = q1
            q1 = q0
        }

        val real = q1 - q2 * cos(omega)
        val imag = q2 * sin(omega)
        return sqrt(real * real + imag * imag)
    }

    private fun emitTokenDetectedEvent(token: String, confidence: Double) {
        try {
            val isoFormat = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
                timeZone = TimeZone.getTimeZone("UTC")
            }
            val payload = Arguments.createMap().apply {
                putString("token", token)
                putDouble("confidence", confidence)
                putString("detectedAt", isoFormat.format(Date()))
            }
            reactContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                ?.emit("ConfPresenceUltrasonicDetected", payload)
        } catch (e: Exception) {
            // Ignore emission errors if context is transitioning
        }
    }
}
