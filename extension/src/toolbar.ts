import * as vscode from 'vscode';
import * as path from 'node:path';
import { Report } from './service';

export interface ToolbarState {
  report?: Report;
  projectCount: number;
  busy?: string;
  cancellable?: boolean;
  failed?: string;
}

/** Icon-only shortcuts for the frequent project actions. */
export class ProjectToolbar implements vscode.Disposable {
  private readonly items = new Map<string, vscode.StatusBarItem>();
  constructor(createItem: (id: string, alignment: vscode.StatusBarAlignment, priority: number) => vscode.StatusBarItem = vscode.window.createStatusBarItem) {
    ['home', 'cubeMX', 'buildPreset', 'build', 'upload', 'flash', 'debug', 'serialMonitor', 'stop'].forEach((name, index) => {
      const item = createItem(`dauhuniec.${name}`, vscode.StatusBarAlignment.Left, 20 - index / 10);
      item.name = `Dauhuniec: ${name}`;
      this.items.set(name, item);
    });
  }

  update(state: ToolbarState): void {
    for (const item of this.items.values()) item.hide();
    const { report } = state;
    const show = (id: string, text: string, command: string | undefined, tooltip: string) => {
      const item = this.items.get(id)!;
      item.text = text;
      item.command = command;
      item.tooltip = tooltip;
      item.accessibilityInformation = { label: tooltip };
      item.show();
    };
    show('serialMonitor', '$(terminal)', 'dauhuniec.serialMonitor', 'Dauhuniec: Open Serial Monitor');
    if (!report && !state.projectCount) return;
    const status = state.busy ?? (state.failed ? `${state.failed} failed` : report?.ready ? 'Ready to build and flash' : 'Setup needs attention');
    const icon = state.busy ? 'sync~spin' : state.failed ? 'error' : report && !report.ready ? 'warning' : 'home';
    const project = report ? `${path.basename(report.root)} · ${report.project?.device ?? 'CubeMX project'}\n${report.root}\n${status}` : `${state.projectCount} CubeMX projects found`;
    show('home', `$(${icon})`, 'workbench.view.extension.dauhuniec', `Dauhuniec: Home\n${project}`);
    show('cubeMX', '$(settings-gear)', 'dauhuniec.openIOC', `Dauhuniec: Open in STM32CubeMX\n${report ? path.basename(report.root) : 'Open STM32CubeMX / Create Project'}`);
    if (state.busy) {
      if (state.cancellable) show('stop', '$(debug-stop)', 'dauhuniec.stopTask', `Dauhuniec: Stop Task\n${state.busy}`);
      return;
    }
    const actions=report?.toolDiscovery?.actions;
    const buildAvailable=!!report?.ready || !!actions?.build;
    const flashAvailable=!!report?.ready || !!actions?.flash;
    const debugAvailable=!!report?.ready || !!actions?.debug;
    if(!report?.project)return;
    if (report.buildPreset) show('buildPreset', `$(layers) ${report.buildPreset}`, 'dauhuniec.selectBuildPreset', 'Dauhuniec: Select Build Preset');
    if(buildAvailable)show('build', '$(check)', 'dauhuniec.build', `Dauhuniec: Build Firmware\n${path.basename(report.root)} · Compile without flashing`);
    if(flashAvailable)show('upload', '$(arrow-up)', 'dauhuniec.upload', `Dauhuniec: Flash Firmware\n${path.basename(report.root)} · Flash the existing ELF and run; no build`);
    if(buildAvailable&&flashAvailable)show('flash', '$(rocket)', 'dauhuniec.flash', `Dauhuniec: Build and Flash\n${path.basename(report.root)} · Build, flash and run firmware`);
    if(buildAvailable&&debugAvailable)show('debug', '$(debug-alt)', 'dauhuniec.debug', `Dauhuniec: Start Debugging\n${path.basename(report.root)} · Build firmware and launch Cortex-Debug`);
  }

  dispose(): void { for (const item of this.items.values()) item.dispose(); }
}
