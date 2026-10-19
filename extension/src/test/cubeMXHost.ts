// Integration test in an isolated VS Code profile, using a fake CubeMX executable.
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';

export async function run(): Promise<void> {
  if (process.platform === 'win32') throw new Error('This host fixture requires a POSIX shell; Windows launch arguments are covered by unit tests.');
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, 'open an empty temporary workspace');
  assert.equal((await vscode.workspace.findFiles('**/*.ioc')).length, 0, 'fixture must start without projects');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cr-cubemx-host-'));
  const result = path.join(root, 'arguments');
  const application = path.join(root, 'Cube MX');
  const config = vscode.workspace.getConfiguration('dauhuniec');
  const previous = config.inspect<string>('cubeMXPath')?.globalValue;
  const ioc = vscode.Uri.joinPath(folder.uri, 'Board with spaces; $name.ioc');
  const quote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'";
  try {
    await fs.writeFile(application, `#!/bin/sh\nprintf '%s\\n' "$@" > ${quote(result)}\n`, { mode: 0o755 });
    await config.update('cubeMXPath', application, vscode.ConfigurationTarget.Global);
    await config.update('autoDetect', false, vscode.ConfigurationTarget.Global);
    const extension = vscode.extensions.getExtension('dauhuniec.dauhuniec');
    assert.ok(extension);
    await extension.activate();
    const invoke = async (expected: string, argument?: unknown) => {
      await fs.rm(result, { force: true });
      await vscode.commands.executeCommand('dauhuniec.openIOC', argument);
      let actual: string | undefined;
      for (let attempt = 0; attempt < 100; attempt++) {
        actual = await fs.readFile(result, 'utf8').catch(() => undefined);
        if (actual === expected) break;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      assert.equal(actual, expected);
    };
    await invoke('\n'); // Empty workspace: launch the application without a project.
    await fs.writeFile(ioc.fsPath, 'Mcu.CPN=STM32F446RETx\n');
    await invoke(`-i\n${ioc.fsPath}\n`, ioc); // Explorer/editor URI.
    await invoke(`-i\n${ioc.fsPath}\n`, folder.uri.fsPath); // Project sidebar root.
    await vscode.window.showTextDocument(ioc);
    await invoke(`-i\n${ioc.fsPath}\n`); // Active IOC editor.
    console.log('DAUHUNIEC_CUBEMX_HOST_TEST_PASS: empty workspace, IOC URI, project root and active editor');
  } finally {
    await config.update('cubeMXPath', previous, vscode.ConfigurationTarget.Global);
    await fs.rm(ioc.fsPath, { force: true });
    await fs.rm(root, { recursive: true, force: true });
  }
}
