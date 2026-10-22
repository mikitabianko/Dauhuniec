import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
// Run in a normal disposable profile: Extension Test mode does not persist storage.
export async function run(): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder);
  await vscode.workspace.getConfiguration('dauhuniec').update('autoDetect', false, vscode.ConfigurationTarget.Workspace);
  const ext = vscode.extensions.getExtension('dauhuniec.dauhuniec');
  assert.ok(ext);
  const api = await ext.activate();
  const file = path.join(folder.uri.fsPath, 'remembered ü [test]', 'invalid CubeMX');
  if (process.env.DAUHUNIEC_VERIFY_HISTORY === '1') {
    assert.equal(api.getToolSelectionHistory(undefined, 'cubeMX'), file);
    console.log('DAUHUNIEC_HISTORY_RESTART_PASS: failed manual selection restored after real workspace restart');
    return;
  }
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, 'not executable', { mode: 0o644 });
  const cfg = vscode.workspace.getConfiguration('dauhuniec');
  const previous = cfg.get('cubeMXPath');
  const timer = setInterval(() => { void vscode.commands.executeCommand('notifications.clearAll'); }, 100);
  try {
    await vscode.commands.executeCommand('dauhuniec.chooseCubeMX', { toolPath: file });
  }
  finally {
    clearInterval(timer);
  }
  assert.equal(api.getToolSelectionHistory(undefined, 'cubeMX'), file);
  assert.equal(vscode.workspace.getConfiguration('dauhuniec').get('cubeMXPath'), previous);
  console.log('DAUHUNIEC_HISTORY_SAVED_PASS: remembered invalid selection without changing active settings');
}

