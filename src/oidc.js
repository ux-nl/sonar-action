/**
 * Fetches a GitHub Actions OIDC token whose `aud` is the Sonar URL.
 * @param {string} audience
 * @param {NodeJS.ProcessEnv} env
 * @param {typeof fetch} fetchImpl
 * @returns {Promise<string>}
 */
export async function fetchOidcToken(audience, env = process.env, fetchImpl = fetch) {
    const url = env.ACTIONS_ID_TOKEN_REQUEST_URL;
    const requestToken = env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;

    if (!url || !requestToken) {
        throw new Error('OIDC token request variables are missing. Add `permissions: id-token: write` to the job that runs sonar-action.');
    }

    const response = await fetchImpl(`${url}&audience=${encodeURIComponent(audience)}`, {
        headers: { Authorization: `bearer ${requestToken}`, Accept: 'application/json; api-version=2.0' },
        signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
        throw new Error(`OIDC token request failed with HTTP ${response.status}.`);
    }

    const body = await response.json().catch(() => ({}));
    if (typeof body.value !== 'string' || body.value === '') {
        throw new Error('OIDC token response had no value.');
    }

    return body.value;
}
