# Shoreline surf validation

The ocean shader retains its existing swell, foam, colour, caustics, disturbance and bioluminescence systems. A cached 400×400 RGBA8 shoreline texture supplies local wave direction, exposure and slope. It adds 640,000 bytes of texture storage and one conditional texture sample to sea fragments; no new draw objects or particles. The regular water update does not rebuild the texture.

Coastal exposure samples an outward fan through the existing seabed field. Narrow bays receive quieter surf; steep shores have less run-up. Crest timing, spacing and coastal patches vary gradually. The local distance gradient adds a shore-facing normal ripple. Thin foam bands widen with pixel footprint while reducing intensity, reducing distant shimmer. Run-up is capped at the rendered sea plane; dry-land foam is masked and retreating wet sand fades gradually. River and pool foam widths remain unchanged.

Terrain edits rebuild the existing full distance field, then refresh new shoreline properties only within the edited area plus their combined 28-unit influence radius and sampling padding. Tests compare this incremental result with a full rebuild.

## CPU measurements

Baseline: `29ce4de`, before this change. Same Node runtime, 200-cell synthetic curved coast, 400×400 water data, sequential before/after runs. Five warm-ups per measurement; 1,000 calm/storm water updates, 80 shore texture refreshes of the same 8×8 edit rectangle. Results are milliseconds.

| Workload | Before median | After median | Before p95 | After p95 |
|---|---:|---:|---:|---:|
| water CPU frame update, calm | 0.00025 | 0.00021 | 0.00048 | 0.00044 |
| water CPU frame update, storm | 0.00039 | 0.00035 | 0.00064 | 0.00047 |
| shore texture refresh, 8x8 edit rectangle | 5.49913 | 8.08317 | 7.81022 | 11.76752 |

Routine CPU water updates are unchanged within measurement noise. Median shoreline refresh increases by about 2.58 ms and p95 by about 3.96 ms. This cost occurs during construction of the water data or coastal terrain editing, not during ordinary frames. Continuous sculpting can still cause hitches because the existing distance transform covers the full map.

Reproduce with `node --import tsx scripts/shoreline-performance.ts`. To measure the baseline, temporarily extract its Water.ts beside the current module and pass `../src/water/WaterBaseline.ts` as the argument, then remove that temporary file.

## Verification and limits

The regression suite passes 301 tests. Targeted checks cover coast direction and rotation, sheltered channels, steep shores, dry land, map boundaries, new coastal obstacles, local/full terrain refresh equivalence, unchanged draw-object count, bounded texture size, storm scaling, distant crest filtering, and preserved ocean ripple/shadow behaviour. The production TypeScript/Vite build passes.

The shader continues to use the existing game time, day/night lighting and storm uniforms, so pausing holds the wave state and game speeds scale it with the rest of the ocean. These integration paths were inspected; they have not been visually certified on a GPU here.

The available Chromium binary exits with SIGSEGV even on about:blank. Consequently no rendered GPU frame-time comparison, mobile hardware benchmark, or rendered day/night/storm/rock-edge review could be completed in this environment. CPU figures above are not whole-game frame times or FPS. A target iPhone review remains necessary before claiming mobile rendering performance or final visual quality. Exposure is a local approximation rather than wave ray tracing; isolated coastal rocks remain handled by the existing foam field.
