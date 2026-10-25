# Client version observations

Ixion observes the latest client version for China (`sdo` / `cn`), international (`squareEnix` / `global`), Korea (`actoz` / `kr`) and Taiwan (`userjoy` / `tw`). International observations use Thaliak; the other regions query their patch services directly.

## Run locally

Use Node 24.11 or later and the repository's pnpm version:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm --filter '@ffcafe/ixion-server...' build
pnpm status --output status.json
pnpm status --previous status.json --output status.json
```

The standalone entry only needs the server package and its dependencies built. It does not load the image encoder or the game-data update commands. A full CLI build also produces `packages/cli/dist/status.js` with the same arguments.

`--baselines` defaults to `.ci/versions.json`. Direct patch providers use the recorded released version to query the patch server, together with the existing boot identifier. Missing or invalid regional values produce `baseline_unavailable`; the initialization placeholder `2012.01.01.0000.0000` is rejected. Supply a real released version before first observation of a new region. Invalid JSON and explicitly supplied missing files fail the command. Thaliak does not require a baseline.

Omit `--previous` for the first local observation. An explicitly named previous file must exist and validate. Local writes use a temporary file and rename. Inputs are limited to 1 MiB. Requests have a 30-second timeout; timeout, network errors, HTTP 429 and 5xx retry once after one second.

## Public JSON

See [status.example.json](status.example.json) for synthetic data. `schemaVersion` is 1 and `regions` always contains every region in the order listed above.

| Field | Meaning |
| --- | --- |
| server, region, source | Fixed identity and observation source |
| version | Last successfully observed client version, or null |
| observedAt | UTC time of that successful observation, or null |
| attemptedAt | UTC start time of the latest observation attempt |
| error | null on success; otherwise timeout, upstream, invalid_response or baseline_unavailable |

Failed queries keep the previous version and observation time. A first-time failure has null version and observedAt. All regions are independent, so an unavailable service does not prevent updates for the others. An output containing regional errors is a successful command (exit 0); check `error` for regional health. Input, storage or publication errors exit nonzero.

Display when a version was last checked and indicate a failed recent attempt. There is no shared expiry threshold. Thaliak's observation time describes when Ixion read Thaliak, rather than when the publisher released the game version.

## Publish to S3

The workflow `.github/workflows/status.yml` runs every half hour and supports manual runs on the default branch. GitHub may delay scheduled runs. Its concurrency group serializes publication; keep any manual publishers serialized with it too.

Configure these repository variables:

| Variable | Value |
| --- | --- |
| STATUS_S3_ENDPOINT | HTTPS S3-compatible endpoint |
| STATUS_S3_REGION | S3 signing region |
| STATUS_S3_BUCKET | Existing bucket |
| STATUS_S3_KEY | Dedicated object key, for example status.json |
| STATUS_S3_FORCE_PATH_STYLE | true for path-style addressing, otherwise false or empty |

Set secrets `STATUS_S3_ACCESS_KEY_ID`, `STATUS_S3_SECRET_ACCESS_KEY` and, for temporary credentials, `STATUS_S3_SESSION_TOKEN`. The command receives them as standard AWS credential environment variables. Use credentials restricted to reading and writing the status object. S3 must allow missing-key detection: on AWS, prefix-restricted ListBucket permission is needed to receive a missing-object response instead of 403. A 403 is always an error, never an empty initial state.

For a manual environment configured with the same variables and AWS credentials:

```sh
pnpm status --publish
```

Publication reads the previous object using authenticated GetObject. Only NoSuchKey starts an empty history. Missing buckets, access failures, invalid JSON and oversized objects stop before observation or publication. The next document is validated and uploaded once with `application/json` and `public, max-age=0, must-revalidate`.

An interrupted upload may have succeeded even if the command reports failure. The next run reads the current object again. A successful upload replaces the whole document. Avoid using the same key for any other purpose.

Configure anonymous reads or a CDN for this object and record the public URL in the deployment handoff. Add CORS when a browser consumer's origin is known. After configuration, run the workflow manually, fetch the URL without credentials, check fields and cache headers, then confirm a scheduled run advances attemptedAt. Check the workflow failure result and per-region errors separately. No public endpoint or production credentials are included in this change.

## Future support display

Read this file and the official profile index independently. Match profiles by region and version:

- No successful observed version, or a failed index fetch: unknown.
- Successfully loaded index with no match: no official profile.
- Matching profile has only opcodes or only memory: partial support; list the capabilities.
- At least one matching profile contains both: a complete profile is available.

Do not combine capabilities across different profiles. For multiple builds of one version, show the matching profiles and their capabilities. Local imports do not count as official support. Actual connections still require the full executable hash match. Profile publication and withdrawal do not rewrite the observation file. Consumer code and pages are delivered separately.
