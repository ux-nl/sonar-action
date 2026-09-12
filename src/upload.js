import { openAsBlob } from 'node:fs';
import path from 'node:path';

const MAX_ATTEMPTS = 2;

/**
 * POSTs health.json and the report files to Sonar as multipart/form-data.
 * Retries once after a network error or 5xx. Never throws.
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
        let response;

        try {
            // The body is rebuilt per attempt: a FormData with file streams cannot be re-sent.
            const form = new FormData();
            form.append('manifest', await openAsBlob(manifestPath, { type: 'application/json' }), 'health.json');
            for (const report of reports) {
                form.append('reports[]', await openAsBlob(path.join(reportsDir, report.report)), report.report);
            }

            response = await fetchImpl(`${sonarUrl}/api/ingest`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
                body: form,
                signal: AbortSignal.timeout(timeoutMs),
            });
        } catch (error) {
            if (attempt < MAX_ATTEMPTS) {
                await sleep(retryDelayMs);
                continue;
            }
            return { ok: false, status: 0, body: error instanceof Error ? error.message : String(error), runId: null };
        }

        const body = (await response.text()).slice(0, 500);

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
