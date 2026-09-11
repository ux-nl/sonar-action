import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchOidcToken } from '../src/oidc.js';

const env = { ACTIONS_ID_TOKEN_REQUEST_URL: 'https://token.example/req?api-version=2', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'req-token' };

test('requests a token for the audience with the runtime bearer token', async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({ value: 'jwt-value' }), { status: 200 });
    };

    assert.equal(await fetchOidcToken('https://sonar.example.com', env, fetchImpl), 'jwt-value');
    assert.equal(calls[0].url, 'https://token.example/req?api-version=2&audience=https%3A%2F%2Fsonar.example.com');
    assert.equal(calls[0].init.headers.Authorization, 'bearer req-token');
});

test('explains the missing permission when the runtime variables are absent', async () => {
    await assert.rejects(() => fetchOidcToken('https://sonar.example.com', {}, async () => new Response('')), /id-token: write/);
});

test('rejects on a non-2xx response and on a response without a value', async () => {
    await assert.rejects(() => fetchOidcToken('a', env, async () => new Response('nope', { status: 403 })), /HTTP 403/);
    await assert.rejects(() => fetchOidcToken('a', env, async () => new Response('{}', { status: 200 })), /no value/);
});
