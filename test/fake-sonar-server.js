// Minimal stand-in for Sonar's ingest endpoint: accepts any multipart POST to
// /api/ingest with a bearer token and answers 202. Used by the CI self-test.
import { createServer } from 'node:http';

const port = Number(process.env.PORT ?? 8787);

createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const size = Buffer.concat(chunks).length;

    if (req.method !== 'POST' || req.url !== '/api/ingest') {
        res.writeHead(404, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ message: 'Not Found' }));
    }
    if (!(req.headers.authorization ?? '').startsWith('Bearer ')) {
        res.writeHead(401, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ message: 'Missing token' }));
    }

    console.log(`fake-sonar: accepted ${size} bytes`);
    res.writeHead(202, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ run_id: 1, reports: 4 }));
}).listen(port, '127.0.0.1', () => console.log(`fake-sonar listening on ${port}`));
