import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readContext, readInputs } from '../src/inputs.js';

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

test('readInputs treats an unset sonar-url as empty', () => {
    assert.equal(readInputs({ GITHUB_WORKSPACE: '/gh/ws' }).sonarUrl, '');
});

test('readContext uses the head ref on pull requests and the ref name otherwise', () => {
    const base = { GITHUB_REPOSITORY: 'ux-nl/sonar', GITHUB_SHA: 'abc', GITHUB_RUN_ID: '123', GITHUB_REF_NAME: 'main' };

    assert.deepEqual(readContext({ ...base, GITHUB_EVENT_NAME: 'push' }), { repository: 'ux-nl/sonar', sha: 'abc', branch: 'main', workflowRunId: 123 });
    assert.equal(readContext({ ...base, GITHUB_EVENT_NAME: 'pull_request', GITHUB_HEAD_REF: 'feature/x', GITHUB_REF_NAME: '42/merge' }).branch, 'feature/x');
    assert.equal(readContext({ ...base, GITHUB_RUN_ID: undefined }).workflowRunId, null);
});
