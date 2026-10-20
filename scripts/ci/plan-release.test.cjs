const { test } = require('node:test');
const assert = require('node:assert/strict');
const { planRelease } = require('./plan-release.cjs');

const sha = 'a'.repeat(40);
const input = {
  version: '0.1.2', repository: 'owner/repo', sha,
  token: 'test-token', apiUrl: 'https://api.github.com',
};

test('a new version builds; a tag on the same commit permits retries', async () => {
  const missing = await planRelease(input, async (url, options) => {
    assert.equal(url, 'https://api.github.com/repos/owner/repo/commits/v0.1.2');
    assert.equal(options.headers.Authorization, 'Bearer test-token');
    return { status: 404 };
  });
  assert.deepEqual(missing, { version: '0.1.2', publish: true });
  const retry = await planRelease(input, async () => ({
    ok: true, json: async () => ({ sha }),
  }));
  assert.equal(retry.publish, true);
});

test('an existing version on another commit skips publication', async () => {
  const plan = await planRelease(input, async () => ({
    ok: true, json: async () => ({ sha: 'b'.repeat(40) }),
  }));
  assert.equal(plan.publish, false);
});

test('API failures and malformed responses fail closed', async () => {
  for (const status of [401, 403, 429, 500]) {
    await assert.rejects(planRelease(input, async () => ({ status, ok: false })), /HTTP/);
  }
  await assert.rejects(planRelease(input, async () => {
    throw new Error('Network unavailable');
  }), /Network unavailable/);
  await assert.rejects(planRelease(input, async () => ({
    ok: true, json: async () => ({}),
  })), /Invalid release tag commit/);
});

test('invalid versions fail before making a request', async () => {
  await assert.rejects(planRelease({ ...input, version: '0.1.2\npublish=true' }, () => {
    assert.fail('must not query GitHub for an invalid version');
  }), /Invalid extension version/);
});
