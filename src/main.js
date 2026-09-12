import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { detectReports, detectTestTool } from './detect.js';
import { computeExtras, writeExtras } from './extras.js';
import { readContext, readInputs } from './inputs.js';
import { buildManifest, writeManifest } from './manifest.js';
import { fetchOidcToken } from './oidc.js';
import { annotate, setOutput, summaryMarkdown, writeSummary } from './summary.js';
import { uploadReports } from './upload.js';
import { loadVersions, versionFor } from './versions.js';

const ACTION_VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

/**
 * Runs the whole pipeline. Never throws: every failure becomes status "failed"
 * with an error annotation; "nothing to report" becomes status "skipped".
 * @param {{ env?: NodeJS.ProcessEnv, fetchImpl?: typeof fetch, log?: (line: string) => void }} options
 * @returns {Promise<{ status: 'uploaded'|'skipped'|'failed', runId: number|null, manifestPath: string, error?: string }>}
 */
export async function run({ env = process.env, fetchImpl = fetch, log = console.log } = {}) {
    const inputs = readInputs(env);
    const context = readContext(env);
    const result = { status: 'skipped', runId: null, manifestPath: '' };
    let reports = [];
    let unmatched = [];
    let extras = {};

    try {
        if (inputs.sonarUrl === '') {
            return skip(result, 'sonar-url is empty (is the SONAR_URL repository variable set?)', env, log);
        }

        if (!existsSync(inputs.reportsDir)) {
            return skip(result, `reports directory ${inputs.reportsDir} does not exist`, env, log);
        }

        extras = computeExtras(inputs.workspace);
        writeExtras(inputs.reportsDir, extras);

        ({ reports, unmatched } = detectReports(inputs.reportsDir, { testTool: detectTestTool(inputs.workspace) }));

        if (reports.length === 0) {
            return skip(result, `no recognised report files in ${inputs.reportsDir}`, env, log);
        }

        const versions = loadVersions(inputs.workspace);
        for (const report of reports) {
            report.version = versionFor(report.name, versions);
        }

        result.manifestPath = writeManifest(inputs.reportsDir, buildManifest({ context, reports, workspace: inputs.workspace, actionVersion: ACTION_VERSION }));

        const token = await fetchOidcToken(inputs.sonarUrl, env, fetchImpl);
        const upload = await uploadReports({ sonarUrl: inputs.sonarUrl, token, reportsDir: inputs.reportsDir, manifestPath: result.manifestPath, reports, fetchImpl });

        if (upload.ok) {
            result.status = 'uploaded';
            result.runId = upload.runId;
        } else {
            result.status = 'failed';
            result.error = `Upload failed with HTTP ${upload.status}: ${upload.body}`;
            annotate('error', `sonar-action: ${result.error}`, log);
        }
    } catch (error) {
        result.status = 'failed';
        result.error = error instanceof Error ? error.message : String(error);
        annotate('error', `sonar-action: ${result.error}`, log);
    }

    writeSummary(summaryMarkdown({ status: result.status, runId: result.runId, sonarUrl: inputs.sonarUrl, reports, unmatched, extras, error: result.error }), env);

    return finish(result, env);
}

function skip(result, reason, env, log) {
    result.status = 'skipped';
    result.error = reason;
    annotate('warning', `sonar-action: ${reason}; nothing to report.`, log);
    writeSummary(summaryMarkdown({ status: 'skipped', runId: null, sonarUrl: '', reports: [], unmatched: [], extras: {}, error: reason }), env);

    return finish(result, env);
}

function finish(result, env) {
    setOutput('status', result.status, env);
    setOutput('run-id', result.runId === null ? '' : String(result.runId), env);
    setOutput('manifest-path', result.manifestPath, env);

    return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const result = await run();

    if (result.status === 'failed' && readInputs().failOnError) {
        process.exitCode = 1;
    }
}
