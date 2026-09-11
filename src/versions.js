import path from 'node:path';
import { readJson } from './fs-utils.js';

/** Tool name → candidate package names, checked in order. */
const PACKAGES = {
    phpstan: ['phpstan/phpstan'],
    pest: ['pestphp/pest'],
    phpunit: ['phpunit/phpunit'],
    pint: ['laravel/pint'],
    rector: ['rector/rector'],
    infection: ['infection/infection'],
    deptrac: ['deptrac/deptrac', 'qossmic/deptrac'],
    phpmetrics: ['phpmetrics/phpmetrics'],
    phpinsights: ['nunomaduro/phpinsights'],
    knip: ['knip'],
    eslint: ['eslint'],
    biome: ['@biomejs/biome'],
    vitest: ['vitest'],
    jest: ['jest'],
};

/**
 * Reads installed package versions from composer.lock and package-lock.json.
 * @param {string} workspace
 * @returns {Map<string, string>} package name → version without a leading "v"
 */
export function loadVersions(workspace) {
    const versions = new Map();

    const composer = readJson(path.join(workspace, 'composer.lock'));
    for (const pkg of [...(composer?.packages ?? []), ...(composer?.['packages-dev'] ?? [])]) {
        if (pkg?.name && pkg?.version) {
            versions.set(pkg.name, String(pkg.version).replace(/^v/, ''));
        }
    }

    const npm = readJson(path.join(workspace, 'package-lock.json'));
    for (const [key, pkg] of Object.entries(npm?.packages ?? {})) {
        if (key.startsWith('node_modules/') && pkg?.version) {
            versions.set(key.slice('node_modules/'.length), String(pkg.version));
        }
    }

    return versions;
}

/**
 * @param {string} tool
 * @param {Map<string, string>} versions
 * @returns {string|null}
 */
export function versionFor(tool, versions) {
    for (const name of PACKAGES[tool] ?? []) {
        if (versions.has(name)) {
            return versions.get(name);
        }
    }
    return null;
}
