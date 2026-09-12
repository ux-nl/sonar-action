import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import path from 'node:path';
import { uploadReports } from '../src/upload.js';
import { cleanupWorkspaces, tmpWorkspace } from './helpers.js';

after(cleanupWorkspaces);

/** Starts a server whose handler receives a web Request and returns a Response. */
async function withServer(handler, fn) {
    const server = createServer(async (req, res) => {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const request = new Request(`http://localhost${req.url}`, { method: req.method, headers: req.headers, body: Buffer.concat(chunks) });
        const response = await handler(request);
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(Buffer.from(await response.arrayBuffer()));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
        await fn(`http://127.0.0.1:${server.address().port}`);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
}

const reports = [{ name: 'phpstan', report: 'phpstan.json', format: 'phpstan-json' }, { name: 'pest', report: 'clover.xml', format: 'clover' }];

function workspace() {
    const dir = tmpWorkspace({ 'reports/health.json': '{"schema":1}', 'reports/phpstan.json': '{"totals":{}}', 'reports/clover.xml': '<coverage/>' });
    return { reportsDir: path.join(dir, 'reports'), manifestPath: path.join(dir, 'reports/health.json') };
}

test('posts the manifest and every report as multipart with the bearer token', async () => {
    let seen;
    await withServer(async (request) => {
        const form = await request.formData();
        seen = {
            url: new URL(request.url).pathname,
            auth: request.headers.get('authorization'),
            manifest: await form.get('manifest').text(),
            manifestName: form.get('manifest').name,
            reports: form.getAll('reports[]').map((f) => f.name),
        };
        return Response.json({ run_id: 77, reports: 2 }, { status: 202 });
    }, async (sonarUrl) => {
        const result = await uploadReports({ sonarUrl, token: 'jwt', reports, ...workspace() });

        assert.deepEqual(result, { ok: true, status: 202, body: '{"run_id":77,"reports":2}', runId: 77 });
    });

    assert.equal(seen.url, '/api/ingest');
    assert.equal(seen.auth, 'Bearer jwt');
    assert.equal(seen.manifest, '{"schema":1}');
    assert.equal(seen.manifestName, 'health.json');
    assert.deepEqual(seen.reports, ['phpstan.json', 'clover.xml']);
});

test('retries once after a 5xx and then reports the final failure with the body', async () => {
    let attempts = 0;
    const slept = [];
    await withServer(async () => {
        attempts++;
        return new Response(JSON.stringify({ message: 'down' }), { status: 503 });
    }, async (sonarUrl) => {
        const result = await uploadReports({ sonarUrl, token: 'jwt', reports, ...workspace(), sleep: async (ms) => { slept.push(ms); } });

        assert.equal(result.ok, false);
        assert.equal(result.status, 503);
        assert.equal(result.body, '{"message":"down"}');
        assert.equal(result.runId, null);
    });

    assert.equal(attempts, 2);
    assert.deepEqual(slept, [10_000]);
});

test('does not retry a 4xx', async () => {
    let attempts = 0;
    await withServer(async () => {
        attempts++;
        return Response.json({ message: 'Manifest repository does not match the OIDC token.' }, { status: 422 });
    }, async (sonarUrl) => {
        const result = await uploadReports({ sonarUrl, token: 'jwt', reports, ...workspace(), sleep: async () => {} });

        assert.equal(result.status, 422);
        assert.match(result.body, /does not match/);
    });
    assert.equal(attempts, 1);
});

test('a network error is retried once and then reported with status 0', async () => {
    let attempts = 0;
    const fetchImpl = async () => {
        attempts++;
        throw new TypeError('fetch failed');
    };

    const result = await uploadReports({ sonarUrl: 'http://127.0.0.1:9', token: 'jwt', reports, ...workspace(), fetchImpl, sleep: async () => {} });

    assert.deepEqual(result, { ok: false, status: 0, body: 'fetch failed', runId: null });
    assert.equal(attempts, 2);
});

test('a missing report file fails immediately without a retry', async () => {
    let fetchCalls = 0;
    const fetchImpl = async () => {
        fetchCalls++;
        throw new Error('should not be called');
    };
    let sleptCount = 0;
    const sleep = async () => {
        sleptCount++;
    };

    const missingReports = [{ name: 'phpstan', report: 'missing.json', format: 'phpstan-json' }];
    const result = await uploadReports({ sonarUrl: 'http://127.0.0.1:9', token: 'jwt', reports: missingReports, ...workspace(), fetchImpl, sleep });

    assert.equal(result.ok, false);
    assert.equal(result.status, 0);
    assert.match(result.body, /ENOENT|no such file|unable to open/i);
    assert.equal(fetchCalls, 0);
    assert.equal(sleptCount, 0);
});

test('a body read failure is retried once and then reported', async () => {
    let attempts = 0;
    const slept = [];
    const fetchImpl = async () => {
        attempts++;
        return { status: 202, text: async () => { throw new Error('read failed'); } };
    };

    const result = await uploadReports({ sonarUrl: 'http://127.0.0.1:9', token: 'jwt', reports, ...workspace(), fetchImpl, sleep: async (ms) => { slept.push(ms); } });

    assert.equal(attempts, 2);
    assert.deepEqual(slept, [10_000]);
    assert.equal(result.ok, false);
    assert.equal(result.body, 'read failed');
});
