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
    assert.equal(url, 'https://api.github.com/repos/owner/repo/git/ref/tags/v0.1.2');
    assert.equal(options.headers.Authorization, 'Bearer test-token');
    return { status: 404 };
  });
  assert.deepEqual(missing, { version: '0.1.2', publish: true });
  const retry = await planRelease(input, async () => ({
    ok: true, json: async () => ({ object: { type: 'commit', sha } }),
  }));
  assert.equal(retry.publish, true);
});

test('an existing version on another commit skips publication', async () => {
  const plan = await planRelease(input, async () => ({
    ok: true, json: async () => ({ object: { type: 'commit', sha: 'b'.repeat(40) } }),
  }));
  assert.equal(plan.publish, false);
});

test('API failures and malformed responses fail closed', async () => {
  for (const status of [401, 403, 422, 429, 500]) {
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


test('annotated tags resolve to their commit before deciding publication', async () => {
  const tagSHA = 'c'.repeat(40);
  for (const commitSHA of [sha, 'b'.repeat(40)]) {
    const urls = [];
    const plan = await planRelease(input, async url => {
      urls.push(url);
      return { ok: true, json: async () => ({ object: urls.length === 1
        ? { type: 'tag', sha: tagSHA }
        : { type: 'commit', sha: commitSHA } }) };
    });
    assert.deepEqual(urls, [
      'https://api.github.com/repos/owner/repo/git/ref/tags/v0.1.2',
      `https://api.github.com/repos/owner/repo/git/tags/${tagSHA}`,
    ]);
    assert.equal(plan.publish, commitSHA === sha);
  }
});

test('missing annotated objects and cyclic tag chains do not permit publication', async () => {
  let calls = 0;
  await assert.rejects(planRelease(input, async () => {
    if (++calls === 1) return { ok: true, json: async () => ({ object: { type: 'tag', sha } }) };
    return { ok: false, status: 404 };
  }), /HTTP 404/);
  await assert.rejects(planRelease(input, async () => ({
    ok: true, json: async () => ({ object: { type: 'tag', sha } }),
  })), /Invalid release tag chain/);
});
