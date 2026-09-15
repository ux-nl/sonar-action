import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { detectReports, detectTestTool } from '../src/detect.js';
import { cleanupWorkspaces, tmpWorkspace } from './helpers.js';

after(cleanupWorkspaces);

const sarif = readFileSync(new URL('./fixtures/sarif/semgrep.sarif', import.meta.url), 'utf8');

function detect(files, testTool = 'pest') {
    const dir = tmpWorkspace(files);
    return { dir, ...detectReports(dir, { testTool }) };
}

const byReport = (reports, name) => reports.find((r) => r.report === name);

test('maps every known filename to its format and default tool', () => {
    const { reports, unmatched } = detect({
        'clover.xml': '<coverage><project/></coverage>',
        'junit.xml': '<testsuites/>',
        'lcov.info': 'TN:',
        'phpstan.json': '{}',
        'type-coverage.json': '{}',
        'infection.json': '{}',
        'mutation.txt': 'Mutations: 10',
        'rector.json': '{}',
        'pint.xml': '<checkstyle/>',
        'composer-audit.json': '{}',
        'composer-outdated.json': '{}',
        'npm-audit.json': '{}',
        'npm-outdated.json': '{}',
        'deptrac.json': '{}',
        'phpmetrics.json': '{}',
        'phpinsights.json': '{}',
        'cpd.xml': '<pmd-cpd/>',
        'knip.json': '{}',
        'about.json': '{}',
        'sonar-metrics.json': '{}',
        'sbom.cdx.json': '{"bomFormat":"CycloneDX"}',
        'sonar-stack.json': '{"schema":1}',
        'health.json': '{}',
        'phpstan.json.exit': '1',
        'notes.md': 'ignored',
    });

    const expected = {
        'clover.xml': ['clover', 'pest'],
        'junit.xml': ['junit', 'pest'],
        'lcov.info': ['lcov', 'pest'],
        'phpstan.json': ['phpstan-json', 'phpstan'],
        'type-coverage.json': ['pest-type-coverage', 'pest'],
        'infection.json': ['infection-json', 'infection'],
        'mutation.txt': ['pest-mutation-text', 'pest'],
        'rector.json': ['rector-json', 'rector'],
        'pint.xml': ['checkstyle', 'pint'],
        'composer-audit.json': ['composer-audit', 'composer'],
        'composer-outdated.json': ['composer-outdated', 'composer'],
        'npm-audit.json': ['npm-audit', 'npm'],
        'npm-outdated.json': ['npm-outdated', 'npm'],
        'deptrac.json': ['deptrac-json', 'deptrac'],
        'phpmetrics.json': ['phpmetrics-json', 'phpmetrics'],
        'phpinsights.json': ['phpinsights-json', 'phpinsights'],
        'cpd.xml': ['pmd-cpd', 'cpd'],
        'knip.json': ['knip-json', 'knip'],
        'about.json': ['artisan-about', 'artisan'],
        'sonar-metrics.json': ['sonar-metrics', 'sonar'],
        'sbom.cdx.json': ['cyclonedx-json', 'syft'],
        'sonar-stack.json': ['sonar-stack', 'sonar'],
    };

    assert.equal(reports.length, Object.keys(expected).length);
    for (const [file, [format, name]] of Object.entries(expected)) {
        const report = byReport(reports, file);
        assert.ok(report, `${file} detected`);
        assert.equal(report.format, format, `${file} format`);
        assert.equal(report.name, name, `${file} tool`);
    }
    assert.equal(byReport(reports, 'phpstan.json').exit_code, 1);
    assert.equal(byReport(reports, 'clover.xml').exit_code, null);
    assert.deepEqual(unmatched, ['notes.md']);
});

test('maps every alternate filename in the RULES table to its format', () => {
    const { reports } = detect({
        'foo.lcov': 'TN:',
        'phpunit-junit.xml': '<testsuites/>',
        'infection-log.json': '{}',
        'pest-type-coverage.json': '{}',
        'pest-mutation.txt': 'Mutations: 10',
        'artisan-about.json': '{}',
        'pmd-cpd.xml': '<pmd-cpd/>',
        'cobertura.xml': '<coverage line-rate="1"/>',
        'inventory.cdx.json': '{}',
        'vitest-lcov.info': 'TN:',
    });

    const expected = {
        'foo.lcov': ['lcov', 'pest'],
        'phpunit-junit.xml': ['junit', 'phpunit'],
        'infection-log.json': ['infection-json', 'infection'],
        'pest-type-coverage.json': ['pest-type-coverage', 'pest'],
        'pest-mutation.txt': ['pest-mutation-text', 'pest'],
        'artisan-about.json': ['artisan-about', 'artisan'],
        'pmd-cpd.xml': ['pmd-cpd', 'cpd'],
        'cobertura.xml': ['cobertura', 'pest'],
        'inventory.cdx.json': ['cyclonedx-json', 'syft'],
        'vitest-lcov.info': ['lcov', 'vitest'],
    };

    assert.equal(reports.length, Object.keys(expected).length);
    for (const [file, [format, name]] of Object.entries(expected)) {
        const report = byReport(reports, file);
        assert.ok(report, `${file} detected`);
        assert.equal(report.format, format, `${file} format`);
        assert.equal(report.name, name, `${file} tool`);
    }
});

test('disambiguates coverage.xml by content', () => {
    assert.equal(detect({ 'coverage.xml': '<?xml version="1.0"?><coverage generated="1"><project timestamp="1"/></coverage>' }).reports[0].format, 'clover');
    assert.equal(detect({ 'coverage.xml': '<?xml version="1.0"?><coverage line-rate="0.9" branch-rate="0.8"/>' }).reports[0].format, 'cobertura');
});

test('sarif files take the tool name from the driver, falling back to the file stem', () => {
    const { reports } = detect({ 'semgrep.sarif': sarif, 'gitleaks.sarif.json': '{"runs":[]}', 'weird.sarif': 'not json' });

    assert.equal(byReport(reports, 'semgrep.sarif').name, 'semgrep oss');
    assert.equal(byReport(reports, 'gitleaks.sarif.json').name, 'gitleaks');
    assert.equal(byReport(reports, 'weird.sarif').name, 'weird');
    assert.ok(reports.every((r) => r.format === 'sarif'));
});

test('checkstyle files derive the tool from the filename', () => {
    const { reports } = detect({ 'checkstyle.xml': '<checkstyle/>', 'phpcs-checkstyle.xml': '<checkstyle/>' });

    assert.equal(byReport(reports, 'checkstyle.xml').name, 'checkstyle');
    assert.equal(byReport(reports, 'phpcs-checkstyle.xml').name, 'phpcs');
});

test('uses the supplied test tool for coverage and junit files', () => {
    const { reports } = detect({ 'junit.xml': '<testsuites/>', 'cobertura.xml': '<coverage line-rate="1"/>' }, 'vitest');

    assert.ok(reports.every((r) => r.name === 'vitest'));
});

test('a <tool>-junit.xml report is attributed to that tool, junit.xml to the workspace test tool', () => {
    const { reports } = detect({ 'junit.xml': '<testsuites/>', 'vitest-junit.xml': '<testsuites/>', 'clover.xml': '<coverage><project/></coverage>' }, 'pest');

    assert.equal(byReport(reports, 'junit.xml').name, 'pest');
    assert.equal(byReport(reports, 'vitest-junit.xml').name, 'vitest');
    assert.equal(byReport(reports, 'clover.xml').name, 'pest');
});

test('a <tool>-lcov.info report is attributed to that tool, lcov.info to the workspace test tool', () => {
    const { reports } = detect({ 'lcov.info': 'TN:', 'jest-lcov.info': 'TN:', 'foo.lcov': 'TN:' }, 'pest');

    assert.equal(byReport(reports, 'lcov.info').name, 'pest');
    assert.equal(byReport(reports, 'jest-lcov.info').name, 'jest');
    assert.equal(byReport(reports, 'foo.lcov').name, 'pest');
    assert.ok(reports.every((r) => r.format === 'lcov'));
});

test('ignores directories, hidden files and an empty or missing directory', () => {
    const { dir, reports, unmatched } = detect({ 'nested/junit.xml': '<testsuites/>', '.hidden': 'x' });

    assert.deepEqual(reports, []);
    assert.deepEqual(unmatched, []);
    assert.deepEqual(detectReports(path.join(dir, 'missing'), { testTool: 'pest' }), { reports: [], unmatched: [] });
});

test('skips entries that cannot be stat\'ed, such as a dangling symlink', () => {
    const dir = tmpWorkspace({ 'clover.xml': '<coverage><project/></coverage>' });
    symlinkSync('/nonexistent', path.join(dir, 'broken.xml'));

    const { reports, unmatched } = detectReports(dir, { testTool: 'pest' });

    assert.deepEqual(reports.map((r) => r.report), ['clover.xml']);
    assert.deepEqual(unmatched, []);
});

test('detectTestTool prefers pest, then phpunit, then vitest or jest, then tests', () => {
    assert.equal(detectTestTool(tmpWorkspace({ 'composer.json': '{"require-dev":{"pestphp/pest":"^4.0"}}' })), 'pest');
    assert.equal(detectTestTool(tmpWorkspace({ 'composer.json': '{"require":{"laravel/framework":"^13.0"}}' })), 'phpunit');
    assert.equal(detectTestTool(tmpWorkspace({ 'package.json': '{"devDependencies":{"vitest":"^3"}}' })), 'vitest');
    assert.equal(detectTestTool(tmpWorkspace({ 'package.json': '{"devDependencies":{"jest":"^30"}}' })), 'jest');
    assert.equal(detectTestTool(tmpWorkspace({})), 'tests');
});
