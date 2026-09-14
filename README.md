# sonar-action

Collects the code-quality reports a GitHub Actions workflow already produced, writes a `health.json` manifest, and sends everything to [Sonar](https://github.com/ux-nl/sonar). The action never fails your workflow unless you ask it to.

The action does **not** run any tools. Your jobs run PHPStan, Pest, Pint and friends with their machine-readable output written into `reports/`, upload that directory as an artifact named `reports-<job>`, and a final `sonar` job merges the artifacts and runs this action.

## Usage

Every repository gets one small workflow that calls the reusable workflow in this repository. Copy [`templates/caller.yml`](templates/caller.yml) to `.github/workflows/sonar.yml`:

```yaml
name: Sonar

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  id-token: write

jobs:
  sonar:
    uses: ux-nl/sonar-action/.github/workflows/sonar.yml@<sha> # v1.1.0
    secrets: inherit
```

It runs on every push to the default branch and on demand (Actions tab, `gh workflow run sonar.yml`, or Sonar's "Run scan" button). There is no schedule. Everything runs on `ubuntu-latest`.

> GitHub only accepts `workflow_dispatch` runs for a workflow that already exists on the default branch, so the caller above must be merged before "Run workflow" or Sonar's "Run scan" button works for a repository.

The reusable workflow detects the stack and runs only what applies:

| Job | Runs when | Report |
|---|---|---|
| `detect` | always | `sonar-stack.json` |
| `inventory` | always | `sbom.cdx.json` (syft, CycloneDX) |
| `secrets` | always | `gitleaks.sarif` (report only) |
| `lint`, `static`, `rector`, `tests`, `security`, `dependencies` | `composer.json` present and the tool installed | Pint, PHPStan, Rector, Pest/PHPUnit, composer audit/outdated, `artisan about` |
| `js-lint`, `js-tests`, `js-unused` | `package.json` present and the tool installed | ESLint SARIF, Vitest/Jest JUnit and lcov, knip |
| `sonar` | always | `health.json`, upload |

`lint`, `static` and `tests` fail the workflow on Pint/PHPStan findings or Pest/PHPUnit failures; `js-lint` and `js-tests` do the same for ESLint findings and Vitest/Jest failures. `rector`, `security`, `dependencies`, `js-unused` and `secrets` are report-only and never fail the workflow — `secrets` runs gitleaks as a pinned release binary rather than the `gitleaks-action`, which needs an organization license. Every job uploads its `reports-<job>` artifact with `if-no-files-found: ignore`, so a job that produced nothing still lets the workflow continue.

The final `sonar` job always runs (`if: always()`). Like the action itself, it never fails your workflow when the upload to Sonar fails (`fail-on-error: false` by default) — the reports already uploaded per job, plus the `sonar-reports` fallback artifact, are how Sonar's GitHub App recovers.

> Until the Sonar server understands the `cyclonedx-json` and `sonar-stack` report formats this release introduces, the `sonar` job's upload is answered with `422` for every v1.1 caller; the workflow run itself still completes and is visible in the Actions log.

### Reusable workflow inputs

| Input | Default | Description |
|---|---|---|
| `php-version` | detected (highest minor satisfying `require.php`, capped at 8.4), else `8.4` | Version for setup-php. |
| `node-version` | `.nvmrc`, then highest major satisfying `engines.node` (capped at 22), else `22` | Version for setup-node. |
| `skip` | empty | Comma-separated job names to skip, e.g. `rector,tests`. |
| `sonar-url` | action default | Only when running your own Sonar instance. |

### Adding the `sonar` job to an existing workflow

[`templates/minimal.yml`](templates/minimal.yml) adds only the final job; your own jobs must write reports into `reports/` and upload them as `reports-<job>`. The action itself:

```yaml
  sonar:
    needs: [tests]
    if: always()
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read
    steps:
      - uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0
      - uses: actions/download-artifact@634f93cb2916e3fdff6788551b99b062d0335ce0 # v5.0.0
        with: { pattern: reports-*, path: reports, merge-multiple: true }
      - uses: ux-nl/sonar-action@<sha> # v1.1.0
      - uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4.6.2
        if: always()
        with: { name: sonar-reports, path: reports/ }
```

The trailing `upload-artifact` step is Sonar's fallback: if the upload to Sonar fails, Sonar's GitHub App downloads the `sonar-reports` artifact when the workflow completes.

## The `detect` action

`ux-nl/sonar-action/detect` inspects a checkout without running any package manager and exposes outputs `php`, `laravel`, `wordpress`, `node`, `static`, `pint`, `phpstan`, `rector`, `pest`, `phpunit`, `eslint`, `vitest`, `jest`, `knip` (`true`/`false`), `package-manager` (`npm`, `pnpm`, `yarn`), `php-version`, `node-version` and `kind` (`app`, `package`, `site`, `other`). It writes `reports/sonar-stack.json` with the detected stack and the declared runtime versions, which Sonar uses for EOL checks and to pick the score profile on a repository's first run. Inputs: `workspace` (default `${{ github.workspace }}`) and `reports-dir` (default `reports`).

The `php-version`/`node-version` outputs (also used as the reusable workflow's install versions) and the `runtimes.php`/`runtimes.node` fields written into `sonar-stack.json` answer different questions and can differ:

- **Install version** (`php-version`, `node-version` outputs): the lock's exact platform override when present, else the *highest* minor satisfying `require.php` capped at 8.4 for PHP (8.4 when `require.php` is undeclared), and the `.nvmrc` major, else the *highest* major satisfying `engines.node` capped at 22 for Node. CI runs on the newest version the project's constraints allow.
- **Declared runtime** (`sonar-stack.json`'s `runtimes.php`/`runtimes.node`): the *lowest* version satisfying the same `require.php`/`engines.node` constraints — the floor the project claims to still support. Sonar uses this for EOL checks, since a repository is only as safe as the oldest runtime it still allows.

## Inputs

| Input | Default | Description |
|---|---|---|
| `sonar-url` | `https://sonar.ux.nl` | Base URL of the Sonar instance; also the OIDC audience. Set it only when you run your own instance. |
| `reports-dir` | `reports` | Directory holding the report files, relative to the workspace. |
| `workspace` | `${{ github.workspace }}` | Path prefix recorded in the manifest so Sonar can make report paths repository-relative. |
| `fail-on-error` | `false` | When `true`, a failed upload or internal error fails the step. |

## Outputs

| Output | Description |
|---|---|
| `run-id` | Sonar run id when the upload was accepted, empty otherwise. |
| `manifest-path` | Absolute path of the written `health.json`. |
| `status` | `uploaded`, `skipped` or `failed`. |

## Detected report files

| File | Format | Tool |
|---|---|---|
| `clover.xml`, `coverage.xml` (Clover) | `clover` | test runner |
| `cobertura.xml`, `coverage.xml` (Cobertura) | `cobertura` | test runner |
| `lcov.info`, `*.lcov` | `lcov` | test runner |
| `junit.xml`, `*-junit.xml` | `junit` | test runner; `<tool>-junit.xml` names the tool |
| `*.sarif`, `*.sarif.json` | `sarif` | driver name from the file |
| `phpstan.json` | `phpstan-json` | phpstan |
| `type-coverage.json`, `pest-type-coverage.json` | `pest-type-coverage` | pest |
| `infection.json`, `infection-log.json` | `infection-json` | infection |
| `mutation.txt`, `pest-mutation.txt` | `pest-mutation-text` | pest |
| `rector.json` | `rector-json` | rector |
| `pint.xml`, `checkstyle.xml`, `*-checkstyle.xml` | `checkstyle` | pint / from filename |
| `composer-audit.json`, `composer-outdated.json` | `composer-audit`, `composer-outdated` | composer |
| `npm-audit.json`, `npm-outdated.json` | `npm-audit`, `npm-outdated` | npm |
| `deptrac.json` | `deptrac-json` | deptrac |
| `phpmetrics.json` | `phpmetrics-json` | phpmetrics |
| `phpinsights.json` | `phpinsights-json` | phpinsights |
| `cpd.xml`, `pmd-cpd.xml` | `pmd-cpd` | cpd |
| `knip.json` | `knip-json` | knip |
| `about.json`, `artisan-about.json` | `artisan-about` | artisan |
| `sbom.cdx.json`, `*.cdx.json` | `cyclonedx-json` | syft |
| `sonar-stack.json` | `sonar-stack` | sonar (written by the `detect` action) |
| `sonar-metrics.json` | `sonar-metrics` | sonar |

The test runner is `pest` when `composer.json` requires `pestphp/pest`, otherwise `phpunit` for PHP projects, `vitest` or `jest` for Node projects. Unknown files are listed in the step summary and ignored. A sidecar `<report>.exit` file containing an integer records the tool's exit code (`vendor/bin/phpstan analyse --error-format=json > reports/phpstan.json; echo $? > reports/phpstan.json.exit`).

## Derived metrics

The action writes `reports/sonar-metrics.json` with `phpstan.level` (from `phpstan.neon`, `phpstan.neon.dist` or `phpstan.dist.neon`, `max` = 10) and `phpstan.baseline_count` (sum of `count:` entries in `phpstan-baseline.neon`). Keys already present in an existing `sonar-metrics.json` win, so a workflow can add or override any metric Sonar's registry knows.

## Development

```bash
npm test
```

Plain JavaScript on the runner's Node 24, no dependencies, no build step. CI runs the unit tests and the action itself against a fake Sonar server (`test/fake-sonar-server.js`).
