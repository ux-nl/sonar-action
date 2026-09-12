import { test } from 'node:test';
import assert from 'node:assert/strict';
import { annotate, setOutput, writeSummary } from '../src/summary.js';

test('setOutput never throws when GITHUB_OUTPUT cannot be written, and warns instead', () => {
    const logs = [];

    assert.doesNotThrow(() => setOutput('status', 'x', { GITHUB_OUTPUT: '/nonexistent-dir/out' }, (l) => logs.push(l)));
    assert.ok(logs.some((l) => l.startsWith('::warning::') && l.includes('GITHUB_OUTPUT')));
});

test('writeSummary never throws when GITHUB_STEP_SUMMARY cannot be written, and warns instead', () => {
    const logs = [];

    assert.doesNotThrow(() => writeSummary('# hi', { GITHUB_STEP_SUMMARY: '/nonexistent-dir/summary' }, (l) => logs.push(l)));
    assert.ok(logs.some((l) => l.startsWith('::warning::') && l.includes('GITHUB_STEP_SUMMARY')));
});

test('annotate escapes %, \\r and \\n', () => {
    const logs = [];

    annotate('warning', 'a%b\rc\nd', (l) => logs.push(l));

    assert.equal(logs[0], '::warning::a%25b%0Dc%0Ad');
});
