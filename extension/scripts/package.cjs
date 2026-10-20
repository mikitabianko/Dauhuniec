const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { name, version } = require('../package.json');

const result = spawnSync(process.execPath, [
  require.resolve('@vscode/vsce/vsce'),
  'package',
  '--no-dependencies',
  '--out', path.resolve(__dirname, '../../releases', `${name}-${version}.vsix`),
], {
  cwd: path.resolve(__dirname, '..'),
  stdio: 'inherit',
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
