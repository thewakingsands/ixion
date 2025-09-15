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

# Build a merged sqpack file of EXD files
# writes outputs/7.25/merged.{dat0,index,index2}
nr x exd build --root-only \
  -m sdo:2025.07.28.0000.0000 \
  -m squareEnix:2025.05.17.0000.0000 \
  outputs/7.25 -p merged
```

## LICENSE

[GPL v3](LICENSE)

FINAL FANTASY, FINAL FANTASY XIV, FFXIV, SQUARE ENIX, and the SQUARE ENIX logo are registered trademarks or trademarks of Square Enix Holdings Co., Ltd.