# Test build, 10 Oct 2026 (early hours)

A "try it" build from the main branch at this point. Newer than build 66.

## What's new since build 66
- **Exercise guides v2:** contoured figures, violet muscle highlight (strong for main muscles, soft for supporting), faint definition of every muscle group, "Feel it most / Also works" legend and a **What not to do** card on the How to screen.
- **Smoother motion engine:** curves through key positions without stopping, one movement per phase, no elbow pops or joint seams. Only some guides are re-timed so far (squat, sled push); the rest still use their old key timing.
- **FitNotes import:** Data & backup › Import from FitNotes. Preview, questions, Undo import.
- Lat pulldown is drawn from behind (provisional).

## Known issues in this build (being fixed)
- **Guides may take a few seconds to start, and use more battery than they should.** The detailed figure is about 7× more work to prepare per frame, and the player redraws more often than needed (review guides-v2 S1, S2).
- **Lat pulldown key positions show the dashed bar path over the back of the head.** Drawing bug, not the intended form (review guides-v2 B1).
- **FitNotes import: try it with a copy or a small file only, and use Undo import afterwards.** Later fixes (one-dumbbell exercises matched by name, remembering answers, Undo forgetting what an import taught) are not in this build yet. Don't import your real history until those land.
- Guides other than squat and sled push still show the old timing (slows at "Halfway").

## Worth checking
- Rest alert with the phone locked, and the lock-screen Live Activity (retest from build 7).
- How to screen: smoothness, how long a guide takes to appear, readability at normal size, Reduce Motion, light/dark.
- Anything that feels slow or wrong: tell Claude what you tapped.
