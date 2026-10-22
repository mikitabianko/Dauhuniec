// Exercise registered commands with real VS Code configuration/workspaceState and CLI.
// Dialog responses are intercepted in this isolated host; no user profile is touched.
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { historyKey } from '../toolSelection';
export async function run(): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder);
  const root = folder.uri.fsPath;
  const ext = vscode.extensions.getExtension('dauhuniec.dauhuniec');
  assert.ok(ext);
  await vscode.workspace.getConfiguration('dauhuniec').update('autoDetect', false, vscode.ConfigurationTarget.Workspace);
  const api = await ext.activate();
  console.log('Tool recovery host started');
  const window = vscode.window as unknown as Record<string, unknown>;
  const originals = new Map<string, unknown>();
  const replace = (key: string, value: unknown) => { if (!originals.has(key))
    originals.set(key, window[key]); window[key] = value; };
  if (process.env.DAUHUNIEC_VERIFY_HISTORY === '1') {
    try {
      let restored: string | undefined;
      replace('showOpenDialog', async (options: vscode.OpenDialogOptions) => { restored = options.defaultUri?.fsPath; return undefined; });
      await vscode.commands.executeCommand('dauhuniec.chooseCubeMX');
      assert.equal(restored, path.join(root, 'remembered ü [test]'));
      console.log('DAUHUNIEC_HISTORY_RESTART_PASS: failed selection survived restarting the same isolated workspace');
    }
    finally {
      for (const [key, value] of originals)
        window[key] = value;
    }
    return;
  }
  const app = path.join(root, 'STM32CubeMX fixture ü [test]');
  const trace = path.join(root, 'launch.trace');
  const invalid = path.join(root, 'missing [ü]', 'STM32CubeMX');
  const cfg = vscode.workspace.getConfiguration('dauhuniec', folder.uri);
  const previous = cfg.get<string>('cubeMXPath');
  const quote = (s: string) => "'" + s.replace(/'/g, "'\\''") + "'";
  try {
    await fs.rm(trace, { force: true });
    await fs.writeFile(app, `#!/bin/sh\nprintf 'launched' > ${quote(trace)}\n`, { mode: 0o755 });
    process.env.STM32CUBEMX_PATH = app;
    await cfg.update('cubeMXPath', invalid, vscode.ConfigurationTarget.Workspace);
    replace('showWarningMessage', async () => 'Keep Current Selection');
    await vscode.commands.executeCommand('dauhuniec.openIOC');
    assert.equal(vscode.workspace.getConfiguration('dauhuniec', folder.uri).get('cubeMXPath'), invalid, 'decline preserves setting');
    replace('showWarningMessage', async () => undefined);
    await vscode.commands.executeCommand('dauhuniec.openIOC');
    assert.equal(vscode.workspace.getConfiguration('dauhuniec', folder.uri).get('cubeMXPath'), invalid, 'cancel preserves explicit setting');
    assert.equal(await fs.stat(trace).then(() => true, () => false), false, 'cancel does not launch');
    replace('showWarningMessage', async () => 'Other Installations');
    replace('showQuickPick', async (items: {
      c?: {
        originalPath: string;
      };
    }[]) => items.find(item => item.c?.originalPath === app));
    await vscode.commands.executeCommand('dauhuniec.openIOC');
    assert.equal(vscode.workspace.getConfiguration('dauhuniec', folder.uri).get('cubeMXPath'), app, 'accepted alternative is saved');
    assert.equal(await fs.readFile(trace, 'utf8'), 'launched', 'original action continues');
    let selectedPath = invalid, dialogDefault: string | undefined;
    replace('showOpenDialog', async (options: vscode.OpenDialogOptions) => { dialogDefault = options.defaultUri?.fsPath; return [vscode.Uri.file(selectedPath)]; });
    replace('showErrorMessage', async () => undefined);
    await vscode.commands.executeCommand('dauhuniec.chooseCubeMX');
    assert.equal(vscode.workspace.getConfiguration('dauhuniec', folder.uri).get('cubeMXPath'), app, 'failed selection preserves working setting');
    selectedPath = app;
    await vscode.commands.executeCommand('dauhuniec.chooseCubeMX');
    assert.equal(dialogDefault, root, 'nearest parent of failed selection restored');
    replace('showOpenDialog', async () => undefined);
    await vscode.commands.executeCommand('dauhuniec.chooseCubeMX');
    assert.equal(vscode.workspace.getConfiguration('dauhuniec', folder.uri).get('cubeMXPath'), app, 'picker cancellation preserves setting');
    // A CLI exception after a file selection must preserve history and working tools.
    const cli = path.join(ext.extensionPath, 'bin', `lon-darwin-${process.arch === 'arm64' ? 'arm64' : 'amd64'}`);
    const cliBackup = cli + '.host-test-backup';
    await fs.rename(cli, cliBackup);
    try {
      selectedPath = path.join(root, 'remembered ü [test]', 'missing', 'STM32CubeMX');
      await fs.mkdir(path.join(root, 'remembered ü [test]'), { recursive: true });
      replace('showOpenDialog', async () => [vscode.Uri.file(selectedPath)]);
      await vscode.commands.executeCommand('dauhuniec.chooseCubeMX');
      assert.equal(vscode.workspace.getConfiguration('dauhuniec', folder.uri).get('cubeMXPath'), app, 'CLI failure preserves working tool');
      replace('showOpenDialog', async (options: vscode.OpenDialogOptions) => { dialogDefault = options.defaultUri?.fsPath; return undefined; });
      await vscode.commands.executeCommand('dauhuniec.chooseCubeMX');
      assert.equal(dialogDefault, path.join(root, 'remembered ü [test]'));
      const archive = path.join(root, 'support.zip');
      let explanation = '';
      replace('showSaveDialog', async (options: vscode.SaveDialogOptions) => { explanation = options.title || ''; return vscode.Uri.file(archive); });
      replace('showInformationMessage', async () => undefined);
      await vscode.commands.executeCommand('dauhuniec.exportDiagnosticReport');
      assert.match(explanation, /redacted settings/);
      const bytes = await fs.readFile(archive);
      assert.equal(bytes.readUInt32LE(0), 0x04034b50);
      assert.ok(bytes.includes(Buffer.from('summary.txt')));
      assert.ok(!bytes.includes(Buffer.from(require('node:os').homedir())));
    }
    finally {
      await fs.rename(cliBackup, cli);
    }
    assert.ok((await vscode.commands.getCommands(true)).includes('dauhuniec.exportDiagnosticReport'));
    assert.ok(api);
    console.log('DAUHUNIEC_RECOVERY_HOST_PASS: alternative acceptance/cancellation, continued action, failed picker memory, working-setting preservation, report ZIP without project');
  }
  finally {
    for (const [key, value] of originals)
      window[key] = value;
    await cfg.update('cubeMXPath', previous, vscode.ConfigurationTarget.Workspace);
    delete process.env.STM32CUBEMX_PATH;
  }
}

