import ActivityKit
import AVFoundation
import ExpoModulesCore
import UIKit
#if canImport(AlarmKit)
import AlarmKit
#endif

// The one owner of the app's AVAudioSession (docs/research/ios-platform-feasibility.md §2.5).
// Spike scope: category/options, speak() with activate -> speak -> deactivate
// (notifyOthersOnDeactivation so music returns to full volume), interruption and
// route-change events, AlarmKit authorization (read, and request only when Ben taps
// "Request permission"), App Group evidence for the app and the Live Activity
// extension, and natively scheduled rest cues (ADR 0040).
//
// Rest cues in the background (Ben, 1 Nov): JS hands over the rest's cues (text +
// wall-clock fire time) whenever the committed rest changes. Each is scheduled
// here on a wall-clock timer, so it fires even when JS is suspended. A cue is
// spoken here only when the app isn't active (on screen, JS speaks it, with the
// newest words). While cues are scheduled AND the app is in the background, a
// silent, mixable player ("hold") keeps the app running; it never ducks. For the
// cue itself the hold stops and the session is re-activated with ducking, then
// deactivated with notifyOthersOnDeactivation, so music comes back up. After the
// last cue, or on cancel, the hold stops and the session is released. Needs
// UIBackgroundModes "audio" (an Info.plist mode, not an entitlement).
//
// Overlapping cues: AVSpeechSynthesizer queues utterances, and so do we. The
// session is deactivated only after the LAST pending cue, and never while the
// hold runs. Every speak() promise settles: on finish, on cancel, or on a
// timeout (max(10 s, 0.15 s per character), divided by the rate when it is
// slower than default, counted from when the cue reaches the front of the queue,
// estimated cumulatively).
//
// Written without a Mac. Build 7 compiled and ran it on iOS 26.6.1; later additions
// (extension App Group evidence, AlarmKit request, timeout fixes, scheduled rest
// cues and the hold) are first compiled by the next macOS CI run. AlarmKit API
// names follow Apple's docs.

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

/// One rest cue to speak natively at its moment (Unix ms, wall clock).
struct ScheduledCue: Record {
  /// `rest:<timerId>:<deadline>:warn|end`; an id that has fired never fires again.
  @Field
  var id: String = ""
  @Field
  var text: String = ""
  @Field
  var fireAtMs: Double = 0
  /// Later than this the cue would say the wrong thing: dropped, never spoken.
  @Field
  var dropAfterMs: Double = 0
}

/// The engine and player looping silence while cues wait in the background.
final class SilentHold {
  let engine: AVAudioEngine
  let player: AVAudioPlayerNode
  var observer: NSObjectProtocol?

  init(engine: AVAudioEngine, player: AVAudioPlayerNode) {
    self.engine = engine
    self.player = player
  }
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
  /// Silent, mixable playback that keeps the app running in the background while rest cues wait.
  private var hold: SilentHold?
  /// Scheduled rest cues not yet fired, by id. Main queue only.
  private var scheduledCues: [String: DispatchWorkItem] = [:]
  private var scheduledSpeakOptions = SpeakOptions()
  /// Ids that have fired (bounded), so a reschedule never speaks a cue twice.
  private var firedCueIds: [String] = []
  /// What happened to the last scheduled cues (for the probe and diagnostics).
  private var cueLog: [[String: Any]] = []
  private var backgroundTask: UIBackgroundTaskIdentifier = .invalid

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
      self.cancelScheduledWork()
      self.stopHold()
      self.endBackgroundWork()
      self.removeObservers()
    }

    // Changing the category while a cue or the hold is playing would
    // interrupt it. Then the options are stored and applied by the next idle
    // speak(); "applied" says which happened.
    AsyncFunction("configureSession") { (newOptions: SessionOptions) -> [String: Any] in
      self.options = newOptions
      let idle = self.cueDelegate.pendingCount == 0 && self.hold == nil
      if idle {
        try self.applyCategory(self.options)
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
      if let failure = self.enqueueCue(text, speakOptions, self.options, settled: { result in
        promise.resolve(result)
      }) {
        promise.reject("ERR_AUDIO_SESSION", failure)
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

    // Replaces the rest's scheduled cues (Ben, 1 Nov; ADR 0040). JS calls it
    // whenever the committed rest changes (start, Skip, ±15/30 s, Undo); the hold
    // isn't released between a cancel and its replacement. Refuses without the
    // audio background mode: then the notification is the background alert.
    AsyncFunction("scheduleRestCues") { (cues: [ScheduledCue], speakOptions: SpeakOptions) -> [String: Any] in
      self.cancelScheduledWork()
      guard AudioCoachModule.hasAudioBackgroundMode else {
        return ["scheduled": false, "count": 0, "reason": "noBackgroundMode", "holdRunning": false]
      }
      self.scheduledSpeakOptions = speakOptions
      let nowMs = Date().timeIntervalSince1970 * 1000
      for cue in cues {
        if self.scheduledCues[cue.id] != nil || self.firedCueIds.contains(cue.id) { continue }
        if cue.dropAfterMs <= nowMs || cue.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { continue }
        let item = DispatchWorkItem { [weak self] in
          self?.fireScheduledCue(cue)
        }
        self.scheduledCues[cue.id] = item
        // Wall time, so a cue is never late because the phone slept.
        DispatchQueue.main.asyncAfter(wallDeadline: .now() + max(0, (cue.fireAtMs - nowMs) / 1000), execute: item)
      }
      var result: [String: Any] = ["scheduled": !self.scheduledCues.isEmpty, "count": self.scheduledCues.count]
      if self.scheduledCues.isEmpty {
        self.releaseHoldIfDone()
      } else if UIApplication.shared.applicationState == .background {
        if let failure = self.startHoldIfWanted() {
          result["holdError"] = failure
        }
      }
      result["holdRunning"] = self.hold != nil
      return result
    }.runOnQueue(.main)

    // Rest skipped, paused, logged through, finished or discarded, or cues turned off.
    // A cue already speaking finishes; then the session is released.
    AsyncFunction("cancelRestCues") { () -> [String: Any] in
      let count = self.scheduledCues.count
      self.cancelScheduledWork()
      self.releaseHoldIfDone()
      return ["cancelled": count, "holdRunning": self.hold != nil]
    }.runOnQueue(.main)

    // On main: the log is written there.
    AsyncFunction("scheduledCueLog") { () -> [[String: Any]] in
      return self.cueLog
    }.runOnQueue(.main)

    Function("getSessionState") { () -> [String: Any] in
      return self.sessionState()
    }

    // The voices installed on this phone (Settings > Accessibility > Spoken
    // Content > Voices adds more). Personal Voice needs its own permission and
    // isn't listed until granted; novelty voices are marked so JS can hide them.
    Function("getVoices") { () -> [[String: Any]] in
      return AVSpeechSynthesisVoice.speechVoices().map { (voice: AVSpeechSynthesisVoice) -> [String: Any] in
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

    // Lock Screen rest buttons (lock-screen-and-alerts §4.2, Ben 26 Oct 2026).
    // The patched expo-widgets LiveActivityIntent (patches/expo-widgets+57.0.23.patch,
    // FizzLiveActivityTaps) stores each tap as "fizz.liveActivity.tap.<id>" in the
    // app's standard defaults and waits (up to 8 s) until it is removed. JS lists
    // them here, turns each into a versioned rest command, then removes it.
    // Read and remove only: nothing here changes workout data.
    Function("liveActivityTaps") { () -> [[String: Any]] in
      let prefix = "fizz.liveActivity.tap."
      return UserDefaults.standard.dictionaryRepresentation()
        .filter { $0.key.hasPrefix(prefix) }
        .compactMap { $0.value as? [String: Any] }
    }

    Function("ackLiveActivityTaps") { (ids: [String]) in
      for id in ids {
        UserDefaults.standard.removeObject(forKey: "fizz.liveActivity.tap." + id)
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

  private static var hasAudioBackgroundMode: Bool {
    let modes = Bundle.main.object(forInfoDictionaryKey: "UIBackgroundModes") as? [String] ?? []
    return modes.contains("audio")
  }

  /// Queues one utterance on the shared synthesizer. Returns an error message
  /// (nothing queued, `settled` never called) or nil (`settled` is called once).
  /// Main queue only.
  private func enqueueCue(
    _ text: String, _ speakOptions: SpeakOptions, _ sessionOptions: SessionOptions,
    settled: @escaping ([String: Any]) -> Void
  ) -> String? {
    let session = AVAudioSession.sharedInstance()
    let otherAudioBefore = session.isOtherAudioPlaying
    do {
      // Changing the category while a cue is playing would interrupt it; only
      // (re)apply it when nothing of ours is speaking.
      if cueDelegate.pendingCount == 0 {
        if hold != nil {
          // The hold mixes without ducking. Ducking starts on activation, so stop
          // it and activate again with the cue's options.
          stopHold()
          try? session.setActive(false)
        }
        try applyCategory(sessionOptions)
      }
      try session.setActive(true)
    } catch {
      startHoldIfWanted()
      return "Could not activate the audio session: \(error.localizedDescription)"
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
    let queuedBehind = cueDelegate.pendingCount
    // Slower speech needs a longer budget; faster speech keeps the default.
    let rate = speakOptions.rate ?? 1.0
    let budget = max(10.0, 0.15 * Double(text.count)) / (rate > 0 ? min(rate, 1.0) : 1.0)
    let deadline = max(Date(), queueDrainsAt).addingTimeInterval(budget)
    queueDrainsAt = deadline

    cueDelegate.register(utterance) { [weak self] outcome in
      guard let self = self else { return }
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
      // More rest cues to come while in the background: keep the app running.
      self.startHoldIfWanted()
      settled(result)
    }
    synthesizer.speak(utterance)
    DispatchQueue.main.asyncAfter(deadline: .now() + deadline.timeIntervalSinceNow) { [weak self] in
      self?.cueDelegate.settle(utterance, .timedOut)
    }
    return nil
  }

  private func fireScheduledCue(_ cue: ScheduledCue) {
    scheduledCues.removeValue(forKey: cue.id)
    firedCueIds.append(cue.id)
    if firedCueIds.count > 50 {
      firedCueIds.removeFirst(firedCueIds.count - 50)
    }
    let nowMs = Date().timeIntervalSince1970 * 1000
    let appState = UIApplication.shared.applicationState
    var entry: [String: Any] = [
      "id": cue.id,
      "fireAtMs": cue.fireAtMs,
      "firedAtMs": nowMs,
      "appState": AudioCoachModule.describe(appState),
      "holdRunning": hold != nil,
    ]
    if appState == .active {
      // On screen: JS speaks it, with the newest words.
      entry["outcome"] = "skippedActive"
      logCue(entry)
      releaseHoldIfDone()
      return
    }
    if nowMs > cue.dropAfterMs {
      // iOS suspended the app past the cue's moment: the notification is the alert.
      entry["outcome"] = "late"
      logCue(entry)
      releaseHoldIfDone()
      return
    }
    beginBackgroundWork()
    let failure = enqueueCue(cue.text, scheduledSpeakOptions, SessionOptions()) { [weak self] result in
      entry["outcome"] = "spoken"
      entry["speakOutcome"] = result["outcome"]
      self?.logCue(entry)
      self?.releaseHoldIfDone()
      self?.endBackgroundWork()
    }
    if let failure = failure {
      entry["outcome"] = "speakFailed"
      entry["error"] = failure
      logCue(entry)
      releaseHoldIfDone()
      endBackgroundWork()
    }
  }

  private func logCue(_ entry: [String: Any]) {
    cueLog.append(entry)
    if cueLog.count > 20 {
      cueLog.removeFirst(cueLog.count - 20)
    }
  }

  private func cancelScheduledWork() {
    scheduledCues.values.forEach { $0.cancel() }
    scheduledCues.removeAll()
  }

  /// No cue left to wait for and none speaking: stop the hold and let the session go.
  private func releaseHoldIfDone() {
    guard scheduledCues.isEmpty, cueDelegate.pendingCount == 0, hold != nil else { return }
    stopHold()
    _ = deactivateIfIdle(requested: true)
  }

  /// Starts the hold only when it's needed: cues waiting, none speaking, app in
  /// the background. Returns an error message when it couldn't start.
  @discardableResult
  private func startHoldIfWanted() -> String? {
    guard hold == nil, !scheduledCues.isEmpty, cueDelegate.pendingCount == 0,
          UIApplication.shared.applicationState == .background else { return nil }
    guard AudioCoachModule.hasAudioBackgroundMode else { return "noBackgroundMode" }
    let session = AVAudioSession.sharedInstance()
    do {
      // Mixable and never ducking: Ben's music plays on at full volume.
      try session.setCategory(.playback, mode: .default, options: [.mixWithOthers])
      try session.setActive(true)
    } catch {
      return "Could not activate the audio session: \(error.localizedDescription)"
    }
    let engine = AVAudioEngine()
    let player = AVAudioPlayerNode()
    engine.attach(player)
    guard let format = AVAudioFormat(standardFormatWithSampleRate: 44_100, channels: 2),
          let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 44_100) else {
      _ = deactivateIfIdle(requested: true)
      return "Could not create the silent buffer"
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
      engine.stop()
      _ = deactivateIfIdle(requested: true)
      return "Could not start the silent player: \(error.localizedDescription)"
    }
    player.play()
    let started = SilentHold(engine: engine, player: player)
    // A route or format change stops the engine: start a fresh one if still wanted.
    started.observer = NotificationCenter.default.addObserver(
      forName: .AVAudioEngineConfigurationChange, object: engine, queue: .main
    ) { [weak self] _ in
      guard let self = self, self.hold === started else { return }
      self.stopHold()
      self.startHoldIfWanted()
      if self.hold == nil {
        _ = self.deactivateIfIdle(requested: true)
      }
    }
    hold = started
    return nil
  }

  private func stopHold() {
    guard let current = hold else { return }
    hold = nil
    if let observer = current.observer {
      NotificationCenter.default.removeObserver(observer)
    }
    current.player.stop()
    current.engine.stop()
  }

  /// A few seconds of guaranteed run time while switching from the hold to a cue and back.
  private func beginBackgroundWork() {
    guard backgroundTask == .invalid else { return }
    backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "fizz.restCue") { [weak self] in
      self?.endBackgroundWork()
    }
  }

  private func endBackgroundWork() {
    guard backgroundTask != .invalid else { return }
    UIApplication.shared.endBackgroundTask(backgroundTask)
    backgroundTask = .invalid
  }

  /// Deactivates (notifying others, so ducked music comes back) only when no
  /// cue is pending and the hold isn't running. Main queue only.
  private func deactivateIfIdle(requested: Bool) -> (deactivated: Bool, skipped: String?, error: String?) {
    if !requested {
      return (false, "notRequested", nil)
    }
    if cueDelegate.pendingCount > 0 {
      return (false, "cuesPending", nil)
    }
    if hold != nil {
      return (false, "holdRunning", nil)
    }
    do {
      try AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
      return (true, nil, nil)
    } catch {
      return (false, nil, error.localizedDescription)
    }
  }

  private func applyCategory(_ options: SessionOptions) throws {
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
      if began {
        // A call or Siri stopped our audio; the hold is gone. Scheduled cues stay.
        self?.stopHold()
      } else {
        // Mixable, so it may start again in the background; if not, the notification is the alert.
        self?.startHoldIfWanted()
      }
      self?.sendEvent("onInterruption", ["type": began ? "began" : "ended", "shouldResume": shouldResume])
    })
    observers.append(center.addObserver(
      forName: AVAudioSession.mediaServicesWereResetNotification, object: nil, queue: .main
    ) { [weak self] _ in
      // Every audio object is invalid now: drop the hold and build a fresh one if still wanted.
      guard let self = self else { return }
      if let current = self.hold, let observer = current.observer {
        NotificationCenter.default.removeObserver(observer)
      }
      self.hold = nil
      self.startHoldIfWanted()
    })
    // The hold runs only while the app is in the background with cues waiting.
    observers.append(center.addObserver(
      forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main
    ) { [weak self] _ in
      guard let self = self, !self.scheduledCues.isEmpty else { return }
      self.beginBackgroundWork()
      self.startHoldIfWanted()
      self.endBackgroundWork()
    })
    observers.append(center.addObserver(
      forName: UIApplication.willEnterForegroundNotification, object: nil, queue: .main
    ) { [weak self] _ in
      guard let self = self, self.hold != nil else { return }
      self.stopHold()
      _ = self.deactivateIfIdle(requested: true)
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

  private static func describe(_ state: UIApplication.State) -> String {
    switch state {
    case .active: return "active"
    case .inactive: return "inactive"
    case .background: return "background"
    @unknown default: return "unknown"
    }
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
