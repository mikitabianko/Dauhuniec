import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { testToolbar } from './toolbarHost';

export async function run(): Promise<void> {
  testToolbar();
  const extension = vscode.extensions.getExtension('dauhuniec.dauhuniec');
  assert.ok(extension);
  await extension.activate();
  const document = await vscode.workspace.openTextDocument({ language: 'c', content: '// Code remains in the editor\n' });
  await vscode.window.showTextDocument(document);
  const before = vscode.window.tabGroups.all.flatMap(group => group.tabs).length;
  // A nonexistent test port exercises terminal launch without touching a connected board.
  await vscode.commands.executeCommand('dauhuniec.serialMonitor', { port: 'DAUHUNIEC_TEST_MISSING_PORT', baud:115200 });
  const terminal = vscode.window.terminals.find(item => item.name.startsWith('Dauhuniec Serial · '));
  assert.ok(terminal);
  const options = terminal.creationOptions as vscode.TerminalOptions;
  assert.equal(options.location, vscode.TerminalLocation.Panel);
  assert.ok(Array.isArray(options.shellArgs) && options.shellArgs.includes('serial-console'));
  assert.equal(vscode.window.tabGroups.all.flatMap(group => group.tabs).length, before, 'does not open an editor Webview');
  assert.equal(vscode.window.activeTextEditor?.document, document);
  terminal.dispose();
  await vscode.commands.executeCommand('workbench.action.closePanel');
  console.log('DAUHUNIEC_SERIAL_HOST_PASS: native console in bottom terminal panel, editor preserved, toolbar commands');
}
