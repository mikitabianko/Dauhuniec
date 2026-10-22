import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { binaryFor, execute, inspect, parseReport, toolArgs, resolveDebugServer } from '../service';

test('debug discovers and validates the server when settings are empty instead of relying on PATH', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dauhuniec-server-'));
  try {
    const server = path.join(root, 'CubeIDE with spaces', 'ST-LINK_gdbserver');
    await fs.mkdir(path.dirname(server));
    await fs.writeFile(server, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const resolved=await fs.realpath(server);
    for (const value of [undefined, '', '  ', 'ST-LINK_gdbserver', 'ST-LINK_gdbserver.exe']) {
      assert.equal(await resolveDebugServer(root, value, async () => server), resolved);
    }
    assert.equal(await resolveDebugServer(root, server, async () => { throw new Error('custom path must be preserved'); }), resolved);
    await assert.rejects(resolveDebugServer(root, '', async () => undefined), /path is missing/);
    await assert.rejects(resolveDebugServer(root, path.join(root, 'missing'), async () => server), /missing or cannot be executed/);
    await assert.rejects(resolveDebugServer(root, root, async () => server), /missing or cannot be executed/);
    await assert.rejects(resolveDebugServer(root, '${config:dauhuniec.server}', async () => server), /path is missing/);
    if (process.platform !== 'win32') {
      await fs.chmod(server, 0o644);
      await assert.rejects(resolveDebugServer(root, server, async () => server), /missing or cannot be executed/);
    }
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('platform selection handles each distributed target', () => {
  for (const platform of ['darwin', 'linux', 'win32'] as NodeJS.Platform[]) {
    for (const arch of ['x64', 'arm64'] as NodeJS.Architecture[]) {
      const binary = binaryFor('/extension', platform, arch);
      assert.match(binary, /lon-/);
      assert.equal(binary.endsWith('.exe'), platform === 'win32');
    }
  }
  assert.throws(() => binaryFor('/extension', 'linux', 'ia32'), /does not include/);
});

test('diagnostic protocol rejects unexpected versions and malformed checks', () => {
  assert.throws(() => parseReport('{"schemaVersion":2}'), /Unsupported/);
  assert.throws(() => parseReport('{"schemaVersion":1,"root":"r","checks":[{}],"tools":{},"ready":false,"configured":false}'), /Unsupported/);
});

test('tool arguments preserve paths as individual argv entries', () => {
  assert.deepEqual(toolArgs({ cubeIDE: '/IDE with spaces;echo test', make: 'C:/MSYS tools/make.exe' }), ['--cube-ide', '/IDE with spaces;echo test', '--make', 'C:/MSYS tools/make.exe']);
});

test('CLI runs without a shell, including punctuation in arguments', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dauhuniec-node-'));
  try {
    const argument = 'project with spaces; echo SHOULD_NOT_RUN';
    const output = await execute(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', argument], root);
    assert.equal(output, argument);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('bundled CLI returns read-only diagnostics for an unconfigured project', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dauhuniec-inspect-'));
  try {
    await fs.writeFile(path.join(root, 'Lab.ioc'), 'Mcu.CPN=STM32F446RETx\nProjectManager.TargetToolchain=Makefile\n');
    await fs.writeFile(path.join(root, 'Makefile'), 'TARGET = Lab\nBUILD_DIR = build\n');
    const extensionPath = path.resolve(__dirname, '../..');
    const report = await inspect(binaryFor(extensionPath), root);
    assert.equal(report.schemaVersion, 1);
    assert.equal(report.configured, false);
    assert.equal(report.project?.device, 'STM32F446RETx'.toUpperCase());
    assert.equal(report.project?.target, 'Lab');
    assert.equal(await fs.stat(path.join(root, '.vscode')).then(() => true, () => false), false);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('clangd diagnostics distinguish missing installation, disabled server and competing engines', async () => {
  const { intelliSenseChecks } = await import('../intelliSense');
  assert.deepEqual(intelliSenseChecks('disabled', true, false), []);
  assert.equal(intelliSenseChecks('disabled', true, false, false)[0].action, 'installClangd');
  assert.match(intelliSenseChecks('default', true, false)[0].message, /Microsoft C\/C\+\+/);
  assert.match(intelliSenseChecks('disabled', false, false)[0].message, /clangd is disabled/);
  assert.match(intelliSenseChecks('disabled', true, true)[0].message, /second STM32 clangd/);
});

test('clangd installer requests enablement even when installed, then activates and delegates downloads; failures can be retried', async () => {
  const { ensureClangd } = await import('../intelliSense');
  const events: string[] = [];
  let installed = false;
  const installer = {
    installed: () => installed,
    installExtension: async () => { events.push('install'); installed = true; },
    activate: async () => { events.push('activate'); },
    downloadServer: async () => { events.push('download'); }
  };
  await ensureClangd(installer);
  assert.deepEqual(events, ['install', 'activate']);
  events.length = 0;
  await ensureClangd(installer, true);
  assert.deepEqual(events, ['install', 'activate', 'download']);
  installed = false;
  await assert.rejects(ensureClangd({ ...installer, installExtension: async () => { throw new Error('offline'); } }), /offline/);
  await assert.rejects(ensureClangd({ ...installer, installExtension: async () => {} }), /Enable the clangd extension/);
  await ensureClangd(installer);
  assert.equal(installed, true);
});
