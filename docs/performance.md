# Performance checks, 11 October 2026

Run `npm ci`, `npm test`, `npm run build` and `npm run perf` and `npm run perf:paths`.

The benchmark runs warmed CPU workloads on the standard island seed under Node 24.19.0. It measures script work, not browser FPS or GPU time. Results vary with hardware and concurrent load; they are observations, not CI timing thresholds.

| Workload | Previous median | Updated median |
| --- | ---: | ---: |
| Rebuild 100 active neighbours after 30,000 previously occupied grid cells | 1.070 ms | 0.006 ms |
| Long path-search burst, work in one frame | 31.236 ms for five searches | 5.996 ms for one search |

The path queue stops after reaching a 3 ms time budget or five completed requests. A single synchronous search can exceed the time budget; at least one completes so routes cannot starve. Remaining requests continue in later frames. Total pathfinding work is unchanged. Cancelled and superseded tasks no longer consume searches or receive stale routes.

The final clean-install run measured five unbudgeted searches at 29.621 ms median (31.018 ms p95), versus 5.996 ms median (6.907 ms p95) for the budgeted per-frame queue.

Other checks: crowd avoidance at 100 and 300 walkers (0.104/0.462 ms median); moving-camera vegetation at low/high detail; shadow proxies and single shadow pass; off-screen simulation, grass and tree LOD; post-processing resolution; movement, placement, boats, wildlife and game restart. The complete automated suite now passes 233 tests.

Islander instance matrices and colour/look attributes upload only their populated range, rather than full 200-person buffers. Compass and pause icons avoid unchanged DOM writes. FPS uses uncapped real frame intervals, while simulation catch-up remains capped. Hidden pages skip game updates and rendering.

## Chatter

Original procedural nonsense speech uses variable pitch, vowel formants and breath consonants. Nearby villagers can reply, with at most two active voice graphs. Audio fades between 6 and 28 world units from the actual camera, pans with its orientation, and works in overhead and eye-level views. Sleeping, hidden, unwell or fleeing villagers do not chatter. Pause, mute, storms and Wildlife view suppress chatter. Phrase nodes disconnect on completion, and the existing master/ambience volume controls apply.

Audio scheduling, distance, pan, voice variation, concurrency and cleanup are tested with a Web Audio graph mock. Actual sound balance has not been auditioned on an iPhone.

## Device verification still required

No browser GPU, live-site FPS or physical iPhone measurements were obtained. Settings layout has been checked separately in headless Chromium; that does not measure game rendering performance. Check a populated village while dragging/pinching, storm sheltering, 3x speed and a close Great Hall view; then check free roam and Wildlife tour. Compare low/high/Ultra with shadows and depth of field using the existing FPS, worst-frame and CPU readout. Listen to chatter at normal volume, zoom away, pause and mute. Existing build output still reports a large JavaScript bundle; these changes do not address download size.


## Islander routing optimisation

Baseline: `e5999ce` (before this routing change). `scripts/pathfinding-performance.ts` runs the same flat-world workloads against that checkout and the updated checkout, sequentially, under Node 24.19.0. Each workload has three warm-up runs and twelve measured runs. The movement and queue CPU times below exclude rendering, GPU work and the rest of the game update. Search counts are medians across those twelve runs; the existing elapsed-time frame budget makes pursuit counts vary with CPU timing.

| Workload | Before route calculations / A* searches | After route calculations / A* searches | Before median workload frame / p95 | After median workload frame / p95 | Median total CPU before → after |
| --- | ---: | ---: | ---: | ---: | ---: |
| 20 moving-animal pursuits, 10 game seconds, 100 simulation frames | 371 / 371 | 184 / 184 | 3.694 / 4.103 ms | 1.580 / 3.891 ms | 369.871 → 167.349 ms |
| 100 repeated requests for one unchanged walking destination | 100 / 100 | 1 / 1 | 0.446 / 0.622 ms | 0.001 / 0.001 ms | 47.498 → 0.539 ms |
| 100 short open village trips | 100 / 100 | 100 / 0 | 0.025 / 0.092 ms | 0.003 / 0.005 ms | 2.888 → 0.352 ms |

The pursuit uses targets moving backwards and forwards while walkers advance, rather than replaying identical route requests. The search-count range was 353–380 before and 181–185 after. That is approximately 50% fewer searches and 55% less total CPU work in this synthetic pursuit. It is not a claim that typical village FPS doubles. The repeated-request case deliberately exercises redundant calls and is an upper bound on that optimisation, not a description of all existing tasks.

### Behaviour and safeguards

- Per-islander active route metadata retains walking progress. Repeated pending requests keep their queue position. Moving follow targets update their pending destination without starting the wait again. New tasks, exact destination changes and movement-permission changes cannot inherit old routes. There is no shared route cache.
- Pursuits and following re-aim when the target moves materially; a valid route can be retained for up to 0.75 game seconds between searches. A changed obstacle or a stuck walker bypasses that delay.
- Construction, relocation, demolition, rock clearance, bridges and terrain edits invalidate navigation metadata. Unaffected routes are retained after validation; blocked routes are queued again. Next-segment checks are staggered at 0.5–0.71 game-second intervals as a fallback. World-space segment checks preserve land/water permissions, climb limits, rock clearance and blocked-corner rules.
- Automatic requests have a stable 0–0.35 game-second departure offset. Player orders have no added departure delay and take priority over routine work; danger/shelter and urgent care requests take precedence. The original three-millisecond/five-calculation frame budget still applies. Reservations, population limits, task priorities and routines are unchanged.
- Nearby resource and store selection already existed and is retained, including player-selected resources, marked resources and fallen-log priorities. Tests cover its fallback to nearby available resources; the change does not silently redirect explicit orders.
- Short trips use a validated direct segment only across a small, flat, open area. Forest, roads, worn ground, rivers, bridges, crowd-avoidance costs and water escorts retain A*. Smoothed A* routes now share the segment obstacle/corner checks.
- Demolition previously compared occupancy against `building.id`, although placement writes `building.id + 1`. Clearance now removes the correct cells once rubble has sunk, while leaving cells claimed by another building alone.

The new navigation tests cover pending/active reuse, changed orders and permissions, construction and slope edits during travel, blocked corners, bridge removal and swimming escorts, rock changes, moving targets, stuck/crowd replans, maximum-size request queues, a 60-person group completing distinct orders, resource reservation/mining/delivery, storm sheltering and actual demolition clearance. Existing tests also cover family and hall routines, livestock bridge preferences, food collection and dense crowds. All 233 tests and the production build pass.

### Remaining costs

A single A* calculation remains synchronous and may exceed the three-millisecond budget. The unchanged long-search stress test measured 5.863 ms median / 6.274 ms p95 per budgeted frame, compared with 5.692 / 6.554 ms in the initial baseline run; five unbudgeted long searches measured 29.623 ms median. These difficult searches were not made faster. Full remaining-route validation after a world edit also costs CPU: an additional maximum-population stress check of 200 long, 100-unit routes measured 4.687 ms median / 7.161 ms p95. That validation is separate from the A* queue budget. Complex edits and urgent group orders can therefore still cause spikes.

Physical iPhone and GPU frame-rate measurements remain necessary to establish the real visual improvement. On-device checks should include construction while people travel, a large shelter call, repeated animal round-ups, bridges and 3x speed.
