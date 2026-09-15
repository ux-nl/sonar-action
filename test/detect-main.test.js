import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { readDetectInputs, runDetect } from '../src/detect-main.js';
import { cleanupWorkspaces, tmpWorkspace } from './helpers.js';

after(cleanupWorkspaces);

function outputs(file) {
    return Object.fromEntries(readFileSync(file, 'utf8').trim().split('\n').map((line) => {
        const index = line.indexOf('=');
        return [line.slice(0, index), line.slice(index + 1)];
    }));
}

test('readDetectInputs resolves reports-dir against the workspace', () => {
    const inputs = readDetectInputs({ INPUT_WORKSPACE: '/ws', 'INPUT_REPORTS-DIR': 'out' });

    assert.deepEqual(inputs, { workspace: '/ws', reportsDir: '/ws/out' });
    assert.deepEqual(readDetectInputs({ GITHUB_WORKSPACE: '/gh' }), { workspace: '/gh', reportsDir: '/gh/reports' });
});

test('runDetect writes every output, the stack report and a summary', () => {
    const dir = tmpWorkspace({
        'composer.json': JSON.stringify({ type: 'project', require: { php: '^8.3', 'laravel/framework': '^12.0' }, 'require-dev': { 'pestphp/pest': '^4.0' } }),
        'artisan': '',
        GITHUB_OUTPUT: '',
        GITHUB_STEP_SUMMARY: '',
    });
    const logs = [];

    const { result, file } = runDetect({
        env: { INPUT_WORKSPACE: dir, 'INPUT_REPORTS-DIR': 'reports', GITHUB_OUTPUT: path.join(dir, 'GITHUB_OUTPUT'), GITHUB_STEP_SUMMARY: path.join(dir, 'GITHUB_STEP_SUMMARY') },
        log: (line) => logs.push(line),
    });

    const out = outputs(path.join(dir, 'GITHUB_OUTPUT'));
    assert.equal(out.php, 'true');
    assert.equal(out.laravel, 'true');
    assert.equal(out.wordpress, 'false');
    assert.equal(out.node, 'false');
    assert.equal(out.static, 'false');
    assert.equal(out.pest, 'true');
    assert.equal(out.phpunit, 'false');
    assert.equal(out.phpstan, 'false');
    assert.equal(out['package-manager'], '');
    assert.equal(out['php-version'], '8.4');
    assert.equal(out['node-version'], '22');
    assert.equal(out.kind, 'app');
    assert.equal(Object.keys(out).length, 18);

    assert.equal(file, path.join(dir, 'reports', 'sonar-stack.json'));
    assert.ok(existsSync(file));
    const report = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(report.schema, 1);
    assert.deepEqual(report.stack, ['php', 'laravel']);
    assert.equal(report.kind, 'app');
    assert.deepEqual(report.package_managers, ['composer']);
    assert.equal(result.kind, 'app');

    const summary = readFileSync(path.join(dir, 'GITHUB_STEP_SUMMARY'), 'utf8');
    assert.match(summary, /## Sonar detect/);
    assert.match(summary, /php, laravel/);
    assert.match(summary, /kind: app/);
    assert.deepEqual(logs, []);
});

test('runDetect on an empty checkout still writes the report with kind other', () => {
    const dir = tmpWorkspace({ 'README.md': '', GITHUB_OUTPUT: '' });

    const { file } = runDetect({ env: { INPUT_WORKSPACE: dir, GITHUB_OUTPUT: path.join(dir, 'GITHUB_OUTPUT') }, log: () => {} });

    assert.equal(JSON.parse(readFileSync(file, 'utf8')).kind, 'other');
    assert.equal(outputs(path.join(dir, 'GITHUB_OUTPUT')).kind, 'other');
});

test('runDetect never fails the step when the report file cannot be written', () => {
    const dir = tmpWorkspace({
        // A regular file at the reports-dir path prevents mkdirSync from creating it.
        reports: 'not a directory',
        GITHUB_OUTPUT: '',
    });
    const logs = [];

    const result = runDetect({
        env: { INPUT_WORKSPACE: dir, 'INPUT_REPORTS-DIR': 'reports', GITHUB_OUTPUT: path.join(dir, 'GITHUB_OUTPUT') },
        log: (line) => logs.push(line),
    });

    assert.ok(result);
    const out = outputs(path.join(dir, 'GITHUB_OUTPUT'));
    assert.equal(out.kind, 'other');
    assert.equal(out.php, 'false');
    assert.ok(logs.some((line) => line.startsWith('::warning::')));
});
