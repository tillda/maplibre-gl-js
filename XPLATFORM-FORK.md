# XPLATFORM FORK OF MAPLIBRE GL JS

This branch is the MapLibre the [xplatform](https://github.com/tillda/xplatform)
client renders with. The app links it as a git submodule at
`third_party/maplibre-gl` instead of the npm package, and builds `dist/` from
this source.

- **Branch** — `xplatform-timing`, the only branch that carries our work.
- **Base** — upstream release **v5.24.0** (`fd31bd859`), the newest release.
- **Divergence** — every commit listed below; nothing else. Each one is a
  separate commit, so a rebase onto a newer release replays them one by one.
- **This file is the ledger.** A patch that is not written down here does not
  exist: it will be dropped by the next rebase without anyone noticing.

## The patches

| Topic | Files | Why it exists | Upstream |
|---|---|---|---|
| Worker-side tile-parse timing | `src/util/x_timing.ts`, `src/source/worker_tile.ts`, `src/source/vector_tile_*`, `src/source/worker_source.ts`, `src/index.ts` | The heavy tile-parse work is worker-side and unhookable from the app; xplatform's `TIMING` lines need spans from inside it | Ours to keep — app-specific observability |
| Pipeline-gap timing (build 2) | as above, plus `src/tile/tile.ts` | Closes the untimed gaps between fetch, parse, and upload | Ours to keep |
| `xtFormat` tag sanitizing | `src/util/x_timing.ts` | The `TIMING` line grammar splits on whitespace and on the first `=`; a tag value carrying either would corrupt the app's batched IPC payload | Ours to keep |
| Feature-state init timing (build 3) | `src/source/source_state.ts`, `src/util/x_timing.ts` | `initializeTileState` re-applies the whole stored feature-state map to every tile load and cache revive — cost scales with the number of stored ids (measured ~55 ms/tile at 41k ids: the app's zoom-crossing lag) and no other span sees it; the `main.stateInit` span (tagged `ids=`) keeps it loud | Ours to keep — app-specific observability |
| Feature-state crash guard | `src/data/program_configuration.ts`, `src/data/program_configuration.test.ts` | Fixes a crash on any style change while tiles are in flight; see below | Ours to carry — upstream `main` has the same bug, so a newer release will still need it |
| Tile reload race guard | `src/source/vector_tile_source.ts`, `src/source/vector_tile_source.test.ts` | Stops a reload from being sent for a tile whose request is still in flight, which throws in the worker; see below | Ours to carry — upstream `main` has the same bug, so a newer release will still need it |

### Feature-state crash guard

`ProgramConfiguration.updatePaintArrays` re-reads the live layer's paint value
and assigns it onto a binder that was built when the tile was parsed:

- The guard in front of it tests the **parse-time** expression, so it still
  passes once the layer has been restyled to a constant.
- A constant possibly-evaluated value is a plain `{kind: 'constant', value}`
  object with no `evaluate`, so the next line throws
  `this.expression.evaluate is not a function`.
- The throw escapes `Tile.setFeatureState`, which iterates the tile's buckets
  with no `try`: every bucket after the failing one loses its feature state, and
  the poisoned binder is skipped forever after, so the tile renders without its
  feature-state paint until it is reparsed.

The patch skips the property when the live value is a constant — the style
change has already queued the reparse that rebuilds the binder — and logs the
layer and property once. `src/data/program_configuration.test.ts` pins both
halves: state still applies for a state-dependent property, and a property the
layer turned constant is skipped rather than thrown on.

### Tile reload race guard

`VectorTileSource.loadTile` decides between a `loadTile` and a `reloadTile`
message. A `reloadTile` for a tile the worker has not finished loading throws
`Should not be trying to reload a tile that was never loaded or has been
removed`, and the tile is left `errored` — blank, and not retried until the next
source-data change or viewport move.

The guard against that was `tile.state === 'loading'`, which covers a first load
but not this sequence:

- A source-data change (`setTiles`, or an expiry timer) puts the tile in the
  `expired` state, and `loadTile` re-sends it as a **full load** — a fresh
  actor, so the worker has no loaded entry for the uid until the fetch returns.
- A second reload — any style change touching the source, such as adding a
  layer — reaches `TileManager._reloadTile`, which overwrites `expired` with
  `reloading` while that load is still in flight.
- `loadTile` now sees a state that is neither `expired` nor `loading`, and sends
  `reloadTile` into the gap.

The patch gates on `tile.abortController` as well: it is set when a request goes
out and deleted on every response path, so it is the honest in-flight marker.
An overlapping reload is queued behind the response through the existing
`tile.reloadPromise`, exactly as a reload of a `loading` tile already was.
`src/source/vector_tile_source.test.ts` pins it by holding the first response
open and flipping the tile to `reloading` mid-flight.

## Moving to a new upstream release

1. Fetch upstream: `git fetch https://github.com/maplibre/maplibre-gl-js main --tags`.
2. Rebase this branch onto the new release tag: `git rebase <tag>`.
3. Replay every patch in the table above — a conflict in the two bug-fix
   patches (`src/data/program_configuration.ts`, the state machine in
   `VectorTileSource.loadTile`) usually means upstream has adopted or moved the
   fix; check before resolving it by hand.
4. Run the tests that pin the patches: `npx vitest run --config
   vitest.config.unit.ts src/data/program_configuration.test.ts
   src/source/vector_tile_source.test.ts`.
5. Rebuild the app's `dist/` from the app repo: `pnpm -C client maplibre:build`.
6. Update the **Base** line above, push this branch, and move xplatform's
   submodule pointer in the same change.

## Staleness check

- **How far behind the newest release we are** — compare the **Base** line above
  with `git ls-remote --tags https://github.com/maplibre/maplibre-gl-js 'v*'`.
- **What we actually carry** — `git log --oneline fd31bd859..HEAD`, which must
  match the patch table row for row.

## Rules

- `dist/` is a build artifact. Edit the source, then rebuild with `pnpm -C
  client maplibre:build`; the app's Vite prebundle ignores a fresh `dist/`
  otherwise.
- One patch, one commit, one row in the table. A patch that gains no row is
  invisible to the next rebase.
- Pin every behavioural patch with a test in this repo, so a rebase that drops
  it fails loudly instead of silently.
- Push this branch before moving xplatform's submodule pointer: an unpushed
  commit is a pointer no other machine can resolve.
