# litematica-viewer

Web app: drop a `.litematic` file → toon-shaded, ink-outlined 3D illustration. Rendering is 100% client-side;
a small Express server (`server/`) serves `dist/` and the share API backed by MySQL.

## Commands
- `npm run dev` — dev server on :5173 (proxies `/api` to :5231)
- `npm run api` — share server on :5231 (`server/index.js`; reads `.env`, see `.env.example`)
- `npm start` — production: serves `dist/` + API on `$PORT`
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

## Conventions
- three.js is pinned to 0.147.0 (legacy colour management; colours are authored as displayed). Upgrading needs
  `renderer.outputColorSpace` / `THREE.ColorManagement` review or colours will shift.
- Add support for a new block shape: add a kind in `classify()` and a `case` in `convert()`;
  use `box()` / `rbox()` (facing-relative) helpers for cuboids.
- Files leave the browser only through «Поделиться» (explicit click). Keep it that way.

## Sharing (server/)
- `POST /api/shares?name=` (raw .litematic) → `{id, updated}`; id is random (16 hex). Same uploader (sha256 of the
  IP, never the raw IP) + same name + same size → that row is overwritten and keeps its id. `PATCH /api/shares/:id`
  `{name}` renames (uploader only). `GET /api/shares/:id` → bytes (+ `X-Name`), `no-cache` + ETag. `GET /api/config` → `{share, maxBytes}`; the page shows the button only
  when `share` is true. `GET /?s=:id` injects the model name into og/twitter titles.
- DB env like our other Render apps: `DATABASE_URL` or `DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME`, `DB_SSL`, `DB_POOL`.
  No env or no connection → sharing off, server keeps running.
- Tables are prefixed `litemat_app_` (shared database). Schema changes = new entry in `server/migrations.js`
  (never edit an applied one); applied ids are stored in `litemat_app_migrations`.
- Frontend: «Поделиться» sits at the bottom of the project panel and opens a dialog (XHR upload progress → «saving»
  → link). The pencil next to the project name renames it locally and, if shared, on the server too. The address bar
  mirrors the model on screen (`?s=<id>` or nothing, `setShareUrl`); shared ids live on the history entry (`shareId`).
