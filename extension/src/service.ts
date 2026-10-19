import { execFile } from 'node:child_process';
import * as path from 'node:path';

export interface Project { target: string; build_dir: string; device: string; ioc: string; }
export interface Check { id: string; label: string; status: 'ok' | 'warning' | 'error'; message: string; action?: string; }
export interface Report {
  schemaVersion: 1; version: string; root: string; project?: Project;
  configured: boolean; ready: boolean; checks: Check[]; tools: Record<string, string>;
}
export interface ToolOptions { cubeIDE?: string; make?: string; }

export function binaryFor(extensionPath: string, platform = process.platform, arch = process.arch): string {
  const os = ({ darwin: 'darwin', linux: 'linux', win32: 'windows' } as Record<string, string>)[platform];
  const cpu = ({ x64: 'amd64', arm64: 'arm64' } as Record<string, string>)[arch];
  if (!os || !cpu) throw new Error(`Dauhuniec does not include a CLI for ${platform}/${arch}.`);
  return path.join(extensionPath, 'bin', `lon-${os}-${cpu}${platform === 'win32' ? '.exe' : ''}`);
}

export function toolArgs(options: ToolOptions): string[] {
  return [...(options.cubeIDE ? ['--cube-ide', options.cubeIDE] : []), ...(options.make ? ['--make', options.make] : [])];
}

export function execute(binary: string, args: string[], cwd: string, log?: (text: string) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(binary, args, { cwd, timeout: 60000, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
      if (error) reject(new Error((stderr || stdout || error.message).trim()));
      else resolve(stdout);
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
  return parseReport(await execute(binary, [verify ? 'doctor' : 'inspect', '--project', root, '--json', ...toolArgs(options)], root));
}
