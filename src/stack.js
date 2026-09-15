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

    // composer.lock always mirrors require.php's constraint verbatim under "platform"
    // (e.g. "^8.3"), whether or not anyone overrode anything; only trust it (or the
    // genuine "platform-overrides") when it is an exact version, not a range.
    const rawLockPlatform = composerLock?.['platform-overrides']?.php ?? composerLock?.platform?.php ?? null;
    const lockPhpPlatform = rawLockPlatform && isExactVersion(rawLockPlatform) ? rawLockPlatform : null;
    const installPhp = php ? (lockPhpPlatform ? majorMinorOf(lockPhpPlatform) : highestPhpMinor(phpConstraint)) : null;
    const installNode = node ? installNodeVersion(workspace, pkg) : null;

    return {
        flags,
        packageManagers: { php: php ? 'composer' : null, node: nodePackages.manager },
        phpVersion: installPhp ?? DEFAULT_PHP_VERSION,
        nodeVersion: installNode ?? DEFAULT_NODE_VERSION,
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
 * Highest `major.minor` that satisfies a composer PHP constraint, capped at
 * {@link DEFAULT_PHP_VERSION}. Unlike {@link lowestPhpMinor}, upper bounds
 * (`<`, `<=`) are honoured and alternatives (`||`) are evaluated independently.
 * Falls back to the cap when the constraint has no upper bound, is empty, or
 * is `*`; never returns lower than the constraint's own lower bound, even
 * when that lower bound is itself past the cap. A constraint that is unbounded
 * inside a major below the cap (`^7.4`) reports that lower bound (`7.4`).
 * @param {string} constraint
 * @returns {string}
 */
export function highestPhpMinor(constraint) {
    const version = highestSatisfying(constraint, versionOf(DEFAULT_PHP_VERSION));
    return `${version.major}.${version.minor}`;
}

/**
 * Highest major that satisfies a node engines constraint, capped at
 * {@link DEFAULT_NODE_VERSION}. See {@link highestPhpMinor} for the semantics.
 * @param {string} constraint
 * @returns {string}
 */
export function highestNodeMajor(constraint) {
    const version = highestSatisfying(constraint, versionOf(DEFAULT_NODE_VERSION));
    return String(version.major);
}

/**
 * @param {string} version e.g. '8.4' or '22'
 * @returns {{ major: number, minor: number }}
 */
function versionOf(version) {
    const [major, minor] = String(version).split('.');
    return { major: Number(major), minor: minor === undefined ? 0 : Number(minor) };
}

/** Sentinels for an open lower/upper bound; compared by reference. */
const NEG_INF = { major: -Infinity, minor: -Infinity };
const POS_INF = { major: Infinity, minor: Infinity };

/**
 * @param {{ major: number, minor: number }} a
 * @param {{ major: number, minor: number }} b
 * @returns {number} negative when a < b, positive when a > b
 */
function compareVer(a, b) {
    return a.major !== b.major ? a.major - b.major : a.minor - b.minor;
}

function maxVer(a, b) {
    return compareVer(a, b) >= 0 ? a : b;
}

function minVer(a, b) {
    return compareVer(a, b) <= 0 ? a : b;
}

/**
 * The major.minor immediately below `version`, borrowing from major when
 * minor is 0. `Infinity` minor stays `Infinity` (an unbounded major).
 * @param {{ major: number, minor: number }} version
 * @returns {{ major: number, minor: number }}
 */
function prevMinor({ major, minor }) {
    if (minor === Infinity) {
        return { major, minor: Infinity };
    }
    return minor > 0 ? { major, minor: minor - 1 } : { major: major - 1, minor: Infinity };
}

/**
 * Parses one bare version token (no `||`, at most one operator) into an
 * inclusive lower bound and an exclusive upper bound at major.minor
 * granularity. Returns null for tokens that cannot be parsed (e.g. `!=1.0`).
 * @param {string} token
 * @returns {{ lower: { major: number, minor: number }, upperExclusive: { major: number, minor: number } } | null}
 */
function parseToken(token) {
    const match = token.match(/^(<=|>=|<|>|\^|~|=)?v?(\d+)(?:\.(\d+|\*|x))?(?:\.(\d+|\*|x))?$/i);
    if (!match) {
        return null;
    }
    const [, op, majorStr, minorRaw, patchStr] = match;
    const major = Number(majorStr);
    const minorWildcard = minorRaw !== undefined && /^[*x]$/i.test(minorRaw);
    const minor = minorRaw === undefined || minorWildcard ? 0 : Number(minorRaw);
    const patchGiven = patchStr !== undefined && !/^[*x]$/i.test(patchStr);

    switch (op) {
        case '>=':
            return { lower: { major, minor }, upperExclusive: POS_INF };
        case '>':
            return { lower: { major, minor: minor + 1 }, upperExclusive: POS_INF };
        case '<=':
            return { lower: NEG_INF, upperExclusive: { major, minor: minor + 1 } };
        case '<':
            return { lower: NEG_INF, upperExclusive: { major, minor } };
        case '^':
            return { lower: { major, minor }, upperExclusive: { major: major + 1, minor: 0 } };
        case '~':
            // ~X.Y.Z restricts to the same minor; ~X or ~X.Y behaves like ^X.
            return minorRaw !== undefined && !minorWildcard && patchGiven
                ? { lower: { major, minor }, upperExclusive: { major, minor: minor + 1 } }
                : { lower: { major, minor }, upperExclusive: { major: major + 1, minor: 0 } };
        default:
            // exact pin, with or without a wildcard patch: a single minor.
            // A wildcard minor ("8.*", "8.x") is unbounded within the major, like ^X.
            return minorWildcard
                ? { lower: { major, minor: 0 }, upperExclusive: { major: major + 1, minor: 0 } }
                : { lower: { major, minor }, upperExclusive: { major, minor: minor + 1 } };
    }
}

/**
 * Highest major.minor satisfying a composer/npm-style constraint, capped at
 * `cap`. Alternatives (`||`) are evaluated independently and the best one
 * wins; space/comma-separated tokens within one alternative are intersected
 * (composer's AND). Constraints with no parseable token (`*`, empty) resolve
 * to `cap`. The winning alternative's lower bound travels with its candidate
 * so an unbounded minor can fall back to it instead of to `.0`.
 * @param {string} constraint
 * @param {{ major: number, minor: number }} cap
 * @returns {{ major: number, minor: number }}
 */
function highestSatisfying(constraint, cap) {
    const alternatives = String(constraint).split(/\s*\|\|\s*/).map((alt) => alt.trim()).filter(Boolean);

    let best = null;
    for (const alt of alternatives) {
        let lower = NEG_INF;
        let upperExclusive = POS_INF;
        let any = false;

        for (const token of alt.split(/\s*,\s*|\s+/).filter(Boolean)) {
            const range = parseToken(token);
            if (!range) {
                continue;
            }
            any = true;
            lower = maxVer(lower, range.lower);
            upperExclusive = minVer(upperExclusive, range.upperExclusive);
        }
        if (!any) {
            continue;
        }

        const upperInclusive = upperExclusive === POS_INF ? POS_INF : prevMinor(upperExclusive);
        let candidate = minVer(upperInclusive, cap);
        if (compareVer(lower, candidate) > 0) {
            candidate = lower;
        }
        if (best === null || compareVer(candidate, best.candidate) > 0) {
            best = { candidate, lower };
        }
    }

    if (best === null) {
        return cap;
    }
    if (best.candidate.minor !== Infinity) {
        return best.candidate;
    }
    // An unbounded minor within a major (e.g. `^7.4` while the cap is 8.4) has no
    // real highest minor to report: every minor of that major satisfies the
    // constraint. Report the alternative's own lower bound rather than dropping
    // to `.0`, which would resolve `^7.4` to an excluded 7.0.
    const { major } = best.candidate;
    const onSameMajor = best.lower.major === major && Number.isFinite(best.lower.minor);
    return { major, minor: onSameMajor ? best.lower.minor : 0 };
}

/**
 * @param {string} version e.g. '8.3.12'
 * @returns {string} 'major.minor', e.g. '8.3'
 */
function majorMinorOf(version) {
    const match = String(version).match(/^(\d+)\.(\d+)/);
    return match ? `${match[1]}.${match[2]}` : String(version);
}

/**
 * True for a plain `major`, `major.minor` or `major.minor.patch` version
 * (e.g. `8.3.12`); false for a range/constraint (`^8.3`, `>=8.1`, `8.3.*`, …).
 * @param {string} value
 * @returns {boolean}
 */
function isExactVersion(value) {
    return /^\d+(\.\d+){0,2}$/.test(String(value).trim());
}

/**
 * Node version to install: `.nvmrc` major when present, else the highest
 * major satisfying `engines.node` capped at {@link DEFAULT_NODE_VERSION},
 * else {@link DEFAULT_NODE_VERSION}.
 * @param {string} workspace
 * @param {any} pkg
 * @returns {string}
 */
function installNodeVersion(workspace, pkg) {
    const nvmrc = path.join(workspace, '.nvmrc');
    if (existsSync(nvmrc)) {
        const match = readFileSync(nvmrc, 'utf8').trim().match(/^v?(\d+)/);
        if (match) {
            return match[1];
        }
    }
    return typeof pkg?.engines?.node === 'string' ? highestNodeMajor(pkg.engines.node) : DEFAULT_NODE_VERSION;
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

    // lockfileVersion 1 has no `packages` map (only a nested `dependencies` tree),
    // so fall through to package.json rather than reporting no packages at all.
    const npm = readJson(path.join(workspace, 'package-lock.json'));
    if (npm?.packages) {
        return { manager: 'npm', has: (name) => `node_modules/${name}` in npm.packages };
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
