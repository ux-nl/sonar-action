import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildStackReport, detectStack, highestNodeMajor, highestPhpMinor, lowestNodeMajor, lowestPhpMinor } from '../src/stack.js';
import { cleanupWorkspaces, tmpWorkspace } from './helpers.js';

after(cleanupWorkspaces);

const composerLock = (packages, dev = []) => JSON.stringify({
    packages: packages.map(([name, version]) => ({ name, version })),
    'packages-dev': dev.map(([name, version]) => ({ name, version })),
});

const LARAVEL = {
    'composer.json': JSON.stringify({ type: 'project', require: { php: '^8.2', 'laravel/framework': '^12.0' }, 'require-dev': { 'pestphp/pest': '^4.0', 'phpstan/phpstan': '^2.0', 'laravel/pint': '^1.0', 'rector/rector': '^2.0' } }),
    'composer.lock': composerLock([['laravel/framework', 'v12.10.0']], [['pestphp/pest', 'v4.1.0'], ['phpstan/phpstan', '2.1.0'], ['laravel/pint', 'v1.20.0'], ['rector/rector', '2.0.0']]),
    'phpstan.neon': 'parameters:\n    level: 8\n',
    'artisan': '#!/usr/bin/env php\n',
    'package.json': JSON.stringify({ private: true, devDependencies: { vite: '^6.0.0' } }),
    'package-lock.json': JSON.stringify({ packages: { '': {}, 'node_modules/vite': { version: '6.0.0' } } }),
    '.nvmrc': 'v22.11.0\n',
};

test('laravel app: php, laravel and node with every php tool', () => {
    const result = detectStack(tmpWorkspace(LARAVEL));

    assert.deepEqual(result.flags, {
        php: true, laravel: true, wordpress: false, node: true, static: false,
        pint: true, phpstan: true, rector: true, pest: true, phpunit: false,
        eslint: false, vitest: false, jest: false, knip: false,
    });
    assert.deepEqual(result.packageManagers, { php: 'composer', node: 'npm' });
    assert.equal(result.phpVersion, '8.4');
    assert.equal(result.nodeVersion, '22');
    assert.equal(result.kind, 'app');
    assert.deepEqual(result.runtimes, { php: '8.2', laravel: '12.10.0', node: '22', wordpress: null });
    assert.deepEqual(result.stack, ['php', 'laravel', 'node']);
});

test('phpstan flag needs a config file as well as the package', () => {
    const files = { ...LARAVEL };
    delete files['phpstan.neon'];

    assert.equal(detectStack(tmpWorkspace(files)).flags.phpstan, false);
    assert.equal(detectStack(tmpWorkspace({ ...files, 'phpstan.dist.neon': 'parameters: {}\n' })).flags.phpstan, true);
});

test('php library without a lock file: flags from composer.json, kind package, phpunit', () => {
    const result = detectStack(tmpWorkspace({
        'composer.json': JSON.stringify({ type: 'library', require: { php: '>=8.1 <8.4' }, 'require-dev': { 'phpunit/phpunit': '^11.0', 'laravel/pint': '^1.0' } }),
    }));

    assert.equal(result.flags.php, true);
    assert.equal(result.flags.phpunit, true);
    assert.equal(result.flags.pest, false);
    assert.equal(result.flags.pint, true);
    assert.equal(result.flags.laravel, false);
    assert.equal(result.phpVersion, '8.3');
    assert.equal(result.kind, 'package');
    assert.deepEqual(result.runtimes, { php: '8.1', laravel: null, node: null, wordpress: null });
    assert.deepEqual(result.stack, ['php']);
});

test('bedrock wordpress: php and wordpress, kind site, core version from the lock', () => {
    const result = detectStack(tmpWorkspace({
        'composer.json': JSON.stringify({ type: 'project', require: { php: '8.3.*', 'roots/wordpress': '6.7.1' } }),
        'composer.lock': composerLock([['roots/wordpress', '6.7.1'], ['wpackagist-plugin/akismet', '5.3']]),
    }));

    assert.equal(result.flags.php, true);
    assert.equal(result.flags.wordpress, true);
    assert.equal(result.flags.laravel, false);
    assert.equal(result.kind, 'site');
    assert.equal(result.phpVersion, '8.3');
    assert.equal(result.runtimes.wordpress, '6.7.1');
    assert.deepEqual(result.stack, ['php', 'wordpress']);
});

test('classic theme: style.css header marks wordpress without php tooling', () => {
    const result = detectStack(tmpWorkspace({
        'style.css': '/*\nTheme Name: Rosendaelsche\nAuthor: ux\n*/\nbody {}\n',
        'functions.php': '<?php\n',
    }));

    assert.equal(result.flags.php, false);
    assert.equal(result.flags.wordpress, true);
    assert.equal(result.kind, 'site');
    assert.equal(result.phpVersion, '8.4');
    assert.deepEqual(result.stack, ['wordpress']);
});

test('vue app with pnpm: node flags from pnpm-lock.yaml, kind app', () => {
    const result = detectStack(tmpWorkspace({
        'package.json': JSON.stringify({ private: true, engines: { node: '>=20' }, devDependencies: { vitest: '^3.0.0', eslint: '^9.0.0', knip: '^5.0.0' } }),
        'pnpm-lock.yaml': [
            "lockfileVersion: '9.0'",
            'importers:',
            '  .:',
            '    devDependencies:',
            '      eslint:',
            '        specifier: ^9.0.0',
            '        version: 9.10.0',
            'packages:',
            '  eslint@9.10.0:',
            '    resolution: {integrity: sha512-x}',
            '  vitest@3.0.5:',
            '    resolution: {integrity: sha512-y}',
            '  knip@5.30.0:',
            '    resolution: {integrity: sha512-z}',
            '',
        ].join('\n'),
        'knip.json': '{}',
    }));

    assert.equal(result.flags.node, true);
    assert.equal(result.flags.php, false);
    assert.equal(result.flags.vitest, true);
    assert.equal(result.flags.eslint, true);
    assert.equal(result.flags.knip, true);
    assert.equal(result.flags.jest, false);
    assert.deepEqual(result.packageManagers, { php: null, node: 'pnpm' });
    assert.equal(result.nodeVersion, '22');
    assert.equal(result.kind, 'app');
    assert.deepEqual(result.runtimes, { php: null, laravel: null, node: '20', wordpress: null });
    assert.deepEqual(result.stack, ['node']);
});

test('yarn lock: package presence by "name@" lines, knip needs its config', () => {
    const result = detectStack(tmpWorkspace({
        'package.json': JSON.stringify({ private: true, devDependencies: { jest: '^29.0.0', knip: '^5.0.0' } }),
        'yarn.lock': [
            '# yarn lockfile v1',
            '',
            'jest@^29.0.0:',
            '  version "29.7.0"',
            '',
            '"knip@npm:^5.0.0":',
            '  version: 5.30.0',
            '',
        ].join('\n'),
    }));

    assert.equal(result.flags.jest, true);
    assert.equal(result.flags.knip, false);
    assert.equal(result.flags.eslint, false);
    assert.equal(result.packageManagers.node, 'yarn');
    assert.equal(result.nodeVersion, '22');
});

test('node package: not private with exports is kind package', () => {
    const result = detectStack(tmpWorkspace({
        'package.json': JSON.stringify({ name: 'tailwindcss-debug-containers', exports: './index.js', devDependencies: {} }),
    }));

    assert.equal(result.kind, 'package');
});

test('static site: index.html under public without php or node', () => {
    const result = detectStack(tmpWorkspace({ 'public/index.html': '<!doctype html>', 'README.md': '' }));

    assert.equal(result.flags.static, true);
    assert.equal(result.kind, 'site');
    assert.deepEqual(result.packageManagers, { php: null, node: null });
    assert.deepEqual(result.stack, ['static']);
});

test('empty repository is kind other with defaults', () => {
    const result = detectStack(tmpWorkspace({ 'README.md': '# hi' }));

    assert.equal(result.kind, 'other');
    assert.equal(result.flags.static, false);
    assert.equal(result.phpVersion, '8.4');
    assert.equal(result.nodeVersion, '22');
    assert.deepEqual(result.stack, []);
});

test('lowestPhpMinor picks the lowest lower bound and ignores upper bounds', () => {
    assert.equal(lowestPhpMinor('^8.2'), '8.2');
    assert.equal(lowestPhpMinor('>=8.1 <8.4'), '8.1');
    assert.equal(lowestPhpMinor('8.3.*'), '8.3');
    assert.equal(lowestPhpMinor('~8.2.0'), '8.2');
    assert.equal(lowestPhpMinor('^7.4 || ^8.0'), '7.4');
    assert.equal(lowestPhpMinor('^8'), '8.0');
    assert.equal(lowestPhpMinor('8.*'), '8.0');
    assert.equal(lowestPhpMinor('8.x'), '8.0');
    assert.equal(lowestPhpMinor('*'), null);
    assert.equal(lowestPhpMinor(''), null);
});

test('lowestNodeMajor picks the lowest lower bound major', () => {
    assert.equal(lowestNodeMajor('>=18'), '18');
    assert.equal(lowestNodeMajor('^20.10.0'), '20');
    assert.equal(lowestNodeMajor('18 || 20'), '18');
    assert.equal(lowestNodeMajor('>=18 <23'), '18');
    assert.equal(lowestNodeMajor('20.*'), '20');
    assert.equal(lowestNodeMajor('*'), null);
});

test('highestPhpMinor picks the highest satisfying minor, capped at the default', () => {
    assert.equal(highestPhpMinor('^8.2'), '8.4');
    assert.equal(highestPhpMinor('>=8.1 <8.4'), '8.3');
    assert.equal(highestPhpMinor('8.3.*'), '8.3');
    assert.equal(highestPhpMinor('~8.2.0'), '8.2');
    assert.equal(highestPhpMinor('*'), '8.4');
    assert.equal(highestPhpMinor(''), '8.4');
    // A bare "major.*"/"major.x" has an unbounded minor, like "^major", not a pin at ".0".
    assert.equal(highestPhpMinor('8.*'), '8.4');
    assert.equal(highestPhpMinor('8.x'), '8.4');
});

test('highestNodeMajor picks the highest satisfying major, capped at the default', () => {
    assert.equal(highestNodeMajor('>=18'), '22');
    assert.equal(highestNodeMajor('^20.10.0'), '20');
    assert.equal(highestNodeMajor('18 || 20'), '20');
    assert.equal(highestNodeMajor('>=18 <23'), '22');
    assert.equal(highestNodeMajor('*'), '22');
    assert.equal(highestNodeMajor('20.*'), '20');
    assert.equal(highestNodeMajor('20.x'), '20');
});

test('php-version output is the highest allowed minor; the declared runtime keeps the floor', () => {
    const result = detectStack(tmpWorkspace({
        'composer.json': JSON.stringify({ require: { php: '^8.2' } }),
    }));

    assert.equal(result.phpVersion, '8.4');
    assert.equal(result.runtimes.php, '8.2');
});

test('composer.lock platform override wins for the install version, not the declared runtime', () => {
    const result = detectStack(tmpWorkspace({
        'composer.json': JSON.stringify({ require: { php: '^8.2' } }),
        'composer.lock': JSON.stringify({ packages: [], 'packages-dev': [], platform: { php: '8.3.12' } }),
    }));

    assert.equal(result.phpVersion, '8.3');
    assert.equal(result.runtimes.php, '8.2');
});

test('composer.lock "platform" mirroring require.php (not an override) is ignored', () => {
    // Every composer.lock carries a "platform" object that mirrors require.php's
    // constraint verbatim, whether or not anyone actually overrode anything; only
    // an exact version there (or under "platform-overrides") counts as an override.
    const result = detectStack(tmpWorkspace({
        'composer.json': JSON.stringify({ require: { php: '^8.3' } }),
        'composer.lock': JSON.stringify({ packages: [], 'packages-dev': [], platform: { php: '^8.3' } }),
    }));

    assert.equal(result.phpVersion, '8.4');
    assert.equal(result.runtimes.php, '8.3');
});

test('buildStackReport produces the schema 1 document', () => {
    const report = buildStackReport(detectStack(tmpWorkspace(LARAVEL)));

    assert.deepEqual(report, {
        schema: 1,
        stack: ['php', 'laravel', 'node'],
        kind: 'app',
        runtimes: { php: '8.2', laravel: '12.10.0', node: '22', wordpress: null },
        package_managers: ['composer', 'npm'],
    });
});
