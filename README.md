# ixion

Ixion contains a CLI and several packages working with FFXIV patches and data files.

## Usage

```bash
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
pnpm run x asset ui --server sdo --storage minio

# Full extraction into the local storage configured in .ixion-config.json
pnpm run x asset extract-local "D:/Games/FFXIV/game" --server sdo --exd-schema lib/EXDSchema

# Reuse a cumulative list from another extraction/storage
pnpm run x asset extract-local "D:/Games/FFXIV/game" --references "references.json"

# Upload missing images, then synchronize version manifests and references
pnpm run x asset ui-sync --server sdo --storage minio
```

Full extraction requires a configured local storage and a valid `ffxivgame.ver`
in the game folder. The old `<output>` argument is no longer accepted. Output
uses `<local.rootPath>/<local.paths.ui or ui>/<server>/` (`server` defaults to
`sdo`), with the same layout as incremental extraction:

```text
storage/ui/sdo/
  current.json
  references.json
  assets/<hash-prefix>/<sha256>.webp (or .avif)
  patches/<ffxivgame.ver>/icons.json
  patches/<ffxivgame.ver>/maps.json
  patches/<ffxivgame.ver>/asset-files.json
```

References from storage, the installation and optional `--references` input are
merged cumulatively. The optional reference file is also updated. Existing
encoded files in storage are reused on subsequent runs. Old `outputs/ui` files
are not moved automatically. After images and all version metadata are written
successfully, extraction sets both `ffxiv` and `lastValidIndex` in local
`current.json` to `ffxivgame.ver`. Failures before that point leave the previous
reference unchanged. Extraction never uploads to remote storage or changes the
`.diff` patch replay state; the full snapshot alone is not a patch replay baseline.

The manual `ui-sync` command uploads missing images before version metadata;
use the configured remote storage name for `--storage` (for example,
`minio-backup` in the example config). It works without a local `current.json`,
leaving the remote checkpoint untouched in that case. Existing local checkpoints
are synchronized as before. CI's internal metadata synchronization does not
perform the additional full image scan.

Manual sync compares local images with `asset-files.json` at the remote
`current.json` version (`lastValidIndex`, falling back to `ffxiv`). It never lists
remote image objects. If there is no remote current reference, it uses the local
target version; if the manifest is absent, it uploads all local images. This
trusts the manifest and does not detect missing objects already listed there.

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
