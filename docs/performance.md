# Performance checks, 11 October 2026

Run `npm ci`, `npm test`, `npm run build` and `npm run perf`.

The benchmark runs warmed CPU workloads on the standard island seed under Node 24.19.0. It measures script work, not browser FPS or GPU time. Results vary with hardware and concurrent load; they are observations, not CI timing thresholds.

| Workload | Previous median | Updated median |
| --- | ---: | ---: |
| Rebuild 100 active neighbours after 30,000 previously occupied grid cells | 1.070 ms | 0.006 ms |
| Long path-search burst, work in one frame | 31.236 ms for five searches | 5.996 ms for one search |

The path queue stops after reaching a 3 ms time budget or five completed requests. A single synchronous search can exceed the time budget; at least one completes so routes cannot starve. Remaining requests continue in later frames. Total pathfinding work is unchanged. Cancelled and superseded tasks no longer consume searches or receive stale routes.

The final clean-install run measured five unbudgeted searches at 29.621 ms median (31.018 ms p95), versus 5.996 ms median (6.907 ms p95) for the budgeted per-frame queue.

Other checks: crowd avoidance at 100 and 300 walkers (0.104/0.462 ms median); moving-camera vegetation at low/high detail; shadow proxies and single shadow pass; off-screen simulation, grass and tree LOD; post-processing resolution; movement, placement, boats, wildlife and game restart. The complete automated suite passes 209 tests.

Islander instance matrices and colour/look attributes upload only their populated range, rather than full 200-person buffers. Compass and pause icons avoid unchanged DOM writes. FPS uses uncapped real frame intervals, while simulation catch-up remains capped. Hidden pages skip game updates and rendering.

## Chatter

Original procedural nonsense speech uses variable pitch, vowel formants and breath consonants. Nearby villagers can reply, with at most two active voice graphs. Audio fades between 6 and 28 world units from the actual camera, pans with its orientation, and works in overhead and eye-level views. Sleeping, hidden, unwell or fleeing villagers do not chatter. Pause, mute, storms and Wildlife view suppress chatter. Phrase nodes disconnect on completion, and the existing master/ambience volume controls apply.

Audio scheduling, distance, pan, voice variation, concurrency and cleanup are tested with a Web Audio graph mock. Actual sound balance has not been auditioned on an iPhone.

## Device verification still required

Chromium could not be downloaded in this environment, so no browser GPU, live-site FPS or physical iPhone measurements were obtained. Check a populated village while dragging/pinching, storm sheltering, 3x speed and a close Great Hall view; then check free roam and Wildlife tour. Compare low/high/Ultra with shadows and depth of field using the existing FPS, worst-frame and CPU readout. Listen to chatter at normal volume, zoom away, pause and mute. Existing build output still reports a large JavaScript bundle; these changes do not address download size.
