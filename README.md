# Audio Asset Browser

A local-first desktop tool for browsing, searching, previewing and organising large
collections of game audio assets. Point it at your sound folders and it builds a cached
index you can search instantly, audition from the keyboard, and copy into a project.

Your audio never leaves your machine. There is no server and no account.

## Download

Windows builds are published on the
[Releases page](https://github.com/neumont-gamedev/audio-search/releases/latest). Each
release has two files — pick one:

| File | What it is |
| --- | --- |
| `Audio Asset Browser Setup <version>.exe` | Installer. Installs for your user account only (no admin rights needed) and adds a Start Menu entry. |
| `Audio Asset Browser <version> Portable.exe` | Portable. Runs directly with nothing installed — handy for USB sticks or lab machines. Starts a little slower, because each launch unpacks itself to the Windows temp folder first. |

The builds are not code-signed, so Windows may show **"Windows protected your PC"** the
first time. Click **More info → Run anyway**.

Both versions keep their data (libraries, favorites, the search index) in
`%APPDATA%\audio-asset-browser`, so they share it if you use both on one PC. The data is
only an index: if it is lost, add your folders again and rescan.

## Getting started (development)

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
| `npm run package` | Build the Windows installer and portable `.exe` into `dist/` |
| `npm run package:portable` | Build only the portable `.exe` |

## Releasing a new version

`dist/` is git-ignored; built `.exe` files go on a GitHub Release, never into the
repository.

One-time setup: install the [GitHub CLI](https://cli.github.com/) and run `gh auth login`.

1. Bump `"version"` in `package.json` (e.g. `1.0.0` → `1.1.0`), commit and push.
2. Close the app if it is running, then:

   ```bash
   npm run release
   ```

   This builds both `.exe` files and creates a **draft** release tagged `v<version>` with
   them attached, install instructions, and notes generated from the commits. Only you can
   see a draft.
3. Open the link it prints, check the release, and click **Publish release**.

The script refuses (changing nothing on GitHub) if `gh` is not logged in, there are
uncommitted or unpushed changes, a release for that version already exists, or a build is
missing. Variants: `npm run release -- --publish` publishes immediately;
`npm run release:upload` skips the build and uploads what is already in `dist/`.

## Using it

1. **Add Library** in the left sidebar and pick a folder. It is indexed recursively in the
   background; you can keep working while it runs, and progress shows in the status bar.
2. **Search** (`Ctrl+F`) across filenames, folder names and relative paths. Extra words
   narrow the results, so `impact heavy body` finds
   `Medieval Combat/Impacts/Body/impact_heavy_03.wav`. Put `-` in front of a word to
   **exclude** it: `impact -metal` finds impacts that aren't metal. Like ordinary words this
   matches the start of words, so `-metal` also leaves out "metallic". A hyphen inside a
   word (`sci-fi`) is just part of the word.
3. **Filter** by duration, file type, channels, sample rate, library, or favorites.
4. **Audition** with `Space`, or click a row's play button. Starting a new sound stops the
   previous one. Two toggles in the player bar speed this up:
   - **Auto** plays each sound as you move to it with the arrow keys or Page Up/Down, so you
     can run down a list hearing every sound without pressing `Space` each time.
     (`Shift`+arrows only extend the selection; they never auto-play.)
   - **Loop** repeats sounds until you stop them, for checking ambiences and loop points.

   Both toggles are remembered between launches. Volume always starts at 100%.

   The player bar shows the sound's **waveform**, so you can see at a glance whether it has
   a long tail, silence at the start, or several hits in one file. The played part is
   highlighted; click anywhere on it to jump there. It is drawn the first time you play a
   sound and remembered after that.
5. **Set a destination** once in the **Copy to** box in the toolbar. "Browse for folder…"
   picks a new one; folders you have already used are listed underneath, most recent
   first.
6. **Select the assets** you want: click, `Shift`+click for a run, `Ctrl`+click to add or
   remove one, `Ctrl+A` for everything loaded.
7. **Right-click → Copy _N_ files to _<destination>_**, or press `Ctrl+Shift+C`. If any
   filenames already exist you are asked once, and your answer covers the whole batch.

Right-clicking inside a multi-row selection acts on the whole selection; right-clicking a
row outside it selects just that row first.

**Drag and drop:** drag rows straight out of the results into Explorer, a Unity / Unreal /
Godot project, or a DAW. Dragging a row inside a multi-row selection takes the whole
selection; dragging any other row takes just that one. Dropping always **copies**: your
original file stays in your library, even when the target folder is on the same drive.

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
asset workflow, library management, and favorites. Tags exist in the schema and IPC layer
but have no UI yet. The schema also reserves nullable columns (`ai_description`,
`ai_tags`, `embedding`) so semantic search can be added later without a rewrite. None of
that is required for the app to work offline.
