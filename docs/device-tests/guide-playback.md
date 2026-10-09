# Device test: exercise guide playback (ADR 0013)

**About 8 minutes on the iPhone.** It's the first build with Skia and Reanimated in it. Nothing here has run on a phone yet. Every row is "not yet tested" until you mark it. Report the same way as the [morning checklist](morning-checklist.md): put **P**, **F** (with one line) or **–** in each row and paste the table back.

Before you start: install over the top as usual. If the app fails to launch right after installing, mark G1 **F** and stop. That points at a native module and the fallback in ADR 0013 applies.

## Where the guides are
Ten exercises have guides (all labelled **Draft guide**): back squat, bench press, overhead press, Romanian deadlift, lat pulldown, triceps pushdown, Bulgarian split squat, one-arm dumbbell row, leg press and sled push. During a workout, open them from the exercise **⋯ › How to**, or with the **ⓘ** button on a row in **Add exercise**.

## Steps
G1. Start an empty workout and add **Back squat** (use the picker's **ⓘ** first: How to opens, and tapping the row still adds the exercise in one tap). In the workout, **⋯ › How to** is the first item.
G2. **Smoothness.** The figure moves smoothly at a steady pace. No stutter, and no pause longer than half a second before it starts (the first frame shows straight away). Close How to and open it again: it starts at once.
G3. **Autoplay stops.** After 3 reps it stops on the start position and the button says **Replay**. **Pause**/**Play** works before that.
G4. **Battery during rest.** Log a set so the rest timer runs, then open How to. Lock the phone for 30 s, unlock: the animation is paused or stopped. It doesn't run in the background. The rest alert still arrives on time. Scroll the How to screen so the figure is out of view: it pauses, and resumes when you scroll back.
G5. **Legibility at 240 pt.** On the How to screen, can you see the bar, the hands on the bar, the knees and the feet on the floor at arm's length, in gym-like light? Note any guide that's hard to read.
G6. **Light and dark.** Switch the iPhone appearance: the figure uses greys and the background colour in both, with no coloured highlight, and stays readable.
G7. **Reduce Motion.** Settings › Accessibility › Motion › Reduce Motion **on**, then open How to: no animation. It shows **1 of 3 · Start** with its caption, and **Previous / Next** steps through the key positions. **Play animation** plays it only when tapped. With How to animating, turning Reduce Motion on stops the animation.
G8. **VoiceOver.** With VoiceOver on, the figure is read once as an image ("Animated guide for Back squat. Side view…"). It isn't repeated while it animates. Swipe on through **Key positions**, **Setup**, **How to do it** and **Common mistakes**.
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
| G7 Reduce Motion key frames | | |
| G8 VoiceOver reads once | | |
| G9 no ⓘ / How to without a guide | | |
| G10 offline | | |

Also note: the build number, and anything in **Profile › App status** that changed.
