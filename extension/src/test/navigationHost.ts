// Open a configured disposable STM32 project with clangd disabled in the
// isolated profile to exercise recovery without downloading another server.
import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import * as vscode from 'vscode';

async function until(check: () => Promise<boolean>, description: string): Promise<void> {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  throw new Error(`Timed out: ${description}`);
}

export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension('dauhuniec.dauhuniec');
  assert.ok(extension);
  const api = await extension.activate();
  const report = await api.refresh();
  assert.ok(report?.configured);
  assert.ok(!vscode.extensions.getExtension('llvm-vs-code-extensions.vscode-clangd')?.isActive, 'fixture starts with clangd inactive');
  await vscode.commands.executeCommand('dauhuniec.installClangd', false);
  const clangd = vscode.extensions.getExtension('llvm-vs-code-extensions.vscode-clangd');
  assert.ok(clangd?.isActive, 'recovery enables and activates the installed extension');
  const doc = await vscode.workspace.openTextDocument(path.join(report.root, 'Core/Src/main.c'));
  await vscode.window.showTextDocument(doc);
  const offset = doc.getText().indexOf('HAL_UART_Transmit(');
  assert.ok(offset >= 0, 'fixture calls HAL_UART_Transmit');
  const position = doc.positionAt(offset + 5);
  await until(async () => {
    const definitions = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>('vscode.executeDefinitionProvider', doc.uri, position);
    return definitions?.some(def => ('uri' in def ? def.uri : def.targetUri).fsPath.endsWith('stm32f4xx_hal_uart.c')) ?? false;
  }, 'UART definition in HAL source');
  await until(async () => {
    const references = await vscode.commands.executeCommand<vscode.Location[]>('vscode.executeReferenceProvider', doc.uri, position);
    return references?.some(ref => ref.uri.fsPath === doc.uri.fsPath && ref.range.contains(position)) ?? false;
  }, 'UART call references in main.c');
  const hovers = await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', doc.uri, position);
  assert.ok(hovers?.length, 'UART type information is available');
  console.log('DAUHUNIEC_NAVIGATION_HOST_PASS: disabled clangd recovery, HAL_UART_Transmit definition, references and hover');
}
