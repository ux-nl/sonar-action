import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { run } from '../src/main.js';
import { tmpWorkspace } from './helpers.js';

const fixtures = new URL('./fixtures/', import.meta.url);

function workspaceWithFixtures() {
    const dir = tmpWorkspace({ 'GITHUB_OUTPUT': '', 'GITHUB_STEP_SUMMARY': '' });
    cpSync(new URL('workspace/', fixtures), dir, { recursive: true });
    cpSync(new URL('reports/', fixtures), path.join(dir, 'reports'), { recursive: true });
    return dir;
}

function envFor(dir, extra = {}) {
    return {
        'INPUT_SONAR-URL': 'https://sonar.example.com',
        'INPUT_REPORTS-DIR': 'reports',
        'INPUT_WORKSPACE': dir,
        GITHUB_REPOSITORY: 'ux-nl/sonar',
        GITHUB_SHA: 'abc123',
        GITHUB_REF_NAME: 'main',
        GITHUB_EVENT_NAME: 'push',
        GITHUB_RUN_ID: '4242',
        GITHUB_OUTPUT: path.join(dir, 'GITHUB_OUTPUT'),
        GITHUB_STEP_SUMMARY: path.join(dir, 'GITHUB_STEP_SUMMARY'),
        ACTIONS_ID_TOKEN_REQUEST_URL: 'https://token.example/req?v=2',
        ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'req',
        ...extra,
    };
}

/** fetch stub: answers the OIDC endpoint and records the ingest request. */
function fakeFetch(ingestResponse = () => Response.json({ run_id: 9, reports: 4 }, { status: 202 })) {
    const calls = [];
    const fetchImpl = async (url, init) => {
        calls.push({ url: String(url), init });
        if (String(url).startsWith('https://token.example/')) {
            return Response.json({ value: 'jwt' });
        }
        return ingestResponse(url, init);
    };
    return { fetchImpl, calls };
}

test('happy path: writes health.json with extras, uploads, sets outputs and a summary', async () => {
    const dir = workspaceWithFixtures();
    const { fetchImpl, calls } = fakeFetch();
    const logs = [];

    const result = await run({ env: envFor(dir), fetchImpl, log: (l) => logs.push(l) });

    assert.equal(result.status, 'uploaded');
    assert.equal(result.runId, 9);
    const manifest = JSON.parse(readFileSync(path.join(dir, 'reports/health.json'), 'utf8'));
    assert.equal(manifest.repository, 'ux-nl/sonar');
    assert.equal(manifest.workflow_run_id, 4242);
    assert.equal(manifest.workspace, `${dir}/`);
    assert.deepEqual(manifest.tools.map((t) => [t.name, t.format]).sort(), [['pest', 'clover'], ['pest', 'junit'], ['phpstan', 'phpstan-json'], ['pint', 'checkstyle'], ['sonar', 'sonar-metrics']].sort());
    assert.deepEqual(JSON.parse(readFileSync(path.join(dir, 'reports/sonar-metrics.json'), 'utf8')), { 'phpstan.level': 8 });
    assert.equal(calls.at(-1).url, 'https://sonar.example.com/api/ingest');
    const outputs = readFileSync(path.join(dir, 'GITHUB_OUTPUT'), 'utf8');
    assert.match(outputs, /^status=uploaded$/m);
    assert.match(outputs, /^run-id=9$/m);
    assert.match(outputs, new RegExp(`^manifest-path=${path.join(dir, 'reports/health.json')}$`, 'm'));
    assert.match(readFileSync(path.join(dir, 'GITHUB_STEP_SUMMARY'), 'utf8'), /run 9/);
    assert.match(readFileSync(path.join(dir, 'GITHUB_STEP_SUMMARY'), 'utf8'), /README\.txt/);
    assert.ok(logs.every((l) => !l.startsWith('::error::')));
});

test('an empty sonar-url skips with a warning and never touches the network', async () => {
    const dir = workspaceWithFixtures();
    const { fetchImpl, calls } = fakeFetch();
    const logs = [];

    const result = await run({ env: envFor(dir, { 'INPUT_SONAR-URL': '' }), fetchImpl, log: (l) => logs.push(l) });

    assert.equal(result.status, 'skipped');
    assert.equal(calls.length, 0);
    assert.ok(logs.some((l) => l.startsWith('::warning::') && l.includes('sonar-url')));
    assert.match(readFileSync(path.join(dir, 'GITHUB_OUTPUT'), 'utf8'), /^status=skipped$/m);
});

test('a missing reports directory or no recognised reports skips', async () => {
    const dir = tmpWorkspace({ 'GITHUB_OUTPUT': '', 'GITHUB_STEP_SUMMARY': '', 'reports/notes.md': 'x' });
    const { fetchImpl, calls } = fakeFetch();

    assert.equal((await run({ env: envFor(dir), fetchImpl, log: () => {} })).status, 'skipped');
    assert.equal((await run({ env: envFor(dir, { 'INPUT_REPORTS-DIR': 'nope' }), fetchImpl, log: () => {} })).status, 'skipped');
    assert.equal(calls.length, 0);
});

test('an upload failure is reported as failed with the server message and health.json still exists', async () => {
    const dir = workspaceWithFixtures();
    const { fetchImpl } = fakeFetch(() => Response.json({ message: 'Manifest repository does not match the OIDC token.' }, { status: 422 }));
    const logs = [];

    const result = await run({ env: envFor(dir), fetchImpl, log: (l) => logs.push(l) });

    assert.equal(result.status, 'failed');
    assert.match(result.error, /HTTP 422/);
    assert.match(result.error, /does not match/);
    assert.ok(existsSync(path.join(dir, 'reports/health.json')));
    assert.ok(logs.some((l) => l.startsWith('::error::')));
});

test('an OIDC failure is reported as failed with the permission hint', async () => {
    const dir = workspaceWithFixtures();
    const { fetchImpl } = fakeFetch();

    const result = await run({ env: envFor(dir, { ACTIONS_ID_TOKEN_REQUEST_URL: undefined, ACTIONS_ID_TOKEN_REQUEST_TOKEN: undefined }), fetchImpl, log: () => {} });

    assert.equal(result.status, 'failed');
    assert.match(result.error, /id-token: write/);
});

test('a GITHUB_OUTPUT that cannot be written does not fail the upload, only warns', async () => {
    const dir = workspaceWithFixtures();
    const { fetchImpl } = fakeFetch();
    const logs = [];

    const result = await run({ env: envFor(dir, { GITHUB_OUTPUT: '/nonexistent-dir/out' }), fetchImpl, log: (l) => logs.push(l) });

    assert.equal(result.status, 'uploaded');
    assert.ok(logs.some((l) => l.startsWith('::warning::') && l.includes('GITHUB_OUTPUT')));
});
