import path from 'node:path';
import { readJson } from './fs-utils.js';

export const DEFAULT_SONAR_URL = 'https://sonar.ux.nl';

/**
 * Reads the action inputs GitHub exposes as INPUT_* environment variables.
 * @param {NodeJS.ProcessEnv} env
 * @returns {{ sonarUrl: string, reportsDir: string, workspace: string, failOnError: boolean }}
 */
export function readInputs(env = process.env) {
    const input = (name) => (env[`INPUT_${name.toUpperCase()}`] ?? '').trim();
    const workspace = input('workspace') || env.GITHUB_WORKSPACE || process.cwd();

    return {
        sonarUrl: (input('sonar-url') || DEFAULT_SONAR_URL).replace(/\/+$/, ''),
        reportsDir: path.resolve(workspace, input('reports-dir') || 'reports'),
        workspace,
        failOnError: /^(true|1|yes)$/i.test(input('fail-on-error')),
    };
}

/**
 * Reads the GitHub Actions context needed for the manifest.
 *
 * On `pull_request`/`pull_request_target` events, `GITHUB_SHA` is the
 * ephemeral merge commit, not a commit Sonar's server (or check runs) can
 * look up. The event payload's `pull_request.head.sha` is the actual PR head
 * commit, so it is preferred there, falling back to `GITHUB_SHA` when the
 * event file is missing or unparseable.
 * @param {NodeJS.ProcessEnv} env
 * @returns {{ repository: string, sha: string, branch: string, workflowRunId: number|null }}
 */
export function readContext(env = process.env) {
    const isPullRequest = env.GITHUB_EVENT_NAME === 'pull_request' || env.GITHUB_EVENT_NAME === 'pull_request_target';
    const runId = env.GITHUB_RUN_ID ? Number(env.GITHUB_RUN_ID) : NaN;

    let sha = env.GITHUB_SHA ?? '';
    if (isPullRequest && env.GITHUB_EVENT_PATH) {
        const headSha = readJson(env.GITHUB_EVENT_PATH)?.pull_request?.head?.sha;
        if (typeof headSha === 'string' && headSha !== '') {
            sha = headSha;
        }
    }

    return {
        repository: env.GITHUB_REPOSITORY ?? '',
        sha,
        branch: isPullRequest && env.GITHUB_HEAD_REF ? env.GITHUB_HEAD_REF : (env.GITHUB_REF_NAME ?? ''),
        workflowRunId: Number.isInteger(runId) ? runId : null,
    };
}
