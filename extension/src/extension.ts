import * as vscode from 'vscode';
import * as path from 'node:path';
import { ProjectToolbar } from './toolbar';
import { openDocumentation } from './documentationBrowser';
import { registerUserCodeFocus } from './userCodeEditor';
import { findCubeMX, launchCubeMX } from './cubeMX';
import { SerialConsole, ConsoleOptions } from './serialConsole';
import { TargetBoards, parseProbeReport, pinDebugTarget } from './targetBoard';
import { binaryFor, execute, inspect, Report, ToolOptions, toolArgs } from './service';

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
  const output = vscode.window.createOutputChannel('Dauhuniec');
  const view = new ProjectView();
  const projectView = new ProjectView();
  const diagnosticsView = new ProjectView();
  const resourcesView = new ProjectView();
  resourcesView.nodes = [
    { label: 'Documentation · MCU / Board / HAL / RTOS', command: 'dauhuniec.documentation', icon: 'library' },
    { label: 'Serial Monitor', command: 'dauhuniec.serialMonitor', icon: 'terminal' },
    { label: 'Install Tools / Official Downloads', command: 'dauhuniec.installTools', icon: 'cloud-download' },
    ...(process.platform === 'win32' ? [{ label: 'Windows Setup Instructions', command: 'dauhuniec.windowsGuide', icon: 'book' }] : []),
    { label: 'Getting Started', command: 'dauhuniec.guide', icon: 'book' }
  ];
  const toolbar = new ProjectToolbar();
  const running = new Map<string, { label: string; execution?: vscode.TaskExecution }>();
  const failures = new Map<string, string>();
  let projectCount = 0;
  const binary = binaryFor(context.extensionPath);
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
  const choices = new Map<string, ToolOptions>();
  context.subscriptions.push(output, toolbar,
    vscode.window.registerTreeDataProvider('dauhuniec.projects', view),
    vscode.window.registerTreeDataProvider('dauhuniec.projectSettings', projectView),
    vscode.window.registerTreeDataProvider('dauhuniec.diagnostics', diagnosticsView),
    vscode.window.registerTreeDataProvider('dauhuniec.resources', resourcesView));

  function trusted(): void {
    if (!vscode.workspace.isTrusted) throw new Error('Trust the project in VS Code before running Dauhuniec.');
  }

  function options(root: string): ToolOptions {
    const config = vscode.workspace.getConfiguration('dauhuniec', vscode.Uri.file(root));
    return { cubeIDE: config.get<string>('cubeIDEPath') || undefined, make: config.get<string>('makePath') || undefined, ...choices.get(root) };
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
    const root = report.root;
    const issues = report.checks.filter(check => check.status !== 'ok');
    const action = (label: string, command: string, icon: string): Node => ({ label, command, icon, root });
    view.nodes = report.configured ? [
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
      ...issues.map(check => ({ label: check.label, description: check.message, detail: check.message, root, icon: check.status === 'error' ? 'error' : 'warning', command: check.action === 'selectCubeIDE' ? 'dauhuniec.chooseIDE' : check.action === 'selectMake' ? 'dauhuniec.chooseMake' : 'dauhuniec.configure' })),
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
      view.nodes = found.length > 1 ? [{ label: `${found.length} CubeMX projects found`, icon: 'folder-opened', command: 'dauhuniec.selectProject' }] : [];
      projectView.nodes = []; diagnosticsView.nodes = [];
      view.refresh(); projectView.refresh(); diagnosticsView.refresh(); updateToolbar();
      await vscode.commands.executeCommand('setContext', 'dauhuniec.hasProject', found.length > 0);
      return;
    }
    const report = await inspect(binary, selected, options(selected));
    if (request === generation) {
      showReport(report);
      if (report.configured && report.tools.programmer) await targets.refresh(report.root).catch(error => output.appendLine(String(error)));
    }
    return report;
  }

  async function chooseTool(kind: 'cubeIDE' | 'make', argument?: unknown): Promise<boolean> {
    trusted();
    const root = await pickProject(argument);
    if (!root) return false;
    const label = kind === 'cubeIDE' ? 'STM32CubeIDE' : 'GNU Make';
    for (;;) {
      const chosen = await vscode.window.showOpenDialog({
        canSelectFolders: kind === 'cubeIDE', canSelectFiles: kind === 'make', canSelectMany: false,
        title: kind === 'cubeIDE' ? 'Select CubeIDE installation, .app or plugins directory' : 'Select GNU Make (Windows: native make.exe from CubeIDE)',
        openLabel: 'Use Selected Path'
      });
      if (!chosen?.[0]) return false;
      const selectedPath = chosen[0].fsPath;
      output.appendLine(`Checking ${label} selection: ${selectedPath}`);
      const report = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Dauhuniec: checking ${label} at ${selectedPath}` },
        () => inspect(binary, root, { ...options(root), [kind]: selectedPath }));
      const failures = report.checks.filter(check => check.status === 'error'
        && check.action === (kind === 'cubeIDE' ? 'selectCubeIDE' : 'selectMake'));
      if (failures.length) {
        const details = failures.map(check => check.message).join('\n');
        output.appendLine(`${label} selection rejected:\n${details}`);
        const action = await vscode.window.showErrorMessage(
          `${label} tools were not found or are incomplete at "${selectedPath}". ${failures[0].message}`,
          'Select Another Path', 'Show Log', 'Official Downloads');
        if (action === 'Select Another Path') continue;
        if (action === 'Show Log') output.show();
        if (action === 'Official Downloads') await installTools();
        return false;
      }
      await vscode.workspace.getConfiguration('dauhuniec', vscode.Uri.file(root)).update(
        kind === 'cubeIDE' ? 'cubeIDEPath' : 'makePath', selectedPath, vscode.ConfigurationTarget.WorkspaceFolder);
      choices.set(root, { ...choices.get(root), [kind]: selectedPath });
      await refresh();
      output.appendLine(`${label} path saved: ${selectedPath}`);
      void vscode.window.showInformationMessage(`${label} tools found. Saved path: ${selectedPath}`);
      return true;
    }
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
        { label: 'Check again', detail: 'Refresh after installing tools', action: 'refresh' }
      ], { title: 'Dauhuniec · Resolve missing tools', placeHolder: report.checks.find(check => check.status === 'error')?.message });
      if (!action) return;
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
    await promptForTarget(await refresh());
    const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(root));
    const actions = folder?.uri.fsPath === root ? ['Build', 'View files'] : ['Open project folder', 'Build'];
    void vscode.window.showInformationMessage('Dauhuniec configured. Existing VS Code settings were merged and backed up. Your CubeMX sources are unchanged.', ...actions).then(async action => {
      if (action === 'Build') await commandTask('build', root);
      if (action === 'View files') await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(path.join(root, '.vscode/tasks.json')));
      if (action === 'Open project folder') await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(root), true);
    });
  }

  async function readyProject(argument?: unknown): Promise<{ root: string; report: Report } | undefined> {
    trusted();
    const root = await pickProject(argument);
    if (!root) return;
    const report = await inspect(binary, root, options(root));
    showReport(report);
    if (!report.ready) {
      const action = await vscode.window.showWarningMessage('Configure this project and resolve environment issues first.', 'Configure');
      if (action === 'Configure') await configure(root);
      return;
    }
    return { root, report };
  }

  async function runTask(root: string, action: string, probeSerial?: string): Promise<number | undefined> {
    if (active.has(root)) throw new Error('A Dauhuniec task is already running for this project.');
    const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(root));
    if (!folder) throw new Error('Open the project in the workspace first.');
    const id = `${Date.now()}-${Math.random()}`;
    const task = new vscode.Task({ type: 'dauhuniec', action, project: root, runId: id }, folder, `Dauhuniec: ${action}`, 'Dauhuniec',
      new vscode.ProcessExecution(binary, [action, '--project', root, ...(probeSerial ? ['--probe-serial', probeSerial] : [])], { cwd: root }), action === 'build' || action === 'flash' ? ['$gcc'] : []);
    task.presentationOptions = { reveal: vscode.TaskRevealKind.Always, panel: vscode.TaskPanelKind.Shared, clear: true };
    active.add(root);
    failures.delete(root);
    const label = ({ build: 'Building…', flash: 'Building and flashing…', upload: 'Flashing…', clean: 'Cleaning…', 'list-probes': 'Finding ST-LINK probes…' } as Record<string, string>)[action] ?? action;
    running.set(root, { label }); updateToolbar();
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (code?: number) => {
        if (settled) return;
        settled = true; active.delete(root); running.delete(root); processEnd.dispose(); taskEnd.dispose();
        if (code !== undefined && code !== 0) failures.set(root, action);
        updateToolbar();
        void refresh().catch(error => output.appendLine(String(error)));
        resolve(code);
      };
      const processEnd = vscode.tasks.onDidEndTaskProcess(event => { if (event.execution.task.definition.runId === id) finish(event.exitCode); });
      const taskEnd = vscode.tasks.onDidEndTask(event => { if (event.execution.task.definition.runId === id) setTimeout(() => finish(), 0); });
      vscode.tasks.executeTask(task).then(execution => {
        if (!settled) { running.set(root, { label, execution }); updateToolbar(); }
      }, error => {
        active.delete(root); running.delete(root); failures.set(root, action); updateToolbar();
        processEnd.dispose(); taskEnd.dispose(); reject(error);
      });
    });
  }

  async function commandTask(action: string, argument?: unknown): Promise<number | undefined> {
    const project = await readyProject(argument);
    if (!project) return;
    const probeSerial = action === 'flash' || action === 'upload' ? await targets.ensure(project.root) : undefined;
    if ((action === 'flash' || action === 'upload') && !probeSerial) return;
    return runTask(project.root, action, probeSerial);
  }

  async function debug(argument?: unknown): Promise<void> {
    const selected = await readyProject(argument);
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
      gdbPath: tools.gdb, objdumpPath: tools.objdump, nmPath: tools.nm, serverPath: tools.server,
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
    const application = await findCubeMX(vscode.workspace.getConfiguration('dauhuniec', resource).get<string>('cubeMXPath', ''));
    if (!application) {
      const action = await vscode.window.showErrorMessage('STM32CubeMX is not installed or could not be found on this host. Install STM32CubeMX or set dauhuniec.cubeMXPath to your installation.', 'Download STM32CubeMX', 'Open Settings');
      if (action === 'Download STM32CubeMX') await openDownload('cubeMX');
      if (action === 'Open Settings') await vscode.commands.executeCommand('workbench.action.openSettings', 'dauhuniec.cubeMXPath');
      return;
    }
    output.appendLine(`Starting STM32CubeMX: ${application}${ioc ? ` · ${ioc.fsPath}` : ' · new project'}`);
    await launchCubeMX(application, ioc?.fsPath);
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

  function register(name: string, handler: (argument?: unknown) => unknown): void {
    context.subscriptions.push(vscode.commands.registerCommand(`dauhuniec.${name}`, async (argument?: unknown) => {
      try { return await handler(argument); }
      catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        output.appendLine(message);
        void vscode.window.showErrorMessage(`Dauhuniec: ${message}`, 'Show Log').then(action => { if (action) output.show(); });
      }
    }));
  }

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
      if (configuration.servertype !== 'stlink' || !configuration.name?.startsWith('Dauhuniec:')) return configuration;
      const root = typeof configuration.cwd === 'string' && path.isAbsolute(configuration.cwd) ? configuration.cwd : folder?.uri.fsPath;
      if (!root) throw new Error('Open the CubeMX project folder before debugging.');
      const serial = await targets.ensure(root);
      if (!serial) return undefined;
      return pinDebugTarget(configuration, serial);
    }
  }));
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
  register('installTools', installTools);
  register('windowsGuide', windowsGuide);
  register('openIOC', openIOC); register('guide', guide); register('logs', () => output.show());
  register('chooseIDE', root => chooseTool('cubeIDE', root)); register('chooseMake', root => chooseTool('make', root));
  const watcher = vscode.workspace.createFileSystemWatcher('**/{*.ioc,Makefile,tools.json}');
  const scheduleRefresh = () => {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => { void refresh().catch(error => output.appendLine(String(error))); }, 400);
  };
  context.subscriptions.push(watcher, watcher.onDidChange(scheduleRefresh), watcher.onDidCreate(scheduleRefresh), watcher.onDidDelete(scheduleRefresh),
    vscode.workspace.onDidChangeWorkspaceFolders(scheduleRefresh), vscode.workspace.onDidChangeConfiguration(event => { if (event.affectsConfiguration('dauhuniec')) scheduleRefresh(); }),
    { dispose: () => { if (refreshTimer) clearTimeout(refreshTimer); } });

  const initial = await refresh();
  void promptForTarget(initial).catch(error => output.appendLine(String(error)));
  if (initial && !initial.configured && vscode.workspace.getConfiguration('dauhuniec').get('autoDetect', true)
      && !context.workspaceState.get(`prompted:${initial.root}`)) {
    await context.workspaceState.update(`prompted:${initial.root}`, true);
    void vscode.window.showInformationMessage('CubeMX project found. Prepare it for building and debugging in VS Code?', 'Configure', 'Later').then(action => {
      if (action === 'Configure') void vscode.commands.executeCommand('dauhuniec.configure', initial.root);
    });
  }
  return { refresh, getStatus: async () => current ?? refresh(), getProjects: projects };
}
