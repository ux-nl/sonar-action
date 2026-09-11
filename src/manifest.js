import { writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Builds the health.json document (schema 1) that Sonar's ingest endpoint validates.
 * @param {{ context: { repository: string, sha: string, branch: string, workflowRunId: number|null }, reports: Array<{ name: string, report: string, format: string, exit_code?: number|null, version?: string|null }>, workspace: string, actionVersion: string }} input
 */
export function buildManifest({ context, reports, workspace, actionVersion }) {
    return {
        schema: 1,
        repository: context.repository,
        sha: context.sha,
        branch: context.branch,
        workflow_run_id: context.workflowRunId,
        action_version: actionVersion,
        workspace: workspace.endsWith('/') ? workspace : `${workspace}/`,
        tools: reports.map((report) => ({
            name: report.name,
            version: report.version ?? null,
            exit_code: report.exit_code ?? null,
            report: report.report,
            format: report.format,
        })),
    };
}

/**
 * @param {string} reportsDir
 * @param {object} manifest
 * @returns {string} absolute path of the written health.json
 */
export function writeManifest(reportsDir, manifest) {
    const file = path.join(reportsDir, 'health.json');
    writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
    return file;
}
