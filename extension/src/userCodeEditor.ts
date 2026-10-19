import * as vscode from 'vscode';
import { userCodeLayout } from './userCode';

/** Editor-only feature: no project export, compiler, or source modification required. */
export function registerUserCodeFocus(context: vscode.ExtensionContext): void {
  const preferences = { ...context.workspaceState.get<Record<string, boolean>>('userCodeFocus', {}) };
  const focused = new Set<string>();
  const anchors = new Map<string, number[]>();
  const pending = new Set<string>();
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 20);
  const eligible = (document: vscode.TextDocument) => document.uri.scheme === 'file' && ['c', 'cpp'].includes(document.languageId);
  context.subscriptions.push(status);

  async function removeFocusRanges(editor: vscode.TextEditor, starts: number[]): Promise<void> {
    if (!starts.length) return;
    const saved = editor.selections;
    editor.selections = starts.map(line => {
      const position = editor.document.validatePosition(new vscode.Position(Math.max(0, line), 0));
      return new vscode.Selection(position, position);
    });
    await vscode.commands.executeCommand('editor.removeManualFoldingRanges');
    editor.selections = saved;
  }

  function updateContext(): void {
    const editor = vscode.window.activeTextEditor;
    const hasBlocks = !!editor && eligible(editor.document) && userCodeLayout(editor.document.getText()).blocks.length > 0;
    const isFocused = !!editor && focused.has(editor.document.uri.toString());
    void vscode.commands.executeCommand('setContext', 'dauhuniec.hasUserCode', hasBlocks);
    void vscode.commands.executeCommand('setContext', 'dauhuniec.userCodeFocus', isFocused);
    if (!hasBlocks) { status.hide(); return; }
    status.text = isFocused ? '$(unfold) USER CODE focus' : '$(fold) Focus USER CODE';
    status.tooltip = isFocused ? 'Generated sections are folded. Click to show the full file.' : 'Fold CubeMX-generated sections and keep USER CODE blocks visible.';
    status.command = 'dauhuniec.toggleUserCodeFocus';
    status.show();
  }

  async function remember(uri: string, value: boolean): Promise<void> {
    preferences[uri] = value;
    // Keep workspace state bounded when many generated files are visited.
    const keys = Object.keys(preferences);
    for (const key of keys.slice(0, Math.max(0, keys.length - 500))) delete preferences[key];
    await context.workspaceState.update('userCodeFocus', preferences);
  }

  async function focus(editor = vscode.window.activeTextEditor, explicit = true): Promise<void> {
    if (!editor || !eligible(editor.document)) return;
    const uri = editor.document.uri.toString();
    if (pending.has(uri)) return;
    if (!vscode.workspace.getConfiguration('editor', editor.document.uri).get('folding', true)) {
      if (explicit) void vscode.window.showInformationMessage('Dauhuniec: enable Editor: Folding to use USER CODE focus.');
      return;
    }
    const layout = userCodeLayout(editor.document.getText());
    if (!layout.blocks.length || layout.issues.length) {
      if (explicit) void vscode.window.showInformationMessage(layout.issues.length
        ? `Dauhuniec: USER CODE markers are incomplete. ${layout.issues[0]}`
        : 'Dauhuniec: no CubeMX USER CODE blocks were found in this file.');
      return;
    }
    pending.add(uri);
    try {
      await vscode.window.showTextDocument(editor.document, { viewColumn: editor.viewColumn, preserveFocus: false });
      if (vscode.window.activeTextEditor?.document !== editor.document) return;
      const selections = editor.selections;
      // Manual ranges have priority over C/C++ syntax ranges, including functions
      // that cross generated/user boundaries. Nothing changes outside focus mode.
      await vscode.commands.executeCommand('editor.unfoldAll');
      if (layout.generated.length) {
        editor.selections = layout.generated.map(range => {
          const end = range.end + 1 < editor.document.lineCount
            ? new vscode.Position(range.end + 1, 0)
            : editor.document.lineAt(range.end).range.end;
          return new vscode.Selection(new vscode.Position(range.start, 0), end);
        });
        await vscode.commands.executeCommand('editor.createFoldingRangeFromSelection');
      }
      anchors.set(uri, layout.generated.map(range => range.start));
      // Restoring a cursor inside generated text would reopen that fold. Keep
      // user selections, or place the cursor in the closest editable section.
      const hidden = (line: number) => layout.generated.some(range => line > range.start && line <= range.end);
      if (selections.every(selection => !hidden(selection.start.line) && !hidden(selection.end.line))) {
        editor.selections = selections;
      } else {
        const nearest = [...layout.blocks].sort((a, b) => Math.abs(a.start - selections[0].active.line) - Math.abs(b.start - selections[0].active.line))[0];
        const line = Math.min(nearest.start + 1, nearest.end);
        const position = new vscode.Position(line, editor.document.lineAt(line).firstNonWhitespaceCharacterIndex);
        editor.selection = new vscode.Selection(position, position);
      }
      focused.add(uri);
      if (explicit) await remember(uri, true);
      updateContext();
    } finally { pending.delete(uri); }
  }

  async function full(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !eligible(editor.document)) return;
    const uri = editor.document.uri.toString();
    focused.delete(uri);
    await remember(uri, false);
    await vscode.window.showTextDocument(editor.document, { viewColumn: editor.viewColumn, preserveFocus: false });
    await removeFocusRanges(editor, anchors.get(uri) ?? []);
    anchors.delete(uri);
    await vscode.commands.executeCommand('editor.unfoldAll');
    updateContext();
  }

  async function activateEditor(editor?: vscode.TextEditor): Promise<void> {
    updateContext();
    if (!editor || !eligible(editor.document)) return;
    const preference = preferences[editor.document.uri.toString()];
    if (preference === true || (preference === undefined && vscode.workspace.getConfiguration('dauhuniec', editor.document.uri).get('focusUserCodeOnOpen', false))) {
      await focus(editor, false);
    }
  }

  const safe = (action: () => Promise<unknown>) => async () => {
    try { await action(); }
    catch (error) { void vscode.window.showErrorMessage(`Dauhuniec: ${error instanceof Error ? error.message : String(error)}`); }
  };
  context.subscriptions.push(
    vscode.commands.registerCommand('dauhuniec.focusUserCode', safe(() => focus())),
    vscode.commands.registerCommand('dauhuniec.showFullFile', safe(full)),
    vscode.commands.registerCommand('dauhuniec.toggleUserCodeFocus', safe(async () => {
      const uri = vscode.window.activeTextEditor?.document.uri.toString();
      if (uri && focused.has(uri)) await full(); else await focus();
    })),
    vscode.commands.registerCommand('dauhuniec.goToUserCode', safe(async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !eligible(editor.document)) return;
      const layout = userCodeLayout(editor.document.getText());
      if (layout.issues.length) { void vscode.window.showWarningMessage(`Dauhuniec: ${layout.issues[0]}`); return; }
      const picked = await vscode.window.showQuickPick(layout.blocks.map(block => ({
        label: block.label, description: `Line ${block.start + 1}`,
        detail: editor.document.getText(new vscode.Range(block.start + 1, 0, block.end, 0)).trim().split(/\r?\n/)[0] || 'Empty user block', block
      })), { title: 'Dauhuniec · USER CODE blocks', placeHolder: 'Jump to an editable CubeMX section' });
      if (!picked) return;
      const line = Math.min(picked.block.start + 1, picked.block.end);
      const position = new vscode.Position(line, editor.document.lineAt(line).firstNonWhitespaceCharacterIndex);
      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    })),
    vscode.window.onDidChangeActiveTextEditor(editor => { void activateEditor(editor).catch(() => undefined); }),
    vscode.workspace.onDidChangeTextDocument(event => {
      if (!eligible(event.document)) return;
      const uri = event.document.uri.toString();
      const layout = userCodeLayout(event.document.getText());
      if (anchors.has(uri) && !layout.issues.length) anchors.set(uri, layout.generated.map(range => range.start));
      if (focused.has(uri) && layout.issues.length) {
        focused.delete(uri);
        if (vscode.window.activeTextEditor?.document === event.document) {
          void full().then(() => vscode.window.showWarningMessage('Dauhuniec: USER CODE markers changed. The full file is shown until the pairs are complete.'));
        }
      }
      updateContext();
    }),
    vscode.workspace.onDidCloseTextDocument(document => { const uri = document.uri.toString(); focused.delete(uri); anchors.delete(uri); }),
    vscode.workspace.onDidChangeConfiguration(event => { if (event.affectsConfiguration('dauhuniec.focusUserCodeOnOpen')) void activateEditor(vscode.window.activeTextEditor); })
  );
  void activateEditor(vscode.window.activeTextEditor).catch(() => undefined);
}
