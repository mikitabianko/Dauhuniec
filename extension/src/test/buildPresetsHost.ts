import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { testToolbar } from './toolbarHost';

// Run in an empty, disposable workspace with the freshly built CLI.
export async function run(): Promise<void> {
  testToolbar();
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  assert.ok(root);
  await vscode.workspace.getConfiguration('dauhuniec').update('autoDetect', false, vscode.ConfigurationTarget.Global);
  await fs.writeFile(path.join(root, 'Board.ioc'), 'Mcu.CPN=STM32F446RETx\nProjectManager.TargetToolchain=Makefile\n');
  await fs.writeFile(path.join(root, 'Makefile'), 'TARGET = Board\nBUILD_DIR = build\n');
  const extension = vscode.extensions.getExtension('dauhuniec.dauhuniec');
  assert.ok(extension);
  const api = await extension.activate();
  let report = await api.refresh();
  assert.equal(report.buildPreset, 'debug');
  assert.match(report.project.build_dir, /^build\/debug\//);
  await vscode.commands.executeCommand('dauhuniec.editBuildPresets', root);
  const file = path.join(root, 'dauhuniec.json');
  const text = await fs.readFile(file, 'utf8');
  assert.equal(vscode.window.activeTextEditor?.document.uri.fsPath, file);
  const config = JSON.parse(text);
  config.default_preset = 'release';
  delete config.presets.custom;
  await fs.writeFile(file, JSON.stringify(config));
  await vscode.commands.executeCommand('dauhuniec.editBuildPresets', root);
  assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).default_preset, 'release', 'editing preserves existing presets');
  report = await api.refresh();
  assert.equal(report.buildPreset, 'release');
  assert.match(report.project.build_dir, /^build\/release\//);
  // The sorted selector starts with debug. Accept it through the real UI.
  const accept = setInterval(() => { void vscode.commands.executeCommand('workbench.action.acceptSelectedQuickOpenItem'); }, 200);
  try { await vscode.commands.executeCommand('dauhuniec.selectBuildPreset', root); }
  finally { clearInterval(accept); }
  assert.equal(JSON.parse(await fs.readFile(path.join(root, '.dauhuniec/build-preset.json'), 'utf8')), 'debug');
  report = await api.refresh();
  assert.equal(report.buildPreset, 'debug');
  const oldOutput = report.project.build_dir;
  config.presets.debug.build_flags = ['-DHOST_TEST=1'];
  await fs.writeFile(file, JSON.stringify(config));
  report = await api.refresh();
  assert.equal(report.buildPreset, 'debug', 'local selection wins over file default');
  assert.notEqual(report.project.build_dir, oldOutput, 'flag edits invalidate build output');
  console.log('DAUHUNIEC_PRESETS_HOST_PASS: toolbar, default, config editing, selector persistence, precedence and flag invalidation');
}
