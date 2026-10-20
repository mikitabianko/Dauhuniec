const fs = require('node:fs');

async function planRelease({ version, repository, sha, token, apiUrl }, request = fetch) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Invalid extension version: ${version}`);
  }
  const baseUrl = `${apiUrl}/repos/${repository}`;
  async function readObject(path, allowMissing = false) {
    const response = await request(`${baseUrl}${path}`, {
      signal: AbortSignal.timeout(30_000),
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (allowMissing && response.status === 404) return null;
    if (!response.ok) throw new Error(`Cannot check release tag: HTTP ${response.status}`);
    const data = await response.json();
    const object = data?.object;
    if (!object || !/^[0-9a-f]{40}$/.test(object.sha) || !['commit', 'tag'].includes(object.type)) {
      throw new Error('Invalid release tag commit');
    }
    return object;
  }

  // Query the exact tag ref: the commit endpoint can return 422 for an
  // unknown revision. Only a missing ref permits a new release.
  let object = await readObject(`/git/ref/tags/v${version}`, true);
  if (!object) return { version, publish: true };
  const visited = new Set();
  while (object.type === 'tag') {
    if (visited.has(object.sha) || visited.size >= 16) throw new Error('Invalid release tag chain');
    visited.add(object.sha);
    object = await readObject(`/git/tags/${object.sha}`);
  }
  return { version, publish: object.sha === sha };
}

async function main() {
  const { version } = require('../../extension/package.json');
  const plan = await planRelease({
    version,
    repository: process.env.GITHUB_REPOSITORY,
    sha: process.env.GITHUB_SHA,
    token: process.env.GH_TOKEN,
    apiUrl: process.env.GITHUB_API_URL,
  });
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `version=${plan.version}\npublish=${plan.publish}\n`);
  const message = plan.publish
    ? `Release v${version} is eligible for this commit.`
    : `Skipping release: v${version} already points to another commit. Bump extension/package.json to publish a new version.`;
  console.log(message);
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${message}\n`);
}

module.exports = { planRelease };
if (require.main === module) main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
