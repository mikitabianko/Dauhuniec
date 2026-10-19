import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';

// Open a configured fixture with two fake probes and no target.json.
export async function run(): Promise<void> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  assert.ok(root);
  const target = path.join(root, '.dauhuniec/target.json');
  assert.equal(await fs.stat(target).then(() => true, () => false), false);
  const extension = vscode.extensions.getExtension('dauhuniec.dauhuniec');
  assert.ok(extension);
  const accept = setInterval(() => { void vscode.commands.executeCommand('workbench.action.acceptSelectedQuickOpenItem'); }, 150);
  try {
    await extension.activate();
    for (let attempt = 0; attempt < 200; attempt++) {
      if (await fs.stat(target).then(() => true, () => false)) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  } finally { clearInterval(accept); }
  const selected = JSON.parse(await fs.readFile(target, 'utf8'));
  assert.equal(selected.serial, 'AAAAAAAA');
  assert.equal(await fs.stat(path.join(root,'programmer-args.txt')).then(() => true, () => false), false, 'startup choice never flashes');
  assert.ok((await vscode.commands.getCommands(true)).includes('dauhuniec.selectTarget'));
  console.log('DAUHUNIEC_TARGET_STARTUP_PASS: startup picker for two identical boards, persisted explicit choice, no automatic programming');
}
