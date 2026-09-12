import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { readJson } from './fs-utils.js';
import { annotate } from './summary.js';

const PHPSTAN_CONFIGS = ['phpstan.neon', 'phpstan.neon.dist', 'phpstan.dist.neon'];

/**
 * Metrics the action derives from repository config rather than a tool report.
 * @param {string} workspace
 * @returns {Record<string, number>}
 */
export function computeExtras(workspace) {
    const extras = {};

    const config = PHPSTAN_CONFIGS.map((f) => path.join(workspace, f)).find((f) => existsSync(f));
    if (config) {
        const level = phpstanLevel(readFileSync(config, 'utf8'));
        if (level !== null) {
            extras['phpstan.level'] = level;
        }
    }

    const baseline = path.join(workspace, 'phpstan-baseline.neon');
    if (existsSync(baseline)) {
        extras['phpstan.baseline_count'] = baselineCount(readFileSync(baseline, 'utf8'));
    }

    return extras;
}

/**
 * @param {string} neon contents of a phpstan.neon file
 * @returns {number|null}
 */
export function phpstanLevel(neon) {
    const match = neon.match(/^\s*level:\s*['"]?(\w+)['"]?\s*$/m);
    if (!match) {
        return null;
    }
    if (match[1] === 'max') {
        return 10;
    }
    const level = Number(match[1]);
    return Number.isInteger(level) ? level : null;
}

/**
 * @param {string} neon contents of phpstan-baseline.neon
 * @returns {number} sum of all `count:` entries
 */
export function baselineCount(neon) {
    let total = 0;
    for (const match of neon.matchAll(/^\s*count:\s*(\d+)\s*$/gm)) {
        total += Number(match[1]);
    }
    return total;
}

/**
 * Merges extras into reports/sonar-metrics.json. Keys already present in the
 * file win, so a workflow can override anything the action derives. When an
 * existing file cannot be parsed as JSON, it is left untouched (rather than
 * clobbered) so Sonar's server can report the parse error itself.
 * @param {string} reportsDir
 * @param {Record<string, number>} extras
 * @param {(line: string) => void} log
 * @returns {boolean} whether the file was written
 */
export function writeExtras(reportsDir, extras, log = console.log) {
    const file = path.join(reportsDir, 'sonar-metrics.json');
    const exists = existsSync(file);

    if (Object.keys(extras).length === 0 && !exists) {
        return false;
    }

    let existing = {};
    if (exists) {
        existing = readJson(file);
        if (existing === null) {
            annotate('warning', 'sonar-action: reports/sonar-metrics.json exists but is not valid JSON; leaving it untouched', log);
            return false;
        }
    }

    writeFileSync(file, `${JSON.stringify({ ...extras, ...existing }, null, 2)}\n`);

    return true;
}
