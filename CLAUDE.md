# litematica-viewer

Static web app: drop a `.litematic` file → toon-shaded, ink-outlined 3D illustration. 100% client-side, no backend.

## Commands
- `npm run dev` — dev server on :5173
- `npm run build` — production build to `dist/` (relative paths, `base: './'`)
- `npm run preview` — serve `dist/` on :4173
- `python3 tools/build_colors.py <mc-version>` — regenerate `src/colors.json`

## Pipeline (src/)
1. `litematic.js` — gzip → NBT parser → unpack Litematica bit-packed `BlockStates` (index = y*sx*sz + z*sx + x,
   values span across longs). Merges multiple regions (handles negative `Size`), crops empty space.
2. `convert.js` — shared model state `M`, block classification (`classify()` → kind), per-kind geometry rules
   (stairs → sloped wedges incl. inner/outer corners, slabs, panes, fences, walls, trapdoors, doors, leaves → blobs, …),
   colour lookup (`colors.json` + name fallbacks), automatic ground cut (`computeCut`; computed but not applied — the UI always shows the full schematic, `M.CUT=0`).
3. `greedy.js` — greedy meshing of full cubes (merges coplanar same-colour faces).
4. `main.js` — three.js scene: MeshToonMaterial (3-step gradient), shadows, narrow 18° perspective camera
   (lens-shifted via `setViewOffset` to centre the model in the area free of header/panel), OrbitControls,
   post-process outline pass (depth + normal edges, line weight scales with on-screen block size), UI + progress.
5. `history.js` — recently opened files in IndexedDB (file bytes + JPEG thumbnail, last 20, id = SHA-256 prefix);
   header model name is the switcher. `localStorage.lastOpened` picks the model shown on start (else the demo).
6. `progress.js` — `step(frac,label)` yields to the browser every ~45 ms so the progress bar repaints.

## Rendering performance (main.js)
- Geometry is split into 32×32 column chunks (`addChunked` / `addInstChunked`) so the colour, normal and shadow
  passes cull off-screen parts. three r147 sets `frustumCulled=false` on every `InstancedMesh` — chunks set it back
  to true with their own bounding sphere; keep that if you add instanced geometry.
- Render on demand: `invalidate()` (controls change, resize, `sync()`); an idle view draws nothing.
- Shadow map: `renderer.shadowMap.autoUpdate=false`; `fitShadow()` fits the shadow frustum to what's on screen and
  sets `needsUpdate` only when that frustum changes.
- Render size capped at ~5 MP (`resize()`), since every frame is 3 full-screen passes.
- Controls: mouse/trackpad left drag = pan, right drag = rotate; touch: one finger = rotate, two = pinch/pan.
  Zoom = camera distance (wheel zoom is ours, anchored at the cursor). Pivot is set at each gesture start on the
  camera axis: nearest point to the model centre while the whole model is in view, else `surfaceAtCenter()`.
- Outline pass: near/far hug the model every frame; edges use the second difference of 1/z (zero on any plane),
  sampled at texel centres with whole-texel offsets. `rtColor` has a depth texture only to get a 24-bit depth buffer.
- Dev only: `window.viewer` = {controls, camera, M, renderer, sun, scene, styled, invalidate, surfaceAtCenter, draw}.

## Social preview
- `public/og.png` (1200×630) is a render of the demo + title, composed in the browser via `window.viewer.draw()`.
- OG/Twitter tags in `index.html` use `__SITE_URL__`, replaced at build by the `site-url` plugin in `vite.config.js`
  from `SITE_URL` or Render's `RENDER_EXTERNAL_URL`.

## Showcases
- `src/showcases.js` lists fixed showcase pages: `/<key>/` opens `public/<file>` (e.g. `/beehive/` → `beehive.litematic`).
  `vite.config.js` emits `<key>/index.html` (with `<base href="../">` and its own og:title/url) for each entry plus
  `/demo/`. Showcases look like the demo, appear under Demo in the recent list, aren't saved to history and don't
  change `lastOpened`. Add one = drop the file into `public/` + one line in `showcases.js`.

## Memory (big maps)
- Loader: palette first → `Uint8Array` grid when ≤256 block states, else `Uint16Array`; packed BlockStates are read
  in place from the decompressed buffer (NBT long arrays aren't copied); no crop copy when there's nothing to crop.
- Geometry is built into typed buffers (`src/buf.js`): greedy faces = Int16 positions, Int8 normals, Uint8 colours;
  converter triangles = Float32 positions + Uint8 colours; boxes/blobs = flat Float32 data, not per-item objects.
- `freeAfterUpload()`: CPU copies of vertex/instance data are dropped once on the GPU (never read back; rebuilds
  make new geometry). Don't add code that reads `attribute.array` after the first render.
- Grids over 40M cells are released after building; a 1-bit occupancy map (`solidAt`) serves the orbit pivot, and
  `ensureGrid()` re-reads the file (`CUR_BUF`) for the «как в игре» view.
- Beehive (904×200×1006): live JS memory after load ~50 MB (was ~1.9 GB).

## Conventions
- three.js is pinned to 0.147.0 (legacy colour management; colours are authored as displayed). Upgrading needs
  `renderer.outputColorSpace` / `THREE.ColorManagement` review or colours will shift.
- Add support for a new block shape: add a kind in `classify()` and a `case` in `convert()`;
  use `box()` / `rbox()` (facing-relative) helpers for cuboids.
- Keep everything client-side: files must never be uploaded anywhere.
