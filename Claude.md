# CLAUDE.md — Audio Asset Browser

Guidance for agents working in this repository. The app is **built and working**; this file
describes what exists, the traps that are not obvious from the code, and what is genuinely
unfinished. Read it before making architectural changes.

---

# What this is

A local-first Electron desktop app for browsing, searching, previewing and organising large
collections of game audio assets. A user points it at folders of sound effects, it indexes
them recursively into SQLite, and then searching, auditioning and copying assets into a
project is fast.

Every design decision answers one question:

    "How quickly can a game developer find the right sound and get it into their project?"

It is an asset **discovery and curation** tool, not a DAW and not an audio editor.

The user's audio never leaves their machine. No server, no account, no uploads.

---

# Current status

**Version 1.0.0. Development paused on 2026-09-30 for user testing.** Before starting new
work, ask the user what testing turned up; feedback should drive the next priorities, not
the backlog below.

The GitHub Release for 1.0.0 has **not been published yet**: `gh` was not logged in on the
user's machine. Once it is, `npm run release:upload` uploads the already-built
`dist/*1.0.0*.exe` files as a draft (they match commit `02b9b59`; later commits changed
only docs and the release script).

All seven originally planned phases are implemented, plus the post-MVP features below.
~9,700 lines across `src/` and `tests/`. **286 tests pass; lint, both typecheck projects
and the production build are clean.**

The MVP definition is fully met — a user can launch the app, add a folder, index it
recursively, reopen without rebuilding the index, search by filename/path, filter by
metadata, select a result, preview it, reveal it in Explorer, and copy it into a project
folder.

## Verified working

- **Indexing** — recursive scan, metadata extraction, progress reporting, incremental
  rescans, pruning of deleted files, cancellation.
- **Search** — SQLite FTS5 over filename, relative path and folder names. Prefix matching,
  case-insensitive, extra terms narrow. A leading `-` excludes (`impact -metal`), done as
  `f.id NOT IN (SELECT rowid FROM audio_files_fts WHERE … MATCH ?)` because FTS5's binary
  `NOT` cannot express an exclusion-only query. bm25 relevance ranking. Facet counts.
- **Filters** — duration buckets and custom range, file type, channels, sample rate,
  library, favorites.
- **Preview** — one shared `<audio>` element, streamed over a custom `audio-asset://`
  protocol. Play/pause/stop/seek/volume, keyboard auditioning. **Auto** (arrow keys play
  each row reached; Shift-extend and mouse clicks never auto-play, because double-click and
  the row play button already toggle and would stop what a click started) and **Loop**.
  Both persist in `localStorage`; volume deliberately does not and always starts at 100%.
- **Waveforms** — drawn in the player bar (not in result rows), doubling as the progress
  bar; click to seek. Generated on first play, never at startup, by decoding in the
  renderer with Web Audio, and cached in `audio_files.waveform` (format: `WAVEFORM_BUCKETS`
  in shared constants). An upsert clears the cache, so a changed file regenerates. Bytes
  reach the renderer through `file:readAudioData` (id-keyed, capped at
  `MAX_WAVEFORM_SOURCE_BYTES`) — the CSP still blocks `fetch` of `audio-asset:`,
  deliberately.
- **Audio protocol** — serves files itself with `Content-Length` and byte ranges (206).
  Before this, `net.fetch(file://)` gave MP3/OGG/M4A infinite duration and broken seeking.
- **Mac junk files** — `__MACOSX` folders and AppleDouble `._*` files are never indexed.
  Scanner and watcher share one rule (`isIgnoredPath` in shared constants).
- **Window state** — size, position and maximized state saved to
  `userData/window-state.json` on close; restored only if it overlaps a connected monitor,
  otherwise the default centered window. Logic in `src/main/windowState.ts` is pure and
  unit-tested.
- **Asset workflow** — reveal in folder, copy path, copy file, single and multi-file copy
  into a chosen destination with duplicate handling.
- **Multi-select** — click, `Shift`+click range, `Ctrl`+click toggle, `Ctrl+A`,
  `Shift`+arrows. A plain press inside a multi-selection defers its collapse to the click
  (`defersToClick`), so the press can start a drag of the whole selection.
- **Drag out** — rows drag into Explorer / engines / DAWs as real files. The renderer sends
  ids; `file:startDrag` resolves paths from the index, drops files missing on disk, and
  calls `webContents.startDrag`. **Verified with a real OS drag: dropping into a folder on
  the same volume copies, never moves** (Electron offers copy/link only). Re-verify that if
  Electron is upgraded — it is the property that protects the user's library.
- **Destinations** — a self-pruning most-recently-used list of 10 folders.
- **Library management** — multiple libraries, rescan, removal (index only), chokidar
  watching, unavailable-drive handling.
- **Favorites** — persist across launches.

## Known gaps — read this before picking work

1. **Tags are half-built.** Schema, IPC handlers and preload surface all exist
   (`listTags`, `addTag`, `removeTag`) but **nothing in the renderer calls them**. This is
   dead surface. Either build the UI or remove the IPC — do not leave it dangling.
2. **The file watcher has almost no test coverage.** Only its ignore rule is tested (via
   `isIgnoredPath`); `src/main/filesystem/watcher.ts` itself was never verified end to end.
   It is the most failure-prone kind of code in the repo (stateful, debounced, racy,
   platform-dependent). Trust it least.
3. **No scale validation.** The architecture is justified by "assume 100k files" but has
   only ever run against a handful. Cold scan time, rescan time, query latency, facet cost
   (two extra `GROUP BY`s per fresh query — likely the first thing to hurt) and scroll
   smoothness are all unmeasured. Generating a synthetic 50–100k library is cheap and its
   results could redirect other work.
4. **Formats only partly verified in a real window.** Waveforms, duration and seeking were
   checked with WAV and MP3. OGG, FLAC and M4A go through the same code paths but were
   never played in the app; no test files of those formats were available.
5. **Small unverified details.** The keyboard focus ring on the hand-drawn volume knob
   (`.volume input:focus-visible::-webkit-slider-thumb`) is in the CSS but was never seen
   on screen; the check hung.
6. **Semantic/AI search is not started, by design.** Migration 2 reserves nullable
   `ai_description`, `ai_tags` and `embedding` columns so it can be added without a
   rewrite. The core app must keep working fully offline with no AI service.

## Backlog — discussed with the user, deferred until after user testing

Not commitments; re-rank them against what testing shows.

- **Music / SFX category.** A `category` column on `libraries` (new migration), chosen when
  adding a library, plus a Music | SFX | All toggle that filters by category across all
  libraries of that type. Agreed approach: user sets it per library; do not guess from
  folder names or duration.
- **Click a folder name to filter to that folder**, to see a sound's variation set
  (`impact_01` … `impact_08`) together.
- **Pitch / speed preview** — playbackRate with `preservesPitch = false`; preview only,
  never modifying files.
- **Tags UI**, or removing the dead tag IPC (see known gap 1).
- **Store data next to the portable `.exe`** — only together with library paths relative
  to the `.exe`; see Distribution. Not wanted unless app and sounds ship on one stick.
- Considered and rejected for now: AI/semantic search, audio editing or trimming,
  auto-update (needs code signing).

---

# Commands

```bash
npm install      # also caches the native SQLite binary for BOTH Electron and Node ABIs
npm run dev      # app with hot reload
npm test         # vitest (swaps to the Node ABI first)
npm run typecheck
npm run lint
npm run build    # typecheck + production build into out/
npm run package           # Windows installer (nsis) + portable .exe into dist/
npm run package:portable  # portable .exe only
```

## Distribution

Users get the app from **GitHub Releases** (`neumont-gamedev/audio-search`), not from the
source. Each release attaches two files from `dist/`: `Audio Asset Browser Setup
<version>.exe` and `Audio Asset Browser <version> Portable.exe`. `dist/` is git-ignored —
never commit built binaries. The release tag is `v<version>` and must match `"version"` in
`package.json`; bump it before building. `npm run release` (`scripts/release.mjs`) builds
and creates a **draft** GitHub Release via `gh`, after checking login, a clean and pushed
tree, no existing release for the version, and both builds present. Details in
`README.md` ("Releasing a new version").

- Builds are **unsigned**; users see a SmartScreen warning. Say so in release notes.
- The app icon is `build/icon.ico` (16–256 px, multi-size) plus `build/icon.png` (512 px),
  both generated from `audio-search-icon.png` with transparent margins trimmed.
  electron-builder picks them up from `build/` by convention — no config entry. The window
  icon is set explicitly in `main.ts` via an electron-vite `?asset` import of
  `build/icon.png` (typed by `src/main/env.d.ts`), so `npm run dev` shows it too rather
  than Electron's.
- The portable build unpacks to `%LOCALAPPDATA%\Temp\<random>\` on each launch and deletes
  it on a clean exit. A force-killed portable app leaves ~270 MB behind there.
- Both builds store data in `%APPDATA%\audio-asset-browser` (Electron `userData`), not
  beside the `.exe`. This is deliberate: the index stores absolute library paths, so
  carrying it between PCs would not help, and SQLite on a USB stick is slow and fragile.
  Do not switch to exe-relative storage without also making library paths relative.

---

# Traps that will cost you an hour

## The native module has two ABIs

`better-sqlite3` is a native binding and must match the ABI of whatever loads it: **Electron
for the app, plain Node for vitest.** They are not interchangeable. `npm install` caches a
build of each under `native/`, and `scripts/select-native.mjs` swaps the active one in.
`npm run dev`/`build` swap to electron; `npm test` swaps to node. This is why those npm
scripts have `use:electron`/`use:node` prefixes — do not remove them.

- **Close the app before running `npm test`.** Windows locks a loaded `.node` file, so the
  swap fails while the app is running. The script detects this and prints a clear message.
- `npx vitest` directly **bypasses the swap** and will fail with a `NODE_MODULE_VERSION`
  error. Always go through `npm test`.

## `ELECTRON_RUN_AS_NODE=1` may be set in your shell

Some agent/IDE shells export this. It makes the `electron` binary run as plain Node, so the
app dies immediately at `protocol.registerSchemesAsPrivileged` with
`Cannot read properties of undefined`. Unset it when launching manually:

```bash
(unset ELECTRON_RUN_AS_NODE; npx electron .)
```

It is not set in the user's own environment, so `npm run dev` from a normal terminal is fine.

## vitest sometimes fails to spawn workers on Windows

`Error: spawn UNKNOWN` (errno -4094) from tinypool, reporting "no tests". This is
environmental, not a code fault — just re-run. Do not go debugging the test config over it.

## `npm run package` fails with `EBUSY` on `dist/win-unpacked`

Something holds a handle inside `dist/`: the packaged app still running, or a shell whose
working directory is inside `dist/win-unpacked`. A failed build can also leave an orphaned
`node_modules\7zip-bin\...\7za.exe` running. Close or `cd` out of those, stop any stray
`7za`, delete `dist/`, and rebuild.

## CSP: `media-src` allows the audio protocol, `connect-src` does not

`src/renderer/index.html` permits `audio-asset:` under `media-src` only. Playback via
`<audio>` works; a plain `fetch()` of an `audio-asset://` URL is **deliberately blocked**.
If you test playback, use an `Audio` element, not `fetch`.

## `music-metadata` is pinned to v7 on purpose

v10+ is ESM-only, which breaks the CJS main-process bundle. Also: **it does not throw on an
unreadable file** — it resolves with an empty `format`. `readAudioMetadata` therefore treats
"learned nothing at all" as a read failure, so corrupt files are still indexed by name and
path with null metadata rather than being silently counted as successes.

## The FTS5 table is deliberately not contentless

Contentless fts5 tables cannot be updated or deleted with ordinary SQL, and this index
changes constantly during rescans. The duplicated text costs a few tens of MB at 100k files
— a fair trade for correct incremental maintenance. `IndexWriter` keeps it in sync by
delete-then-insert.

## Migrations

Currently at **version 3**. Never edit a shipped migration; append a new one.
`openDatabase` closes its connection if a migration throws — without that, a failed
migration leaves the index file locked on Windows forever.

## Ordering rules that must stay in sync

`listDestinations` and `prune` in `src/main/database/userData.ts` **must order identically**
(`last_used_at DESC, id DESC`), or the entry shown last is not the one pruned. The recency
stamp is monotonic (`nextUseStamp`), not raw `Date.now()`: wall-clock ties inside one
millisecond would make "use it again" fail to promote a folder, and a backwards clock
adjustment would scramble the order.

## Two renderer modules are unit-tested

`src/renderer/services/selection.ts` and `destinations.ts` are pure, dependency-free logic.
They are listed explicitly in `tsconfig.node.json` so the test project can see them. Keep
them free of React imports.

---

# Architecture

```
Electron Main Process  ──IPC──  Preload (contextBridge)  ──  React Renderer
```

`contextIsolation: true`, `nodeIntegration: false`. The renderer gets **only** the named
functions in `AudioLibraryApi` — no `fs`, no `path`, no generic `invoke`. Audio streams
through a custom protocol keyed by **index row id**, so the renderer never handles or
chooses a filesystem path.

```
src/
  main/                  the only code with filesystem access
    main.ts              lifecycle, window, security handlers
    logger.ts            scoped logging to userData/logs/app.log
    windowState.ts       save/restore window bounds, fitted to connected monitors
    database/
      db.ts              connection, pragmas, migration runner
      migrations.ts      ordered schema migrations (at v3)
      libraries.ts       library CRUD
      audioFiles.ts      IndexWriter, change-detection stamps
      search.ts          FTS5 query building, filters, sorting, facets
      userData.ts        destinations (MRU), favorites, tags
    filesystem/
      scanner.ts         recursive walk, symlink-loop and depth guards
      pathUtils.ts       normalisation, comparison, containment
      fileActions.ts     copyAsset (single) + copyAssets (batch)
      watcher.ts         chokidar, debounced  ** UNTESTED **
    indexing/indexer.ts  discover -> index -> prune, progress, cancellation
    audio/
      metadata.ts        music-metadata wrapper, bounded concurrency
      protocol.ts        audio-asset:// handler (serves byte ranges itself)
      range.ts           Range header parsing + MIME types (pure, tested)
    ipc/
      channels.ts        channel names (single source of truth)
      validate.ts        argument validation - everything is untrusted
      handlers.ts        handlers, all returning a result envelope
  preload/preload.ts     the entire exposed surface
  renderer/
    App.tsx              composition, selection state, shortcuts
    components/          SearchBar, DestinationPicker, LibrarySidebar,
                         ResultsTable (virtualized), FilterPanel, PlayerBar,
                         StatusBar, ContextMenu, Dialogs
    hooks/               useSearch, useAudioPlayer, useLibraries, useToasts
    services/            api (IPC envelope unwrapping), format, selection,
                         destinations
  shared/                types and constants used on both sides of the bridge
```

## Key invariants

- **No application menu.** `Menu.setApplicationMenu(null)` removes Electron's default
  File/Edit/View/Window/Help bar. Unpackaged runs restore `Ctrl+R` and
  `F12`/`Ctrl+Shift+I` through `before-input-event`; packaged builds offer neither.
  Clipboard keys in text inputs still work natively on Windows.

- **The database is an index, not the source of truth.** The filesystem is authoritative.
  Rescanning reconciles. "Rescan Library" is always available as a reliable fallback,
  because file watching is never assumed to be perfect.
- **Rescans are incremental.** A file whose size and mtime are unchanged keeps its existing
  metadata instead of being re-parsed.
- **One bad file never fails a scan.** Log it and continue.
- **Removing a library removes index rows only.** Never delete or move a user's asset.
- **Copying never overwrites silently.** A batch reports every collision at once and applies
  one answer (skip / overwrite / keep both) to all of them. Non-colliding files copy
  regardless; one failure never stops the rest.
- **Results are virtualized and paged.** Never render tens of thousands of rows.

---

# How to verify a change

Unit tests cover logic. **They are not enough for UI work** — this was learned the hard way:
copy-to-destination passed at the IPC level while every context-menu item was dead, because
a capture-phase `mousedown` listener unmounted the menu before any button's `click` could
fire. IPC tests could never have caught it.

For anything user-facing, drive the real UI. Launch with a debugging port and talk to the
renderer over the DevTools protocol:

```bash
(unset ELECTRON_RUN_AS_NODE; npx electron . --remote-debugging-port=9333 &)
# then, from a throwaway script:
#   fetch http://127.0.0.1:9333/json/list  -> find the page target
#   open its webSocketDebuggerUrl (node --experimental-websocket)
#   Runtime.enable, then Runtime.evaluate with awaitPromise + returnByValue
```

Synthesise **real** events rather than calling handlers:

```js
el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, shiftKey: true }))
// a full click is mousedown + mouseup + click
```

Two gotchas when driving it: React batches state updates, so `sleep` between a click and a
dependent keypress (a real user cannot do both in one microtask); and the renderer cannot
read the clipboard without window focus, so verify clipboard writes with
`powershell -NoProfile -Command Get-Clipboard`.

More gotchas: keys sent with CDP `Input.dispatchKeyEvent` **do not reach the main
process's `before-input-event`**, so they cannot test main-process shortcuts. Launch with
`--inspect=9229` as well and evaluate in the main process with
`includeCommandLineAPI: true` (that is what makes `require('electron')` available).
Your manually launched instance will collide with a running `npm run dev` on the
single-instance lock; pass `--user-data-dir=<temp dir>` to get a separate lock and an empty
index, then add a temp library with `audioLibrary.addLibrary(path)` from the page.

Testing drag-out: to check which files a drag carries, replace `webContents.startDrag` with a
recorder from the main-process inspector and dispatch a `DragEvent('dragstart')` on a row —
no mouse needed. Testing the drop itself needs a real OS drag (and the user's consent, since
it moves their cursor): use `mouse_event` with `MOVE|ABSOLUTE` — OLE's drag loop ignores
`SetCursorPos` — call `SetProcessDPIAware` first, and aim at Explorer's file list, not the
navigation-pane divider, which rejects drops. Use throwaway files on one volume only.

Tests must only ever use temporary directories (`tests/helpers.ts`). **Never write a test
that touches a real asset library.**

Prioritise tests for anything that could cause data loss or a wrong index: scanning,
metadata, path normalisation, search, filtering, duplicate handling, copying, index updates,
deleted files, malformed audio.

---

# Rules for agents

1. Read this file before making architectural changes.
2. Inspect existing code before creating a replacement system. Prefer modifying an existing
   module over adding a duplicate.
3. Keep renderer and main-process responsibilities separated. Business logic does not belong
   in React components.
4. **Never weaken Electron security to solve an implementation problem.** Do not enable node
   integration, do not disable context isolation, do not expose raw `fs`/`path`/
   `child_process` or a generic IPC channel, do not pass unvalidated URLs to
   `shell.openExternal`.
5. Validate every IPC argument in the main process. Treat all paths and metadata as
   untrusted input. Never execute a command derived from a filename.
6. Keep TypeScript types explicit at IPC boundaries. Avoid `any` without a documented reason.
7. Fix root causes; do not suppress type or lint errors.
8. Run lint, typecheck and the tests after meaningful changes.
9. Keep dependencies minimal — only three runtime deps today (`better-sqlite3`, `chokidar`,
   `music-metadata`). Do not add one without clear value.
10. Do not introduce cloud dependencies for anything that can work locally.
11. No destructive filesystem operations unless explicitly required. Never delete or move a
    user's original asset as part of a normal workflow.
12. Do not build speculative features before the core workflow is reliable.
13. Errors must be understandable by a normal user. Handle missing directories, disconnected
    drives, permission denied, files deleted after a search, corrupt audio, unsupported
    codecs, unavailable destinations, duplicate filenames and database errors.
14. Log the operations that matter (startup, scan start/end, indexing failures, database
    failures, copy failures, playback failures). Do not flood logs in normal operation.

---

# Reference: behaviour requirements

These still define intended behaviour; the tests encode most of them.

**Supported formats** — WAV, MP3, OGG, FLAC, M4A. Adding one to `SUPPORTED_EXTENSIONS` in
`src/shared/constants/index.ts` is enough for the scanner to pick it up.

**Indexed metadata** — filename, extension, absolute path, relative path, parent folder,
library, file size, duration, sample rate, bit depth, channels, bitrate, modified date.
Unreadable values are null, never a guess.

**Search** — must match filename, relative path and parent folder names. Case-insensitive.
Multiple terms narrow. `Medieval Combat/Impacts/Body/impact_heavy_03.wav` should be findable
by `medieval`, `combat`, `impact`, `body`, `heavy` or `impact heavy`.

**Filters** — duration (`< 1s`, `1–3s`, `3–10s`, `> 10s`, plus a custom range), file type,
channels (mono / stereo / other), sample rate, library, favorites. Bucket selections are
OR-ed together; a custom range is AND-ed on top.

**Results** — a dense table, not oversized cards: play, filename, folder, duration, format,
sample rate, channels, size. Sortable by filename, duration, size and modified date. Files
with unknown duration sort last in either direction.

**Preview** — clicking another sound immediately stops the current one. `Space` auditions
the focused row. No separate preview window.

**Duplicate filenames** — never silently overwrite. Offer cancel, overwrite, or automatic
rename (`explosion.wav` → `explosion_2.wav` → `explosion_3.wav`).

**UI philosophy** — a professional productivity tool, not a consumer music app. Optimise for
speed, information density and minimal clicks. Avoid excessive animation, oversized
elements, and modal dialogs for routine operations.

**Keyboard** — `Ctrl+F` search, `Up`/`Down` navigate, `Shift`+arrows extend, `Ctrl+A` select
all, `Enter` play, `Space` play/stop, `Ctrl+C` copy path, `Ctrl+Shift+C` copy selection to
destination. Do not override expected OS shortcuts unnecessarily.

**Privacy** — do not upload audio, filenames, folder structures, or analytics containing
filesystem paths without explicit user consent. Any future AI feature must clearly separate
local from remote processing and must never be mandatory.
