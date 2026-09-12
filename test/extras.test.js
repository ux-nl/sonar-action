import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { baselineCount, computeExtras, phpstanLevel, writeExtras } from '../src/extras.js';
import { cleanupWorkspaces, tmpWorkspace } from './helpers.js';

after(cleanupWorkspaces);

test('phpstanLevel reads numeric and max levels', () => {
    assert.equal(phpstanLevel('parameters:\n    level: 8\n    paths:\n        - app\n'), 8);
    assert.equal(phpstanLevel("parameters:\n  level: 'max'\n"), 10);
    assert.equal(phpstanLevel('parameters:\n    paths: [app]\n'), null);
});

test('baselineCount sums count entries and is zero for an empty baseline', () => {
    const neon = 'parameters:\n\tignoreErrors:\n\t\t-\n\t\t\tmessage: "#^Foo#"\n\t\t\tcount: 3\n\t\t\tpath: app/A.php\n\t\t-\n\t\t\tmessage: "#^Bar#"\n\t\t\tcount: 1\n\t\t\tpath: app/B.php\n';
    assert.equal(baselineCount(neon), 4);
    assert.equal(baselineCount('parameters:\n\tignoreErrors: []\n'), 0);
});

test('computeExtras reads phpstan.neon, then .dist, and the baseline when present', () => {
    assert.deepEqual(computeExtras(tmpWorkspace({ 'phpstan.neon': 'parameters:\n    level: 6\n', 'phpstan-baseline.neon': 'parameters:\n\tignoreErrors:\n\t\t-\n\t\t\tcount: 2\n' })), { 'phpstan.level': 6, 'phpstan.baseline_count': 2 });
    assert.deepEqual(computeExtras(tmpWorkspace({ 'phpstan.neon.dist': 'parameters:\n    level: max\n' })), { 'phpstan.level': 10 });
    assert.deepEqual(computeExtras(tmpWorkspace({})), {});
});

test('writeExtras merges into an existing sonar-metrics.json with existing keys winning', () => {
    const dir = tmpWorkspace({ 'reports/sonar-metrics.json': '{"phpstan.level": 9, "custom.metric": 1}' });

    assert.equal(writeExtras(path.join(dir, 'reports'), { 'phpstan.level': 6, 'phpstan.baseline_count': 2 }), true);
    assert.deepEqual(JSON.parse(readFileSync(path.join(dir, 'reports/sonar-metrics.json'), 'utf8')), { 'phpstan.level': 9, 'phpstan.baseline_count': 2, 'custom.metric': 1 });
});

test('writeExtras writes nothing when there are no extras and no existing file', () => {
    const dir = tmpWorkspace({ 'reports/.keep': '' });

    assert.equal(writeExtras(path.join(dir, 'reports'), {}), false);
    assert.equal(existsSync(path.join(dir, 'reports/sonar-metrics.json')), false);
});

test('writeExtras leaves an unparseable existing sonar-metrics.json untouched and warns', () => {
    const dir = tmpWorkspace({ 'reports/sonar-metrics.json': '{not json' });
    const logs = [];

    const wrote = writeExtras(path.join(dir, 'reports'), { 'phpstan.level': 6 }, (l) => logs.push(l));

    assert.equal(wrote, false);
    assert.equal(readFileSync(path.join(dir, 'reports/sonar-metrics.json'), 'utf8'), '{not json');
    assert.ok(logs.some((l) => l.startsWith('::warning::') && l.includes('not valid JSON')));
});
