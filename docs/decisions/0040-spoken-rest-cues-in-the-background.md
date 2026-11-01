# 0040: Spoken rest cues in the background: native scheduling plus a silent hold

**Status:** ACCEPTED for build (Ben agreed to turn background audio on, 1 Nov 2026). Not yet compiled or run on
Ben's iPhone; the Swift is first compiled by the next macOS CI run. Amends ADR 0007 ("Background audio is an
opt-in experiment, default off") and partly supersedes `lock-screen-and-alerts.md` §2.4.

## Context

Ben, 1 Nov: spoken rest cues "don't always work"; they fail when he is in another app (Spotify, Messages) with
GymSmarter in the background. iOS suspends the app, so the JS timers that speak "15 seconds. Next: …" and
"Rest over." (voice.md revision 27 Oct) never run. Until now cues were by design "while the app is open only", with
the notification as the background alert. `UIBackgroundModes: audio` alone does not help: iOS keeps an app running
only while it is actually playing audio.

## Decision

1. **Background audio is on by default.** `FIZZ_BACKGROUND_AUDIO` defaults to on in `app.config.ts`
   (`FIZZ_BACKGROUND_AUDIO=0` leaves it out); the workflow's checkbox defaults to ticked, and `[no-bg-audio]` in a
   pushed commit message turns it off. It is an Info.plist mode, not an entitlement, so it stays
   free-provisionable (the entitlement check already allows `audio`).
2. **Cues are scheduled natively.** On every committed rest change (start, Skip, ±15/30 s, Undo, Pause, Finish,
   Discard) and on Settings › Voice changes, the cue controller hands audio-coach the rest's cues: id
   (`rest:<timerId>:<deadline>:warn|end`), words as of now, wall-clock fire time and drop time (warning 1.5 s,
   end 5 s, unchanged). `scheduleRestCues` replaces what was scheduled; `cancelRestCues` drops it. Swift fires each
   cue on a `DispatchWallTime` timer, so it survives JS suspension. An id that has fired never fires again.
3. **Who speaks:** on screen (`applicationState == .active`) JS speaks, with the newest words, as before; native
   logs `skippedActive`. Otherwise (another app, locked, Control Centre) native speaks. JS never speaks when the
   app isn't active, so a cue is never said twice.
4. **The silent hold.** Only while cues are scheduled **and** the app is in the background, audio-coach loops a
   silent buffer in category `.playback` with `.mixWithOthers` only, so Ben's music plays on, never ducked. It
   starts on `didEnterBackground` (or at schedule time if already in the background) and stops on
   `willEnterForeground`. For a cue it stops, the session is re-activated with `.duckOthers` +
   `.interruptSpokenAudioAndMixWithOthers` (mode `.voicePrompt`), the cue speaks, the session is deactivated with
   `notifyOthersOnDeactivation` (music back up), and the hold restarts if another cue is waiting. A short
   `beginBackgroundTask` covers the switch. After the last cue, or on cancel, the hold stops and the session is
   released, so nothing holds audio or drains battery between rests. Music is never stopped.
5. **Interruptions and routes:** a call or Siri ends the hold (scheduled cues stay); when the interruption ends the
   hold restarts if still wanted. An engine configuration change (AirPods in or out) rebuilds it; a media-services
   reset drops it and rebuilds it. The existing `onInterruption` / `onRouteChange` events are unchanged.
6. **Honest fallback:** the rest-done notification is scheduled exactly as before, whatever happens here. Builds
   without the native functions (older builds) or without the background mode (`scheduleRestCues` answers
   `noBackgroundMode`) send nothing further and behave as before. A cue that fires after its drop time (iOS
   suspended the app anyway) is logged `late` and not spoken.
7. **Rest cues only.** A timed set's "10 seconds" / "Time." stay in-app only: Ben is holding the plank, not in
   another app.
8. The probe-only `startKeepAlive` / `stopKeepAlive` are removed. Probe S7 ("Spoken cues in the background") now
   runs the product path: two scheduled cues 30 s and 45 s after Run, judged from the native `scheduledCueLog`.

## Alternatives

- **Keep JS alive with the hold and speak from JS timers.** Rejected as the main path: whether React Native's
  timers fire on time in the background is not something we control, and a JS hiccup would drop the cue. JS still
  hands over the words, so the words logic stays in one tested place.
- **Hold the session from the first set to Finish** (lock-screen-and-alerts §2.4's earlier design). Rejected: it
  keeps the session active while Ben is in the app (risk with the recogniser's `playAndRecord`) and between rests.
- **Remove the notification when the spoken cue is confirmed** (§2.4's "exactly one alert"). Not built: it needs a
  native-to-JS confirmation at the deadline, which is the part that fails when suspended. Ben may hear the cue and
  see the notification banner; Ben to say if that's too much.

## Consequences

- Uncertain until compiled and tried on the phone: Expo Modules decoding `[ScheduledCue]` (an array of Records)
  as an argument; re-activating the session from the background with ducking; whether a zero-amplitude buffer keeps
  the app running for a full rest on iOS 26; whether the cue ducks Spotify while the hold had been mixing.
- Battery: one silent engine for the length of a rest while in the background, nothing else.
- `docs/design/voice.md` "Still while the app is open only" and `lock-screen-and-alerts.md` §2.4 are amended to
  point here.
