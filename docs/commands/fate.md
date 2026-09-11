# Local FATE and DynamicEvent locations

From the repository root:

```sh
pnpm x fate export-locations "C:/Games/FINAL FANTASY XIV/game" outputs/fate-locations.json
```

The game path must contain `sqpack`. Reads local Windows SqPack data only; no server configuration or downloads are needed. Uses `lib/EXDSchema` under the repository root by default. Supply `--saintcoinach <definitions-directory>` to explicitly use SaintCoinach instead.

To specify an EXDSchema directory explicitly:

```sh
pnpm x fate export-locations "C:/Games/FINAL FANTASY XIV/game" outputs/fate-locations.json --exd-schema lib/EXDSchema
```

Use definitions matching the installed game version. `--exd-schema` and `--saintcoinach` are mutually exclusive.

Use `outputs/fate-locations.json` for exports regardless of definition source; no `-exdschema` suffix is needed.

Reads `Fate.Location`, `TerritoryType.Bg` / `Map`, and map scale, offsets and place names. Scans `bg.lgb`, `planmap.lgb`, `planevent.lgb` and `planlive.lgb` for EventRange (49) instances matching the location ID. All matching FATEs and placements are retained. `planlive.lgb` includes placements such as FATE 2022 on Phaenna (location instance 11873699).

The output contains:

- `locations`: FATE ID, location instance ID, territory, layer, source resource path, original `world` X/Y/Z and `position` with `map`, `zoneid`, `x`, `y`, `z`.
- `unmatchedFateIds`: FATEs with a nonzero location but no matching placement.
- `dynamicEventLocations`: type 45 (EventObject) placements referenced by `DynamicEvent.LGBEventObject`. Each entry uses `dynamicEventId` instead of `fateId`, with the same location, territory, layer, source path, world and map coordinate fields as FATE placements.
- `unmatchedDynamicEventIds`: DynamicEvents with a nonzero `LGBEventObject` but no matching type 45 placement.
- `missingLgbFiles`: optional LGB paths absent from the installed game.

Map coordinates follow Teamcraft's conversion and rounding. World X/Z become map X/Y; `position.z` is `floor(world.y) / 100` (no altitude offset). Each territory uses its default `TerritoryType.Map`; automatic floor selection for territories with multiple maps is not implemented. Original world coordinates are included for consumers that need their own floor or altitude handling.

Missing required sheets, invalid definitions or corrupt LGB files fail the export. An entirely empty result also fails, rather than writing a misleading empty export.

Both definition formats must include `DynamicEvent.LGBEventObject`. Unreferenced type 45 objects are not exported. FATE and DynamicEvent IDs belong to separate sheets; their results are kept in separate arrays to preserve the existing FATE output structure.
