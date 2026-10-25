# Client version observations

Ixion observes China (`sdo` / `cn`), international (`squareEnix` / `global`), Korea (`actoz` / `kr`) and Taiwan (`userjoy` / `tw`). International observations use Thaliak; the others query their patch services directly. Only version metadata is fetched.

## Run locally

Use Node 24.11 or later and the repository's pnpm version:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm --filter '@ffcafe/ixion-cli^...' --filter '!@ffcafe/ixion-image-encoder' build
pnpm x ci observe
```

Observation is a subcommand of the existing CLI. After building the CLI, use `node packages/cli/dist/index.js ci observe` with the same options. Source execution needs the CLI's JavaScript workspace dependencies built, but does not load the native image encoder.

The command reads `.ci/versions.json` and `.ci/versions-observed.json`, then writes the latter only when versions change. Missing files start empty; normal JSON parsing errors fail the command. These repository-owned maps are read directly, without a second schema or size-validation layer.

Patch providers use the released version and existing boot identifier. A missing baseline or initialization placeholder produces `baseline_unavailable`; Thaliak can query without one. Upstream providers validate their own responses.

Requests time out after 30 seconds and retry transient failures once. Failed regions retain their previous observed versions; first-time failures are omitted. Errors appear in the command log only. All failures leave an existing file unchanged and do not create a first file.

## Repository JSON

The file uses the same flat server-to-version format as `.ci/versions.json`; see [status.example.json](status.example.json). `.ci/versions.json` remains the released-version record. No observation timestamps or health fields are stored.

Consumers read `https://raw.githubusercontent.com/thewakingsands/ixion/main/.ci/versions-observed.json` after the first successful workflow publication. ETag / If-None-Match can support cached reads. Commit time describes a content change, not each region's latest successful check; inspect Actions logs for check times and errors.

## Update workflow

`.github/workflows/ci.yml` runs on Tuesdays at 16:00 UTC+8 and supports manual dispatch, including Thursday hotfix checks. GitHub may delay scheduled runs. The existing concurrency group serializes observation and release together.

The observation job builds the JavaScript workspace dependencies and runs `pnpm x ci observe --commit`. This commits and pushes only `.ci/versions-observed.json`, then writes `sha` and `update_required` to GitHub outputs. It needs contents: write and checkout's Git credentials; no additional storage credentials are required.

A successful observation differing from the released-version record triggers EXDSchema update, full build and release. Comparing with released versions allows the same observed version to retry after a download failure. Failed regions never trigger updates using stale observations. `force_release` explicitly runs the existing update path; `allow_missing_remote_version` keeps its existing meaning.

Unchanged versions create no empty commit. Git publication failure fails the observation job and prevents downstream work. The EXDSchema job checks out the observation SHA, and subsequent jobs use its resulting SHA. Release commits preserve the observation file. The existing release-attachment recovery limitation is tracked separately in MJT-98.

After merge, manually verify that the observed file appears on main before downloads start, unchanged versions skip heavy jobs, forced updates run, and GitHub raw allows anonymous reads. Confirm the next scheduled run. These production checks require an actual Actions run.

## Future support display

Consumers independently match official profiles by region and observed version. Missing observations or an unavailable index mean unknown; no match means no official profile. One capability means partial support; at least one profile must contain both opcodes and memory for complete support. Actual connections still check the full executable hash. Consumer integration and pages are delivered separately.
