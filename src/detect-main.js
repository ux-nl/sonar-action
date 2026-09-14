import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildStackReport, detectStack } from './stack.js';
import { annotate, setOutput, writeSummary } from './summary.js';

const FLAG_OUTPUTS = ['php', 'laravel', 'wordpress', 'node', 'static', 'pint', 'phpstan', 'rector', 'pest', 'phpunit', 'eslint', 'vitest', 'jest', 'knip'];

/**
 * Reads the detect action inputs GitHub exposes as INPUT_* environment variables.
 * @param {NodeJS.ProcessEnv} env
 * @returns {{ workspace: string, reportsDir: string }}
 */
export function readDetectInputs(env = process.env) {
    const input = (name) => (env[`INPUT_${name.toUpperCase()}`] ?? '').trim();
    const workspace = input('workspace') || env.GITHUB_WORKSPACE || process.cwd();

    return {
        workspace,
        reportsDir: path.resolve(workspace, input('reports-dir') || 'reports'),
    };
}

/**
 * Detects the stack, writes every job output, writes <reports-dir>/sonar-stack.json
 * and appends a step summary. Never throws: like the rest of sonar-action, this
 * is best-effort, so a failure writing the report file is reported as a warning
 * annotation instead and every output is still written.
 * @param {{ env?: NodeJS.ProcessEnv, log?: (line: string) => void }} options
 * @returns {{ result: import('./stack.js').StackResult, file: string }}
 */
export function runDetect({ env = process.env, log = console.log } = {}) {
    const inputs = readDetectInputs(env);
    const result = detectStack(inputs.workspace);

    for (const name of FLAG_OUTPUTS) {
        setOutput(name, String(result.flags[name]), env, log);
    }
    setOutput('package-manager', result.packageManagers.node ?? '', env, log);
    setOutput('php-version', result.phpVersion, env, log);
    setOutput('node-version', result.nodeVersion, env, log);
    setOutput('kind', result.kind, env, log);

    const file = path.join(inputs.reportsDir, 'sonar-stack.json');
    try {
        mkdirSync(inputs.reportsDir, { recursive: true });
        writeFileSync(file, `${JSON.stringify(buildStackReport(result), null, 2)}\n`);
    } catch (error) {
        annotate('warning', `sonar-action detect: could not write ${file}: ${error instanceof Error ? error.message : String(error)}`, log);
    }

    writeSummary(detectSummary(result), env, log);

    return { result, file };
}

/**
 * @param {import('./stack.js').StackResult} result
 * @returns {string}
 */
export function detectSummary(result) {
    const tools = Object.entries(result.flags)
        .filter(([name, on]) => on && !['php', 'laravel', 'wordpress', 'node', 'static'].includes(name))
        .map(([name]) => name);

    return [
        '## Sonar detect',
        '',
        `Stack: ${result.stack.length > 0 ? result.stack.join(', ') : 'none detected'} (kind: ${result.kind})`,
        `Tools: ${tools.length > 0 ? tools.join(', ') : 'none'}`,
        `PHP ${result.phpVersion}, Node ${result.nodeVersion}${result.packageManagers.node ? ` (${result.packageManagers.node})` : ''}`,
    ].join('\n');
}

/**
 * Entry point used by detect/index.js: never lets an exception fail the job
 * silently; it is annotated and re-thrown so the step fails visibly.
 */
export function main() {
    try {
        runDetect();
    } catch (error) {
        annotate('error', `sonar-action detect: ${error instanceof Error ? error.message : String(error)}`, console.log);
        process.exitCode = 1;
    }
}
