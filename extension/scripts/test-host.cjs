// Exercise the real VS Code API in an isolated profile, never the user's profile.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const project = process.argv[2];
if (!project) throw new Error('Usage: pnpm run test:host /path/to/configured/CubeMX/project');
const candidates = [process.env.DAUHUNIEC_VSCODE_EXECUTABLE,
  '/Applications/Visual Studio Code.app/Contents/MacOS/Code',
  '/Applications/Visual Studio Code.app/Contents/MacOS/Electron', '/usr/share/code/code',
  path.join(process.env.LOCALAPPDATA || '', 'Programs/Microsoft VS Code/Code.exe'),
  path.join(process.env.ProgramFiles || '', 'Microsoft VS Code/Code.exe')].filter(Boolean);
const executable = candidates.find(candidate => fs.existsSync(candidate));
if (!executable) throw new Error('Set DAUHUNIEC_VSCODE_EXECUTABLE to the VS Code application executable.');
const extension = path.resolve(__dirname, '..');
// macOS IPC sockets have a short path limit; its default TMPDIR is too long.
const profile = fs.mkdtempSync(path.join(process.platform === 'darwin' ? '/private/tmp' : os.tmpdir(), 'cr-vsc-'));
const userData = path.join(profile, 'user-data');
fs.mkdirSync(path.join(userData, 'User'), { recursive: true });
fs.writeFileSync(path.join(userData, 'User/settings.json'), JSON.stringify({
  'security.workspace.trust.enabled': false, 'workbench.startupEditor': 'none',
  'window.restoreWindows': 'none', 'update.mode': 'none',
  'extensions.autoCheckUpdates': false, 'extensions.autoUpdate': false, 'telemetry.telemetryLevel': 'off'
}));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
console.log('Isolated VS Code profile:', profile);
const child = spawn(executable, ['--user-data-dir', userData, '--extensions-dir', path.join(profile, 'extensions'),
  '--extensionDevelopmentPath', extension, '--extensionTestsPath', path.join(extension, process.argv.includes('--targets-startup') ? 'dist/test/targetBoardStartupHost.js' : process.argv.includes('--targets') ? 'dist/test/targetBoardHost.js' : process.argv.includes('--serial') ? 'dist/test/serialMonitorHost.js' : process.argv.includes('--cubemx') ? 'dist/test/cubeMXHost.js' : process.argv.includes('--focus') ? 'dist/test/userCodeHost.js' : 'dist/test/host.js'),
  '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--disable-gpu', '--new-window', path.resolve(project)],
  { env, stdio: 'inherit' });
const timeout = setTimeout(() => { console.error('Extension Host test timed out.'); child.kill(); }, 120000);
child.on('error', error => { clearTimeout(timeout); console.error(error); process.exitCode = 1; });
child.on('exit', (code, signal) => { clearTimeout(timeout); if (signal) console.error('VS Code exited with signal', signal); process.exitCode = code ?? 1; });
