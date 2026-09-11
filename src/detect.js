import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { peek, readJson } from './fs-utils.js';

/** Placeholder resolved to the workspace's test runner (pest, phpunit, vitest, jest, tests). */
export const TEST_TOOL = Symbol('test-tool');

/**
 * Ordered detection rules: the first matching rule wins.
 * `tool` is a string, TEST_TOOL, or a function (fileName, filePath) => string.
 * @type {Array<{ match: (name: string, head: string) => boolean, format: string, tool: string|symbol|((name: string, file: string) => string), example: string }>}
 */
export const RULES = [
    { match: (n, head) => n === 'clover.xml' || (n === 'coverage.xml' && head.includes('<project')), format: 'clover', tool: TEST_TOOL, example: 'clover.xml' },
    { match: (n, head) => n === 'cobertura.xml' || (n === 'coverage.xml' && head.includes('line-rate')), format: 'cobertura', tool: TEST_TOOL, example: 'cobertura.xml' },
    { match: (n) => n === 'lcov.info' || n.endsWith('.lcov'), format: 'lcov', tool: TEST_TOOL, example: 'lcov.info' },
    { match: (n) => n === 'junit.xml' || n.endsWith('-junit.xml'), format: 'junit', tool: TEST_TOOL, example: 'junit.xml' },
    { match: (n) => n.endsWith('.sarif') || n.endsWith('.sarif.json'), format: 'sarif', tool: sarifTool, example: 'semgrep.sarif' },
    { match: (n) => n === 'phpstan.json', format: 'phpstan-json', tool: 'phpstan', example: 'phpstan.json' },
    { match: (n) => n === 'type-coverage.json' || n === 'pest-type-coverage.json', format: 'pest-type-coverage', tool: 'pest', example: 'type-coverage.json' },
    { match: (n) => n === 'infection.json' || n === 'infection-log.json', format: 'infection-json', tool: 'infection', example: 'infection.json' },
    { match: (n) => n === 'mutation.txt' || n === 'pest-mutation.txt', format: 'pest-mutation-text', tool: 'pest', example: 'mutation.txt' },
    { match: (n) => n === 'rector.json', format: 'rector-json', tool: 'rector', example: 'rector.json' },
    { match: (n) => n === 'pint.xml' || n === 'checkstyle.xml' || n.endsWith('-checkstyle.xml'), format: 'checkstyle', tool: checkstyleTool, example: 'pint.xml' },
    { match: (n) => n === 'composer-audit.json', format: 'composer-audit', tool: 'composer', example: 'composer-audit.json' },
    { match: (n) => n === 'composer-outdated.json', format: 'composer-outdated', tool: 'composer', example: 'composer-outdated.json' },
    { match: (n) => n === 'npm-audit.json', format: 'npm-audit', tool: 'npm', example: 'npm-audit.json' },
    { match: (n) => n === 'npm-outdated.json', format: 'npm-outdated', tool: 'npm', example: 'npm-outdated.json' },
    { match: (n) => n === 'deptrac.json', format: 'deptrac-json', tool: 'deptrac', example: 'deptrac.json' },
    { match: (n) => n === 'phpmetrics.json', format: 'phpmetrics-json', tool: 'phpmetrics', example: 'phpmetrics.json' },
    { match: (n) => n === 'phpinsights.json', format: 'phpinsights-json', tool: 'phpinsights', example: 'phpinsights.json' },
    { match: (n) => n === 'cpd.xml' || n === 'pmd-cpd.xml', format: 'pmd-cpd', tool: 'cpd', example: 'cpd.xml' },
    { match: (n) => n === 'knip.json', format: 'knip-json', tool: 'knip', example: 'knip.json' },
    { match: (n) => n === 'about.json' || n === 'artisan-about.json', format: 'artisan-about', tool: 'artisan', example: 'about.json' },
    { match: (n) => n === 'sonar-metrics.json', format: 'sonar-metrics', tool: 'sonar', example: 'sonar-metrics.json' },
];

const RESERVED = new Set(['health.json']);

/**
 * Scans the reports directory (one level, files only) and classifies each file.
 * @param {string} reportsDir
 * @param {{ testTool: string }} options
 * @returns {{ reports: Array<{ name: string, report: string, format: string, exit_code: number|null }>, unmatched: string[] }}
 */
export function detectReports(reportsDir, { testTool }) {
    if (!existsSync(reportsDir) || !statSync(reportsDir).isDirectory()) {
        return { reports: [], unmatched: [] };
    }

    const reports = [];
    const unmatched = [];

    for (const name of readdirSync(reportsDir).sort()) {
        const file = path.join(reportsDir, name);
        if (name.startsWith('.') || name.endsWith('.exit') || RESERVED.has(name) || !statSync(file).isFile()) {
            continue;
        }

        const head = peek(file);
        const rule = RULES.find((r) => r.match(name, head));
        if (!rule) {
            unmatched.push(name);
            continue;
        }

        reports.push({
            name: resolveTool(rule.tool, name, file, testTool),
            report: name,
            format: rule.format,
            exit_code: readExitCode(`${file}.exit`),
        });
    }

    return { reports, unmatched };
}

/**
 * Picks the test runner name used for coverage and JUnit reports.
 * @param {string} workspace
 * @returns {string}
 */
export function detectTestTool(workspace) {
    const composer = readJson(path.join(workspace, 'composer.json'));
    if (composer) {
        const deps = { ...(composer.require ?? {}), ...(composer['require-dev'] ?? {}) };
        return 'pestphp/pest' in deps ? 'pest' : 'phpunit';
    }

    const pkg = readJson(path.join(workspace, 'package.json'));
    if (pkg) {
        const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
        if ('vitest' in deps) {
            return 'vitest';
        }
        if ('jest' in deps) {
            return 'jest';
        }
    }

    return 'tests';
}

function resolveTool(tool, name, file, testTool) {
    if (tool === TEST_TOOL) {
        return testTool;
    }
    return typeof tool === 'function' ? tool(name, file) : tool;
}

function sarifTool(name, file) {
    const stem = name.replace(/\.sarif(\.json)?$/, '');
    try {
        const driver = JSON.parse(readFileSync(file, 'utf8'))?.runs?.[0]?.tool?.driver?.name;
        return typeof driver === 'string' && driver !== '' ? driver.toLowerCase() : stem;
    } catch {
        return stem;
    }
}

function checkstyleTool(name) {
    if (name === 'pint.xml') {
        return 'pint';
    }
    if (name === 'checkstyle.xml') {
        return 'checkstyle';
    }
    return name.replace(/-checkstyle\.xml$/, '');
}

function readExitCode(file) {
    if (!existsSync(file)) {
        return null;
    }
    const value = Number.parseInt(readFileSync(file, 'utf8').trim(), 10);
    return Number.isInteger(value) ? value : null;
}
