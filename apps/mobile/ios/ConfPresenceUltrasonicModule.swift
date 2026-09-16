import Foundation
import AVFoundation
import React

@objc(ConfPresenceUltrasonic)
class ConfPresenceUltrasonicModule: RCTEventEmitter {

    private enum ReceiverFsmState {
        case seekPreamble
        case readPayload
    }

    private var audioEngine: AVAudioEngine?
    private var playerNode: AVAudioPlayerNode?
    private var isBroadcasting = false
    private var isListening = false
    private var activeBroadcastToken: String?
    private var broadcastTimer: Timer?

    private let sampleRate: Double = 48000.0
    private let preambleDurationSec: Double = 0.080
    private let symbolDurationSec: Double = 0.045

    private let freqPreamble1: Double = 18200.0
    private let freqPreamble2: Double = 19800.0
    private let symbolFrequencies: [Double] = [
        18500.0, 18650.0, 18800.0, 18950.0,
        19100.0, 19250.0, 19400.0, 19550.0
    ]
    private let noiseFloorLowFreq: Double = 17500.0
    private let noiseFloorHighFreq: Double = 20500.0
    private let minMagnitudeThreshold: Double = 2500.0

    private var fsmState: ReceiverFsmState = .seekPreamble
    private var preambleHits: Int = 0
    private var payloadFramesCollected: Int = 0
    private var payloadSymbols: [Int] = [0, 0, 0, 0]
    private var lastAvgSnr: Double = 0.0
    private var lastEmittedTime: TimeInterval = 0
    private var lastEmittedToken: String = ""

    override static func requiresMainQueueSetup() -> Bool {
        return false
    }

    override func supportedEvents() -> [String]! {
        return ["ConfPresenceUltrasonicDetected"]
    }

    @objc func isSupported(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        resolve(true)
    }

    // MARK: - Ultrasonic Broadcasting (Compact 260ms Burst)

    @objc func startBroadcasting(_ token: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        let sanitized = token.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        guard !sanitized.isEmpty else {
            reject("INVALID_TOKEN", "Token cannot be empty", nil)
            return
        }

        activeBroadcastToken = String(sanitized.prefix(6))
        isBroadcasting = true

        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.setupAudioSessionForPlayback()
            self.playSinglePulse()
            self.broadcastTimer?.invalidate()
            self.broadcastTimer = Timer.scheduledTimer(withTimeInterval: 3.0, repeats: true) { [weak self] _ in
                self?.playSinglePulse()
            }
        }
        resolve(nil)
    }

    @objc func stopBroadcasting(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        isBroadcasting = false
        activeBroadcastToken = nil
        DispatchQueue.main.async { [weak self] in
            self?.broadcastTimer?.invalidate()
            self?.broadcastTimer = nil
            self?.playerNode?.stop()
        }
        resolve(nil)
    }

    private func setupAudioSessionForPlayback() {
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playAndRecord, mode: .measurement, options: [.mixWithOthers, .defaultToSpeaker])
        try? session.setActive(true)
    }

    private func playSinglePulse() {
        guard isBroadcasting, let token = activeBroadcastToken else { return }
        
        let engine = AVAudioEngine()
        let player = AVAudioPlayerNode()
        engine.attach(player)

        let format = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 1)!
        engine.connect(player, to: engine.mainMixerNode, format: format)

        guard let buffer = synthesizeTokenBuffer(token: token, format: format) else { return }

        do {
            try engine.start()
            player.play()
            player.scheduleBuffer(buffer, at: nil, options: []) {
                DispatchQueue.global().asyncAfter(deadline: .now() + 0.05) {
                    player.stop()
                    engine.stop()
                }
            }
        } catch {
            // Audio engine start error
        }
    }

    private func synthesizeTokenBuffer(token: String, format: AVAudioFormat) -> AVAudioPCMBuffer? {
        let symbols = encodeTokenTo4Symbols(token: token)
        let samplesPerSymbol = Int(sampleRate * symbolDurationSec)
        let samplesPerPreamble = Int(sampleRate * preambleDurationSec)
        let totalSamples = samplesPerPreamble + (symbols.count * samplesPerSymbol) + Int(sampleRate * 0.01)

        guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(totalSamples)) else {
            return nil
        }
        buffer.frameLength = AVAudioFrameCount(totalSamples)
        let channels = buffer.floatChannelData![0]

        var offset = 0

        // 1. 80ms Preamble (Dual Tone Header) with Hann window
        for i in 0..<samplesPerPreamble {
            let t = Double(i) / sampleRate
            let env = 0.5 * (1.0 - cos(2.0 * .pi * Double(i) / Double(samplesPerPreamble)))
            let wave1 = sin(2.0 * .pi * freqPreamble1 * t)
            let wave2 = sin(2.0 * .pi * freqPreamble2 * t)
            channels[offset] = Float(0.5 * (wave1 + wave2) * env * 0.8)
            offset += 1
        }

        // 2. 4 M-FSK Payload symbols (45ms each)
        for symbol in symbols {
            let freq = symbolFrequencies[min(max(symbol, 0), symbolFrequencies.count - 1)]
            let ramp = Int(sampleRate * 0.004)
            for i in 0..<samplesPerSymbol {
                let t = Double(i) / sampleRate
                var env: Double = 1.0
                if i < ramp {
                    env = 0.5 * (1.0 - cos(.pi * Double(i) / Double(ramp)))
                } else if i > samplesPerSymbol - ramp {
                    env = 0.5 * (1.0 - cos(.pi * Double(samplesPerSymbol - i) / Double(ramp)))
                }
                channels[offset] = Float(sin(2.0 * .pi * freq * t) * env * 0.9)
                offset += 1
            }
        }

        return buffer
    }

    private func encodeTokenTo4Symbols(token: String) -> [Int] {
        let clean = token.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        var prefixCode = 0
        var rest = clean

        if clean.hasPrefix("RM") || clean.hasPrefix("ROOM") {
            prefixCode = 0
            rest = clean.replacingOccurrences(of: "ROOM", with: "").replacingOccurrences(of: "RM", with: "").trimmingCharacters(in: CharacterSet(charactersIn: "-_ "))
        } else if clean.hasPrefix("HL") || clean.hasPrefix("HALL") {
            prefixCode = 1
            rest = clean.replacingOccurrences(of: "HALL", with: "").replacingOccurrences(of: "HL", with: "").trimmingCharacters(in: CharacterSet(charactersIn: "-_ "))
        } else if clean.hasPrefix("WK") || clean.hasPrefix("WORKSHOP") {
            prefixCode = 2
            rest = clean.replacingOccurrences(of: "WORKSHOP", with: "").replacingOccurrences(of: "WK", with: "").trimmingCharacters(in: CharacterSet(charactersIn: "-_ "))
        } else if clean.hasPrefix("ST") || clean.hasPrefix("STAGE") {
            prefixCode = 3
            rest = clean.replacingOccurrences(of: "STAGE", with: "").replacingOccurrences(of: "ST", with: "").trimmingCharacters(in: CharacterSet(charactersIn: "-_ "))
        } else if clean.hasPrefix("AUD") || clean.hasPrefix("AUDITORIUM") {
            prefixCode = 4
            rest = ""
        } else if clean.hasPrefix("CONF") || clean.hasPrefix("CONFERENCE") {
            prefixCode = 5
            rest = ""
        } else if clean.hasPrefix("LAB") {
            prefixCode = 6
            rest = clean.replacingOccurrences(of: "LAB", with: "").trimmingCharacters(in: CharacterSet(charactersIn: "-_ "))
        } else {
            prefixCode = 7
        }

        func charToSymbol(_ ch: Character?) -> Int {
            guard let ch = ch else { return 0 }
            switch ch {
            case "A": return 0
            case "B": return 1
            case "C": return 2
            case "D": return 3
            case "1": return 4
            case "2": return 5
            case "3": return 6
            case "4": return 7
            case "E": return 0
            case "F": return 1
            case "5": return 4
            case "6": return 5
            default:
                return Int(ch.asciiValue ?? 0) % 8
            }
        }

        let firstChar = rest.first
        let secondChar = rest.count > 1 ? rest[rest.index(after: rest.startIndex)] : nil
        let sub1 = charToSymbol(firstChar)
        let sub2 = charToSymbol(secondChar)
        let checksum = (prefixCode + sub1 + sub2) % 8

        return [prefixCode, sub1, sub2, checksum]
    }

    private func decode4SymbolsToToken(s: [Int]) -> String? {
        guard s.count >= 4 else { return nil }
        let prefixCode = s[0] & 0x07
        let sub1 = s[1] & 0x07
        let sub2 = s[2] & 0x07
        let checksum = s[3] & 0x07

        if (prefixCode + sub1 + sub2) % 8 != checksum {
            return nil
        }

        let prefix: String
        switch prefixCode {
        case 0: prefix = "RM"
        case 1: prefix = "HL"
        case 2: prefix = "WK"
        case 3: prefix = "ST"
        case 4: prefix = "AUD"
        case 5: prefix = "CONF"
        case 6: prefix = "LAB"
        default: prefix = "GEN"
        }

        if prefix == "AUD" || prefix == "CONF" {
            return prefix
        }

        func symbolToChar(_ sym: Int) -> Character {
            switch sym {
            case 0: return "A"
            case 1: return "B"
            case 2: return "C"
            case 3: return "D"
            case 4: return "1"
            case 5: return "2"
            case 6: return "3"
            case 7: return "4"
            default: return "A"
            }
        }

        let c1 = symbolToChar(sub1)
        if sub2 != 0 {
            let c2 = symbolToChar(sub2)
            return "\(prefix)-\(c1)\(c2)"
        } else {
            return "\(prefix)-\(c1)"
        }
    }

    // MARK: - Ultrasonic Listening & 2-Phase Synchronized State Machine

    @objc func startListening(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard !isListening else {
            resolve(nil)
            return
        }

        isListening = true
        fsmState = .seekPreamble
        preambleHits = 0
        payloadFramesCollected = 0
        setupAudioSessionForPlayback()

        audioEngine = AVAudioEngine()
        guard let engine = audioEngine else {
            resolve(nil)
            return
        }

        let input = engine.inputNode
        let bus = 0
        let inputFormat = input.outputFormat(forBus: bus)

        input.installTap(onBus: bus, bufferSize: 2048, format: inputFormat) { [weak self] (buffer, time) in
            self?.processIncomingAudioBuffer(buffer: buffer)
        }

        do {
            try engine.start()
            resolve(nil)
        } catch {
            isListening = false
            reject("LISTEN_ERROR", "Failed to start audio engine: \(error.localizedDescription)", error)
        }
    }

    @objc func stopListening(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        isListening = false
        fsmState = .seekPreamble
        preambleHits = 0
        payloadFramesCollected = 0
        if let engine = audioEngine {
            engine.inputNode.removeTap(onBus: 0)
            engine.stop()
            audioEngine = nil
        }
        resolve(nil)
    }

    private func processIncomingAudioBuffer(buffer: AVAudioPCMBuffer) {
        guard isListening, let channelData = buffer.floatChannelData?[0] else { return }
        let frameCount = Int(buffer.frameLength)
        guard frameCount >= 512 else { return }

        let rate = buffer.format.sampleRate

        switch fsmState {
        case .seekPreamble:
            // 1. Dual-Tone Preamble Magnitude (18.2 kHz + 19.8 kHz)
            let mag1 = goertzelMagnitude(channelData: channelData, count: frameCount, targetFreq: freqPreamble1, sampleRate: rate)
            let mag2 = goertzelMagnitude(channelData: channelData, count: frameCount, targetFreq: freqPreamble2, sampleRate: rate)

            // 2. Dual-Point Noise Baseline (17.5 kHz & 20.5 kHz)
            let noiseLow = goertzelMagnitude(channelData: channelData, count: frameCount, targetFreq: noiseFloorLowFreq, sampleRate: rate)
            let noiseHigh = goertzelMagnitude(channelData: channelData, count: frameCount, targetFreq: noiseFloorHighFreq, sampleRate: rate)
            let noise = max(400.0, max(noiseLow, noiseHigh))

            let snr1 = mag1 / noise
            let snr2 = mag2 / noise
            let avgSnr = (snr1 + snr2) / 2.0

            let isPreamblePresent = (mag1 > minMagnitudeThreshold) &&
                                    (mag2 > minMagnitudeThreshold) &&
                                    (snr1 >= 2.2) &&
                                    (snr2 >= 2.2) &&
                                    (avgSnr >= 2.4)

            if isPreamblePresent {
                preambleHits += 1
                lastAvgSnr = avgSnr
                if preambleHits >= 2 {
                    // Preamble confirmed (~85ms). Switch to capturing payload symbols.
                    fsmState = .readPayload
                    preambleHits = 0
                    payloadFramesCollected = 0
                }
            } else {
                if preambleHits > 0 {
                    preambleHits -= 1
                }
            }

        case .readPayload:
            // Extract dominant M-FSK frequency in this payload frame
            var bestSymbol = 0
            var bestMag = 0.0
            for (idx, freq) in symbolFrequencies.enumerated() {
                let symMag = goertzelMagnitude(channelData: channelData, count: frameCount, targetFreq: freq, sampleRate: rate)
                if symMag > bestMag {
                    bestMag = symMag
                    bestSymbol = idx
                }
            }

            payloadSymbols[payloadFramesCollected] = bestSymbol
            payloadFramesCollected += 1

            if payloadFramesCollected >= 4 {
                fsmState = .seekPreamble
                if let decodedToken = decode4SymbolsToToken(s: payloadSymbols) {
                    let now = Date().timeIntervalSince1970
                    if now - lastEmittedTime > 2.0 || decodedToken != lastEmittedToken {
                        let confidence = min(0.99, max(0.85, lastAvgSnr / 3.0))
                        emitTokenDetected(token: decodedToken, confidence: confidence)
                        lastEmittedTime = now
                        lastEmittedToken = decodedToken
                    }
                }
            }
        }
    }

    private func goertzelMagnitude(channelData: UnsafeMutablePointer<Float>, count: Int, targetFreq: Double, sampleRate: Double) -> Double {
        let k = Int(0.5 + ((Double(count) * targetFreq) / sampleRate))
        let omega = (2.0 * .pi * Double(k)) / Double(count)
        let coeff = 2.0 * cos(omega)

        var q0: Double = 0.0
        var q1: Double = 0.0
        var q2: Double = 0.0

        for i in 0..<count {
            q0 = coeff * q1 - q2 + Double(channelData[i] * 32767.0)
            q2 = q1
            q1 = q0
        }

        let real = q1 - q2 * cos(omega)
        let imag = q2 * sin(omega)
        return sqrt(real * real + imag * imag)
    }

    private func emitTokenDetected(token: String, confidence: Double) {
        let isoFormatter = ISO8601DateFormatter()
        isoFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let dateStr = isoFormatter.string(from: Date())

        let payload: [String: Any] = [
            "token": token,
            "confidence": confidence,
            "detectedAt": dateStr
        ]
        sendEvent(withName: "ConfPresenceUltrasonicDetected", body: payload)
    }
}
