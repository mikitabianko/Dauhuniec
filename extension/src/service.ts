import { diagnostics } from './diagnosticReport';
import { execFile } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { constants } from 'node:fs';
export interface Project {
  target: string;
  build_dir: string;
  device: string;
  ioc: string;
}
export interface Check {
  id: string;
  label: string;
  status: 'ok' | 'warning' | 'error';
  message: string;
  action?: string;
}
export interface Report {
  buildPreset?: string;
  schemaVersion: 1;
  version: string;
  root: string;
  project?: Project;
  configured: boolean;
  ready: boolean;
  checks: Check[];
  tools: Record<string, string>;
  toolDiscovery?: ToolsReport;
}
export interface ToolOptions {
  cubeIDE?: string;
  make?: string;
  cubeMX?: string;
}
export interface ToolCandidate {
  kind: string;
  originalPath: string;
  resolvedPath?: string;
  source: string;
  installation?: string;
  valid: boolean;
  reason: string;
  components?: Record<string, string>;
}
export interface ToolsReport {
  schemaVersion: 1;
  version: string;
  tools: Record<string, string>;
  checks: Check[];
  details: Record<string, ToolCandidate>;
  alternatives: Record<string, ToolCandidate[]>;
  actions: Record<string, Record<string, string>>;
  candidates?: ToolCandidate[];
  selection?: Record<string, string>;
}
export async function discover(binary: string, cwd: string, options: ToolOptions = {}, previous: Record<string, string> = {}): Promise<ToolsReport> {
  const args = ['tools', '--json', '--diagnostics', ...toolArgs(options)];
  for (const [key, value] of Object.entries(previous))
    if (value && ['gcc', 'gdb', 'server', 'programmer', 'make', 'cubeMX', 'objcopy'].includes(key))
      args.push('--known', `${key}=${value}`);
  const report = JSON.parse(await execute(binary, args, cwd)) as ToolsReport;
  if (report.schemaVersion !== 1 || !report.actions || !report.alternatives)
    throw new Error('Unsupported tool discovery response.');
  diagnostics.record('discovery', report);
  return report;
}
/** Resolve after VS Code variable substitution so an empty setting cannot trigger a PATH fallback. */
export async function resolveDebugServer(root: string, configured: unknown, discover: () => Promise<string | undefined>): Promise<string> {
  let server = typeof configured === 'string' ? configured : '';
  if (!server.trim() || /^ST-LINK_gdbserver(?:\.exe)?$/i.test(server))
    server = await discover() || '';
  if (!server || server.includes('${'))
    throw new Error('ST-LINK GDB server path is missing. Select the STM32CubeIDE installation in Dauhuniec and configure the project again.');
  const executable = path.resolve(root, server);
  try {
    if (!(await fs.stat(executable)).isFile())
      throw new Error('Not a file');
    const resolved = await fs.realpath(executable);
    await fs.access(resolved, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
    diagnostics.record('file.validation', { originalPath: server, resolvedPath: resolved, valid: true });
    return resolved;
  }
  catch (error) {
    diagnostics.record('file.validation.failure', { originalPath: server, error: String(error), valid: false });
    throw new Error(`ST-LINK GDB server is missing or cannot be executed: ${executable}. Select the STM32CubeIDE installation in Dauhuniec and configure the project again.`);
  }
}
export function binaryFor(extensionPath: string, platform = process.platform, arch = process.arch): string {
  const os = ({ darwin: 'darwin', linux: 'linux', win32: 'windows' } as Record<string, string>)[platform];
  const cpu = ({ x64: 'amd64', arm64: 'arm64' } as Record<string, string>)[arch];
  if (!os || !cpu)
    throw new Error(`Dauhuniec does not include a CLI for ${platform}/${arch}.`);
  return path.join(extensionPath, 'bin', `lon-${os}-${cpu}${platform === 'win32' ? '.exe' : ''}`);
}
export function toolArgs(options: ToolOptions): string[] {
  return [...(options.cubeIDE ? ['--cube-ide', options.cubeIDE] : []), ...(options.make ? ['--make', options.make] : []), ...(options.cubeMX ? ['--cube-mx', options.cubeMX] : [])];
}
export function execute(binary: string, args: string[], cwd: string, log?: (text: string) => void): Promise<string> {
  diagnostics.record('process.start', { binary, args, cwd });
  return new Promise((resolve, reject) => {
    const child = execFile(binary, args, { cwd, timeout: 60000, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
      diagnostics.record(error ? 'process.error' : 'process.exit', { binary, args, cwd, exitCode: error?.code ?? 0, creationError: error && !child.pid ? error.message : undefined, stdout, stderr });
      if (error)
        reject(new Error((stderr || stdout || error.message).trim()));
      else
        resolve(stdout);
    });
    if (log) {
      child.stdout?.on('data', data => log(String(data)));
      child.stderr?.on('data', data => log(String(data)));
    }
  });
}
export function parseReport(text: string): Report {
  const result = JSON.parse(text) as Partial<Report>;
  if (result.schemaVersion !== 1 || typeof result.root !== 'string' || !Array.isArray(result.checks)
    || typeof result.configured !== 'boolean' || typeof result.ready !== 'boolean' || !result.tools
    || result.checks.some(check => !check || typeof check.id !== 'string' || !['ok', 'warning', 'error'].includes(check.status))) {
    throw new Error('Unsupported Dauhuniec diagnostic response. Reinstall the extension.');
  }
  return result as Report;
}
export async function inspect(binary: string, root: string, options: ToolOptions = {}, verify = false): Promise<Report> {
  const report = parseReport(await execute(binary, [verify ? 'doctor' : 'inspect', '--project', root, '--json', '--diagnostics', ...toolArgs(options)], root));
  if (report.toolDiscovery)
    diagnostics.record('discovery', report.toolDiscovery);
  return report;
}
