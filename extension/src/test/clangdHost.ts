// Run against a disposable, configured STM32 project with --clangd.
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';

async function until<T>(check: () => Promise<T | undefined>, description: string): Promise<T> {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const result = await check();
    if (result !== undefined) return result;
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  throw new Error(`Timed out: ${description}`);
}

export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension('dauhuniec.dauhuniec');
  assert.ok(extension);
  const api = await extension.activate();
  const report = await api.refresh();
  assert.ok(report?.configured, JSON.stringify(report));
  const root = report.root;
  const config = vscode.workspace.getConfiguration(undefined, vscode.Uri.file(root));
  assert.equal(config.get('C_Cpp.intelliSenseEngine'), 'disabled');
  assert.equal(config.get('clangd.enable'), true);
  assert.equal(config.get('stm32cube-ide-clangd.enable'), false);
  assert.equal(config.get('editor.semanticHighlighting.enabled'), true);
  assert.ok((await vscode.commands.getCommands(true)).includes('dauhuniec.installClangd'));
  const clangd = vscode.extensions.getExtension('llvm-vs-code-extensions.vscode-clangd');
  assert.ok(clangd, 'official clangd extension installed in isolated profile');
  const doc = await vscode.workspace.openTextDocument(path.join(root, 'Core/Src/main.c'));
  await vscode.window.showTextDocument(doc);
  await clangd.activate();
  for (const [symbol, filename] of [['HAL_Init()', 'stm32f4xx_hal.c'], ['HAL_GPIO_WritePin(', 'stm32f4xx_hal_gpio.c'], ['ETH_HandleTypeDef', 'stm32f4xx_hal_eth.h']]) {
    const offset = doc.getText().indexOf(symbol);
    assert.ok(offset >= 0, symbol);
    await until(async () => {
      const definitions = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>('vscode.executeDefinitionProvider', doc.uri, doc.positionAt(offset + 2));
      return definitions?.some(def => ('uri' in def ? def.uri : def.targetUri).fsPath.endsWith(filename)) ? true : undefined;
    }, `definition of ${symbol} in ${filename}`);
  }
  const database = path.join(root, '.dauhuniec/compile_commands.json');
  const makefile = path.join(root, 'Makefile');
  const original = await fs.readFile(makefile, 'utf8');
  const extra = path.join(root, 'Core/Src/dauhuniec_index_test.c');
  try {
    await fs.writeFile(makefile, original + '\nCPPFLAGS += -DDAUHUNIEC_CLANGD_HOST=1\n');
    await until(async () => (await fs.readFile(database, 'utf8')).includes('-DDAUHUNIEC_CLANGD_HOST=1') ? true : undefined, 'database refresh after Makefile change');
    await fs.writeFile(extra, 'int dauhuniec_index_test(void) { return 1; }\n');
    await until(async () => (await fs.readFile(database, 'utf8')).includes('dauhuniec_index_test.c') ? true : undefined, 'new source added to index');
    await fs.unlink(extra);
    await until(async () => !(await fs.readFile(database, 'utf8')).includes('dauhuniec_index_test.c') ? true : undefined, 'deleted source removed from index');
  } finally {
    await fs.rm(extra, { force: true });
    await fs.writeFile(makefile, original);
  }
  console.log('DAUHUNIEC_CLANGD_HOST_PASS: isolated activation, HAL definitions, semantic settings, Makefile refresh and source add/remove');
}
