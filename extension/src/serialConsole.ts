import * as vscode from 'vscode';
import * as path from 'node:path';
import { execute } from './service';

export interface ConsoleOptions { port: string; baud: number; ending?: 'lf' | 'crlf' | 'cr' | 'none'; hex?: boolean; }

export function consoleArgs(options: ConsoleOptions): string[] {
  if (typeof options.port !== 'string' || !options.port.trim() || options.port.length > 1024 || /[\r\n\0]/.test(options.port)
    || !Number.isInteger(options.baud) || options.baud < 1 || options.baud > 4000000
    || options.ending && !['lf', 'crlf', 'cr', 'none'].includes(options.ending)) throw new Error('Choose a serial port, a baud rate from 1 to 4000000 and a valid line ending.');
  return ['serial-console', '--port', options.port.trim(), '--baud', String(options.baud), '--ending', options.ending || 'lf', ...(options.hex ? ['--hex'] : [])];
}

export class SerialConsole implements vscode.Disposable {
  private terminal?: vscode.Terminal;
  private opening?: Promise<void>;
  private readonly closed: vscode.Disposable;

  constructor(private readonly context: vscode.ExtensionContext, private readonly binary: string) {
    this.closed = vscode.window.onDidCloseTerminal(terminal => { if (terminal === this.terminal) this.terminal = undefined; });
  }

  async open(options?: ConsoleOptions): Promise<void> {
    this.terminal ??= vscode.window.terminals.find(terminal => terminal.exitStatus === undefined
      && terminal.name.startsWith('Dauhuniec Serial · ') && (terminal.creationOptions as vscode.TerminalOptions).shellPath === this.binary);
    if (this.terminal?.exitStatus === undefined && this.terminal) {
      await vscode.commands.executeCommand('workbench.action.positionPanelBottom');
      this.terminal.show(); return;
    }
    if (this.opening) return this.opening;
    this.opening = this.launch(options);
    try { await this.opening; } finally { this.opening = undefined; }
  }

  private async launch(options?: ConsoleOptions): Promise<void> {
    if (!options) {
      const found: unknown = JSON.parse(await execute(this.binary, ['serial-list'], path.dirname(this.binary)));
      if (!Array.isArray(found) || !found.every(port => typeof port === 'string')) throw new Error('Invalid serial port list.');
      const previous = this.context.workspaceState.get<string>('serial.port', '');
      const ports = [...found].sort((a, b) => Number(b === previous) - Number(a === previous));
      const picked = await vscode.window.showQuickPick([
        ...ports.map(port => ({ label: port, port })), { label: 'Enter port manually…', port: '' }
      ], { title: 'Dauhuniec · Serial port', placeHolder: ports.length ? 'Choose the board port' : 'No ports found. Connect a board or enter a port manually.' });
      if (!picked) return;
      const port = picked.port || await vscode.window.showInputBox({ title: 'Serial port', value: previous,
        prompt: 'Windows: COM3 · macOS: /dev/cu.usbmodem… · Linux: /dev/ttyACM0' });
      if (!port) return;
      const previousBaud = String(this.context.workspaceState.get('serial.baud', 115200));
      const speeds = [...new Set([previousBaud, '9600', '19200', '38400', '57600', '115200', '230400', '460800', '921600'])];
      const speed = await vscode.window.showQuickPick([...speeds, 'Custom…'], { title: 'Dauhuniec · Baud rate' });
      if (!speed) return;
      const baud = speed === 'Custom…' ? await vscode.window.showInputBox({ title: 'Baud rate', value: previousBaud,
        validateInput: value => /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 4000000 ? undefined : 'Enter an integer from 1 to 4000000.' }) : speed;
      if (!baud) return;
      options = { port, baud: Number(baud) };
    }
    const args = consoleArgs(options);
    await vscode.commands.executeCommand('workbench.action.positionPanelBottom');
    this.terminal = vscode.window.createTerminal({ name: `Dauhuniec Serial · ${options.port}`, shellPath: this.binary,
      shellArgs: args, location: vscode.TerminalLocation.Panel, isTransient: false, message: 'Serial Monitor · /help for commands · Ctrl+C to disconnect\r\n' });
    this.terminal.show();
    await this.context.workspaceState.update('serial.port', options.port);
    await this.context.workspaceState.update('serial.baud', options.baud);
  }

  async startLogging(): Promise<void> {
    await this.open();
    const terminal = this.terminal;
    if (!terminal || terminal.exitStatus !== undefined) return;
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
    const filename = `serial-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`;
    const file = await vscode.window.showSaveDialog({ title: 'Serial log (append to existing file)', filters: { 'Serial message log': ['jsonl'] },
      defaultUri: folder ? vscode.Uri.joinPath(folder, filename) : undefined, saveLabel: 'Start Logging' });
    if (!file || this.terminal !== terminal || terminal.exitStatus !== undefined) return;
    if (/[\r\n\0]/.test(file.fsPath)) throw new Error('The log path cannot contain line breaks.');
    terminal.sendText(`/log ${file.fsPath}`, true);
    terminal.show();
  }

  stopLogging(): void {
    if (this.terminal && this.terminal.exitStatus === undefined) { this.terminal.sendText('/logoff', true); this.terminal.show(); }
  }

  async restoreLegacy(panel: vscode.WebviewPanel, state: unknown): Promise<void> {
    panel.dispose();
    const saved = state as { port?: unknown; baud?: unknown } | undefined;
    const baud = Number(saved?.baud);
    await this.open(typeof saved?.port === 'string' && saved.port && Number.isInteger(baud) && baud > 0 && baud <= 4000000
      ? { port: saved.port, baud } : undefined);
  }

  dispose(): void { this.closed.dispose(); this.terminal = undefined; }
}
