import ActivityKit
import AVFoundation
import ExpoModulesCore
#if canImport(AlarmKit)
import AlarmKit
#endif

// The one owner of the app's AVAudioSession (docs/research/ios-platform-feasibility.md §2.5).
// Spike scope: category/options, speak() with activate -> speak -> deactivate
// (notifyOthersOnDeactivation so music returns to full volume), interruption and
// route-change events, AlarmKit authorization (read, and request only when Ben taps
// "Request permission"), App Group evidence for the app and the Live Activity
// extension, and an opt-in silent keep-alive for the locked-cue experiment.
//
// Overlapping cues: AVSpeechSynthesizer queues utterances, and so do we. The
// session is deactivated only after the LAST pending cue, and never while the
// keep-alive runs. Every speak() promise settles: on finish, on cancel, or on a
// timeout (max(10 s, 0.15 s per character), divided by the rate when it is
// slower than default, counted from when the cue reaches the front of the queue,
// estimated cumulatively).
//
// Written without a Mac. Build 7 compiled and ran it on iOS 26.6.1; later additions
// (extension App Group evidence, AlarmKit request, keep-alive/timeout fixes) are
// first compiled by the next macOS CI run. AlarmKit API names follow Apple's docs.

struct SessionOptions: Record {
  /// "playback" (cues play with the silent switch on) or "playAndRecord" (needed while listening).
  @Field
  var category: String = "playback"
  @Field
  var duckOthers: Bool = true
  /// Apple's recommendation for occasional spoken audio in an exercise app.
  @Field
  var interruptSpokenAudioAndMixWithOthers: Bool = true
  /// playAndRecord only: take the mic from a Bluetooth headset (HFP). Off by
  /// default: HFP drops output quality, and cues only need A2DP output.
  @Field
  var bluetoothMicrophone: Bool = false
}

struct SpeakOptions: Record {
  @Field
  var language: String?
  /// An AVSpeechSynthesisVoice identifier (from getVoices). When it isn't on
  /// this phone any more, `language` (or the system default) is used.
  @Field
  var voice: String?
  /// Multiplier of AVSpeechUtteranceDefaultSpeechRate (1.0 = default).
  @Field
  var rate: Double?
  /// Deactivate the session after the cue so ducked music comes back up.
  @Field
  var deactivateAfter: Bool = true
}

/// How a cue ended. Only the first outcome per cue counts.
enum CueOutcome: String {
  case finished
  case cancelled
  case timedOut
}

/// Main-queue only (speak/stop and the delegate all run on main).
final class CueDelegate: NSObject, AVSpeechSynthesizerDelegate {
  private var completions: [ObjectIdentifier: (CueOutcome) -> Void] = [:]

  var pendingCount: Int { completions.count }

  func register(_ utterance: AVSpeechUtterance, completion: @escaping (CueOutcome) -> Void) {
    completions[ObjectIdentifier(utterance)] = completion
  }

  /// Settles a cue once; later calls for the same cue are ignored.
  func settle(_ utterance: AVSpeechUtterance, _ outcome: CueOutcome) {
    // Remove first, so the completion sees the updated pendingCount.
    completions.removeValue(forKey: ObjectIdentifier(utterance))?(outcome)
  }

  /// stopSpeaking may report didCancel only for the current utterance, not the
  /// queued ones; settle everything still pending.
  func cancelAll() {
    let pending = Array(completions.values)
    completions.removeAll()
    pending.forEach { $0(.cancelled) }
  }

  func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
    settle(utterance, .finished)
  }

  func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
    settle(utterance, .cancelled)
  }
}

public final class AudioCoachModule: Module {
  private let synthesizer = AVSpeechSynthesizer()
  private let cueDelegate = CueDelegate()
  private var options = SessionOptions()
  private var observers: [NSObjectProtocol] = []
  /// Estimated time the last queued cue will have finished (for timeouts).
  private var queueDrainsAt = Date.distantPast
  /// Silent playback that keeps the app running while locked (opt-in experiment).
  private var keepAliveEngine: AVAudioEngine?
  private var keepAlivePlayer: AVAudioPlayerNode?

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

    // Changing the category while a cue or the keep-alive is playing would
    // interrupt it. Then the options are stored and applied by the next idle
    // speak(); "applied" says which happened.
    AsyncFunction("configureSession") { (newOptions: SessionOptions) -> [String: Any] in
      self.options = newOptions
      let idle = self.cueDelegate.pendingCount == 0 && self.keepAliveEngine == nil
      if idle {
        try self.applyCategory()
      }
      var state = self.sessionState()
      state["applied"] = idle
      return state
    }.runOnQueue(.main)

    AsyncFunction("speak") { (text: String, speakOptions: SpeakOptions, promise: Promise) in
      if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        promise.reject("ERR_EMPTY_CUE", "Cue text is empty")
        return
      }
      let session = AVAudioSession.sharedInstance()
      let otherAudioBefore = session.isOtherAudioPlaying
      do {
        // Changing the category while a cue or the keep-alive is playing would
        // interrupt it; only (re)apply it when the session is idle.
        if self.cueDelegate.pendingCount == 0 && self.keepAliveEngine == nil {
          try self.applyCategory()
        }
        try session.setActive(true)
      } catch {
        promise.reject("ERR_AUDIO_SESSION", "Could not activate the audio session: \(error.localizedDescription)")
        return
      }
      let utterance = AVSpeechUtterance(string: text)
      if let id = speakOptions.voice, let chosen = AVSpeechSynthesisVoice(identifier: id) {
        utterance.voice = chosen
      } else if let language = speakOptions.language {
        utterance.voice = AVSpeechSynthesisVoice(language: language)
      }
      if let rate = speakOptions.rate {
        utterance.rate = Float(rate) * AVSpeechUtteranceDefaultSpeechRate
      }
      let category = session.category.rawValue
      let deactivate = speakOptions.deactivateAfter
      let queuedBehind = self.cueDelegate.pendingCount
      // Slower speech needs a longer budget; faster speech keeps the default.
      let rate = speakOptions.rate ?? 1.0
      let budget = max(10.0, 0.15 * Double(text.count)) / (rate > 0 ? min(rate, 1.0) : 1.0)
      let deadline = max(Date(), self.queueDrainsAt).addingTimeInterval(budget)
      self.queueDrainsAt = deadline

      self.cueDelegate.register(utterance) { outcome in
        var result: [String: Any] = [
          "finished": outcome == .finished,
          "outcome": outcome.rawValue,
          "otherAudioWasPlaying": otherAudioBefore,
          "category": category,
          "queuedBehind": queuedBehind,
        ]
        if outcome == .timedOut && self.cueDelegate.pendingCount == 0 {
          // The synthesizer never reported back; stop it so the session can go.
          _ = self.synthesizer.stopSpeaking(at: .immediate)
        }
        let deactivation = self.deactivateIfIdle(requested: deactivate)
        result["deactivated"] = deactivation.deactivated
        if let skipped = deactivation.skipped {
          result["deactivationSkipped"] = skipped
        }
        if let deactivationError = deactivation.error {
          result["deactivationError"] = deactivationError
        }
        promise.resolve(result)
      }
      self.synthesizer.speak(utterance)
      DispatchQueue.main.asyncAfter(deadline: .now() + deadline.timeIntervalSinceNow) { [weak self] in
        self?.cueDelegate.settle(utterance, .timedOut)
      }
    }.runOnQueue(.main)

    AsyncFunction("stop") {
      _ = self.synthesizer.stopSpeaking(at: .immediate)
      // Nothing is queued any more; later cues' timeouts start from now.
      self.queueDrainsAt = Date.distantPast
      // Every pending speak() promise resolves as "cancelled"; the last one
      // deactivates the session (pendingCount is already 0 by then).
      self.cueDelegate.cancelAll()
    }.runOnQueue(.main)

    // Opt-in experiment (FIZZ_BACKGROUND_AUDIO=1 builds only): loop silence so iOS
    // keeps the app running while locked, letting a cue play at rest end. Needs
    // UIBackgroundModes "audio"; refuses to start without it.
    AsyncFunction("startKeepAlive") { () -> [String: Any] in
      let modes = Bundle.main.object(forInfoDictionaryKey: "UIBackgroundModes") as? [String] ?? []
      guard modes.contains("audio") else {
        return ["started": false, "reason": "This build has no audio background mode"]
      }
      if self.keepAliveEngine != nil {
        return ["started": true, "reason": "already running"]
      }
      let session = AVAudioSession.sharedInstance()
      try self.applyCategory()
      try session.setActive(true)
      let engine = AVAudioEngine()
      let player = AVAudioPlayerNode()
      engine.attach(player)
      guard let format = AVAudioFormat(standardFormatWithSampleRate: 44_100, channels: 2),
            let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 44_100) else {
        // keepAliveEngine is still nil, so this releases the session we just activated.
        _ = self.deactivateIfIdle(requested: true)
        return ["started": false, "reason": "Could not create the silent buffer"]
      }
      buffer.frameLength = buffer.frameCapacity
      if let channels = buffer.floatChannelData {
        for c in 0..<Int(format.channelCount) {
          channels[c].update(repeating: 0, count: Int(buffer.frameLength))
        }
      }
      engine.connect(player, to: engine.mainMixerNode, format: format)
      player.scheduleBuffer(buffer, at: nil, options: .loops)
      do {
        try engine.start()
      } catch {
        // Don't leave the session active (music ducked/paused) after a failed start.
        engine.stop()
        _ = self.deactivateIfIdle(requested: true)
        throw error
      }
      player.play()
      self.keepAliveEngine = engine
      self.keepAlivePlayer = player
      return ["started": true, "category": session.category.rawValue]
    }.runOnQueue(.main)

    AsyncFunction("stopKeepAlive") { () -> [String: Any] in
      self.keepAlivePlayer?.stop()
      self.keepAliveEngine?.stop()
      let wasRunning = self.keepAliveEngine != nil
      self.keepAlivePlayer = nil
      self.keepAliveEngine = nil
      let deactivation = self.deactivateIfIdle(requested: true)
      var result: [String: Any] = ["wasRunning": wasRunning, "deactivated": deactivation.deactivated]
      if let skipped = deactivation.skipped {
        result["deactivationSkipped"] = skipped
      }
      if let error = deactivation.error {
        result["deactivationError"] = error
      }
      return result
    }.runOnQueue(.main)

    Function("getSessionState") { () -> [String: Any] in
      return self.sessionState()
    }

    // The voices installed on this phone (Settings > Accessibility > Spoken
    // Content > Voices adds more). Personal Voice needs its own permission and
    // isn't listed until granted; novelty voices are marked so JS can hide them.
    Function("getVoices") { () -> [[String: Any]] in
      return AVSpeechSynthesisVoice.speechVoices().map { voice in
        var entry: [String: Any] = [
          "identifier": voice.identifier,
          "name": voice.name,
          "language": voice.language,
          "quality": AudioCoachModule.describe(voice.quality),
        ]
        if #available(iOS 17.0, *) {
          entry["novelty"] = voice.voiceTraits.contains(.isNoveltyVoice)
          entry["personal"] = voice.voiceTraits.contains(.isPersonalVoice)
        }
        return entry
      }
    }

    // App Group evidence for the capability probe (free-ios-install.md §9 #3,
    // ADR 0007). For the app AND the Live Activity extension: the installed
    // signing profile and ALTAppGroups; each candidate group's container (test
    // file write/read/delete); and the group each process actually resolved,
    // as recorded by the patched expo-widgets (patches/expo-widgets+57.0.23.patch).
    AsyncFunction("getAppGroupInfo") { (configuredGroups: [String]) -> [String: Any] in
      return AudioCoachModule.appGroupInfo(configuredGroups: configuredGroups)
    }

    // Read only. Returns "authorized" | "denied" | "notDetermined" (from the
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

    // Shows the system AlarmKit permission prompt (only if not yet determined;
    // otherwise returns the current state). Needs NSAlarmKitUsageDescription.
    // Same return values as getAlarmKitStatus. Scheduling is a follow-up.
    AsyncFunction("requestAlarmKitAuthorization") { () async throws -> String in
      #if canImport(AlarmKit)
      if #available(iOS 26.0, *) {
        return try await AudioCoachModule.requestAlarmKit()
      }
      return "unsupportedOS"
      #else
      return "notInSDK"
      #endif
    }
  }

  #if canImport(AlarmKit)
  // MainActor in case AlarmManager is main-actor isolated in the iOS 26 SDK.
  @available(iOS 26.0, *)
  @MainActor
  private static func requestAlarmKit() async throws -> String {
    let state = try await AlarmManager.shared.requestAuthorization()
    return String(describing: state)
  }
  #endif

  /// Must match FizzAppGroupResolver.recordKeyPrefix in the expo-widgets patch.
  private static let resolutionKeyPrefix = "fizz.appGroupResolution."
  /// expo-widgets' extension target name (its PlugIns/<name>.appex).
  private static let widgetExtensionName = "ExpoWidgetsTarget"

  private static func appGroupInfo(configuredGroups: [String]) -> [String: Any] {
    var info: [String: Any] = [:]
    var candidates = configuredGroups

    // Absent keys mean "unknown"; the JS side validates every field.
    if let altGroups = Bundle.main.object(forInfoDictionaryKey: "ALTAppGroups") as? [String] {
      info["altAppGroups"] = altGroups
      candidates.append(contentsOf: altGroups)
    }
    let appProfile = readProfile(in: Bundle.main.bundleURL)
    info.merge(appProfile) { _, new in new }
    candidates.append(contentsOf: appProfile["profileGroups"] as? [String] ?? [])

    // Live Activity prerequisites on the app side.
    info["supportsLiveActivities"] = Bundle.main.object(forInfoDictionaryKey: "NSSupportsLiveActivities") as? Bool ?? false
    if #available(iOS 16.1, *) {
      info["activitiesEnabled"] = ActivityAuthorizationInfo().areActivitiesEnabled
    }

    // The widget extension gets its own profile from the signing tool, and may
    // have been removed by it entirely (review F2).
    var ext: [String: Any] = ["present": false]
    if let plugIns = Bundle.main.builtInPlugInsURL,
       let appex = Bundle(url: plugIns.appendingPathComponent("\(widgetExtensionName).appex")) {
      ext["present"] = true
      if let bundleId = appex.bundleIdentifier {
        ext["bundleId"] = bundleId
      }
      if let configured = appex.object(forInfoDictionaryKey: "ExpoWidgetsAppGroupIdentifier") as? String {
        ext["configuredGroup"] = configured
      }
      if let altGroups = appex.object(forInfoDictionaryKey: "ALTAppGroups") as? [String] {
        ext["altAppGroups"] = altGroups
        candidates.append(contentsOf: altGroups)
      }
      let extProfile = readProfile(in: appex.bundleURL)
      ext.merge(extProfile) { _, new in new }
      candidates.append(contentsOf: extProfile["profileGroups"] as? [String] ?? [])
    }
    info["extension"] = ext

    var containers: [String: Any] = [:]
    var records: [[String: Any]] = []
    for group in Set(candidates) {
      containers[group] = checkContainer(group)
      // Only read a group's defaults if we're entitled to it; otherwise
      // UserDefaults(suiteName:) is a private local domain and proves nothing.
      guard FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group) != nil,
            let shared = UserDefaults(suiteName: group) else { continue }
      for role in ["app", "extension"] {
        if var record = shared.dictionary(forKey: resolutionKeyPrefix + role) {
          record["role"] = role
          record["foundIn"] = group
          records.append(record)
        }
      }
    }
    info["containers"] = containers
    info["resolutionRecords"] = records
    return info
  }

  /// The installed signing profile of a bundle (app or appex).
  private static func readProfile(in bundleURL: URL) -> [String: Any] {
    // embedded.mobileprovision is CMS-signed; the plist is plain XML inside it.
    let url = bundleURL.appendingPathComponent("embedded.mobileprovision")
    guard let data = try? Data(contentsOf: url),
          let start = data.range(of: Data("<?xml".utf8)),
          let end = data.range(of: Data("</plist>".utf8), in: start.lowerBound..<data.endIndex),
          let plist = try? PropertyListSerialization.propertyList(
            from: data.subdata(in: start.lowerBound..<end.upperBound), options: [], format: nil
          ) as? [String: Any] else {
      return ["profileFound": false]
    }
    var out: [String: Any] = ["profileFound": true]
    let entitlements = plist["Entitlements"] as? [String: Any] ?? [:]
    out["profileGroups"] = entitlements["com.apple.security.application-groups"] as? [String] ?? []
    if let teamId = entitlements["com.apple.developer.team-identifier"] as? String {
      out["profileTeamId"] = teamId
    }
    if let expires = plist["ExpirationDate"] as? Date {
      out["profileExpiresUtc"] = ISO8601DateFormatter().string(from: expires)
    }
    return out
  }

  private static func checkContainer(_ group: String) -> [String: Any] {
    guard let url = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group) else {
      return ["resolved": false]
    }
    let file = url.appendingPathComponent("fizz-probe-native.txt")
    let token = UUID().uuidString
    do {
      try token.write(to: file, atomically: true, encoding: .utf8)
      let readBack = try String(contentsOf: file, encoding: .utf8)
      try? FileManager.default.removeItem(at: file)
      return ["resolved": true, "path": url.path, "writeRead": readBack == token]
    } catch {
      return ["resolved": true, "path": url.path, "writeRead": false, "error": error.localizedDescription]
    }
  }

  /// Deactivates (notifying others, so ducked music comes back) only when no
  /// cue is pending and the keep-alive isn't running. Main queue only.
  private func deactivateIfIdle(requested: Bool) -> (deactivated: Bool, skipped: String?, error: String?) {
    if !requested {
      return (false, "notRequested", nil)
    }
    if cueDelegate.pendingCount > 0 {
      return (false, "cuesPending", nil)
    }
    if keepAliveEngine != nil {
      return (false, "keepAliveRunning", nil)
    }
    do {
      try AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
      return (true, nil, nil)
    } catch {
      return (false, nil, error.localizedDescription)
    }
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
      // Under playAndRecord, Bluetooth output must be opted into, or cues play
      // from the loudspeaker while AirPods are in. A2DP = output only.
      categoryOptions.insert(.defaultToSpeaker)
      categoryOptions.insert(.allowBluetoothA2DP)
      if options.bluetoothMicrophone {
        // HFP (headset mic). Named .allowBluetoothHFP from the iOS 26 SDK; the
        // old name still compiles (deprecation warning only).
        categoryOptions.insert(.allowBluetooth)
      }
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

  private static func describe(_ quality: AVSpeechSynthesisVoiceQuality) -> String {
    switch quality {
    case .premium: return "premium"
    case .enhanced: return "enhanced"
    default: return "default"
    }
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
