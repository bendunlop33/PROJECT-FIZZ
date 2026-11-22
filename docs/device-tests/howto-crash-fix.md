# Device test: How to no longer closes the app (first build after 83)

**About 6 minutes on the iPhone.** Build 83 closed the app as soon as How to started the animation. The cause is fixed and covered by tests on Linux (review [howto-crash.md](../reviews/howto-crash.md), ADR 0018), but nothing here has run on a phone yet. Put **P**, **F** (with one line) or **–** in each row and paste the table back.

If the app closes at any step: reopen it, go to **Profile › App status › Last error**, tap **Copy or share** and paste it into the note. "Closed during How to" means no error reached the app (a native or animation-thread crash). Then turn **Profile › Developer › Exercise guide animations** off and carry on from H6.

## Steps
H1. **Start clean.** Profile › App status › Last error: if something is there, tap **Clear**. It now says **No error recorded**.
H2. **Header link.** Start a workout with **Back squat**. On the active set, **How to** sits next to the exercise name. Tap it: the figure animates, stops after 3 reps on the start position, and the button says **Replay**. Tap Replay: it plays again. The app stays open throughout.
H3. **⋯ menu.** Close How to. **⋯ › How to** opens the same screen and it plays the same way.
H4. **Rest screen.** Log a set so the rest timer runs, and open How to from the rest screen. It plays; close it. The rest alert still arrives on time.
H5. **Background.** Open How to, press the Home button (or swipe up), wait 10 s, go back to the app. How to is still there and the app didn't restart.
H6. **Safe mode.** Profile › Developer › **Exercise guide animations** off. Open How to: still key positions with Previous/Next, no animation, and a line saying animations are off. Turn it back on: the next How to animates.
H7. **Nothing recorded.** Profile › App status › Last error still says **No error recorded**.
H8. **Large text.** Settings › Accessibility › Display & Text Size › Larger Text, drag to the largest size. On the active set, the exercise name, **How to** and **⋯** are all readable and tappable (note it if the name is squeezed to a few letters). Set the text size back.

Then re-run [guide-playback.md](guide-playback.md) G1–G10 in full: only G1 ran on build 83.

## Results (paste back)

| Step | Result | Note |
|---|---|---|
| H1 Last error clear | | |
| H2 header How to plays 3 reps, Replay | | |
| H3 ⋯ › How to | | |
| H4 from rest; rest alert on time | | |
| H5 background and back | | |
| H6 animations off: stills and notice | | |
| H7 still no error recorded | | |
| H8 largest text: header row readable | | |
