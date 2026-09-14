# sonar-action

Collects the code-quality reports a GitHub Actions workflow already produced, writes a `health.json` manifest, and sends everything to [Sonar](https://github.com/ux-nl/sonar). The action never fails your workflow unless you ask it to.

The action does **not** run any tools. Your jobs run PHPStan, Pest, Pint and friends with their machine-readable output written into `reports/`, upload that directory as an artifact named `reports-<job>`, and a final `sonar` job merges the artifacts and runs this action.

## Usage

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
      - uses: ux-nl/sonar-action@90202b9a87508102da761e726f057558695451c0 # v1.0.0
      - uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4.6.2
        if: always()
        with: { name: sonar-reports, path: reports/ }
```

The trailing `upload-artifact` step is Sonar's fallback: if the upload to Sonar fails (for example while Sonar is down), Sonar's GitHub App downloads the `sonar-reports` artifact when the workflow completes. `health.json` is written before the upload, so the artifact always contains it.

Ready-made workflows: [`templates/minimal.yml`](templates/minimal.yml) adds only the `sonar` job; [`templates/quality.yml`](templates/quality.yml) is a complete Laravel quality workflow. The templates use `runs-on: self-hosted`; change it to `ubuntu-latest` if you do not run your own runners.

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
