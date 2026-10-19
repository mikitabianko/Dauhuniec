import { testToolbar } from './toolbarHost';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { userCodeLayout } from '../userCode';

async function until(condition: () => boolean, message: string): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(message);
    await new Promise(resolve => setTimeout(resolve, 30));
  }
}

export async function run(): Promise<void> {
  testToolbar();
  const extension = vscode.extensions.getExtension('dauhuniec.dauhuniec');
  assert.ok(extension);
  const api = await extension.activate();
  assert.equal((await api.getStatus()).configured, false, 'focus must work before build setup');
  const root = vscode.workspace.workspaceFolders![0].uri.fsPath;
  const file = path.join(root, 'Focus.c');
  const original = ['// Generated header', '#include "generated.h"', '/* USER CODE BEGIN Includes */', '#include "mine.h"', '/* USER CODE END Includes */',
    'void generated(void) {', '  generated_body();', '}', 'int main(void) {', '  HAL_Init();', '  /* USER CODE BEGIN 2 */', '  user_init();',
    '  /* USER CODE END 2 */', '  generated_init();', '  /* USER CODE BEGIN WHILE */', '  while (1) {', '  /* USER CODE END WHILE */',
    '    generated_poll();', '    /* USER CODE BEGIN 3 */', '    user_loop();', '  }', '  /* USER CODE END 3 */', '}', 'generated_footer();'].join('\n');
  await fs.writeFile(file, original);
  const document = await vscode.workspace.openTextDocument(file);
  const editor = await vscode.window.showTextDocument(document);
  // Simulate another C extension providing a parent function fold across user blocks.
  const syntax = vscode.languages.registerFoldingRangeProvider({ language: 'c', scheme: 'file', pattern: '**/Focus.c' }, {
    provideFoldingRanges: () => [new vscode.FoldingRange(8, 22)]
  });
  const visible = (line: number) => editor.visibleRanges.some(range => range.start.line <= line && range.end.line >= line);
  try {
    await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
    const header = new vscode.Position(8, 0);
    editor.selection = new vscode.Selection(header, header);
    await vscode.commands.executeCommand('vscode.executeFoldingRangeProvider', document.uri);
    for (let attempt = 0; attempt < 50 && visible(11); attempt++) {
      await vscode.commands.executeCommand('editor.fold', { selectionLines: [8], levels: 1, direction: 'down' });
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    assert.equal(visible(11), false, `test parent fold did not close: language=${document.languageId}, ranges=${JSON.stringify(await vscode.commands.executeCommand('vscode.executeFoldingRangeProvider', document.uri))}, visible=${JSON.stringify(editor.visibleRanges)}`);
    await vscode.commands.executeCommand('dauhuniec.focusUserCode');
    await until(() => visible(11) && visible(19) && !visible(13), `focus did not expose user blocks: ${JSON.stringify(editor.visibleRanges)}`);
    for (const block of userCodeLayout(original).blocks) {
      for (let line = block.start; line <= block.end; line++) assert.ok(visible(line), `USER CODE line ${line} hidden`);
    }
    for (const line of [5, 7, 8, 22]) assert.ok(visible(line), `function context line ${line} hidden`);
    assert.equal(document.getText(), original);
    assert.equal(document.isDirty, false);
    await vscode.commands.executeCommand('dauhuniec.showFullFile');
    await until(() => visible(13), 'show full file did not unfold generated code');
    await vscode.commands.executeCommand('dauhuniec.toggleUserCodeFocus');
    await until(() => !visible(13), `toggle did not restore focus mode: visible=${JSON.stringify(editor.visibleRanges)}, selections=${JSON.stringify(editor.selections)}`);
    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, document.lineAt(12).range, '  /* USER CODE END Wrong */');
    await vscode.workspace.applyEdit(edit);
    await until(() => visible(13), 'incomplete markers should reveal the full file');
    assert.equal(document.getText(), original.replace('/* USER CODE END 2 */', '/* USER CODE END Wrong */'));
    // Restore the test file before closing; the feature itself never writes source.
    await vscode.commands.executeCommand('workbench.action.files.revert');
    console.log('DAUHUNIEC_USER_CODE_TEST_PASS: pre-setup focus, conflicting syntax folds, all user lines visible, full-file/toggle commands, unchanged source and malformed-marker recovery');
  } finally { syntax.dispose(); }
}
