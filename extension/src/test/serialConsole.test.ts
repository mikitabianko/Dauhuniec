import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import * as vm from 'node:vm';

function harness() {
  const terminals: any[] = [], commands: string[] = [];
  const saved = new Map<string, unknown>([['serial.port', '/dev/cu.usbmodem144203'], ['serial.baud', 9600]]);
  const vscode = { TerminalLocation: { Panel: 1 }, workspace: {},
    window: { terminals, onDidCloseTerminal: () => ({ dispose() {} }),
      showQuickPick: async (items: any[]) => items[0],
      showSaveDialog: async () => ({ fsPath: '/logs/session with spaces;test.jsonl' }),
      createTerminal: (options: any) => {
        const terminal = { creationOptions: options, name: options.name, exitStatus: undefined as unknown, sent: [] as string[],
          show() {}, sendText(text: string) { this.sent.push(text); } };
        terminals.push(terminal); return terminal;
      } },
    commands: { executeCommand: async (name: string) => { commands.push(name); } } };
  const filename = path.join(__dirname, '../serialConsole.js');
  const nativeRequire = createRequire(filename), module = { exports: {} as any };
  vm.runInNewContext(readFileSync(filename, 'utf8'), { module, exports: module.exports,
    require: (name: string) => name === 'vscode' ? vscode : name === './service' ? {
      execute: async () => JSON.stringify(['/dev/cu.BLTH', '/dev/cu.usbmodem144203']) } : nativeRequire(name) });
  const context = { workspaceState: { get: (key: string, fallback: unknown) => saved.get(key) ?? fallback,
    update: async (key: string, value: unknown) => { saved.set(key, value); } } };
  return { ...module.exports, terminals, commands, vscode, context };
}

test('console opens in the terminal panel, remembers the selected board and reuses a running session', async () => {
  const h = harness();
  const console = new h.SerialConsole(h.context, '/native/tool');
  await console.open();
  assert.equal(h.terminals.length, 1);
  const options = h.terminals[0].creationOptions;
  assert.equal(options.location, 1);
  assert.equal(options.shellPath, '/native/tool');
  assert.deepEqual(Array.from(options.shellArgs), ['serial-console', '--port', '/dev/cu.usbmodem144203', '--baud', '9600', '--ending', 'lf']);
  assert.equal(options.isTransient, false);
  assert.ok(h.commands.includes('workbench.action.positionPanelBottom'));
  await console.open();
  assert.equal(h.terminals.length, 1);
  const restored = new h.SerialConsole(h.context, '/native/tool');
  await restored.open();
  assert.equal(h.terminals.length, 1, 'adopts the native terminal after extension reload');
});

test('console arguments preserve paths without shell interpolation and reject invalid parameters', () => {
  const h = harness();
  const port = '/dev/board with spaces; $(not-a-shell)';
  assert.equal(h.consoleArgs({ port, baud:115200, hex:true })[2], port);
  for (const options of [{port:'',baud:115200}, {port:'COM1',baud:0}, {port:'COM1',baud:1.5}, {port:'COM1',baud:9600,ending:'invalid'}]) {
    assert.throws(() => h.consoleArgs(options));
  }
});

test('optional logging commands target the running console and an exited session is replaced', async () => {
  const h = harness();
  const console = new h.SerialConsole(h.context, '/native/tool');
  await console.open({port:'COM3',baud:115200});
  assert.deepEqual(h.terminals[0].sent, []);
  await console.startLogging(); console.stopLogging();
  assert.deepEqual(h.terminals[0].sent, ['/log /logs/session with spaces;test.jsonl', '/logoff']);
  h.terminals[0].exitStatus = {code:1};
  await console.open({port:'COM4',baud:9600});
  assert.equal(h.terminals.length, 2);
});
