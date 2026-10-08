import AVFoundation
import ExpoModulesCore
#if canImport(AlarmKit)
import AlarmKit
#endif

// The one owner of the app's AVAudioSession (docs/research/ios-platform-feasibility.md §2.5).
// Spike scope: category/options, speak() with activate -> speak -> deactivate
// (notifyOthersOnDeactivation so music returns to full volume), interruption and
// route-change events, and AlarmKit availability (detect only, never requests).
//
// UNVERIFIED: written without a Mac. It has not been compiled yet; the first CI run
// on macOS is its first compile. AlarmKit API names follow Apple's docs.

struct SessionOptions: Record {
  /// "playback" (cues play with the silent switch on) or "playAndRecord" (needed while listening).
  @Field
  var category: String = "playback"
  @Field
  var duckOthers: Bool = true
  /// Apple's recommendation for occasional spoken audio in an exercise app.
  @Field
  var interruptSpokenAudioAndMixWithOthers: Bool = true
}

struct SpeakOptions: Record {
  @Field
  var language: String?
  /// Multiplier of AVSpeechUtteranceDefaultSpeechRate (1.0 = default).
  @Field
  var rate: Double?
  /// Deactivate the session after the cue so ducked music comes back up.
  @Field
  var deactivateAfter: Bool = true
}

final class CueDelegate: NSObject, AVSpeechSynthesizerDelegate {
  private var completions: [ObjectIdentifier: (Bool) -> Void] = [:]

  func register(_ utterance: AVSpeechUtterance, completion: @escaping (Bool) -> Void) {
    completions[ObjectIdentifier(utterance)] = completion
  }

  func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
    completions.removeValue(forKey: ObjectIdentifier(utterance))?(true)
  }

  func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
    completions.removeValue(forKey: ObjectIdentifier(utterance))?(false)
  }
}

public final class AudioCoachModule: Module {
  private let synthesizer = AVSpeechSynthesizer()
  private let cueDelegate = CueDelegate()
  private var options = SessionOptions()
  private var observers: [NSObjectProtocol] = []

  public func definition() -> ModuleDefinition {
    Name("AudioCoach")

    Events("onInterruption", "onRouteChange")

    OnCreate {
      self.synthesizer.delegate = self.cueDelegate
      // The app, not the synthesizer, owns the session.
      self.synthesizer.usesApplicationAudioSession = true
      self.addObservers()
    }

    OnDestroy {
      self.removeObservers()
    }

    AsyncFunction("configureSession") { (newOptions: SessionOptions) -> [String: Any] in
      self.options = newOptions
      try self.applyCategory()
      return self.sessionState()
    }

    AsyncFunction("speak") { (text: String, speakOptions: SpeakOptions, promise: Promise) in
      let session = AVAudioSession.sharedInstance()
      let otherAudioBefore = session.isOtherAudioPlaying
      do {
        try self.applyCategory()
        try session.setActive(true)
      } catch {
        promise.reject("ERR_AUDIO_SESSION", "Could not activate the audio session: \(error.localizedDescription)")
        return
      }
      let utterance = AVSpeechUtterance(string: text)
      if let language = speakOptions.language {
        utterance.voice = AVSpeechSynthesisVoice(language: language)
      }
      if let rate = speakOptions.rate {
        utterance.rate = Float(rate) * AVSpeechUtteranceDefaultSpeechRate
      }
      let category = session.category.rawValue
      let deactivate = speakOptions.deactivateAfter
      self.cueDelegate.register(utterance) { finished in
        var deactivationError: String? = nil
        if deactivate {
          do {
            try session.setActive(false, options: .notifyOthersOnDeactivation)
          } catch {
            deactivationError = error.localizedDescription
          }
        }
        var result: [String: Any] = [
          "finished": finished,
          "otherAudioWasPlaying": otherAudioBefore,
          "category": category,
          "deactivated": deactivate && deactivationError == nil,
        ]
        if let deactivationError {
          result["deactivationError"] = deactivationError
        }
        promise.resolve(result)
      }
      self.synthesizer.speak(utterance)
    }.runOnQueue(.main)

    AsyncFunction("stop") {
      self.synthesizer.stopSpeaking(at: .immediate)
    }.runOnQueue(.main)

    Function("getSessionState") { () -> [String: Any] in
      return self.sessionState()
    }

    // Detect only. Returns "authorized" | "denied" | "notDetermined" (from the
    // system enum), "unsupportedOS" below iOS 26, or "notInSDK" if built with an
    // SDK that has no AlarmKit.
    // Runs on the main queue and reads inside MainActor.assumeIsolated in case
    // AlarmManager is main-actor isolated in the iOS 26 SDK.
    AsyncFunction("getAlarmKitStatus") { () -> String in
      #if canImport(AlarmKit)
      if #available(iOS 26.0, *) {
        return MainActor.assumeIsolated {
          String(describing: AlarmManager.shared.authorizationState)
        }
      }
      return "unsupportedOS"
      #else
      return "notInSDK"
      #endif
    }.runOnQueue(.main)
  }

  private func applyCategory() throws {
    var categoryOptions: AVAudioSession.CategoryOptions = []
    if options.duckOthers {
      categoryOptions.insert(.duckOthers)
    }
    if options.interruptSpokenAudioAndMixWithOthers {
      categoryOptions.insert(.interruptSpokenAudioAndMixWithOthers)
    }
    let session = AVAudioSession.sharedInstance()
    if options.category == "playAndRecord" {
      categoryOptions.insert(.defaultToSpeaker)
      try session.setCategory(.playAndRecord, mode: .default, options: categoryOptions)
    } else {
      try session.setCategory(.playback, mode: .voicePrompt, options: categoryOptions)
    }
  }

  private func sessionState() -> [String: Any] {
    let session = AVAudioSession.sharedInstance()
    let outputs: [[String: Any]] = session.currentRoute.outputs.map { port in
      ["portType": port.portType.rawValue, "portName": port.portName]
    }
    return [
      "category": session.category.rawValue,
      "mode": session.mode.rawValue,
      "categoryOptions": Int(session.categoryOptions.rawValue),
      "isOtherAudioPlaying": session.isOtherAudioPlaying,
      "secondaryAudioShouldBeSilencedHint": session.secondaryAudioShouldBeSilencedHint,
      "outputs": outputs,
    ]
  }

  private func addObservers() {
    let center = NotificationCenter.default
    observers.append(center.addObserver(
      forName: AVAudioSession.interruptionNotification, object: nil, queue: .main
    ) { [weak self] note in
      let info = note.userInfo ?? [:]
      let typeRaw = info[AVAudioSessionInterruptionTypeKey] as? UInt ?? 0
      let optionsRaw = info[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0
      let began = AVAudioSession.InterruptionType(rawValue: typeRaw) == .began
      let shouldResume = AVAudioSession.InterruptionOptions(rawValue: optionsRaw).contains(.shouldResume)
      self?.sendEvent("onInterruption", ["type": began ? "began" : "ended", "shouldResume": shouldResume])
    })
    observers.append(center.addObserver(
      forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main
    ) { [weak self] note in
      let info = note.userInfo ?? [:]
      let reasonRaw = info[AVAudioSessionRouteChangeReasonKey] as? UInt ?? 0
      let reason = AVAudioSession.RouteChangeReason(rawValue: reasonRaw)
      let outputs = AVAudioSession.sharedInstance().currentRoute.outputs.map { $0.portType.rawValue }
      self?.sendEvent("onRouteChange", ["reason": AudioCoachModule.describe(reason), "outputs": outputs])
    })
  }

  private func removeObservers() {
    observers.forEach { NotificationCenter.default.removeObserver($0) }
    observers.removeAll()
  }

  private static func describe(_ reason: AVAudioSession.RouteChangeReason?) -> String {
    switch reason {
    case .newDeviceAvailable: return "newDeviceAvailable"
    case .oldDeviceUnavailable: return "oldDeviceUnavailable"
    case .categoryChange: return "categoryChange"
    case .override: return "override"
    case .wakeFromSleep: return "wakeFromSleep"
    case .noSuitableRouteForCategory: return "noSuitableRouteForCategory"
    case .routeConfigurationChange: return "routeConfigurationChange"
    default: return "unknown"
    }
  }
}
