# Audio Asset Browser

A local-first desktop tool for browsing, searching, previewing and organising large
collections of game audio assets. Point it at your sound folders and it builds a cached
index you can search instantly, audition from the keyboard, and copy into a project.

Your audio never leaves your machine. There is no server and no account.

## Getting started

```bash
npm install     # also builds the native SQLite binding for Electron and Node
npm run dev     # start the app with hot reload
```

Other commands:

| Command | What it does |
| --- | --- |
| `npm test` | Run the test suite |
| `npm run typecheck` | Type-check main, preload and renderer |
| `npm run lint` | Lint everything |
| `npm run build` | Type-check and produce a production build in `out/` |
| `npm run package` | Build an installer into `dist/` |

## Using it

1. **Add Library** in the left sidebar and pick a folder. It is indexed recursively in the
   background; you can keep working while it runs, and progress shows in the status bar.
2. **Search** (`Ctrl+F`) across filenames, folder names and relative paths. Extra words
   narrow the results, so `impact heavy body` finds
   `Medieval Combat/Impacts/Body/impact_heavy_03.wav`.
3. **Filter** by duration, file type, channels, sample rate, library, or favorites.
4. **Audition** with `Space`, or click a row's play button. Starting a new sound stops the
   previous one.
5. **Set a destination** once in the **Copy to** box in the toolbar. "Browse for folder…"
   picks a new one; folders you have already used are listed underneath, most recent
   first.
6. **Select the assets** you want: click, `Shift`+click for a run, `Ctrl`+click to add or
   remove one, `Ctrl+A` for everything loaded.
7. **Right-click → Copy _N_ files to _<destination>_**, or press `Ctrl+Shift+C`. If any
   filenames already exist you are asked once, and your answer covers the whole batch.

Right-clicking inside a multi-row selection acts on the whole selection; right-clicking a
row outside it selects just that row first.

### Keyboard

| Key | Action |
| --- | --- |
| `Ctrl+F` | Focus the search box |
| `Up` / `Down` | Move through results |
| `PageUp` / `PageDown` | Jump 20 rows |
| `Enter` | Play the selected asset |
| `Space` | Play / stop the selected asset |
| `Shift`+`Up`/`Down` | Extend the selection |
| `Ctrl+A` | Select all loaded results |
| `Ctrl+C` | Copy the focused asset's path |
| `Ctrl+Shift+C` | Copy the selection to the chosen destination |

## How it is put together

```
src/
  main/         Electron main process - the only code with filesystem access
    database/   SQLite schema, migrations, search queries
    filesystem/ recursive scanning, path handling, copying, watching
    indexing/   scan orchestration and progress reporting
    audio/      metadata extraction, the audio-asset:// protocol
    ipc/        channel definitions, argument validation, handlers
  preload/      the contextBridge surface exposed to the renderer
  renderer/     React UI - components, hooks, services
  shared/       types and constants used on both sides of the bridge
```

A few decisions worth knowing about:

- **The database is an index, not the source of truth.** The filesystem is authoritative.
  Rescanning reconciles the index against what is actually on disk, and "Rescan Library" is
  always available as a reliable fallback when file watching misses something.
- **Rescans are incremental.** A file whose size and modification time are unchanged keeps
  its existing metadata instead of being parsed again.
- **The renderer has no Node access.** `contextIsolation` is on, `nodeIntegration` is off,
  and the preload exposes only the named functions in `AudioLibraryApi`. Audio is streamed
  through a custom `audio-asset://` protocol that takes an index row id, so the renderer
  never handles or chooses a filesystem path.
- **Results are virtualized and paged**, so a 100k-file library costs the same to display
  as a small one.
- **Removing a library only removes the index entries.** Your files are never deleted or
  moved.
- **Copying never overwrites silently.** A batch copy reports every collision at once and
  applies a single answer (skip, overwrite, or keep both) to all of them. Files that do not
  collide are copied regardless, and one failure never stops the rest.
- **Destinations manage themselves.** Choosing a folder is what remembers it, copying into
  one moves it to the top, and only the ten most recent are kept. There is no list to
  curate. Where folder names collide (two projects both ending in `Audio`), just enough of
  the parent path is shown to tell them apart.

### The native module

`better-sqlite3` is a native binding, so it has to match the ABI of whatever runs it:
Electron for the app, plain Node for the tests. `npm install` caches a build of each under
`native/`, and the `dev` / `test` scripts swap the right one into place automatically.

## Testing

```bash
npm test
```

The suite covers recursive scanning, metadata extraction, path normalisation, search and
filtering, index updates (added, changed, deleted and moved files), malformed audio files,
duplicate filename handling, single and batch file copying, selection rules, IPC validation
and database migrations.

Tests only ever work inside temporary directories; they never touch a real asset library.

## Status

Phases 1-7 of the plan are implemented: application shell, indexing, search, preview, the
asset workflow, library management, and favorites/tags. Waveform rendering is not drawn
yet, but the player bar and schema leave a slot for it, and the schema also reserves
nullable columns (`ai_description`, `ai_tags`, `embedding`) so semantic search can be added
later without a rewrite. None of that is required for the app to work offline.
