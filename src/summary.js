import { appendFileSync } from 'node:fs';

/**
 * @param {string} name
 * @param {string} value
 * @param {NodeJS.ProcessEnv} env
 */
export function setOutput(name, value, env = process.env) {
    if (env.GITHUB_OUTPUT) {
        appendFileSync(env.GITHUB_OUTPUT, `${name}=${value}\n`);
    }
}

/**
 * Emits a workflow command annotation.
 * @param {'warning'|'error'|'notice'} level
 * @param {string} message
 * @param {(line: string) => void} log
 */
export function annotate(level, message, log = console.log) {
    log(`::${level}::${message.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')}`);
}

/**
 * @param {string} markdown
 * @param {NodeJS.ProcessEnv} env
 */
export function writeSummary(markdown, env = process.env) {
    if (env.GITHUB_STEP_SUMMARY) {
        appendFileSync(env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
    }
}

/**
 * @param {{ status: string, runId: number|null, sonarUrl: string, reports: Array<{ name: string, report: string, format: string, version?: string|null, exit_code?: number|null }>, unmatched: string[], extras: Record<string, number>, error?: string }} result
 * @returns {string}
 */
export function summaryMarkdown({ status, runId, sonarUrl, reports, unmatched, extras, error }) {
    const lines = ['## Sonar', ''];

    if (status === 'uploaded') {
        lines.push(`Uploaded ${reports.length} report${reports.length === 1 ? '' : 's'} as [run ${runId}](${sonarUrl}/runs/${runId}).`);
    } else if (status === 'skipped') {
        lines.push(`Skipped: ${error ?? 'nothing to report'}.`);
    } else {
        lines.push(`Upload failed: ${error ?? 'unknown error'}.`);
    }

    if (reports.length > 0) {
        lines.push('', '| Tool | Report | Format | Version | Exit |', '|---|---|---|---|---|');
        for (const r of reports) {
            lines.push(`| ${r.name} | ${r.report} | ${r.format} | ${r.version ?? ''} | ${r.exit_code ?? ''} |`);
        }
    }

    if (Object.keys(extras).length > 0) {
        lines.push('', `Derived metrics: ${Object.entries(extras).map(([k, v]) => `${k} = ${v}`).join(', ')}`);
    }

    if (unmatched.length > 0) {
        lines.push('', `Ignored (unknown format): ${unmatched.join(', ')}`);
    }

    return lines.join('\n');
}
