# Device test: exercise guide playback (ADR 0013)

**About 8 minutes on the iPhone.** It's the first build with Skia and Reanimated in it. Nothing here has run on a phone yet. Every row is "not yet tested" until you mark it. Report the same way as the [morning checklist](morning-checklist.md): put **P**, **F** (with one line) or **–** in each row and paste the table back.

**Re-run in full on the first build after 83.** On build 83 How to closed the app on the first frame, so only G1 ran; see [howto-crash-fix.md](howto-crash-fix.md) first. How to is now also a link next to the exercise name on the active set.

Before you start: install over the top as usual. If the app fails to launch right after installing, mark G1 **F** and stop. That points at a native module and the fallback in ADR 0013 applies.

If How to opens with the line **"The animated guide couldn't be shown. The cues below still apply."** and no figure, the app caught a drawing failure on purpose (the workout is unaffected). Mark G2 **F**, copy that line into the note, and carry on with the cue rows.

## Where the guides are
Ten guides exist, but **nine can be opened in the app** (all labelled **Draft guide**): back squat, bench press, overhead press, Romanian deadlift, lat pulldown, triceps pushdown, Bulgarian split squat, one-arm dumbbell row and leg press. During a workout, open them from the exercise **⋯ › How to**, or with the **ⓘ** button on a row in **Add exercise**.

**Sled push** isn't in the picker yet: it's logged by distance, which sets can't record yet. Review it, with all ten, on the guide review web page instead. It's not a fault if you can't find it on the phone.

## Steps
G1. Start an empty workout and add **Back squat** (use the picker's **ⓘ** first: How to opens, and tapping the row still adds the exercise in one tap). In the workout, **⋯ › How to** is the first item.
G2. **Smoothness.** The figure moves smoothly at a steady pace. No stutter, and no pause longer than half a second before it starts (the first frame shows straight away). Close How to and open it again: it starts at once.
G3. **Autoplay stops.** After 3 reps it stops on the start position and the button says **Replay**. **Pause**/**Play** works before that.
G4. **Battery during rest.** Log a set so the rest timer runs, then open How to. Lock the phone for 30 s, unlock: the animation is paused or stopped. It doesn't run in the background. The rest alert still arrives on time. Scroll the How to screen so the figure is out of view: it pauses, and resumes when you scroll back.
G5. **Legibility at 240 pt.** On the How to screen, can you see the bar, the hands on the bar, the knees and the feet on the floor at arm's length, in gym-like light? Note any of the nine that's hard to read.
G6. **Light and dark.** Switch the iPhone appearance: the figure uses greys and the background colour in both, with no coloured highlight, and stays readable.
G7. **Reduce Motion.** Settings › Accessibility › Motion › Reduce Motion **on**, then open How to: no animation, and the figure appears straight away (not an empty box). It shows **1 of 3 · Start** with its caption, and **Previous / Next** steps through the key positions. **Play animation** plays it only when tapped. With How to animating, turning Reduce Motion on stops the animation. With it off, the button under the figure says **Key positions**.
G8. **VoiceOver.** With VoiceOver on, the figure is read once as an image ("Exercise guide for Back squat. Side view…"). It isn't repeated while it animates. In the key positions view, double-tap **Next**: VoiceOver reads the new position ("Key position 2 of 3, …"). Swipe on through **Key positions**, **Setup**, **How to do it**, **Common mistakes** and **Safety** (ending with "Stop the set if:" and its lines).
G9. **No guide.** In **Add exercise**, rows without a guide have no ⓘ, and their **⋯** menu has no How to.
G10. **Offline.** In Airplane mode, How to and the animation still work.

## Results (paste back)

| Step | Result | Note |
|---|---|---|
| G1 open from picker and ⋯ | | |
| G2 smooth, starts at once | | |
| G3 stops after 3, Replay | | |
| G4 pauses locked / scrolled away; rest alert on time | | |
| G5 readable at 240 pt (which guides aren't?) | | |
| G6 light and dark, no accent | | |
| G7 Reduce Motion key positions | | |
| G8 VoiceOver reads once; Next is announced | | |
| G9 no ⓘ / How to without a guide | | |
| G10 offline | | |

Also note: the build number, and anything in **Profile › App status** that changed.
