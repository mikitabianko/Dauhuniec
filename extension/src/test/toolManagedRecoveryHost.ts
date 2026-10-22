import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as vscode from 'vscode';
import { binaryFor } from '../service';
export async function run(): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder);
  const root = folder.uri.fsPath;
  await vscode.workspace.getConfiguration('dauhuniec').update('autoDetect', false, vscode.ConfigurationTarget.Workspace);
  const ext = vscode.extensions.getExtension('dauhuniec.dauhuniec');
  assert.ok(ext);
  await fs.writeFile(path.join(root, 'Board.ioc'), 'Mcu.CPN=STM32F446RETx\nProjectManager.TargetToolchain=Makefile\n');
  await fs.writeFile(path.join(root, 'Makefile'), "TARGET = Board\nBUILD_DIR = build\nall:\n\tmkdir -p build\n\tprintf firmware > build/Board.elf\n");
  const old = path.join(root, 'STM32CubeIDE_99 old ü [test]');
  const replacement = path.join(root, 'STM32CubeIDE_100 new ü [test]');
  const dir = path.join(old, 'plugins/com.st.stm32cube.ide.mcu.externaltools.gnu-tools-for-stm32.14.3/tools/bin');
  await fs.mkdir(dir, { recursive: true });
  for (const name of ['gcc', 'objcopy', 'size'])
    await fs.writeFile(path.join(dir, 'arm-none-eabi-' + name), '#!/bin/sh\necho "Werkzeug fixture 14"\n', { mode: 0o755 });
  await promisify(execFile)(binaryFor(ext.extensionPath), ['setup', root, '--cube-ide', old, '--make', '/usr/bin/make', '--action', 'build']);
  await ext.activate();
  await fs.rename(old, replacement);
  process.env.STM32CUBEIDE_PATH = replacement;
  const window = vscode.window as unknown as Record<string, unknown>;
  const original = window.showWarningMessage;
  let prompts = 0;
  window.showWarningMessage = async () => { prompts++; return undefined; };
  try {
    const code = await vscode.commands.executeCommand('dauhuniec.build', root);
    assert.equal(code, 0, 'build continued after automatic managed recovery');
    assert.equal(prompts, 0, 'managed recovery did not prompt');
    const cfg = vscode.workspace.getConfiguration('dauhuniec', folder.uri);
    assert.ok(cfg.get<string>('gcc')?.startsWith(replacement));
    assert.equal(cfg.get('make'), '/usr/bin/make', 'working Make preserved');
    assert.equal(await fs.readFile(path.join(root, 'build/Board.elf'), 'utf8'), 'firmware');
    console.log('DAUHUNIEC_MANAGED_HOST_PASS: stale managed paths recovered silently, optional debug tools absent, working Make preserved, captured build task completed');
  }
  finally {
    window.showWarningMessage = original;
    delete process.env.STM32CUBEIDE_PATH;
  }
}

