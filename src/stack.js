import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { readJson } from './fs-utils.js';

export const DEFAULT_PHP_VERSION = '8.4';
export const DEFAULT_NODE_VERSION = '22';

const WORDPRESS_CORE = ['roots/wordpress', 'johnpbloch/wordpress-core', 'wordpress/core'];
const PHPSTAN_CONFIGS = ['phpstan.neon', 'phpstan.neon.dist', 'phpstan.dist.neon'];
const KNIP_CONFIGS = ['knip.json', 'knip.jsonc'];
const STATIC_ENTRIES = ['index.html', 'public/index.html', 'dist/index.html'];
const STACK_ORDER = ['php', 'laravel', 'wordpress', 'node', 'static'];

/**
 * @typedef {{ php: boolean, laravel: boolean, wordpress: boolean, node: boolean, static: boolean, pint: boolean, phpstan: boolean, rector: boolean, pest: boolean, phpunit: boolean, eslint: boolean, vitest: boolean, jest: boolean, knip: boolean }} StackFlags
 * @typedef {{ php: string|null, laravel: string|null, node: string|null, wordpress: string|null }} DeclaredRuntimes
 * @typedef {{ flags: StackFlags, packageManagers: { php: 'composer'|null, node: 'npm'|'pnpm'|'yarn'|null }, phpVersion: string, nodeVersion: string, kind: 'app'|'package'|'site'|'other', runtimes: DeclaredRuntimes, stack: string[] }} StackResult
 */

/**
 * Classifies a checkout from its files only; never runs a package manager.
 * @param {string} workspace absolute path of the checkout
 * @returns {StackResult}
 */
export function detectStack(workspace) {
    const composer = readJson(path.join(workspace, 'composer.json'));
    const composerLock = readJson(path.join(workspace, 'composer.lock'));
    const pkg = readJson(path.join(workspace, 'package.json'));

    const phpPackages = composerPackages(composer, composerLock);
    const nodePackages = nodePackageIndex(workspace, pkg);

    const php = composer !== null;
    const node = pkg !== null;
    const laravel = php && (phpPackages.has('laravel/framework') || existsSync(path.join(workspace, 'artisan')));
    const wordpress = WORDPRESS_CORE.some((name) => phpPackages.has(name))
        || existsSync(path.join(workspace, 'wp-config.php'))
        || hasThemeHeader(path.join(workspace, 'style.css'));
    const isStatic = !php && !node && STATIC_ENTRIES.some((file) => existsSync(path.join(workspace, file)));

    const flags = {
        php,
        laravel,
        wordpress,
        node,
        static: isStatic,
        pint: phpPackages.has('laravel/pint'),
        phpstan: phpPackages.has('phpstan/phpstan') && existsAny(workspace, PHPSTAN_CONFIGS),
        rector: phpPackages.has('rector/rector'),
        pest: phpPackages.has('pestphp/pest'),
        phpunit: phpPackages.has('phpunit/phpunit'),
        eslint: nodePackages.has('eslint'),
        vitest: nodePackages.has('vitest'),
        jest: nodePackages.has('jest'),
        knip: nodePackages.has('knip') && existsAny(workspace, KNIP_CONFIGS),
    };

    const phpConstraint = typeof composer?.require?.php === 'string' ? composer.require.php : '';
    const declaredPhp = php ? lowestPhpMinor(phpConstraint) : null;
    const declaredNode = node ? declaredNodeVersion(workspace, pkg) : null;
    const wordpressCore = WORDPRESS_CORE.find((name) => phpPackages.get(name));

    const runtimes = {
        php: declaredPhp,
        laravel: phpPackages.get('laravel/framework') ?? null,
        node: declaredNode,
        wordpress: wordpressCore ? phpPackages.get(wordpressCore) : null,
    };

    return {
        flags,
        packageManagers: { php: php ? 'composer' : null, node: nodePackages.manager },
        phpVersion: declaredPhp ?? DEFAULT_PHP_VERSION,
        nodeVersion: declaredNode ?? DEFAULT_NODE_VERSION,
        kind: resolveKind(composer, pkg, flags),
        runtimes,
        stack: STACK_ORDER.filter((name) => flags[name]),
    };
}

/**
 * The sonar-stack.json document (schema 1) that Sonar's `sonar-stack` parser reads.
 * @param {StackResult} result
 * @returns {{ schema: 1, stack: string[], kind: string, runtimes: DeclaredRuntimes, package_managers: string[] }}
 */
export function buildStackReport(result) {
    return {
        schema: 1,
        stack: result.stack,
        kind: result.kind,
        runtimes: result.runtimes,
        package_managers: [result.packageManagers.php, result.packageManagers.node].filter((m) => m !== null),
    };
}

/**
 * Lowest `major.minor` that satisfies a composer PHP constraint, or null when
 * the constraint has no lower bound (`*`, empty). Upper bounds (`<`, `<=`, `!=`)
 * are ignored; alternatives (`||`) contribute their own lower bound.
 * @param {string} constraint
 * @returns {string|null}
 */
export function lowestPhpMinor(constraint) {
    const bounds = lowerBounds(constraint);
    if (bounds.length === 0) {
        return null;
    }
    bounds.sort((a, b) => a.major - b.major || a.minor - b.minor);
    return `${bounds[0].major}.${bounds[0].minor}`;
}

/**
 * Lowest major that satisfies a node engines constraint, or null.
 * @param {string} constraint
 * @returns {string|null}
 */
export function lowestNodeMajor(constraint) {
    const bounds = lowerBounds(constraint);
    if (bounds.length === 0) {
        return null;
    }
    bounds.sort((a, b) => a.major - b.major);
    return String(bounds[0].major);
}

/**
 * @param {string} constraint
 * @returns {Array<{ major: number, minor: number }>}
 */
function lowerBounds(constraint) {
    const bounds = [];
    for (const token of String(constraint).split(/\s*\|\|?\s*|\s*,\s*|\s+/)) {
        const match = token.match(/^(\^|~|>=|=|v)?(\d+)(?:\.(\d+))?(?:\.(?:\d+|\*|x))?$/i);
        if (!match) {
            continue;
        }
        bounds.push({ major: Number(match[2]), minor: match[3] === undefined ? 0 : Number(match[3]) });
    }
    return bounds;
}

/**
 * Package name → version (without a leading "v") from composer.lock; falls back
 * to the names in composer.json (version null) when no lock is committed.
 * @param {any} composer
 * @param {any} lock
 * @returns {Map<string, string|null>}
 */
function composerPackages(composer, lock) {
    const packages = new Map();
    if (lock) {
        for (const pkg of [...(lock.packages ?? []), ...(lock['packages-dev'] ?? [])]) {
            if (pkg?.name) {
                packages.set(pkg.name, pkg.version ? String(pkg.version).replace(/^v/, '') : null);
            }
        }
        return packages;
    }
    for (const name of Object.keys({ ...(composer?.require ?? {}), ...(composer?.['require-dev'] ?? {}) })) {
        packages.set(name, null);
    }
    return packages;
}

/**
 * Node package presence by lockfile, falling back to package.json.
 * @param {string} workspace
 * @param {any} pkg parsed package.json or null
 * @returns {{ manager: 'npm'|'pnpm'|'yarn'|null, has: (name: string) => boolean }}
 */
function nodePackageIndex(workspace, pkg) {
    if (pkg === null) {
        return { manager: null, has: () => false };
    }

    const pnpm = path.join(workspace, 'pnpm-lock.yaml');
    if (existsSync(pnpm)) {
        const text = readFileSync(pnpm, 'utf8');
        return { manager: 'pnpm', has: (name) => new RegExp(`^\\s+/?${escapeRegExp(name)}[@:]`, 'm').test(text) };
    }

    const yarn = path.join(workspace, 'yarn.lock');
    if (existsSync(yarn)) {
        const text = readFileSync(yarn, 'utf8');
        return { manager: 'yarn', has: (name) => new RegExp(`^"?${escapeRegExp(name)}@`, 'm').test(text) };
    }

    const npm = readJson(path.join(workspace, 'package-lock.json'));
    if (npm) {
        return { manager: 'npm', has: (name) => `node_modules/${name}` in (npm.packages ?? {}) };
    }

    const declared = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    return { manager: 'npm', has: (name) => name in declared };
}

/**
 * @param {string} workspace
 * @param {any} pkg
 * @returns {string|null} major version from .nvmrc, then engines.node
 */
function declaredNodeVersion(workspace, pkg) {
    const nvmrc = path.join(workspace, '.nvmrc');
    if (existsSync(nvmrc)) {
        const match = readFileSync(nvmrc, 'utf8').trim().match(/^v?(\d+)/);
        if (match) {
            return match[1];
        }
    }
    return typeof pkg?.engines?.node === 'string' ? lowestNodeMajor(pkg.engines.node) : null;
}

/**
 * @param {any} composer
 * @param {any} pkg
 * @param {StackFlags} flags
 * @returns {'app'|'package'|'site'|'other'}
 */
function resolveKind(composer, pkg, flags) {
    if (composer?.type === 'library') {
        return 'package';
    }
    if (pkg && pkg.private !== true && (pkg.main !== undefined || pkg.exports !== undefined)) {
        return 'package';
    }
    if (flags.static || (flags.wordpress && !flags.laravel)) {
        return 'site';
    }
    if (flags.laravel || flags.node) {
        return 'app';
    }
    return 'other';
}

function hasThemeHeader(file) {
    if (!existsSync(file)) {
        return false;
    }
    return /^\s*\*?\s*Theme Name:/m.test(readFileSync(file, 'utf8').slice(0, 4096));
}

function existsAny(workspace, files) {
    return files.some((file) => existsSync(path.join(workspace, file)));
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}
