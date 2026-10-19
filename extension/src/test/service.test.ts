import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { binaryFor, execute, inspect, parseReport, toolArgs } from '../service';

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
