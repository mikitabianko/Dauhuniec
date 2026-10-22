import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as vscode from 'vscode';
import { binaryFor } from '../service';
// Real Cortex-Debug adapter, synthetic executables: no board access or programming.
export async function run(): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder);
  const root = folder.uri.fsPath;
  await vscode.workspace.getConfiguration('dauhuniec').update('autoDetect', false, vscode.ConfigurationTarget.Workspace);
  const ext = vscode.extensions.getExtension('dauhuniec.dauhuniec');
  assert.ok(ext);
  const plugins = path.join(root, 'STMicroelectronics', 'STM32CubeIDE_99 ü [fixture].app', 'Contents/Eclipse/plugins');
  const trace = path.join(root, 'server-args.txt');
  const quote = (s: string) => "'" + s.replace(/'/g, "'\\''") + "'";
  const families: Record<string, string[]> = {
    'gnu-tools-for-stm32.14.3': ['arm-none-eabi-gcc', 'arm-none-eabi-gdb', 'arm-none-eabi-objcopy', 'arm-none-eabi-objdump', 'arm-none-eabi-size', 'arm-none-eabi-nm'],
    'stlink-gdb-server.2.2': ['ST-LINK_gdbserver'], 'cubeprogrammer.2.22': ['STM32_Programmer_CLI'], 'make.4.4': ['make']
  };
  const binaries: Record<string, string> = {};
  for (const [family, names] of Object.entries(families)) {
    const dir = path.join(plugins, 'com.st.stm32cube.ide.mcu.externaltools.' + family, 'tools/bin');
    await fs.mkdir(dir, { recursive: true });
    for (const name of names) {
      const file = path.join(dir, name);
      binaries[name] = file;
      let script = '#!/bin/sh\necho "GNU gdb (fixture) 14.3"\n';
      if (name === 'STM32_Programmer_CLI')
        script = '#!/bin/sh\necho "ST-Link Probe 0:"\necho "ST-LINK SN : AAAAAAAA"\necho "Board Name : Synthetic Board"\n';
      if (name === 'ST-LINK_gdbserver')
        script = `#!/bin/sh\nprintf '%s\\n' "$@" > ${quote(trace)}\nexit 23\n`;
      if (name === 'arm-none-eabi-gdb')
        script = `#!/usr/bin/env node\nif(process.argv.includes('--version')){console.log('GNU gdb (fixture) 14.3');process.exit(0)};console.log('(gdb)');require('node:readline').createInterface({input:process.stdin}).on('line',s=>{const token=/^\\d+/.exec(s)?.[0]||'';console.log(token+'^done');console.log('(gdb)');});\n`;
      await fs.writeFile(file, script, { mode: 0o755 });
    }
  }
  await fs.writeFile(path.join(root, 'Board.ioc'), 'Mcu.CPN=STM32F446RETx\nProjectManager.TargetToolchain=Makefile\n');
  await fs.writeFile(path.join(root, 'Makefile'), 'TARGET = Board\nBUILD_DIR = build\n');
  await promisify(execFile)(binaryFor(ext.extensionPath), ['setup', root, '--cube-ide', plugins, '--make', binaries.make]);
  await fs.mkdir(path.join(root, 'build'), { recursive: true });
  await fs.writeFile(path.join(root, 'build/Board.elf'), 'synthetic ELF');
  const cfg = vscode.workspace.getConfiguration('dauhuniec', folder.uri);
  await cfg.update('cubeIDEPath', plugins, vscode.ConfigurationTarget.WorkspaceFolder);
  await cfg.update('server', '', vscode.ConfigurationTarget.WorkspaceFolder);
  const stateFile=path.join(root,'.dauhuniec/tools.json');const state=JSON.parse(await fs.readFile(stateFile,'utf8'));
  state.tools.gdb=path.join(root,'stale managed GDB');await fs.writeFile(stateFile,JSON.stringify(state));
  await cfg.update('gdb',state.tools.gdb,vscode.ConfigurationTarget.WorkspaceFolder);
  await ext.activate();
  await vscode.extensions.getExtension('marus25.cortex-debug')?.activate();
  await new Promise(resolve => setTimeout(resolve, 1000));
  const received: vscode.DebugConfiguration[] = [];
  const tracker = vscode.debug.registerDebugAdapterTrackerFactory('cortex-debug', { createDebugAdapterTracker() { return { onWillReceiveMessage(message) { if (message.command === 'launch' || message.command === 'attach')
        received.push(message.arguments); } }; } });
  try {
    for (const request of ['launch', 'attach']) {
      const count = received.length;
      await vscode.debug.startDebugging(folder, { name: `Dauhuniec: ${request} fixture`, type: 'cortex-debug', request, servertype: 'stlink', cwd: root, executable: path.join(root, 'build/Board.elf'), device: 'STM32F446RETx', gdbPath: '${config:dauhuniec.gdb}', objdumpPath: binaries['arm-none-eabi-objdump'], nmPath: binaries['arm-none-eabi-nm'], serverPath: '${config:dauhuniec.server}', stm32cubeprogrammer: path.dirname(binaries.STM32_Programmer_CLI) }).then(value => value, (error: unknown) => { console.log('Synthetic adapter launch stopped:', String(error)); return false; });
      for (let i = 0; i < 100 && received.length === count; i++)
        await new Promise(resolve => setTimeout(resolve, 50));
      const config = received.at(-1);
      assert.ok(config && received.length > count, `${request} reached real Cortex-Debug`);
      assert.equal(config.serverPath, undefined, 'wrong-case key corrected');
      assert.equal(config.gdbPath,binaries['arm-none-eabi-gdb'],'stale managed GDB recovered after variable substitution');assert.equal(config.__dauhuniecToolReferences,undefined,'internal substitution markers removed');
      assert.equal(config.serverpath, binaries['ST-LINK_gdbserver']);
      assert.ok(path.isAbsolute(config.serverpath));
      assert.ok((await fs.stat(config.serverpath)).isFile());
      assert.equal(config.serialNumber, 'AAAAAAAA', 'probe preserved');
      await vscode.debug.stopDebugging();
    }
    const window = vscode.window as unknown as Record<string, unknown>;
    const save = window.showSaveDialog, info = window.showInformationMessage;
    try {
      window.showSaveDialog = async () => vscode.Uri.file(path.join(root, 'debug-support.zip'));
      window.showInformationMessage = async () => undefined;
      await vscode.commands.executeCommand('dauhuniec.exportDiagnosticReport');
      const report = await fs.readFile(path.join(root, 'debug-support.zip'));
      assert.ok(report.includes(Buffer.from('ST-LINK_gdbserver')));
      assert.ok(!report.includes(Buffer.from('AAAAAAAA')), 'probe serial redacted from all captured adapter/CLI output');
    }
    finally {
      window.showSaveDialog = save;
      window.showInformationMessage = info;
    }
    console.log('DAUHUNIEC_DEBUG_HOST_PASS: real Cortex-Debug received absolute existing serverpath after substitution for Debug and Attach; empty setting and serverPath typo recovered; probe preserved');
  }
  finally {
    tracker.dispose();
    await vscode.debug.stopDebugging();
  }
}

