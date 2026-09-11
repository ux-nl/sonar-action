import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadVersions, versionFor } from '../src/versions.js';
import { tmpWorkspace } from './helpers.js';

test('loadVersions reads composer.lock (both sections) and package-lock.json', () => {
    const versions = loadVersions(tmpWorkspace({
        'composer.lock': JSON.stringify({ packages: [{ name: 'laravel/framework', version: 'v13.1.0' }], 'packages-dev': [{ name: 'phpstan/phpstan', version: '2.1.17' }, { name: 'pestphp/pest', version: 'v4.1.0' }] }),
        'package-lock.json': JSON.stringify({ packages: { '': { name: 'app' }, 'node_modules/knip': { version: '5.50.0' }, 'node_modules/eslint': { version: '9.30.0' } } }),
    }));

    assert.equal(versionFor('phpstan', versions), '2.1.17');
    assert.equal(versionFor('pest', versions), '4.1.0');
    assert.equal(versionFor('knip', versions), '5.50.0');
    assert.equal(versionFor('eslint', versions), '9.30.0');
    assert.equal(versionFor('rector', versions), null);
    assert.equal(versionFor('unknown-tool', versions), null);
});

test('loadVersions tolerates missing lock files', () => {
    assert.equal(versionFor('phpstan', loadVersions(tmpWorkspace({}))), null);
});

test('deptrac resolves either package name', () => {
    const versions = loadVersions(tmpWorkspace({ 'composer.lock': JSON.stringify({ packages: [], 'packages-dev': [{ name: 'qossmic/deptrac', version: '1.0.2' }] }) }));
    assert.equal(versionFor('deptrac', versions), '1.0.2');
});
