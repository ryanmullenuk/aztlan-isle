# Shallow-water habitats

The existing Coral module now generates small reef groups and irregular seagrass drifts using independent tile seeds. Candidate transforms survive local hide/resize/restore operations, keeping remote patches stable and matching regeneration from the same edited terrain. New groups also grow beside a subset of existing submerged rocks. Grass has tapered segmented blades, sparse edges and varied heights; coral colours are less saturated. No additional scenery system, population limit or fish pathfinding queue was introduced.

The existing spatial instance batches retain candidates separately from the compact visible instance list. Local sculpting/canal edits refresh touched chunks; invalid steep, dry, deep or blocked sites disappear, and valid sites can return. The same refresh and visibility material cover existing tube coral. Existing tube-coral placement remains its original deterministic seed-and-terrain generator.

Shared GPU animation gives plants gentle currents with anchored roots and honours Island Movement. Depth tint and alpha fade soften distant/deep details; low/medium/high/ultra ranges are 24/36/48/60 world units. Rivers, ocean waves, colours and deep-water shadow fading are unchanged. Thin seagrass is double-sided in one pass; closed coral uses normal front-face culling.

Decorative reef schools linger and circle habitat points, sometimes changing to nearby cover. School and visible-fish movements check submerged ground and rock cells without route searches. Off-screen fish ride at the cleared school centre. Seabed editing relocates stranded decorative fish to valid water or keeps them hidden if none is available. Fish population and heron catch timers are not reset by habitat refresh. The deep ocean schools used by village fishing retain their original resource logic.

## CPU comparison

Baseline: `1b1c51d`, before these changes. Same synthetic shallow 200-cell world, seed 71, 36 fixed reef points and 255 fish. Each camera-distance scenario runs 30 warm-up and 300 measured simulation/instance-update frames. The low-distance camera is 28 units above water; close-detail is 8 units. These names describe camera scenarios, not measured mobile hardware or a rendered quality preset. Milliseconds:

| Scenario | Before median | After median | Before p95 | After p95 |
|---|---:|---:|---:|---:|
| mobile-low-distance | 0.081 | 0.092 | 0.148 | 0.325 |
| close-detail | 0.040 | 0.046 | 0.063 | 0.162 |

Local 8×8 Coral refresh: median 0.039 ms, p95 0.233 ms. This figure excludes terrain smoothing, fish rescue and tube-coral refresh. Initial habitat construction measured 35.6 ms before and 41.3 ms after (single samples, not a statistical frame measurement). Habitat mesh batches in this all-water fixture: 367 before, 264 after. No full-game FPS inference follows from these CPU results.

Reproduce using `node --import tsx scripts/habitat-performance.ts`. For the baseline comparison, temporarily extract baseline Coral.ts and ReefFish.ts beside the current modules as CoralBaseline.ts and ReefFishBaseline.ts, then run with `--baseline`. Remove those files afterwards.

## Checks and limitations

307 regression tests and the TypeScript/Vite build pass. Targeted checks cover deterministic matrices, edited-world restoration of new habitats, local hide/recovery, submerged height limits, steep/deep/dry/rock rejection, shader current weights, depth/distance fading and preset ranges, reef-fish swept rock checks, stranded-fish rescue, stable fish count/catch timers, and legacy tube-coral terrain refresh. Existing shark, tube coral, shoreline, shadow and save regressions pass.

The available Chromium exits with SIGSEGV even on about:blank, so no rendered frame-time comparison, GPU benchmark, screenshot review, or iPhone visual certification was possible. Day/night lighting is provided by the existing standard material and ocean; preset integration and motion controls were checked in code, not on a rendered device. The scene needs target-device review for transparency sorting, fine grass readability and actual GPU cost. Decorative fish rescue searches locally to 12 units, then other existing reef centres; fish are hidden if the edited world has no suitable refuge. Habitat suitability uses seabed slope and occupied rock cells rather than a separate sediment simulation.
