import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as vscode from 'vscode';
import { binaryFor } from '../service';

export async function run(): Promise<void> {
  if (process.platform === 'win32') throw new Error('This host fixture uses POSIX executables; portable selection is covered by unit tests.');
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder);
  assert.equal((await vscode.workspace.findFiles('**/*.ioc')).length, 0, 'use an empty temporary workspace');
  await vscode.workspace.getConfiguration('dauhuniec').update('autoDetect', false, vscode.ConfigurationTarget.Global);
  const extension = vscode.extensions.getExtension('dauhuniec.dauhuniec');
  assert.ok(extension);
  await extension.activate();
  const root = path.join(folder.uri.fsPath, 'Two identical boards');
  await fs.mkdir(root);
  const listing = path.join(root, 'probes.txt'), trace = path.join(root, 'programmer-args.txt');
  const quote = (text: string) => "'" + text.replace(/'/g, "'\\''") + "'";
  const probeList = (serials: string[]) => serials.map((serial, index) => `ST-Link Probe ${index}:\nST-LINK SN : ${serial}\nBoard Name : NUCLEO-C071RB\n`).join('');
  const script = `#!/bin/sh\nif [ "$1" = "-l" ]; then\n  cat ${quote(listing)}\nelif [ "$1" = "-c" ]; then\n  printf '%s\\n' "$@" > ${quote(trace)}\nelse\n  echo 'Dauhuniec fixture tool'\nfi\n`;
  try {
    await fs.writeFile(path.join(root, 'Board.ioc'), 'Mcu.CPN=STM32C071RBT6\nProjectManager.TargetToolchain=Makefile\n');
    await fs.writeFile(path.join(root, 'Makefile'), 'TARGET = Board\nBUILD_DIR = build\n');
    const plugins = path.join(root, 'plugins');
    const families: Record<string, string[]> = {
      'gnu-tools-for-stm32.14.3': ['arm-none-eabi-gcc','arm-none-eabi-gdb','arm-none-eabi-objcopy','arm-none-eabi-objdump','arm-none-eabi-size','arm-none-eabi-nm'],
      'stlink-gdb-server.2.2': ['ST-LINK_gdbserver'], 'cubeprogrammer.2.22': ['STM32_Programmer_CLI']
    };
    for (const [family, names] of Object.entries(families)) {
      const directory = path.join(plugins, `com.st.stm32cube.ide.mcu.externaltools.${family}`, 'tools/bin');
      await fs.mkdir(directory, { recursive:true });
      for (const name of names) await fs.writeFile(path.join(directory, name), script, { mode:0o755 });
    }
    const make = path.join(root, 'make'); await fs.writeFile(make, script, {mode:0o755});
    await fs.writeFile(listing, probeList(['AAAAAAAA','BBBBBBBB']));
    const binary = binaryFor(extension.extensionPath);
    await promisify(execFile)(binary, ['setup', root, '--cube-ide', plugins, '--make', make]);
    await fs.mkdir(path.join(root, 'build')); await fs.writeFile(path.join(root,'build/Board.elf'),'fixture ELF');
    await vscode.commands.executeCommand('dauhuniec.refresh');
    // Accept the picker in this isolated window. No physical probes are used.
    const acceptPicker = async (action: () => PromiseLike<unknown>) => {
      const timer = setInterval(() => { void vscode.commands.executeCommand('workbench.action.acceptSelectedQuickOpenItem'); }, 150);
      try { return await action(); } finally { clearInterval(timer); }
    };
    assert.equal(await fs.stat(path.join(root,'.dauhuniec/target.json')).then(()=>true,()=>false), false);
    await acceptPicker(() => vscode.commands.executeCommand('dauhuniec.selectTarget', root));
    let saved = JSON.parse(await fs.readFile(path.join(root,'.dauhuniec/target.json'),'utf8'));
    assert.equal(saved.serial, 'AAAAAAAA');
    assert.equal(await vscode.commands.executeCommand('dauhuniec.upload', root), 0);
    assert.match(await fs.readFile(trace,'utf8'), /sn=AAAAAAAA/);
    await fs.writeFile(listing, probeList(['BBBBBBBB','CCCCCCCC','AAAAAAAA']));
    await vscode.commands.executeCommand('dauhuniec.refresh');
    assert.equal(await vscode.commands.executeCommand('dauhuniec.upload', root), 0);
    assert.match(await fs.readFile(trace,'utf8'), /sn=AAAAAAAA/);
    await fs.rm(trace);
    await fs.writeFile(listing, probeList(['BBBBBBBB']));
    assert.equal(await vscode.commands.executeCommand('dauhuniec.upload', root), undefined);
    assert.equal(await fs.stat(trace).then(()=>true,()=>false), false, 'no programming when selected board is absent');
    saved = JSON.parse(await fs.readFile(path.join(root,'.dauhuniec/target.json'),'utf8'));
    assert.equal(saved.serial,'AAAAAAAA');
    await acceptPicker(() => vscode.commands.executeCommand('dauhuniec.selectTarget', root));
    assert.equal(await vscode.commands.executeCommand('dauhuniec.upload', root), 0);
    assert.match(await fs.readFile(trace,'utf8'), /sn=BBBBBBBB/);
    console.log('DAUHUNIEC_TARGET_HOST_PASS: picker for identical boards, explicit SN in upload task, sticky selection, disconnected-target block, manual change');
  } finally { await fs.rm(root, {recursive:true,force:true}); }
}
