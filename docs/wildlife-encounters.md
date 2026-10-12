# Occasional ocean encounters

Existing marine animals are borrowed briefly; encounters add no animals, catches, boat orders or animal pathfinding. Dolphin pods normally swim underwater and have a coordinated leap opportunity every 45–90 simulation seconds. Their existing instance batch, deformation shader, foam and bounded water effects are reused.

One encounter may run at a time. The first visit and the gap after each completed visit are 180–300 seconds of unpaused real play time, independent of 1x/2x/3x game speed. An unavailable encounter retries after 45 seconds, without accumulating missed attempts. The previous species is avoided for 600 seconds and the previous canoe for 900 seconds. A different species/boat replaces the previous choice; these are consecutive-repeat guards, not histories of every animal/boat. Suitability may make visits much less frequent.

- Dolphins borrow a nearby existing pod for up to 40 real seconds beside a moving unsailed fishing canoe. Full pod approach/step corridors check seabed and fixed rocks; nearby whales, pods and all existing boat traffic also reserve clearance. A stopped/removed canoe or unsafe step releases the pod, recentering its normal swimming loop at its current position.
- Whales borrow an available adult's existing rise animation (usually shorter than the 80-second maximum). Its full rise corridor must have offshore depth and rock clearance; a mother's calf must be nearby. Boat clearance and terrain changes can end the encounter and return the whale to swimming.
- Turtle mothers borrow a reachable sheltered bay destination for up to 90 real seconds. The existing water-only family movement retains breathing, swept shell checks, breadcrumb following and waiting for stragglers. Watch follows the mother from a wider distance to include babies where practical. Families keep their normal obstacle steering; a blocked approach may finish without reaching the bay.

A six-second, dismissible info toast offers Watch, with a matching entry in the existing alert inbox. It never changes the camera or pauses play on arrival. Watch chooses the actual animal, stops an automatic wildlife tour and preserves the normal camera restoration on exit. Ended/unavailable encounters remove their alerts; an expired Watch is harmless. Settings → Game → Wildlife encounters disables notifications without disabling animal visits. The preference and remaining cooldowns are in normal saves and shared island files. Loading resumes normal animal routines, gives at least 60 seconds of scheduling grace (at least 180 after an active visit), and retains repeat guards. Older saves use the normal defaults.

## Validation and CPU measurements

318 automated tests and the production build pass. New checks cover scheduler limits, pause/resume gaps, disabled notifications, invalid/expired alerts, clickable Watch/Dismiss without map focus, exact animal selection and exit restoration, boat state/catches remaining unchanged, occupied hull clearance, shallow/rocky approaches, calf spacing, turtle breathing/cohesion and terrain exposure, plus cooldown/preference sharing and old saves. Existing marine, fishing, boat, capture and terrain tests also pass.

Measured with Node 24 in this container, seed 20260926, 12 dolphins, three whales and 16 turtles, using 180 warmup and 2,000 measured 1/60-second simulation/instance updates. Parent baseline: `13d2d34`. These are small headless CPU samples, **not rendered frame times or FPS**; they exclude rendering, other game systems, actual Game traffic collection and UI costs. The active escort sample uses a safe synthetic moving canoe and a clear-traffic callback.

| Scenario | Median CPU ms | p95 CPU ms |
| --- | ---: | ---: |
| Parent marine + turtle normal routines | 0.102 | 0.244 |
| Updated normal routines + idle scheduler | 0.095 | 0.209 |
| Updated routines with an active dolphin escort (600 samples) | 0.097 | 0.206 |
| Updated whale/bay eligibility probe (100 samples) | 0.022 | 0.031 |

The normal-routine difference is too small to establish an FPS improvement. Occasional leaping reduces the continuous splash workload, while encounter scheduling adds bounded checks. No new A* requests, particle pools or draw batches were introduced. Physical iPhone testing, visual inspection of family framing/foam, GPU timings and full rendered-frame comparisons could not be completed: the available Chromium executable crashes with SIGSEGV even on a blank headless page. Recheck those on a working WebGL/mobile device.

Reproduce CPU checks using `node --import tsx scripts/encounter-performance.ts`. To measure the parent, temporarily extract its Marine/SeaTurtles source into same-directory `MarineBaseline.ts` / `SeaTurtlesBaseline.ts`, run with `--baseline`, then remove the temporary modules. Keep the same Node version, seed and sample counts.
