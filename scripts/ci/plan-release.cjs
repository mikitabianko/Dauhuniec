const fs = require('node:fs');

async function planRelease({ version, repository, sha, token, apiUrl }, request = fetch) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Invalid extension version: ${version}`);
  }
  const response = await request(`${apiUrl}/repos/${repository}/commits/v${version}`, {
    signal: AbortSignal.timeout(30_000),
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (response.status === 404) return { version, publish: true };
  if (!response.ok) throw new Error(`Cannot check release tag: HTTP ${response.status}`);
  const commit = await response.json();
  if (!/^[0-9a-f]{40}$/.test(commit.sha)) throw new Error('Invalid release tag commit');
  return { version, publish: commit.sha === sha };
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
