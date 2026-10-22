import {testToolbar} from './toolbarHost';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
export async function run(): Promise<void> {
  testToolbar();
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder);
  const workspace = folder.uri.fsPath;
  await vscode.workspace.getConfiguration('dauhuniec').update('autoDetect', false, vscode.ConfigurationTarget.Workspace);
  const roots = [path.join(workspace, 'project A'), path.join(workspace, 'project B')];
  const ides = [path.join(workspace, 'STM32CubeIDE_99 A'), path.join(workspace, 'STM32CubeIDE_100 B')];
  for (let i = 0; i < 2; i++) {
    await fs.mkdir(roots[i], { recursive: true });
    await fs.writeFile(path.join(roots[i], 'Board.ioc'), 'Mcu.CPN=STM32F446RETx\nProjectManager.TargetToolchain=Makefile\n');
    await fs.writeFile(path.join(roots[i], 'Makefile'), 'TARGET = Board\nBUILD_DIR = build\nall:\n\tmkdir -p build\n\tprintf firmware > build/Board.elf\n');
    const dir = path.join(ides[i], 'plugins/com.st.stm32cube.ide.mcu.externaltools.gnu-tools-for-stm32.14.3/tools/bin');
    await fs.mkdir(dir, { recursive: true });
    for (const name of ['gcc', 'objcopy', 'size'])
      await fs.writeFile(path.join(dir, 'arm-none-eabi-' + name), '#!/bin/sh\necho "fixture 14"\n', { mode: 0o755 });
  }
  const ext = vscode.extensions.getExtension('dauhuniec.dauhuniec');
  assert.ok(ext);
  await ext.activate();
  const previous = vscode.workspace.getConfiguration('dauhuniec').get('cubeIDEPath');
  for (let i = 0; i < 2; i++)
    assert.equal(await vscode.commands.executeCommand('dauhuniec.chooseIDE', { project: roots[i], toolPath: ides[i] }), true);
  assert.equal(vscode.workspace.getConfiguration('dauhuniec').get('cubeIDEPath'), previous, 'nested project choice does not overwrite workspace setting');
  for (let i = 0; i < 2; i++) {
    assert.equal(await vscode.commands.executeCommand('dauhuniec.build', roots[i]), 0);
    const cfg = JSON.parse(await fs.readFile(path.join(roots[i], '.dauhuniec/tools.json'), 'utf8'));
    assert.ok(cfg.tools.gcc.startsWith(ides[i]), 'project retains its selected toolset');
  }
  console.log('DAUHUNIEC_TOOL_ISOLATION_HOST_PASS: sibling projects selected different installations and built with their own tools');
}

