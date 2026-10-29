# ixion

Ixion contains a CLI and several packages working with FFXIV patches and data files.

## Client version status

See [Client version observations](docs/status.md) for the version observation command, repository JSON format and conditional update workflow.

## Usage

```bash
# Initialize pinned schema repositories
git submodule update --init --recursive

# Install dependencies and build packages
pnpm i
pnpm build

# Here we use `nr` to run scripts
# You can install `@antfu/ni` globally or use `pnpm run x`

# Check configured storages
nr x storage list

# Install game from scratch
nr x update -s squareEnix -f 2012.01.01.0000.0000
# Or: record your installed game files
nr x record -s squareEnix C:\\path\\to\\game

# Update game to latest version
nr x update -s squareEnix

# Sync versions between storages
nr x storage sync -a

# List all available versions across all storages
nr x storage versions -a

# Build a merged sqpack file of EXD files
# writes outputs/7.25/merged.{dat0,index,index2}
nr x exd build --root-only \
  -m sdo:2025.07.28.0000.0000 \
  -m squareEnix:2025.05.17.0000.0000 \
  outputs/7.25 -p merged

# Export EXDs to CSV
nr x exd export-csv \
  -m sdo:2025.07.28.0000.0000 \
  -m squareEnix:2025.05.17.0000.0000 \
  outputs/7.25
```

## Referenced UI assets

Icon discovery is exhaustive: IDs `000000` through `999999`, including ID zero,
normal and `_hr1` textures, and the base/en/ja/fr/de/hq/chs/cht/kr variants. EXD
icon references do **not** filter extraction. Only maps use the collected EXD
`Map.Id` values to generate `_m`, `m_m` and `d` texture candidates. This policy
applies to both full local extraction and incremental CI processing.

Local extraction and patch processing use SqPack directory/file hashes to probe
all icons in existing directories, avoiding reads of millions of absent files.
An index2-only local installation falls back to the exhaustive path generator.

EXD processing accumulates icon IDs (schema fields of type `icon`/`Image`) and
`Map.Id` values in `ui/<server>/references.json` under the configured storage.
This is a union of every reference observed, not a per-version snapshot. Local
and remote copies are merged before saving. Arrays, subrows and all languages
present in each sheet are scanned. Sheets without schema definitions are skipped silently;
use definitions matching the input game data for complete coverage.

CI collects asset references only from the primary CN server (`sdo`), while
applying EXD updates and before the UI asset stage. Other servers' EXD updates
and release exports do not contribute asset references in CI. Existing CN
installations are bootstrapped by scanning their current stored EXD. Historical
references can only be retained once those EXD files have been processed.

```bash
# Incremental UI patches: exhaustive icons and referenced maps (ui-icons remains an alias)
pnpm run x asset ui --server sdo --storage garage-33

# Full extraction into the local storage configured in .ixion-config.json
pnpm run x asset extract-local "D:/Games/FFXIV/game" --server sdo --exd-schema lib/EXDSchema

# Reuse a cumulative list from another extraction/storage
pnpm run x asset extract-local "D:/Games/FFXIV/game" --references "references.json"

# Upload immutable chunks, then publish the catalog, runtime index and current pointer
pnpm run x asset ui-sync --server sdo --storage garage-33
```

Full extraction requires Node 24 or newer, a configured local storage and a valid
`ffxivgame.ver`. It writes beneath
`<local.rootPath>/<local.paths.ui or ui>/<server>/` (default server: `sdo`):

```text
storage/ui/sdo/
  catalog.sqlite                         # transactional build state, not a runtime index
  current.json                           # ffxiv, lastValidIndex, publication UUID
  references.json
  chunks/<uuid>.bin                      # immutable concatenated encoded images
  patches/<version>/catalog.sqlite       # consistent publication snapshot
  patches/<version>/assets.bin            # IXAS v2 runtime index
```

Only new or changed encoded images create chunks. A batch targets 32 MiB per
chunk and seals its final partial chunk; later batches never reopen it. Images
are never split or compressed again. Images larger than 32 MiB get a dedicated
chunk, up to the 64 MiB image limit. Deduplication uses the original TEX SHA-256,
stored as a 32-byte SQLite BLOB, not a checksum of the encoded WebP/AVIF bytes.
Old bytes are never overwritten or compacted. Deletions change path mappings
only. The runtime index contains no image SHA-256.

SQLite replaces `icons.json`, `maps.json` and `asset-files.json`. Tables hold
objects, paths, sealed chunks and build/publication metadata. Chunk data is
fsynced before its records are committed; publication databases are exported
with `VACUUM INTO`, not copied with an uncheckpointed WAL. Diagnostic
`changes.json`/`resolved-index.json` and cumulative EXD `references.json`
remain separate. Do not edit SQLite tables or copy a database while it is open.

Extraction advances local `current.json` only after the snapshot is complete.
It does not upload resources or change the `.diff` patch replay state; a full
game snapshot is not by itself a patch replay baseline.

### Migration and publication

The new runtime accepts **IXAS v2 only**. There is no fallback to old binary/JSON
indexes or per-image objects. Prepare a separate storage prefix and switch it
together with the new service.

```bash
# Read only the legacy current version, pack without re-encoding and verify every path.
# The destination is an EMPTY UI server root, separate from the configured legacy root.
pnpm x asset ui-pack --server sdo --output ../ixion-chunks/ui/sdo

# Then configure local.rootPath to ../ixion-chunks and select a NEW remote prefix.
pnpm x asset ui-sync --server sdo --storage garage-33

# Resume the exact saved publication only after its previous writer has stopped.
pnpm x asset ui-sync --server sdo --storage garage-33 --resume
```

The importer leaves the source untouched. It migrates the current valid version,
not old historical versions; historical versions will not be accessible in the
new store unless separately rebuilt. It does not delete old MinIO objects.

`ui-sync` requires a completed local current snapshot. It compares the remote
published SQLite catalog (from `catalogs/<publication>.sqlite`), never a bucket
listing. It trusts the published inventory rather than auditing existing objects.
Uploads occur in this order: new immutable chunks, immutable SQLite snapshot,
`patches/<version>/assets.bin`, and finally `current.json`. A fresh CI workspace
downloads the current catalog to retain deduplication and location information;
already-published chunk contents do not have to be downloaded for building.

Only one writer may use a local workspace or publish to a server at a time.
A local `.asset-build.lock` prevents overlapping builds. After a crash, stop
the previous process before removing this exact local lock file. A remote
`publish.lock` and a local `publication-plan.json` file preserve interrupted
publication state. Failures require `--resume`; do not modify local snapshot
files or launch a competing recovery process. Stale remote baselines are
rejected rather than overwritten. A stale workspace must be rebuilt from a
fresh copy of the latest published catalog, not forced over the remote state.

The shared `S3Storage` adapter supports `type: "s3"`; `type: "minio"` and the
`MinioStorage` class remain aliases, not separate implementations. Endpoint,
bucket, region and credentials are ordinary S3 settings (the region must match
the server configuration). Publication policy is explicit, never inferred from
a storage name such as `garage-33`.

The default `publicationMode: "conditional"` requires S3 `If-None-Match: *`
for PUT. A unique temporary probe verifies enforcement and is then deleted.
Unsupported endpoints fail closed; no automatic unsafe fallback is used.

Garage does not support atomic conditional writes. Configure its S3 storage
with explicit `publicationMode: "cooperative"`. This opts into a **best-effort
remote cooperative lock**, not strict distributed mutual exclusion. No hostname
binding, shared directory or additional coordination service is required.
Different devices and CI jobs use the same `ui/<server>/publish.lock` object;
in normal operation they must not publish simultaneously.

The lock records a random per-run owner UUID, publication UUID and acquisition
time. Acquisition checks for an existing lock, writes the record with ordinary
PUT and reads it back. Existing locks are rejected regardless of age. Chunk and
metadata writes check ownership before and after each operation; baseline checks
also run before publishing the index and current pointer. Detected ownership
loss stops publication without deleting the observed other owner's lock.
Successful publication removes its lock. Errors preserve the lock and the local
pending plan for explicit recovery; clocks do not control lock expiry.

These checks cannot close the GET-to-PUT or GET-to-DELETE race windows. Two
simultaneous acquirers can both initially succeed, an in-flight write cannot be
undone after ownership loss, and a concurrent takeover can race with unlock.
There is no fencing token enforced by Garage. Content checks and baseline checks
reduce accidental conflicts, but do not guarantee safety under concurrent
publication. `createFile` remains unavailable in cooperative mode rather than
pretending a read-then-write is atomic. Strict acquisition is still available
only through conditional mode on a backend that supports it.

Inspect and recover a publication only after stopping all previous writers:

```sh
# Read-only: displays owner, publication and acquiredAt, or null if unlocked.
pnpm x asset ui-lock --server sdo --storage garage-33

# Continue the saved publication plan; rotates the owner UUID.
pnpm x asset ui-sync --server sdo --storage garage-33 --resume

# Abandon a lock only after stopping its writer; use the exact owner from ui-lock.
pnpm x asset ui-unlock --server sdo --storage garage-33 --owner <owner-uuid> --confirm-stopped
```

`--resume` can reclaim only the same publication UUID, never a different
publication's lock. To resume on another device, transfer the complete local
workspace including its catalog, `publication-plan.json`, snapshot and new chunk files
after stopping the original process. Remove a crash-left `.asset-build.lock`
only after confirming its process is stopped. Manual `ui-unlock` checks the
owner and rereads the lock before deleting it; it does not delete local pending
state, chunks, snapshots or current. No publisher may start during manual
unlock. After abandoning an outdated plan, rebuild in a fresh workspace from
the latest remote catalog rather than forcing a stale baseline over it.

`publication-plan.json` is stored directly in the local UI server directory
(for example `storage/ui-chunks/sdo/publication-plan.json`). It is written
atomically, retained after a failed publication and removed on success. It is
never uploaded or included in SQLite snapshots. Existing `meta.pending` entries
in working catalogs are migrated to this JSON file on first use, then removed
from SQLite; conflicting copies stop migration without overwriting either.
After stopping the writer, this JSON file can be deleted to discard the saved
execution plan. Deletion does not release `publish.lock`, reset the catalog's
baseline or remove image data. Inspect/unlock the remote lock separately when
abandoning a publication; deleting the file does not bypass stale-baseline checks.

Already-published chunks are compared by UUID, length and digest in the remote
SQLite catalog only: no chunk GET, HEAD, checksum calculation or upload is
performed. Only unconfirmed objects (typically an interrupted upload whose
catalog was not published) are downloaded and compared byte-for-byte before
reuse. Differing content is rejected, never overwritten. SDK errors are not
interpreted as absence. The immutable UUID chunk layout and IXAS v2 format are
unchanged; runtime readers need no Garage-specific adapter.
Unreferenced failed-upload chunks are retained; garbage collection is not part
of this release.

Publisher credentials need GET and PUT beneath the UI prefix, plus DELETE for
`publish.lock` and, in conditional mode, temporary `.capabilities/` probes. They do not need
bucket listing. Service runtime credentials only need GET (including Range).

### IXAS v2 wire format

All integers are little-endian. Layout: 64-byte header, 24-byte chunk entries,
then 20-byte resource entries.

| Header offset | Type | Value |
| --- | --- | --- |
| 0 | bytes[4] | ASCII `IXAS` |
| 4 | uint16 | Version `2` |
| 6 | uint16 | Header size `64` |
| 8 | uint32 | Flags `0` |
| 12 | uint16 | Resource entry size `20` |
| 14 | uint16 | Hash kind `1`: SqPack dual CRC32 |
| 16 | uint32 | Resource count |
| 20 | uint32 | Resource table offset: `64 + chunk_count * 24` |
| 24 | uint32 | Total file length |
| 28 | uint32 | Standard CRC-32/IEEE over bytes `[64, EOF)` |
| 32 | uint32 | Chunk count, at most 65,536 |
| 36 | uint32 | Chunk table offset `64` |
| 40 | uint16 | Chunk entry size `24` |
| 42 | bytes[22] | Reserved, zero |

A chunk entry contains UUID bytes [0,16), uint32 actual length at 16 and four
reserved zero bytes at 20. UUID bytes use canonical textual UUID byte order.
Only chunks referenced by this snapshot appear, strictly sorted by UUID bytes.
Objects are addressed as `chunks/<canonical-lowercase-hyphenated-uuid>.bin`.

| Resource offset | Type | Value |
| --- | --- | --- |
| 0 | uint64 | `directoryCRC << 32 \| filenameCRC` |
| 8 | uint32 | Offset within the chunk |
| 12 | uint32 | Image byte length, nonzero |
| 16 | uint16 | Snapshot-local chunk table index, 0..65535 |
| 18 | uint8 | Format: 1 WebP, 2 AVIF, 3 TEX |
| 19 | uint8 | Reserved, zero |

Paths use lowercase ASCII letters, digits, `_`, `-`, `.` and `/`, are shorter
than 260 characters, and have no empty, dot or parent segments. Backslashes
are rejected. Resource entries are strictly sorted by their unsigned hash.
Path CRC32 is the complement of standard CRC32; the payload checksum is not.
Duplicate keys/collisions, unsupported headers, nonzero reserved bytes,
unreferenced/duplicate chunks, zero sizes and out-of-bounds ranges are rejected.
Readers use wide arithmetic for bounds checks.

The 16-bit field is NOT a global identifier: the same chunk can have different
table positions in different snapshots. Disk caches must key by physical UUID,
offset, size, format and storage namespace. Exceeding 65,536 referenced chunks
fails publication; no truncation, wraparound or automatic repacking is allowed.

Both extraction modes use the same icon enumeration rules, map reference
generator and texture processor. Collected icon IDs remain in references.json
for compatibility, but are not used to limit icon extraction.
Map entries identify the source
variants `_m`, `m_m` and `d`; these are source textures, not a composed map image.
Absent language/HQ/HD variants are skipped. The incremental command also checks
saved UI state for newly discovered references when no new patch is available.

Reading and encoding use separate bounded queues (16 tasks each). Missing paths
and duplicate content do not occupy encoding slots, and slow textures do not
block later completed work. Every 10 seconds, progress reports scanned paths,
found textures, reused content, completed encodings, written files, active
encoders and the oldest active resource. A final summary is printed on completion.
The WebP/AVIF quality settings are unchanged.

## LICENSE

[GPL v3](LICENSE)

FINAL FANTASY, FINAL FANTASY XIV, FFXIV, SQUARE ENIX, and the SQUARE ENIX logo are registered trademarks or trademarks of Square Enix Holdings Co., Ltd.

## Shared data libraries

SqPack and SeString come from the exact npm versions of `@ffcafe/elpis-sqpack`
and `@ffcafe/elpis-sestring` declared in the consuming packages. Upgrade these
versions together, update the lockfile, then rebuild and run the tests.
Use their public ESM entry points, not deep imports or a mixture of ESM and CommonJS.
Language helpers in ixion-utils re-export the same elpis definitions.
Debug namespaces are `elpis:sqpack:*` and `elpis:sestring:*`.

## GitHub Actions

The TypeScript packages use tsdown; building requires Node 24.11+ (24.x) or 26+.
Build output remains ESM at `dist/index.js`, with declarations at `dist/index.d.ts`.

`build.yml` builds and packages the CLI on every push to `main` and every pull
request. It uses read-only repository permissions and does not download game
patches or access update-service credentials. The extracted production artifact is
checked by importing storage and starting the CLI with `--help`.

`ci.yml` updates game data every Tuesday at 16:00 UTC+8, or on manual dispatch.
It only runs on `main`; manual runs selecting another branch are skipped.
The update workflow refreshes EXDSchema, calls the build workflow with the exact
resulting commit, then runs patch updates from that build artifact. Release
version commits still run from a main checkout. CSV exports and xivstrings
updates run only after the patch update succeeds. Update runs are serialized.
