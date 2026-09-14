import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readContext, readInputs } from '../src/inputs.js';
import { cleanupWorkspaces, tmpWorkspace } from './helpers.js';

after(cleanupWorkspaces);

test('readInputs resolves the reports dir against the workspace and strips trailing slashes from the url', () => {
    const inputs = readInputs({
        'INPUT_SONAR-URL': 'https://sonar.example.com/',
        'INPUT_REPORTS-DIR': 'build/reports',
        'INPUT_WORKSPACE': '/work/repo',
        'INPUT_FAIL-ON-ERROR': 'true',
    });

    assert.deepEqual(inputs, {
        sonarUrl: 'https://sonar.example.com',
        reportsDir: path.resolve('/work/repo', 'build/reports'),
        workspace: '/work/repo',
        failOnError: true,
    });
});

test('readInputs falls back to GITHUB_WORKSPACE, reports/ and fail-on-error false', () => {
    const inputs = readInputs({ 'INPUT_SONAR-URL': 'https://sonar.example.com', GITHUB_WORKSPACE: '/gh/ws' });

    assert.equal(inputs.workspace, '/gh/ws');
    assert.equal(inputs.reportsDir, '/gh/ws/reports');
    assert.equal(inputs.failOnError, false);
});

test('readInputs defaults sonar-url to https://sonar.ux.nl when unset or empty', () => {
    assert.equal(readInputs({ GITHUB_WORKSPACE: '/gh/ws' }).sonarUrl, 'https://sonar.ux.nl');
    assert.equal(readInputs({ 'INPUT_SONAR-URL': '  ', GITHUB_WORKSPACE: '/gh/ws' }).sonarUrl, 'https://sonar.ux.nl');
});

test('readContext uses the head ref on pull requests and the ref name otherwise', () => {
    const base = { GITHUB_REPOSITORY: 'ux-nl/sonar', GITHUB_SHA: 'abc', GITHUB_RUN_ID: '123', GITHUB_REF_NAME: 'main' };

    assert.deepEqual(readContext({ ...base, GITHUB_EVENT_NAME: 'push' }), { repository: 'ux-nl/sonar', sha: 'abc', branch: 'main', workflowRunId: 123 });
    assert.equal(readContext({ ...base, GITHUB_EVENT_NAME: 'pull_request', GITHUB_HEAD_REF: 'feature/x', GITHUB_REF_NAME: '42/merge' }).branch, 'feature/x');
    assert.equal(readContext({ ...base, GITHUB_RUN_ID: undefined }).workflowRunId, null);
});

test('readContext prefers the pull request head sha over the ephemeral merge commit', () => {
    const dir = tmpWorkspace({ 'event.json': JSON.stringify({ pull_request: { head: { sha: 'headsha123' } } }) });
    const base = { GITHUB_REPOSITORY: 'ux-nl/sonar', GITHUB_SHA: 'mergecommitsha', GITHUB_RUN_ID: '123', GITHUB_REF_NAME: '42/merge', GITHUB_EVENT_PATH: path.join(dir, 'event.json') };

    assert.equal(readContext({ ...base, GITHUB_EVENT_NAME: 'pull_request' }).sha, 'headsha123');
});

test('readContext uses GITHUB_SHA on push even when the event file has a pull_request key', () => {
    const dir = tmpWorkspace({ 'event.json': JSON.stringify({ pull_request: { head: { sha: 'headsha123' } } }) });
    const base = { GITHUB_REPOSITORY: 'ux-nl/sonar', GITHUB_SHA: 'pushsha', GITHUB_RUN_ID: '123', GITHUB_REF_NAME: 'main', GITHUB_EVENT_PATH: path.join(dir, 'event.json') };

    assert.equal(readContext({ ...base, GITHUB_EVENT_NAME: 'push' }).sha, 'pushsha');
});

test('readContext falls back to GITHUB_SHA when GITHUB_EVENT_PATH points at a missing file', () => {
    const base = { GITHUB_REPOSITORY: 'ux-nl/sonar', GITHUB_SHA: 'fallbacksha', GITHUB_RUN_ID: '123', GITHUB_REF_NAME: '42/merge', GITHUB_EVENT_PATH: '/nonexistent/event.json' };

    assert.equal(readContext({ ...base, GITHUB_EVENT_NAME: 'pull_request' }).sha, 'fallbacksha');
});
