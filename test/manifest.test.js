import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { buildManifest, writeManifest } from '../src/manifest.js';
import { cleanupWorkspaces, tmpWorkspace } from './helpers.js';

after(cleanupWorkspaces);

const context = { repository: 'ux-nl/sonar', sha: 'abc123', branch: 'main', workflowRunId: 42 };

test('buildManifest produces the schema 1 shape the server validates', () => {
    const manifest = buildManifest({
        context,
        reports: [{ name: 'phpstan', report: 'phpstan.json', format: 'phpstan-json', exit_code: 1, version: '2.1.17' }, { name: 'pest', report: 'clover.xml', format: 'clover', exit_code: null }],
        workspace: '/home/runner/work/sonar/sonar',
        actionVersion: '1.0.0',
    });

    assert.deepEqual(manifest, {
        schema: 1,
        repository: 'ux-nl/sonar',
        sha: 'abc123',
        branch: 'main',
        workflow_run_id: 42,
        action_version: '1.0.0',
        workspace: '/home/runner/work/sonar/sonar/',
        tools: [
            { name: 'phpstan', version: '2.1.17', exit_code: 1, report: 'phpstan.json', format: 'phpstan-json' },
            { name: 'pest', version: null, exit_code: null, report: 'clover.xml', format: 'clover' },
        ],
    });
});

test('writeManifest writes health.json into the reports dir and returns its path', () => {
    const dir = tmpWorkspace({ 'reports/.keep': '' });
    const manifest = buildManifest({ context, reports: [], workspace: '/w/', actionVersion: '1.0.0' });

    const file = writeManifest(path.join(dir, 'reports'), manifest);

    assert.equal(file, path.join(dir, 'reports', 'health.json'));
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), manifest);
});
