// Run with VS Code's --extensionTestsPath pointing to the compiled module.
import { testToolbar } from './toolbarHost';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';

export async function run(): Promise<void> {
  testToolbar();
  const extension = vscode.extensions.getExtension('dauhuniec.dauhuniec');
  assert.ok(extension, 'extension is registered');
  const api = await extension.activate();
  const commands = await vscode.commands.getCommands(true);
  for (const name of ['configure', 'build', 'flash', 'debug', 'check', 'selectProject']) assert.ok(commands.includes(`dauhuniec.${name}`), name);
  const report = await api.getStatus();
  assert.equal(report.ready, true, JSON.stringify(report));
  assert.ok(report.project.target);
  const backupDirectory = path.join(report.root, '.dauhuniec/backups');
  const before = (await fs.readdir(backupDirectory).catch(() => [])).length;
  await vscode.commands.executeCommand('dauhuniec.configure', report.root);
  assert.equal((await fs.readdir(backupDirectory)).length, before + 1, 'configure command performs setup and creates a backup');
  const exitCode = await vscode.commands.executeCommand('dauhuniec.build', report.root);
  assert.equal(exitCode, 0, 'VS Code build task succeeds');
  assert.ok((await fs.stat(path.join(report.root, report.project.build_dir, `${report.project.target}.elf`))).size > 0);
  console.log('DAUHUNIEC_HOST_TEST_PASS: activation, commands, configure wizard, backup, ready state, native build task and firmware ELF');
}
