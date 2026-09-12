import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readJson, peek } from '../src/fs-utils.js';
import { cleanupWorkspaces, tmpWorkspace } from './helpers.js';

after(cleanupWorkspaces);

test('readJson returns the parsed object for valid JSON', () => {
    const dir = tmpWorkspace({ 'report.json': '{"ok":true,"count":3}' });

    assert.deepEqual(readJson(path.join(dir, 'report.json')), { ok: true, count: 3 });
});

test('readJson returns null for a missing file', () => {
    const dir = tmpWorkspace();

    assert.equal(readJson(path.join(dir, 'missing.json')), null);
});

test('readJson returns null for malformed JSON', () => {
    const dir = tmpWorkspace({ 'broken.json': '{not valid json' });

    assert.equal(readJson(path.join(dir, 'broken.json')), null);
});

test('peek returns only the first N bytes of a larger file', () => {
    const dir = tmpWorkspace({ 'large.txt': 'a'.repeat(10 * 1024) });

    assert.equal(peek(path.join(dir, 'large.txt'), 16), 'a'.repeat(16));
});

test('peek returns the whole content of a file shorter than N', () => {
    const dir = tmpWorkspace({ 'small.txt': 'hello' });

    assert.equal(peek(path.join(dir, 'small.txt'), 4096), 'hello');
});

test('peek throws ENOENT for a missing file', () => {
    const dir = tmpWorkspace();

    assert.throws(() => peek(path.join(dir, 'missing.txt')), { code: 'ENOENT' });
});
