import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import { spawn, execFile } from 'node:child_process';
import { diagnostics, createRedactor, reportFiles, zipFiles, pathCharacteristics } from './diagnosticReport';
import { historyKey, pickerDirectory } from './toolSelection';
import { intelliSenseChecks, ensureClangd, clangdExtension } from './intelliSense';
import { ProjectToolbar } from './toolbar';
import { openDocumentation } from './documentationBrowser';
import { registerUserCodeFocus } from './userCodeEditor';
import { launchCubeMX, cubeMXLaunch } from './cubeMX';
import { SerialConsole, ConsoleOptions } from './serialConsole';
import { TargetBoards, parseProbeReport, pinDebugTarget } from './targetBoard';
import { binaryFor, execute, inspect, Report, ToolOptions, toolArgs, resolveDebugServer, discover, ToolsReport } from './service';

interface Node { label: string; description?: string; icon?: string; command?: string; root?: string; children?: Node[]; detail?: string; }

const officialDownloads = {
  cubeMX: { label: 'STM32CubeMX', detail: 'Create projects and generate STM32 code.', url: 'https://www.st.com/en/development-tools/stm32cubemx.html' },
  cubeIDE: { label: 'STM32CubeIDE', detail: 'Install the desktop IDE with ARM GCC, GDB, Make, ST-LINK server and CubeProgrammer.', url: 'https://www.st.com/en/development-tools/stm32cubeide.html' },
  stlink: { label: 'ST-LINK USB driver (STSW-LINK009)', detail: 'Windows USB driver for connecting an ST-LINK probe.', url: 'https://www.st.com/en/development-tools/stsw-link009.html' }
};

type DownloadTool = keyof typeof officialDownloads;

class ProjectView implements vscode.TreeDataProvider<Node> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  nodes: Node[] = [];
  refresh(): void { this.changed.fire(); }
  getChildren(node?: Node): Node[] { return node ? node.children ?? [] : this.nodes; }
  getTreeItem(node: Node): vscode.TreeItem {
    const item = new vscode.TreeItem(node.label, node.children ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
    item.description = node.description;
    item.tooltip = node.detail ?? node.description ?? node.label;
    if (node.icon) item.iconPath = new vscode.ThemeIcon(node.icon);
    if (node.command) item.command = { command: node.command, title: node.label, arguments: node.root ? [node.root] : [] };
    return item;
  }
}

export async function activate(context: vscode.ExtensionContext) {
  registerUserCodeFocus(context);
  const channel = vscode.window.createOutputChannel('Dauhuniec');
  const output = { append(text: string) { channel.append(text); diagnostics.record('log',text); }, appendLine(text: string) { channel.appendLine(text); diagnostics.record('log',text); }, show(preserveFocus?: boolean) { channel.show(preserveFocus); }, dispose() { channel.dispose(); } };
  const view = new ProjectView();
  const projectView = new ProjectView();
  const diagnosticsView = new ProjectView();
  const resourcesView = new ProjectView();
  resourcesView.nodes = [
    { label: 'Documentation · MCU / Board / HAL / RTOS', command: 'dauhuniec.documentation', icon: 'library' },
    { label: 'Serial Monitor', command: 'dauhuniec.serialMonitor', icon: 'terminal' },
    { label: 'Install Tools / Official Downloads', command: 'dauhuniec.installTools', icon: 'cloud-download' },
    ...(process.platform === 'win32' ? [{ label: 'Windows Setup Instructions', command: 'dauhuniec.windowsGuide', icon: 'book' }] : []),
    { label: 'Getting Started', command: 'dauhuniec.guide', icon: 'book' },
    { label: 'Install / Update clangd', command: 'dauhuniec.installClangd', icon: 'cloud-download' },
    { label: 'Export Diagnostic Report', command: 'dauhuniec.exportDiagnosticReport', icon: 'export' }
  ];
  const toolbar = new ProjectToolbar();
  const running = new Map<string, { label: string; execution?: vscode.TaskExecution }>();
  const failures = new Map<string, string>();
  const taskCodes=new Map<string,number>();
  let projectCount = 0;
  const binary = (()=>{try{return binaryFor(context.extensionPath);}catch(error){diagnostics.record('cli.unavailable',String(error));return path.join(context.extensionPath,'bin','unavailable');}})();
  const serialMonitor = new SerialConsole(context, binary);
  context.subscriptions.push(serialMonitor,
    vscode.window.registerWebviewPanelSerializer('dauhuniec.serialMonitor', {
      async deserializeWebviewPanel(panel, state) { await serialMonitor.restoreLegacy(panel, state); }
    }));
  const active = new Set<string>();
  let selected: string | undefined = context.workspaceState.get('selectedProject');
  let current: Report | undefined;
  const targets = new TargetBoards({
    list: async root => parseProbeReport(await execute(binary, ['probes', '--project', root, '--json'], root)),
    save: async (root, serial) => JSON.parse(await execute(binary, ['select-probe', '--project', root, '--probe-serial', serial, '--json'], root)),
    pick: async (probes, selected) => {
      const picked = await vscode.window.showQuickPick(probes.map(probe => ({
        label: probe.name || 'ST-LINK', description: `S/N ${probe.serial}`,
        detail: `${probe.serial === selected?.serial ? 'Current target · ' : ''}${probe.firmware ? `Firmware ${probe.firmware} · ` : ''}Flash/debug this exact device`, probe
      })), { title: 'Dauhuniec · Which board should receive the firmware?',
        placeHolder: 'Choose the exact physical board by its ST-LINK serial number', ignoreFocusOut: true });
      return picked?.probe;
    },
    changed: root => { if (current?.root === root) showReport(current); }
  });
  let refreshTimer: NodeJS.Timeout | undefined;
  let generation = 0;
  const databaseDirty = new Set<string>();
  const databaseInitialized = new Set<string>();
  const databaseJobs = new Map<string, Promise<void>>();
  const databaseErrors = new Map<string, string>();
  const choices = new Map<string, ToolOptions>();
  // Keep startup actions in the provider so stale welcome contributions cannot repeat them.
  const actionsView = vscode.window.createTreeView('dauhuniec.projects', { treeDataProvider: view });
  context.subscriptions.push(output, toolbar,
    actionsView,
    vscode.window.registerTreeDataProvider('dauhuniec.projectSettings', projectView),
    vscode.window.registerTreeDataProvider('dauhuniec.diagnostics', diagnosticsView),
    vscode.window.registerTreeDataProvider('dauhuniec.resources', resourcesView));

  function trusted(): void {
    if (!vscode.workspace.isTrusted) throw new Error('Trust the project in VS Code before running Dauhuniec.');
  }

  function options(root: string): ToolOptions {
    const config = vscode.workspace.getConfiguration('dauhuniec', vscode.Uri.file(root));
    return { cubeIDE: config.get<string>('cubeIDEPath') || undefined, make: config.get<string>('makePath') || undefined, cubeMX:config.get<string>('cubeMXPath')||undefined,...context.workspaceState.get<ToolOptions>(`toolOverrides:${root}`,{}), ...choices.get(root) };
  }

  async function workingPaths(root?: string): Promise<Record<string, string>> {
    const cfg = vscode.workspace.getConfiguration('dauhuniec', root ? vscode.Uri.file(root) : undefined);
    if (root && vscode.workspace.getWorkspaceFolder(vscode.Uri.file(root))?.uri.fsPath !== root) {
      try {
        return JSON.parse(await fs.readFile(path.join(root, '.dauhuniec/tools.json'), 'utf8')).tools || {};
      }
      catch {
        return {};
      }
    }
    return Object.fromEntries(['gcc', 'gdb', 'objcopy', 'objdump', 'nm', 'size', 'server', 'programmer', 'make'].map(key => [key, cfg.get<string>(key, '')]));
  }

  async function toolReport(root?: string, overrides: ToolOptions = {}): Promise<ToolsReport> {
    const cfg = vscode.workspace.getConfiguration('dauhuniec', root ? vscode.Uri.file(root) : undefined);
    return discover(binary, root || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || os.homedir(), { cubeMX: cfg.get<string>('cubeMXPath') || undefined, ...(root ? options(root) : {}), ...overrides }, { ...context.workspaceState.get<Record<string, string>>(`lastWorkingTools:${root || 'workspace'}`, {}), ...(root ? await workingPaths(root) : {}) });
  }

  async function saveToolChoice(root: string | undefined, kind: 'cubeIDE' | 'make' | 'cubeMX', value: string): Promise<void> {
    const setting = kind === 'cubeIDE' ? 'cubeIDEPath' : kind === 'make' ? 'makePath' : 'cubeMXPath';
    if (root) {
      // A containing workspace folder can hold several independent CubeMX projects.
      // Snapshot their effective overrides before updating its shared setting.
      for (const other of await projects())
        if (other !== root) {
          const key = `toolOverrides:${other}`;
          const prior = context.workspaceState.get<ToolOptions>(key, {});
          if (!(kind in prior))
            await context.workspaceState.update(key, { ...prior, [kind]: options(other)[kind] || '' });
        }
      await context.workspaceState.update(`toolOverrides:${root}`, { ...context.workspaceState.get<ToolOptions>(`toolOverrides:${root}`, {}), [kind]: value });
      choices.set(root, { ...choices.get(root), [kind]: value });
    }
    if (!root || kind === 'cubeMX' || vscode.workspace.getWorkspaceFolder(vscode.Uri.file(root))?.uri.fsPath === root)
      await vscode.workspace.getConfiguration('dauhuniec', root ? vscode.Uri.file(root) : undefined).update(setting, value, root ? vscode.ConfigurationTarget.WorkspaceFolder : vscode.ConfigurationTarget.Workspace);
  }

  function toolInstallationName(executable: string): string {
    return executable.split(/[\\/]/).find(part => /^STM32CubeIDE/i.test(part)) || path.basename(path.dirname(executable));
  }

  async function resolveTools(root: string | undefined, action: string): Promise<Record<string, string> | undefined> {
    let report = await toolReport(root);
    const required = ({ build: ['gcc', 'objcopy', 'size', 'make'], flash: ['programmer'], debug: ['gdb', 'objdump', 'nm', 'server', 'programmer'], cubeMX: ['cubeMX'] } as Record<string, string[]>)[action] || [];
    for (const kind of action === 'cubeMX' ? ['cubeMX'] : action === 'flash' || action === 'debug' ? ['cubeIDE'] : ['cubeIDE', 'make']) {
      const cfg = vscode.workspace.getConfiguration('dauhuniec', root ? vscode.Uri.file(root) : undefined);
      const setting = kind === 'cubeIDE' ? 'cubeIDEPath' : kind === 'make' ? 'makePath' : 'cubeMXPath';
      const explicit = root ? options(root)[kind as keyof ToolOptions] : cfg.get<string>(setting);
      const candidate = report.candidates?.find(candidate => candidate.kind === kind && candidate.source === 'explicit');
      if (explicit && (!candidate?.valid || (kind === 'cubeIDE' && !required.filter(key => key !== 'make').every(key => candidate.components?.[key])))) {
        const alternatives = (report.alternatives[kind] || []).filter(c => kind !== 'cubeIDE' || required.filter(key => key !== 'make').every(key => c.components?.[key]));
        const replacement = alternatives[0];
        const choice = await vscode.window.showWarningMessage(`The selected ${kind} installation is unavailable.${replacement ? ' Use the discovered installation ' + path.basename(replacement.originalPath) + '?' : ''}`, ...(replacement ? ['Use Discovered Installation', 'Other Installations'] : []), 'Select Path', 'Official Downloads', 'Create Error Report', 'Keep Current Selection');
        diagnostics.record('recovery.choice', { action, kind, choice, alternative: replacement });
        let selectedAlternative: import('./service').ToolCandidate | undefined = replacement;
        if (choice === 'Other Installations')
          selectedAlternative = (await vscode.window.showQuickPick(alternatives.map(c => ({ label: path.basename(c.originalPath), description: c.originalPath, c })), { title: 'Select installation' }))?.c;
        if ((choice === 'Use Discovered Installation' || choice === 'Other Installations') && selectedAlternative) {
          const validated = await toolReport(root, { [kind]: selectedAlternative.originalPath });
          if (!validated.actions[action])
            throw new Error('The alternative failed validation; previous settings were preserved.');
          await saveToolChoice(root, kind as 'cubeIDE' | 'make' | 'cubeMX', selectedAlternative.originalPath);
          report = validated;
        }
        else if (choice === 'Select Path') {
          if (!await chooseTool(kind as 'cubeIDE' | 'make' | 'cubeMX', root))
            return;
          report = await toolReport(root);
        }
        else {
          if (choice === 'Official Downloads')
            await openDownload(kind === 'cubeMX' ? 'cubeMX' : 'cubeIDE');
          if (choice === 'Create Error Report')
            await exportDiagnosticReport();
          return;
        }
      }
    }
    const tools = report.actions[action];
    if (!tools || !required.every(key => tools[key])) {
      diagnostics.record('discovery.failure', { action, report });
      const choice = await vscode.window.showErrorMessage(`Required ${action === 'cubeMX' ? 'STM32CubeMX' : action + ' tools'} could not be found.`, 'Select Path', 'Official Downloads', 'Create Error Report');
      if (choice === 'Select Path' && await chooseTool(action === 'cubeMX' ? 'cubeMX' : 'cubeIDE', root))
        return resolveTools(root, action);
      if (choice === 'Official Downloads')
        await openDownload(action === 'cubeMX' ? 'cubeMX' : 'cubeIDE');
      if (choice === 'Create Error Report')
        await exportDiagnosticReport();
      return;
    }
    if (root && action !== 'cubeMX') {
      let saved: Record<string, string> = {};
      try {
        saved = JSON.parse(await fs.readFile(path.join(root, '.dauhuniec/tools.json'), 'utf8')).tools || {};
      }
      catch { }
      const cfg = vscode.workspace.getConfiguration('dauhuniec', vscode.Uri.file(root));
      for (const key of required) {
        const value = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(root))?.uri.fsPath === root ? cfg.get<string>(key) : saved[key];
        if (!value || value === saved[key] || value === tools[key])
          continue;
        // Values matching tools.json were written by setup. A changed value is an explicit choice.
        try {
          await resolveDebugServer(root, value, async () => undefined);
          tools[key] = value;
        }
        catch (error) {
          const answer = await vscode.window.showWarningMessage(`The selected ${key} is unavailable. Use the discovered executable from ${toolInstallationName(tools[key])}?`, 'Use Discovered Tool', 'Select Path', 'Create Error Report');
          diagnostics.record('recovery.choice', { action, key, answer, previous: value, replacement: tools[key] });
          if (answer === 'Use Discovered Tool')
            await cfg.update(key, tools[key], vscode.ConfigurationTarget.WorkspaceFolder);
          else if (answer === 'Select Path' && await chooseTool(key === 'make' ? 'make' : 'cubeIDE', root))
            return resolveTools(root, action);
          else {
            if (answer === 'Create Error Report')
              await exportDiagnosticReport();
            return;
          }
        }
      }
    }
    output.appendLine(`Tool selection for ${action}: ${JSON.stringify({ tools, selection: report.selection, candidates: report.candidates })}`);
    return tools;
  }

  async function exportDiagnosticReport(): Promise<void> {
    // Export uses captured events and read-only metadata; never reruns an action.
    const root = selected;
    const cfg = vscode.workspace.getConfiguration('dauhuniec', root ? vscode.Uri.file(root) : undefined);
    const settings: Record<string, unknown> = {};
    for (const key of ['cubeIDEPath', 'makePath', 'cubeMXPath', 'gcc', 'gdb', 'objcopy', 'objdump', 'nm', 'size', 'make', 'server', 'programmer', 'programmerDir', 'device', 'elf', 'runner']) {
      let value;
      try {
        value = cfg.inspect(key);
      }
      catch (error) {
        settings[key] = { collected: false, reason: String(error) };
        continue;
      }
      settings[key] = { effective: cfg.get(key), source: value?.workspaceFolderValue !== undefined ? 'workspaceFolder' : value?.workspaceValue !== undefined ? 'workspace' : value?.globalValue !== undefined ? 'user' : 'default' };
    }
    const presence: Record<string, boolean> = {};
    if (root)
      for (const name of ['Makefile', 'CMakeLists.txt', '.vscode/launch.json', '.dauhuniec/tools.json', ...(current?.project ? [current.project.ioc] : [])])
        presence[name] = await fs.stat(path.join(root, name)).then(s => s.isFile(), () => false);
    for (const [section, key] of [['C_Cpp', 'intelliSenseEngine'], ['clangd', 'enable'], ['stm32cube-ide-clangd', 'enable'],
      ['cmake', 'sourceDirectory'], ['cmake', 'autoDetectSourceDirectory'], ['cmake', 'configureOnOpen'],
      ['cmake', 'configureOnEdit'], ['cmake', 'ignoreCMakeListsMissing'], ['stm32cube-ide-build-cmake', 'ignoreCubeProjectDiscovery']]) {
      const language = vscode.workspace.getConfiguration(section, root ? vscode.Uri.file(root) : undefined);
      const value = language.inspect(key);
      settings[`${section}.${key}`] = { effective: language.get(key), source: value?.workspaceFolderValue !== undefined ? 'workspaceFolder' : value?.workspaceValue !== undefined ? 'workspace' : value?.globalValue !== undefined ? 'user' : 'default' };
    }
    const events = diagnostics.snapshot();
    const serials = events.flatMap(event => [...JSON.stringify(event.data).matchAll(/(?:serialNumber|serial(?:\s+number)?|sn)["']?\s*[:=]\s*["']?([A-Za-z0-9_-]{6,})/gi)].map(match => match[1]));
    if (root) {
      const state = targets.get(root);
      if (state?.selected?.serial)
        serials.push(state.selected.serial);
      for (const probe of state?.probes || [])
        serials.push(probe.serial);
    }
    const categories = {
      versions: { collected: true, extension: context.extension.packageJSON.version, vscode: vscode.version, cli: (events.filter(e => e.stage === 'discovery').at(-1)?.data as ToolsReport | undefined)?.version || { collected: false, reason: 'CLI discovery unavailable or not requested' } },
      host: { collected: true, os: os.platform(), release: os.release(), systemArchitecture: os.machine(), processArchitecture: process.arch, language: vscode.env.language, locale: Object.fromEntries(Object.keys(process.env).filter(k => k === 'LANG' || k === 'LANGUAGE' || /^LC_[A-Z_]+$/.test(k)).map(k => [k, process.env[k]])), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
      pathCharacteristics: {collected:true,home:pathCharacteristics(os.homedir()),reason:'Home paths are redacted; these flags/code points preserve path-encoding clues without revealing usernames'},
      settings: { collected: true, values: settings, projectOverrides: root ? { source: 'workspaceState', values: context.workspaceState.get<ToolOptions>(`toolOverrides:${root}`, {}) } : undefined }, project: { collected: !!root, root, project: current?.project, type: current?.project ? 'CubeMX Makefile' : undefined, presence, reason: root ? undefined : 'No project selected' },
      discovery: { collected: events.some(e => e.stage === 'discovery'), reason: 'See captured discovery events; export does not run tools' },
      validation: { collected: events.some(e => e.stage === 'discovery' || e.stage === 'debug.configuration'), reason: 'File and symlink validation is included in discovery and debug events' },
      debug: { collected: events.some(e => e.stage === 'debug.configuration'), reason: 'No substituted Dauhuniec Debug/Attach configuration captured unless a debug launch was requested' },
      processes: { collected: events.some(e => e.stage.startsWith('process.')), reason: 'Only processes started by this extension session are captured' },
      logs: { collected: true, droppedEvents: diagnostics.dropped, limits: '256 KiB event ring plus last discovery/debug/failure context (128 KiB each); 16 KiB per text field', cortexDebug: 'Adapter output collected after tracker registration; VS Code internal output channels are not readable', buildFlash: 'Output captured for extension tasks; external terminals are not readable' },
      recovery: { collected: events.some(e => e.stage.startsWith('recovery.')), reason: 'See recovery events; none if no recovery was requested' }
    };
    const save = await vscode.window.showSaveDialog({ title: 'Export diagnostic ZIP: includes redacted settings, paths, project metadata, launch commands and available logs. Excludes source files, firmware and full environment.', defaultUri: vscode.Uri.file(path.join(root || os.tmpdir(), 'dauhuniec-diagnostics.zip')), filters: { 'ZIP archive': ['zip'] } });
    if (!save)
      return;
    const files = reportFiles(categories, events, createRedactor([...new Set(serials)]));
    await vscode.workspace.fs.writeFile(save, zipFiles(files));
    const action = await vscode.window.showInformationMessage('Diagnostic report saved. Review it before sending it to a developer.', 'Show File', 'Open Summary', ...(!events.some(event => event.stage === 'discovery') ? ['Check Tools'] : []));
    if (action === 'Check Tools') {
      await toolReport(root);
      if (await vscode.window.showInformationMessage('Safe tool checks captured. Export an updated report?', 'Export Report'))
        await exportDiagnosticReport();
    }
    if (action === 'Show File')
      await vscode.commands.executeCommand('revealFileInOS', save);
    if (action === 'Open Summary') {
      const doc = await vscode.workspace.openTextDocument({ content: files['summary.txt'], language: 'plaintext' });
      await vscode.window.showTextDocument(doc);
    }
  }

  async function projects(): Promise<string[]> {
    const files = await vscode.workspace.findFiles('**/*.ioc', '**/{.git,node_modules,build,.build,.dauhuniec}/**', 300);
    return [...new Set(files.filter(file => file.scheme === 'file').map(file => path.dirname(file.fsPath)))].sort();
  }

  async function pickProject(argument?: unknown, force = false): Promise<string | undefined> {
    let root = typeof argument === 'string' ? argument : argument instanceof vscode.Uri && argument.scheme === 'file' ? path.dirname(argument.fsPath) : undefined;
    const found = await projects();
    if (!root && !force && selected && found.includes(selected)) root = selected;
    if (!root && !force && found.length === 1) root = found[0];
    if (!root) {
      const picked = await vscode.window.showQuickPick([
        ...found.map(project => ({ label: path.basename(project), description: project, root: project })),
        { label: 'Open a project folder…', description: 'Folder generated by STM32CubeMX', root: '' }
      ], { title: 'Dauhuniec · Select CubeMX project', placeHolder: 'Choose the project to prepare for VS Code' });
      if (!picked) return;
      if (!picked.root) {
        const folder = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: false, openLabel: 'Open CubeMX Project' });
        if (folder?.[0]) await vscode.commands.executeCommand('vscode.openFolder', folder[0], false);
        return;
      }
      root = picked.root;
    }
    if (!vscode.workspace.getWorkspaceFolder(vscode.Uri.file(root))) throw new Error('Open this project folder in VS Code before configuring it.');
    selected = root;
    await context.workspaceState.update('selectedProject', root);
    return root;
  }

  function showReport(report: Report): void {
    current = report;
    actionsView.message = undefined;
    const root = report.root;
    report.checks = report.checks.filter(check => check.id !== 'intellisense' && check.id !== 'compdb.refresh');
    if (databaseErrors.has(root)) report.checks.push({ id: 'compdb.refresh', label: 'clangd compilation database', status: 'warning', message: databaseErrors.get(root)!, action: 'configure' });
    // Nested project .vscode settings apply only when that project is opened as a folder.
    if (report.configured && vscode.workspace.getWorkspaceFolder(vscode.Uri.file(root))?.uri.fsPath === root) {
      const resource = vscode.Uri.file(root);
      report.checks.push(...intelliSenseChecks(
        vscode.workspace.getConfiguration('C_Cpp', resource).get('intelliSenseEngine', 'default'),
        vscode.workspace.getConfiguration('clangd', resource).get('enable', true),
        !!vscode.extensions.getExtension('stmicroelectronics.stm32cube-ide-clangd') && vscode.workspace.getConfiguration('stm32cube-ide-clangd', resource).get('enable', true), !!vscode.extensions.getExtension(clangdExtension)));
    }
    const issues = report.checks.filter(check => check.status !== 'ok');
    const action = (label: string, command: string, icon: string): Node => ({ label, command, icon, root });
    view.nodes = report.project ? [
      action('Build, Flash and Run', 'dauhuniec.flash', 'circuit-board'),
      action('Build Firmware', 'dauhuniec.build', 'gear'),
      action('Flash Firmware', 'dauhuniec.upload', 'arrow-up'),
      action('Start Debugging', 'dauhuniec.debug', 'debug-alt'),
      action('Serial Monitor', 'dauhuniec.serialMonitor', 'terminal')
    ] : [action('Configure Project', 'dauhuniec.configure', 'tools')];
    projectView.nodes = [
      { label: report.project?.target ?? path.basename(root), description: report.project?.device, detail: root, icon: 'circuit-board', command: 'dauhuniec.selectProject' },
      ...(report.configured ? [targetNode(root)] : []),
      { label: report.ready ? 'Ready for VS Code' : 'Setup needs attention', icon: report.ready ? 'pass' : 'warning', command: report.ready ? 'dauhuniec.check' : 'dauhuniec.configure', root },
      ...issues.map(check => ({ label: check.label, description: check.message, detail: check.message, root, icon: check.status === 'error' ? 'error' : 'warning', command: check.action === 'editBuildPresets' ? 'dauhuniec.editBuildPresets' : check.action === 'installClangd' ? 'dauhuniec.installClangd' : check.action === 'selectCubeIDE' ? 'dauhuniec.chooseIDE' : check.action === 'selectMake' ? 'dauhuniec.chooseMake' : 'dauhuniec.configure' })),
      { label: 'Build Preset', description: report.buildPreset ?? 'Invalid configuration', command: 'dauhuniec.selectBuildPreset', icon: 'layers', root },
      action('Edit Build Presets', 'dauhuniec.editBuildPresets', 'edit'),
      action('Configure Project', 'dauhuniec.configure', 'tools'),
      ...(issues.some(check => check.action === 'selectCubeIDE' || check.action === 'selectMake')
        ? [action('Install Tools / Official Downloads', 'dauhuniec.installTools', 'cloud-download')] : []),
      action('Open in STM32CubeMX', 'dauhuniec.openIOC', 'file-code'),
      action('Documentation', 'dauhuniec.documentation', 'library'),
      ...(report.configured ? [action('Clean Build', 'dauhuniec.clean', 'clear-all')] : [])
    ];
    diagnosticsView.nodes = [
      action('Check Environment', 'dauhuniec.check', 'checklist'),
      ...(report.configured ? [action('List ST-LINK Probes', 'dauhuniec.probes', 'plug')] : []),
      { label: 'Detected Tools', icon: 'settings-gear', children: report.checks.filter(check => check.status === 'ok' && check.id !== 'project' && check.id !== 'configuration').map(check => ({ label: check.label, description: check.message, detail: check.message, icon: 'check' })) },
      action('Show Logs', 'dauhuniec.logs', 'output')
    ];
    view.refresh();
    projectView.refresh();
    diagnosticsView.refresh();
    updateToolbar();
    void vscode.commands.executeCommand('setContext', 'dauhuniec.hasProject', true);
  }

  function targetNode(root: string): Node {
    const state = targets.get(root), chosen = state?.selected;
    const missing = chosen && !state?.probes.some(probe => probe.serial === chosen.serial);
    return { label: 'Target Board', command: 'dauhuniec.selectTarget', root,
      description: chosen ? `${chosen.name || 'ST-LINK'} · ${chosen.serial}${missing ? ' · disconnected' : ''}` : 'Select board…',
      icon: missing || targets.error(root) || state?.selectionError ? 'warning' : 'circuit-board',
      detail: targets.error(root) || state?.selectionError || (chosen ? `ST-LINK ${chosen.serial}. Kept when other boards connect. Click to change the flash/debug target.` : 'Choose the board used for flashing and debugging. Serial Monitor has its own port selection.') };
  }

  async function promptForTarget(report?: Report): Promise<void> {
    if (report?.configured && !targets.get(report.root)?.selected && (targets.get(report.root)?.probes.length || 0) > 1) {
      await targets.ensure(report.root);
    }
  }

  function updateToolbar(): void {
    const task = current && running.get(current.root);
    toolbar.update({ report: current, projectCount, busy: task?.label,
      cancellable: !!task?.execution, failed: current && failures.get(current.root) });
  }

  async function refresh(): Promise<Report | undefined> {
    const request = ++generation;
    if (!vscode.workspace.isTrusted) return;
    const found = await projects();
    if (request !== generation) return;
    projectCount = found.length;
    if (!selected || !found.includes(selected)) selected = found.length === 1 ? found[0] : undefined;
    if (!selected) {
      current = undefined;
      actionsView.message = found.length === 0 ? 'Open a project generated by STM32CubeMX, or create one in CubeMX.' : undefined;
      view.nodes = found.length > 1 ? [{ label: `${found.length} CubeMX projects found`, icon: 'folder-opened', command: 'dauhuniec.selectProject' }] : [
        { label: 'Open STM32CubeMX / Create Project', icon: 'file-code', command: 'dauhuniec.openIOC' },
        { label: 'Select Project', icon: 'folder-opened', command: 'dauhuniec.selectProject' }
      ];
      projectView.nodes = []; diagnosticsView.nodes = [];
      view.refresh(); projectView.refresh(); diagnosticsView.refresh(); updateToolbar();
      await vscode.commands.executeCommand('setContext', 'dauhuniec.hasProject', found.length > 0);
      return;
    }
    const report = await inspect(binary, selected, options(selected));
    if (report.configured && (!databaseInitialized.has(report.root) || databaseDirty.has(report.root) || databaseJobs.has(report.root))) {
      databaseInitialized.add(report.root);
      let job = databaseJobs.get(report.root);
      if (!job) {
        job = (async () => {
          do {
            databaseDirty.delete(report.root);
            try {
              await execute(binary, ['compdb', '--project', report.root], report.root);
              databaseErrors.delete(report.root);
            } catch (error) {
              databaseErrors.set(report.root, String(error));
              output.appendLine(`clangd database: ${error}`);
            }
          } while (databaseDirty.has(report.root));
        })().finally(() => databaseJobs.delete(report.root));
        databaseJobs.set(report.root, job);
      }
      await job;
    }
    if (request === generation) {
      showReport(report);
      if (report.configured && report.tools.programmer) await targets.refresh(report.root).catch(error => output.appendLine(String(error)));
    }
    return report;
  }

  async function chooseTool(kind: 'cubeIDE' | 'make' | 'cubeMX', argument?: unknown): Promise<boolean> {
    trusted();
    const supplied = argument && typeof argument === 'object' && 'toolPath' in argument ? argument as {
      toolPath: string;
      project?: string;
    } : undefined;
    const root = kind === 'cubeMX' ? (supplied?.project || (typeof argument === 'string' ? argument : selected)) : await pickProject(supplied?.project || argument);
    if (!root && kind !== 'cubeMX')
      return false;
    const cfg = vscode.workspace.getConfiguration('dauhuniec', root ? vscode.Uri.file(root) : undefined);
    const setting = kind === 'cubeIDE' ? 'cubeIDEPath' : kind === 'make' ? 'makePath' : 'cubeMXPath';
    let retryPath: string | undefined = supplied?.toolPath;
    for (;;) {
      const discovered = await toolReport(root).catch(() => undefined);
      const directory = await pickerDirectory(context.workspaceState, root, kind, root ? options(root)[kind] : cfg.get<string>(setting), discovered?.alternatives[kind]?.[0]?.originalPath || (process.platform === 'darwin' ? '/Applications' : os.homedir()));
      const chosen = retryPath ? [vscode.Uri.file(retryPath)] : await vscode.window.showOpenDialog({ canSelectFolders: kind !== 'make', canSelectFiles: true, canSelectMany: false, defaultUri: directory ? vscode.Uri.file(directory) : undefined, title: `Select ${kind} installation or executable`, openLabel: 'Use Selected Path' });
      if (!chosen?.[0])
        return false;
      const selectedPath = chosen[0].fsPath;
      retryPath = undefined;
      await context.workspaceState.update(historyKey(root, kind), selectedPath);
      diagnostics.record('recovery.selection', { root, kind, selectedPath });
      try {
        const result = await toolReport(root, { [kind]: selectedPath });
        const candidate = result.candidates?.find(c => c.kind === kind && c.source === 'explicit');
        if (!candidate?.valid || (kind === 'cubeIDE' && !result.actions.build && !result.actions.debug && !result.actions.flash))
          throw new Error(candidate?.reason || 'No usable tools in selected installation');
        await saveToolChoice(root, kind, selectedPath);
        output.appendLine(`Validated ${kind}: ${candidate.resolvedPath}`);
        await refresh();
        return true;
      }
      catch (error) {
        diagnostics.record('validation.failure', { kind, selectedPath, error: String(error) });
        const action = await vscode.window.showErrorMessage(`The ${kind} path was remembered but failed validation. Select another path or retry.`, 'Select Another Path', 'Retry Validation', 'Create Error Report', 'Official Downloads');
        if (action === 'Select Another Path' || action === 'Retry Validation') {
          if (action === 'Retry Validation')
            retryPath = selectedPath;
          continue;
        }
        if (action === 'Create Error Report')
          await exportDiagnosticReport();
        if (action === 'Official Downloads')
          await openDownload(kind === 'cubeMX' ? 'cubeMX' : 'cubeIDE');
        return false;
      }
    }
  }

  async function installClangd(download = true): Promise<void> {
    trusted();
    await ensureClangd({
      installed: () => !!vscode.extensions.getExtension(clangdExtension),
      installExtension: () => vscode.commands.executeCommand('workbench.extensions.installExtension', clangdExtension, { enable: true }),
      activate: async () => {
        const extension = vscode.extensions.getExtension(clangdExtension);
        if (!extension) throw new Error('clangd installation did not finish. Enable the extension and retry.');
        await extension.activate(); // The extension offers to download a missing server.
      },
      downloadServer: () => vscode.commands.executeCommand('clangd.install')
    }, download);
  }

  async function configure(argument?: unknown): Promise<void> {
    trusted();
    const root = await pickProject(argument);
    if (!root) return;
    if (active.has(root)) throw new Error('Wait for the running project task to finish before configuring.');
    for (;;) {
      const report = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Dauhuniec: checking project and tools' }, () => inspect(binary, root, options(root), true));
      showReport(report);
      if (!report.project) {
        const action = await vscode.window.showWarningMessage(report.checks.find(check => check.id === 'project')?.message ?? 'Generate a Makefile project in CubeMX first.', 'Open .ioc', 'Guide');
        if (action === 'Open .ioc') await openIOC(root);
        if (action === 'Guide') await guide();
        return;
      }
      if (!report.checks.some(check => check.status === 'error')) break;
      const action = await vscode.window.showQuickPick([
        { label: 'Select CubeIDE installation', detail: 'ARM GCC, GDB, ST-LINK server and CubeProgrammer', action: 'cubeIDE' },
        { label: 'Select GNU Make', detail: 'Windows: use native make.exe from CubeIDE', action: 'make' },
        { label: 'Download STM32CubeIDE', detail: 'Open the official ST download page', action: 'downloadCubeIDE' },
        ...(process.platform === 'win32' ? [
          { label: 'Windows Setup Instructions', detail: 'Use CubeIDE tools without additional build dependencies', action: 'windowsGuide' },
        ] : []),
        { label: 'Installation guide', detail: 'How to install the required tools', action: 'guide' },
        { label: 'Create Error Report', detail: 'Save a redacted diagnostic ZIP', action: 'report' },
        { label: 'Check again', detail: 'Refresh after installing tools', action: 'refresh' }
      ], { title: 'Dauhuniec · Resolve missing tools', placeHolder: report.checks.find(check => check.status === 'error')?.message });
      if (!action) return;
      if (action.action === 'report'){await exportDiagnosticReport();return;}
      if (action.action === 'windowsGuide') { await windowsGuide(); return; }
      if (action.action === 'downloadCubeIDE') {
        await openDownload('cubeIDE');
        return;
      }
      if (action.action === 'guide') { await guide(); return; }
      if (action.action === 'cubeIDE' || action.action === 'make') { if (!await chooseTool(action.action, root)) return; }
    }
    active.add(root);
    running.set(root, { label: 'Configuring…' }); updateToolbar();
    try {
      await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Dauhuniec: configuring build and debugging' }, async () => {
        output.appendLine(`\nConfigure: ${root}`);
        await execute(binary, ['setup', root, ...toolArgs(options(root))], root, text => output.append(text));
      });
    } finally { active.delete(root); running.delete(root); updateToolbar(); }
    try { await installClangd(false); }
    catch (error) { output.appendLine(`clangd installation: ${error}`); void vscode.window.showWarningMessage(`Project configured, but clangd is unavailable: ${error}. Use Resources → Install / Update clangd to retry.`); }
    await promptForTarget(await refresh());
    const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(root));
    const actions = folder?.uri.fsPath === root ? ['Build', 'View files'] : ['Open project folder', 'Build'];
    void vscode.window.showInformationMessage('Dauhuniec configured. Existing VS Code settings were merged and backed up. Your CubeMX sources are unchanged.', ...actions).then(async action => {
      if (action === 'Build') await commandTask('build', root);
      if (action === 'View files') await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(path.join(root, '.vscode/tasks.json')));
      if (action === 'Open project folder') await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(root), true);
    });
  }

  async function readyProject(argument?: unknown, action = 'build'): Promise<{
    root: string;
    report: Report;
  } | undefined> {
    trusted();
    const root = await pickProject(argument);
    if (!root)
      return;
    const needed = action === 'upload' || action === 'list-probes' ? ['flash'] : action === 'flash' ? ['build', 'flash'] : action === 'clean' ? [] : action === 'debug' ? ['build', 'debug'] : ['build'];
    let changed = false;
    const old = await workingPaths(root);
    for (const requirement of needed) {
      const tools = await resolveTools(root, requirement);
      if (!tools)
        return;
      if (Object.entries(tools).some(([k, v]) => old[k] !== v))
        changed = true;
    }
    let report = await inspect(binary, root, options(root));
    if (!report.project) {
      await configure(root);
      return;
    }
    if (!report.configured || changed) {
      for (const requirement of needed.length ? needed : ['build'])
        await execute(binary, ['setup', root, '--action', requirement, ...toolArgs(options(root))], root, text => output.append(text));
      output.appendLine('Recovered managed tool configuration after validating the replacement.');
      report = await inspect(binary, root, options(root));
    }
    showReport(report);
    return { root, report };
  }

  async function runTask(root: string, action: string, probeSerial?: string): Promise<number | undefined> {
    if (active.has(root))
      throw new Error('A Dauhuniec task is already running for this project.');
    const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(root));
    if (!folder)
      throw new Error('Open the project in the workspace first.');
    const id = `${Date.now()}-${Math.random()}`;
    const task = new vscode.Task({ type: 'dauhuniec', action, project: root, runId: id }, folder, `Dauhuniec: ${action}`, 'Dauhuniec', new vscode.CustomExecution(async () => {
      const write = new vscode.EventEmitter<string>(), close = new vscode.EventEmitter<number>();
      let child: ReturnType<typeof spawn> | undefined;
      return { onDidWrite: write.event, onDidClose: close.event, open() {
          const args = [action, '--project', root, ...(probeSerial ? ['--probe-serial', probeSerial] : [])];
          diagnostics.record('process.start', { runId:id,binary, args, cwd: root });
          child = spawn(binary, args, { cwd: root, shell: false, windowsHide: true, detached: process.platform !== 'win32' });
          for (const [stream, name] of [[child.stdout, 'stdout'], [child.stderr, 'stderr']] as const)
            stream?.on('data', data => { const text = String(data); write.fire(text.replace(/\r?\n/g, '\r\n')); diagnostics.record(`process.${name}`, {runId:id,action,cwd:root,text}); });
          child.once('error', error => { diagnostics.record('process.creation.error', {runId:id,action,cwd:root,error:String(error)}); close.fire(1); });
          child.once('close', code => { taskCodes.set(id, code ?? 1); diagnostics.record('process.exit', {runId:id, action, cwd: root, exitCode: code }); close.fire(code ?? 1); });
        }, close() { if (child?.pid && child.exitCode === null) {
          if (process.platform === 'win32')
            execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => { });
          else {
            try {
              process.kill(-child.pid, 'SIGTERM');
            }
            catch {
              child.kill();
            }
          }
        } write.dispose(); close.dispose(); } };
    }), action === 'build' || action === 'flash' ? ['$gcc'] : []);
    task.presentationOptions = { reveal: vscode.TaskRevealKind.Always, panel: vscode.TaskPanelKind.Shared, clear: true };
    active.add(root);
    failures.delete(root);
    const label = ({ build: 'Building…', flash: 'Building and flashing…', upload: 'Flashing…', clean: 'Cleaning…', 'list-probes': 'Finding ST-LINK probes…' } as Record<string, string>)[action] ?? action;
    running.set(root, { label });
    updateToolbar();
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (code?: number) => {
        if (settled)
          return;
        settled = true;
        active.delete(root);
        running.delete(root);
        processEnd.dispose();
        taskEnd.dispose();
        if (code !== undefined && code !== 0) {
          failures.set(root, action);
          diagnostics.record('task.failure', { action, root, exitCode: code });
          void vscode.window.showErrorMessage(`Dauhuniec ${action} failed.`, 'Create Error Report', 'Show Log').then(choice => { if (choice === 'Create Error Report')
            void exportDiagnosticReport(); if (choice === 'Show Log')
            output.show(); });
        }
        updateToolbar();
        void refresh().catch(error => output.appendLine(String(error)));
        resolve(code);
      };
      const processEnd = vscode.tasks.onDidEndTaskProcess(event => { if (event.execution.task.definition.runId === id)
        finish(event.exitCode); });
      const taskEnd = vscode.tasks.onDidEndTask(event => { if (event.execution.task.definition.runId === id)
        setTimeout(() => { const code = taskCodes.get(id); taskCodes.delete(id); finish(code); }, 0); });
      vscode.tasks.executeTask(task).then(execution => {
        if (!settled) {
          running.set(root, { label, execution });
          updateToolbar();
        }
      }, error => {
        active.delete(root);
        running.delete(root);
        failures.set(root, action);
        updateToolbar();
        processEnd.dispose();
        taskEnd.dispose();
        reject(error);
      });
    });
  }

  async function commandTask(action: string, argument?: unknown): Promise<number | undefined> {
    const project = await readyProject(argument, action);
    if (!project) return;
    const probeSerial = action === 'flash' || action === 'upload' ? await targets.ensure(project.root) : undefined;
    if ((action === 'flash' || action === 'upload') && !probeSerial) return;
    return runTask(project.root, action, probeSerial);
  }

  async function debug(argument?: unknown): Promise<void> {
    const selected = await readyProject(argument, 'debug');
    if (!selected?.report.project) return;
    const probeSerial = await targets.ensure(selected.root);
    if (!probeSerial) return;
    if (!vscode.extensions.getExtension('marus25.cortex-debug')) {
      const action = await vscode.window.showInformationMessage('Install Cortex-Debug to debug STM32 firmware.', 'Install Cortex-Debug');
      if (action) await vscode.commands.executeCommand('workbench.extensions.installExtension', 'marus25.cortex-debug');
      return;
    }
    if (await runTask(selected.root, 'build') !== 0) throw new Error('Build did not finish successfully. See the task terminal.');
    const { root, report } = selected;
    const tools = report.tools;
    const configuration: vscode.DebugConfiguration = {
      name: 'Dauhuniec: Debug', type: 'cortex-debug', request: 'launch', servertype: 'stlink',
      cwd: root, executable: path.join(root, report.project!.build_dir, `${report.project!.target}.elf`),
      device: report.project!.device, interface: 'swd', runToEntryPoint: 'main',
      serialNumber: probeSerial,
      gdbPath: tools.gdb, objdumpPath: tools.objdump, nmPath: tools.nm, serverpath: tools.server,
      stm32cubeprogrammer: path.dirname(tools.programmer), serverArgs: ['-k'], postResetCommands: ['monitor reset halt']
    };
    await vscode.debug.startDebugging(vscode.workspace.getWorkspaceFolder(vscode.Uri.file(root)), configuration);
  }

  async function openIOC(argument?: unknown): Promise<void> {
    trusted();
    const editor = vscode.window.activeTextEditor?.document.uri;
    const explicitFile = argument instanceof vscode.Uri && argument.scheme === 'file' && argument.fsPath.toLowerCase().endsWith('.ioc') ? argument : undefined;
    const activeFile = editor?.scheme === 'file' && editor.fsPath.toLowerCase().endsWith('.ioc') && vscode.workspace.getWorkspaceFolder(editor) ? editor : undefined;
    const root = typeof argument === 'string' ? argument : undefined;
    let ioc = explicitFile ?? (!root ? activeFile : undefined);
    if (!ioc) {
      const found = await projects();
      const projectRoot = root ?? (selected && found.includes(selected) ? selected : undefined);
      const files = await vscode.workspace.findFiles(projectRoot ? new vscode.RelativePattern(projectRoot, '*.ioc') : '**/*.ioc', '**/{.git,node_modules,build,.build,.dauhuniec}/**');
      if (files.length === 1) ioc = files[0];
      else if (files.length > 1) {
        const picked = await vscode.window.showQuickPick(files.map(file => ({ label: path.basename(file.fsPath), description: file.fsPath, uri: file })),
          { title: 'Dauhuniec · Open in STM32CubeMX', placeHolder: 'Choose a CubeMX project' });
        if (!picked) return;
        ioc = picked.uri;
      }
    }
    const resource = ioc ?? (root ? vscode.Uri.file(root) : vscode.workspace.workspaceFolders?.[0]?.uri);
    const tools=await resolveTools(ioc?path.dirname(ioc.fsPath):root,'cubeMX');
    const application=tools?.cubeMX;if(!application) return;
    diagnostics.record('process.start',{...cubeMXLaunch(application,ioc?.fsPath),cwd:root});
    output.appendLine(`Starting STM32CubeMX: ${application}${ioc ? ` · ${ioc.fsPath}` : ' · new project'}`);
    try { await launchCubeMX(application,ioc?.fsPath);diagnostics.record('cubeMX.launch',{application,status:'launcher accepted'});await context.workspaceState.update(`lastWorkingTools:${ioc?path.dirname(ioc.fsPath):root || 'workspace'}`,{cubeMX:application}); }catch(error){diagnostics.record('cubeMX.launch.failure',{application,error:String(error)});throw error;}
  }

  async function documentation(argument?: unknown): Promise<void> {
    const explicit = argument instanceof vscode.Uri && argument.scheme === 'file' && argument.path.toLowerCase().endsWith('.ioc') ? argument : undefined;
    const editor = vscode.window.activeTextEditor?.document.uri;
    const activeIOC = editor?.scheme === 'file' && editor.path.toLowerCase().endsWith('.ioc') && vscode.workspace.getWorkspaceFolder(editor) ? editor : undefined;
    const found = await projects();
    let root = typeof argument === 'string' ? argument : explicit ? path.dirname(explicit.fsPath)
      : selected && found.includes(selected) ? selected : activeIOC ? path.dirname(activeIOC.fsPath) : found.length === 1 ? found[0] : undefined;
    let ioc = explicit ?? (activeIOC && path.dirname(activeIOC.fsPath) === root ? activeIOC : undefined);
    if (!ioc) {
      const files = await vscode.workspace.findFiles(root ? new vscode.RelativePattern(root, '*.ioc') : '**/*.ioc', '**/{.git,node_modules,build,.build,.dauhuniec}/**', 300);
      if (files.length === 1) ioc = files[0];
      else if (files.length > 1) {
        const picked = await vscode.window.showQuickPick([
          ...files.map(uri => ({ label: path.basename(uri.fsPath), description: uri.fsPath, uri })),
          { label: 'General documentation / official references', description: 'HAL, RTOS and manual model selection', uri: undefined }
        ], { title: 'Dauhuniec · Documentation project', placeHolder: 'Choose the project whose hardware documentation to open' });
        if (!picked) return;
        ioc = picked.uri;
      }
    }
    if (ioc) root = path.dirname(ioc.fsPath);
    await openDocumentation(context, root, ioc);
  }

  async function openDownload(tool: DownloadTool): Promise<void> {
    const download = officialDownloads[tool];
    if (!await vscode.env.openExternal(vscode.Uri.parse(download.url))) {
      throw new Error(`Could not open ${download.label} download page: ${download.url}`);
    }
  }

  async function installTools(): Promise<void> {
    const items = (Object.keys(officialDownloads) as DownloadTool[])
      .filter(tool => process.platform === 'win32' || tool !== 'stlink')
      .map(tool => ({ ...officialDownloads[tool], description: new URL(officialDownloads[tool].url).hostname, tool }));
    const picked = await vscode.window.showQuickPick(items, {
      title: 'Dauhuniec · Official tool downloads',
      placeHolder: 'Open the official website, install the tool, then run Configure Project again',
      matchOnDetail: true
    });
    if (picked) await openDownload(picked.tool);
  }

  async function guide(): Promise<void> {
    await vscode.commands.executeCommand('markdown.showPreview', vscode.Uri.joinPath(context.extensionUri, 'README.md'));
  }

  async function windowsGuide(): Promise<void> {
    await vscode.commands.executeCommand('markdown.showPreview', vscode.Uri.joinPath(context.extensionUri, 'docs', 'windows.md'));
  }

  async function check(argument?: unknown): Promise<void> {
    trusted();
    const root = await pickProject(argument);
    if (!root) return;
    const report = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Dauhuniec: checking environment' }, () => inspect(binary, root, options(root), true));
    output.appendLine(`\nEnvironment: ${root}\n` + report.checks.map(check => `[${check.status}] ${check.label}: ${check.message}`).join('\n'));
    showReport(report); output.show(true);
  }

  async function moreActions(): Promise<void> {
    const root = await pickProject();
    if (!root) return;
    const separator = (label: string): vscode.QuickPickItem => ({ label, kind: vscode.QuickPickItemKind.Separator });
    const items: (vscode.QuickPickItem & { command?: string })[] = [
      separator('Project'),
      { label: '$(tools) Configure Project', command: 'dauhuniec.configure' },
      { label: '$(file-code) Open in STM32CubeMX', command: 'dauhuniec.openIOC' },
      { label: '$(settings-gear) Extension Settings', command: 'workbench.action.openSettings' },
      ...(current?.configured ? [
        separator('Maintenance'),
        { label: '$(clear-all) Clean Build', command: 'dauhuniec.clean' }
      ] : []),
      separator('Diagnostics'),
      { label: '$(terminal) Serial Monitor', command: 'dauhuniec.serialMonitor' },
      { label: '$(checklist) Check Environment', command: 'dauhuniec.check' },
      ...(current?.configured ? [{ label: '$(plug) List ST-LINK Probes', command: 'dauhuniec.probes' }] : []),
      { label: '$(output) Show Logs', command: 'dauhuniec.logs' },
      { label: '$(terminal) Show Task Terminal', command: 'workbench.action.terminal.focus' },
      { label: '$(warning) Show Problems', command: 'workbench.actions.view.problems' },
      separator('Help'),
      { label: '$(library) Documentation · MCU / Board / HAL / RTOS', command: 'dauhuniec.documentation' },
      { label: '$(book) Getting Started', command: 'dauhuniec.guide' }
    ];
    const picked = await vscode.window.showQuickPick(items, { title: `Dauhuniec · ${path.basename(root)}`, placeHolder: 'Choose an action for the active project' });
    if (!picked?.command) return;
    if (picked.command === 'workbench.action.openSettings') await vscode.commands.executeCommand(picked.command, '@ext:dauhuniec.dauhuniec');
    else if (picked.command.startsWith('dauhuniec.')) await vscode.commands.executeCommand(picked.command, root);
    else await vscode.commands.executeCommand(picked.command);
  }

  function notifyFailure(action: string, error: unknown): void {
    diagnostics.record('action.failure', { action, error: error instanceof Error ? { message: error.message, stack: error.stack } : error });
    output.appendLine(String(error));
    void vscode.window.showErrorMessage(`Dauhuniec ${action} failed. Choose a tool installation, view the log, or create an error report.`, 'Select Tools', 'Show Log', 'Create Error Report').then(async (choice) => {
      if (choice === 'Select Tools')
        await chooseTool(action.toLowerCase().includes('cubemx') || action === 'openIOC' ? 'cubeMX' : 'cubeIDE', selected);
      if (choice === 'Show Log')
        output.show();
      if (choice === 'Create Error Report')
        await exportDiagnosticReport();
    });
  }

  function register(name: string, handler: (argument?: unknown) => unknown): void {
    context.subscriptions.push(vscode.commands.registerCommand(`dauhuniec.${name}`, async (argument?: unknown) => {
      try { return await handler(argument); }
      catch (error) {
        notifyFailure(name,error);
      }
    }));
  }

  async function selectBuildPreset(argument?: unknown): Promise<void> {
    trusted();
    const root = await pickProject(argument);
    if (!root) return;
    if (active.has(root) || vscode.debug.activeDebugSession) throw new Error('Wait for the current task or debug session to finish before changing the build preset.');
    const result = await execute(binary, ['presets', '--project', root], root);
    const presets = JSON.parse(result) as { active: string; presets: string[]; selectionError?: string };
    const picked = await vscode.window.showQuickPick([
      ...presets.presets.map(name => ({ label: name, description: name === presets.active ? 'Active' : '', preset: name })),
      { label: '$(edit) Edit Build Presets…', description: 'dauhuniec.json', preset: '' }
    ], { title: 'Dauhuniec · Build Preset', placeHolder: presets.selectionError ?? 'Choose the configuration for build, flash and debug' });
    if (!picked) return;
    if (!picked.preset) { await editBuildPresets(root); return; }
    if (active.has(root) || vscode.debug.activeDebugSession) throw new Error('Wait for the current task or debug session to finish before changing the build preset.');
    await execute(binary, ['select-preset', '--preset', picked.preset, '--project', root], root);
    databaseDirty.add(root);
    await refresh();
  }

  async function editBuildPresets(argument?: unknown): Promise<void> {
    trusted();
    const root = await pickProject(argument);
    if (!root) return;
    const file = vscode.Uri.file(path.join(root, 'dauhuniec.json'));
    try { await fs.access(file.fsPath); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await fs.writeFile(file.fsPath, JSON.stringify({
        default_preset: 'debug',
        presets: {
          debug: { debug: true, optimization: '-Og' },
          release: { debug: false, optimization: '-O2' },
          custom: { extends: 'debug', build_flags: ['-DAPP_LOG_LEVEL=3'], c_flags: [], cxx_flags: [], asm_flags: [], link_flags: [] }
        }
      }, null, 2) + '\n', { flag: 'wx' });
    }
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file));
  }

  register('selectBuildPreset', selectBuildPreset);
  register('editBuildPresets', editBuildPresets);
  register('exportDiagnosticReport',exportDiagnosticReport);
  register('chooseCubeMX',root=>chooseTool('cubeMX',root));
  register('moreActions', moreActions);
  register('selectTarget', async argument => {
    trusted();
    const root = await pickProject(argument);
    if (!root) return;
    if (active.has(root) || vscode.debug.activeDebugSession) throw new Error('Wait for the current flash/debug task to finish before changing the target board.');
    return targets.select(root);
  });
  context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('cortex-debug', {
    async resolveDebugConfiguration(folder, configuration) {
      try {
        if (configuration.servertype !== 'stlink' || !configuration.name?.startsWith('Dauhuniec:'))
          return configuration;
        const root = typeof configuration.cwd === 'string' && path.isAbsolute(configuration.cwd) ? configuration.cwd : folder?.uri.fsPath;
        if (!root)
          throw new Error('Open the CubeMX project folder before debugging.');
        if (configuration.serverPath !== undefined) {
          configuration.serverpath = configuration.serverpath || configuration.serverPath;
          delete configuration.serverPath;
        }
        if (configuration.executable === '${config:dauhuniec.elf}') {
          const report = await inspect(binary, root, options(root));
          if (!report.project || !report.buildPreset) throw new Error('Fix the build preset configuration before debugging.');
          configuration.executable = path.join(root, report.project.build_dir, `${report.project.target}.elf`);
        }
        configuration.__dauhuniecToolReferences = [];
        for (const [field, key, setting] of [['serverpath', 'server', 'server'], ['gdbPath', 'gdb', 'gdb'], ['objdumpPath', 'objdump', 'objdump'], ['nmPath', 'nm', 'nm'], ['stm32cubeprogrammer', 'programmer', 'programmerDir']])
          if (typeof configuration[field] === 'string' && configuration[field].includes('${config:dauhuniec.' + setting + '}'))
            configuration.__dauhuniecToolReferences.push(key);
        const serial = await targets.ensure(root);
        if (!serial)
          return undefined;
        return pinDebugTarget(configuration, serial);
      }
      catch (error) {
        notifyFailure('debug validation', error);
        return undefined;
      }
    },
    async resolveDebugConfigurationWithSubstitutedVariables(folder, configuration) {
      if (configuration.servertype !== 'stlink' || !configuration.name?.startsWith('Dauhuniec:'))
        return configuration;
      try {
        trusted();
        const root = typeof configuration.cwd === 'string' && path.isAbsolute(configuration.cwd) ? configuration.cwd : folder?.uri.fsPath;
        if (!root)
          throw new Error('Open the CubeMX project folder before debugging.');
        if (configuration.serverPath !== undefined) {
          configuration.serverpath = configuration.serverpath || configuration.serverPath;
          delete configuration.serverPath;
        }
        const settingReferences = new Set<string>(configuration.__dauhuniecToolReferences || []);
        delete configuration.__dauhuniecToolReferences;
        let tools = await resolveTools(root, 'debug');
        if (!tools)
          return undefined;
        let saved: Record<string, string> = {};
        try {
          saved = JSON.parse(await fs.readFile(path.join(root, '.dauhuniec/tools.json'), 'utf8')).tools || {};
        }
        catch { }
        const cacheKey = `debugToolOverrides:${root}:${configuration.name}`;
        const remembered = context.workspaceState.get<Record<string, {
          original: string;
          replacement: string;
        }>>(cacheKey, {});
        const replacements = { ...remembered };
        const updates: Record<string, string> = {};
        const managedFields: {
          field: string;
          key: string;
          directory: boolean;
          validate: (value: string) => Promise<string>;
        }[] = [];
        const cfg = vscode.workspace.getConfiguration('dauhuniec', vscode.Uri.file(root));
        for (const item of [
          { field: 'serverpath', key: 'server', label: 'ST-LINK server', binary: 'ST-LINK_gdbserver' },
          { field: 'gdbPath', key: 'gdb', label: 'ARM GDB', binary: 'arm-none-eabi-gdb' },
          { field: 'objdumpPath', key: 'objdump', label: 'ARM objdump', binary: 'arm-none-eabi-objdump' },
          { field: 'nmPath', key: 'nm', label: 'ARM nm', binary: 'arm-none-eabi-nm' },
          { field: 'stm32cubeprogrammer', key: 'programmer', label: 'CubeProgrammer', binary: 'STM32_Programmer_CLI' }
        ]) {
          const directory = item.key === 'programmer';
          const original = typeof configuration[item.field] === 'string' ? configuration[item.field] : '';
          const savedPath = directory && saved[item.key] ? path.dirname(saved[item.key]) : saved[item.key];
          const implicit = !original.trim() || original === item.binary || original === item.binary + '.exe';
          const managed = settingReferences.has(item.key) || implicit || original === savedPath;
          const alternative = () => directory ? path.dirname(tools![item.key]) : tools![item.key];
          async function validate(value: string): Promise<string> {
            if (directory) {
              for (const base of [value, path.join(value, 'bin')]) {
                try {
                  return path.dirname(await resolveDebugServer(root!, path.join(base, item.binary + (process.platform === 'win32' ? '.exe' : '')), async () => undefined));
                }
                catch { }
              }
              throw new Error('CubeProgrammer executable is unavailable in the selected directory.');
            }
            return resolveDebugServer(root!, value, async () => undefined);
          }
          if (managed)
            managedFields.push({ field: item.field, key: item.key, directory, validate });
          let candidate = managed ? alternative() : remembered[item.field]?.original === original ? remembered[item.field].replacement : original;
          let resolved: string;
          try {
            resolved = await validate(candidate);
          }
          catch (error) {
            diagnostics.record('debug.validation.failure', { component: item.key, original, candidate, error: String(error) });
            const answer = await vscode.window.showWarningMessage(`The selected ${item.label} is unavailable. Use the discovered executable from ${toolInstallationName(tools[item.key])}?`, 'Use Discovered Tool', 'Select Installation', 'Create Error Report');
            diagnostics.record('recovery.choice', { action: 'debug', component: item.key, answer, original, replacement: alternative() });
            if (answer === 'Select Installation') {
              if (!await chooseTool('cubeIDE', root))
                return undefined;
              tools = await resolveTools(root, 'debug');
              if (!tools)
                return undefined;
            }
            else if (answer !== 'Use Discovered Tool') {
              if (answer === 'Create Error Report')
                await exportDiagnosticReport();
              return undefined;
            }
            candidate = alternative();
            resolved = await validate(candidate);
            replacements[item.field] = { original, replacement: resolved };
          }
          configuration[item.field] = resolved;
          if (managed && original !== resolved) {
            output.appendLine(`Recovered managed ${item.label}: ${original} → ${resolved}`);
            diagnostics.record('recovery.managed', { component: item.key, original, replacement: resolved });
          }
          if (managed || replacements[item.field]?.original === original)
            updates[item.key] = directory ? tools[item.key] : resolved;
        }
        // A picker may have changed the installation after earlier fields
        // validated. Keep every managed component in the newly selected suite.
        for (const item of managedFields) {
          const expected = item.directory ? path.dirname(tools[item.key]) : tools[item.key];
          if (configuration[item.field] !== expected) {
            configuration[item.field] = await item.validate(expected);
            updates[item.key] = item.directory ? tools[item.key] : configuration[item.field];
          }
        }
        // Commit after every required executable has validated, so cancellation
        // of a later suggestion preserves the previous working settings.
        await context.workspaceState.update(cacheKey, replacements);
        if (vscode.workspace.getWorkspaceFolder(vscode.Uri.file(root))?.uri.fsPath === root) {
          for (const [key, value] of Object.entries(updates))
            if (cfg.get<string>(key) !== value)
              await cfg.update(key, value, vscode.ConfigurationTarget.WorkspaceFolder);
          if (updates.programmer)
            await cfg.update('programmerDir', path.dirname(updates.programmer), vscode.ConfigurationTarget.WorkspaceFolder);
        }
        output.appendLine(`ST-LINK GDB server passed to Cortex-Debug: ${configuration.serverpath}`);
        configuration.showDevDebugOutput ??= 'raw';
        diagnostics.record('debug.configuration', configuration);
        return configuration;
      }
      catch (error) {
        notifyFailure('debug launch validation', error);
        return undefined;
      }
    }
  }));
  context.subscriptions.push(vscode.debug.registerDebugAdapterTrackerFactory('cortex-debug', { createDebugAdapterTracker(session) {
      if (!session.name.startsWith('Dauhuniec:'))
        return;
      return { onDidSendMessage(message) { if (message.type === 'event' && message.event === 'output')
          diagnostics.record('debug.output', message.body); if (message.type === 'response' && ['launch', 'attach'].includes(message.command) && message.success === false)
          notifyFailure('debug launch', message); }, onError(error) { diagnostics.record('debug.adapter.error', String(error)); }, onExit(code, signal) { diagnostics.record('debug.exit', { code, signal }); } };
    } }));
  register('serialMonitor', options => { trusted(); return serialMonitor.open(options && typeof options === 'object' ? options as ConsoleOptions : undefined); });
  register('serialStartLogging', () => { trusted(); return serialMonitor.startLogging(); });
  register('serialStopLogging', () => serialMonitor.stopLogging());
  register('stopTask', () => { if (selected) running.get(selected)?.execution?.terminate(); });
  register('configure', configure); register('selectProject', async () => { await pickProject(undefined, true); await promptForTarget(await refresh()); });
  register('refresh', refresh); register('check', check); register('build', root => commandTask('build', root));
  register('upload', root => commandTask('upload', root));
  register('flash', root => commandTask('flash', root)); register('clean', root => commandTask('clean', root));
  register('probes', root => commandTask('list-probes', root)); register('debug', debug);
  register('documentation', documentation);
  register('installClangd', argument => installClangd(argument !== false));
  register('installTools', installTools);
  register('windowsGuide', windowsGuide);
  register('openIOC', openIOC); register('guide', guide); register('logs', () => output.show());
  register('chooseIDE', root => chooseTool('cubeIDE', root)); register('chooseMake', root => chooseTool('make', root));
  const watcher = vscode.workspace.createFileSystemWatcher('**/{*.ioc,Makefile,tools.json,dauhuniec.json,build-preset.json}');
  const scheduleRefresh = () => {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => { void refresh().catch(error => output.appendLine(String(error))); }, 400);
  };
  const sourceWatcher = vscode.workspace.createFileSystemWatcher('**/{Makefile,*.mk,*.c,*.C,*.cc,*.cpp,*.cxx,dauhuniec.json,build-preset.json}');
  const updateDatabase = (uri: vscode.Uri) => {
    if (path.basename(uri.fsPath).startsWith('.preset-')) return;
    if (selected && (uri.fsPath === selected || uri.fsPath.startsWith(selected + path.sep))) {
      databaseDirty.add(selected);
      scheduleRefresh();
    }
  };
  context.subscriptions.push(sourceWatcher,
    sourceWatcher.onDidCreate(updateDatabase), sourceWatcher.onDidDelete(updateDatabase),
    sourceWatcher.onDidChange(uri => { if (path.basename(uri.fsPath) === 'Makefile' || uri.fsPath.endsWith('.mk') || ['dauhuniec.json', 'build-preset.json'].includes(path.basename(uri.fsPath))) updateDatabase(uri); }));
  context.subscriptions.push(watcher, watcher.onDidChange(scheduleRefresh), watcher.onDidCreate(scheduleRefresh), watcher.onDidDelete(scheduleRefresh),
    vscode.workspace.onDidChangeWorkspaceFolders(scheduleRefresh), vscode.workspace.onDidChangeConfiguration(event => { if (['dauhuniec', 'C_Cpp', 'clangd', 'stm32cube-ide-clangd'].some(section => event.affectsConfiguration(section))) scheduleRefresh(); }),
    { dispose: () => { if (refreshTimer) clearTimeout(refreshTimer); } });

  const initial = await refresh().catch(error=>{diagnostics.record('activation.discovery.failure',String(error));output.appendLine(String(error));return undefined;});
  void promptForTarget(initial).catch(error => output.appendLine(String(error)));
  if (initial && !initial.configured && vscode.workspace.getConfiguration('dauhuniec').get('autoDetect', true)
      && !context.workspaceState.get(`prompted:${initial.root}`)) {
    await context.workspaceState.update(`prompted:${initial.root}`, true);
    void vscode.window.showInformationMessage('CubeMX project found. Prepare it for building and debugging in VS Code?', 'Configure', 'Later').then(action => {
      if (action === 'Configure') void vscode.commands.executeCommand('dauhuniec.configure', initial.root);
    });
  }
  return { refresh, getStatus: async () => current ?? refresh(), getProjects: projects, getToolSelectionHistory:(root:string|undefined,tool:string)=>context.workspaceState.get<string>(historyKey(root,tool)) };
}
