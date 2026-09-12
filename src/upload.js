import { openAsBlob } from 'node:fs';
import path from 'node:path';

const MAX_ATTEMPTS = 2;

/**
 * Builds the multipart/form-data body from the manifest and report files.
 * A FormData with file-stream parts cannot be re-sent, so this is called once per attempt.
 * @param {string} manifestPath
 * @param {string} reportsDir
 * @param {Array<{ report: string }>} reports
 * @returns {Promise<FormData>}
 */
async function buildForm(manifestPath, reportsDir, reports) {
    const form = new FormData();
    form.append('manifest', await openAsBlob(manifestPath, { type: 'application/json' }), 'health.json');
    for (const report of reports) {
        form.append('reports[]', await openAsBlob(path.join(reportsDir, report.report)), report.report);
    }
    return form;
}

/**
 * POSTs health.json and the report files to Sonar as multipart/form-data.
 * Retries once after a network error, a failure reading the response body, or a 5xx.
 * A local error building the request body (e.g. a missing report file) is not
 * retried, since retrying cannot fix it. Never throws.
 * @param {{ sonarUrl: string, token: string, reportsDir: string, manifestPath: string, reports: Array<{ report: string }>, fetchImpl?: typeof fetch, sleep?: (ms: number) => Promise<void>, retryDelayMs?: number, timeoutMs?: number }} options
 * @returns {Promise<{ ok: boolean, status: number, body: string, runId: number|null }>}
 */
export async function uploadReports({
    sonarUrl,
    token,
    reportsDir,
    manifestPath,
    reports,
    fetchImpl = fetch,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    retryDelayMs = 10_000,
    timeoutMs = 120_000,
}) {
    for (let attempt = 1; ; attempt++) {
        let form;
        try {
            form = await buildForm(manifestPath, reportsDir, reports);
        } catch (error) {
            return { ok: false, status: 0, body: error instanceof Error ? error.message : String(error), runId: null };
        }

        let response;
        let body;

        try {
            response = await fetchImpl(`${sonarUrl}/api/ingest`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
                body: form,
                signal: AbortSignal.timeout(timeoutMs),
            });
            body = (await response.text()).slice(0, 500);
        } catch (error) {
            if (attempt < MAX_ATTEMPTS) {
                await sleep(retryDelayMs);
                continue;
            }
            return { ok: false, status: response ? response.status : 0, body: error instanceof Error ? error.message : String(error), runId: null };
        }

        if (response.status >= 500 && attempt < MAX_ATTEMPTS) {
            await sleep(retryDelayMs);
            continue;
        }

        let runId = null;
        try {
            const parsed = JSON.parse(body);
            runId = Number.isInteger(parsed.run_id) ? parsed.run_id : null;
        } catch {
            runId = null;
        }

        return { ok: response.status === 202, status: response.status, body, runId };
    }
}
