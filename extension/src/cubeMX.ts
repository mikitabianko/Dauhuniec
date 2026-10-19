import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import { constants } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export interface CubeMXEnvironment {
  platform: NodeJS.Platform;
  home: string;
  env: NodeJS.ProcessEnv;
}

const environment = (): CubeMXEnvironment => ({ platform: process.platform, home: os.homedir(), env: process.env });

export function cubeMXLocations({ platform, home, env }: CubeMXEnvironment): string[] {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const locations = [p.join(home, 'STM32CubeMX'), p.join(home, 'STM32Cube', 'STM32CubeMX'), p.join(home, '.stm32cubemx')];
  if (platform === 'win32') {
    for (const base of [env.ProgramFiles || 'C:\\Program Files', env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', env.LOCALAPPDATA]) {
      if (base) locations.push(p.join(base, 'STMicroelectronics', 'STM32Cube', 'STM32CubeMX'), p.join(base, 'STMicroelectronics', 'STM32CubeMX'));
    }
  } else if (platform === 'darwin') {
    for (const base of ['/Applications', p.join(home, 'Applications')]) {
      locations.push(base, p.join(base, 'STMicroelectronics'), p.join(base, 'STMicroelectronics', 'STM32CubeMX'));
    }
  } else if (platform === 'linux') {
    locations.push('/usr/local/STMicroelectronics/STM32Cube/STM32CubeMX', '/opt/STMicroelectronics/STM32Cube/STM32CubeMX',
      '/opt/st/STM32CubeMX', '/opt/STM32CubeMX', '/usr/local/STM32CubeMX');
  }
  const searchPath = env.PATH ?? env.Path ?? '';
  locations.push(...searchPath.split(platform === 'win32' ? ';' : ':').filter(Boolean).map(entry => entry.replace(/^"(.*)"$/, '$1')));
  return [...new Set(locations)];
}

async function executable(candidate: string, platform: NodeJS.Platform): Promise<string | undefined> {
  try {
    const stat = await fs.stat(candidate);
    if (platform === 'darwin' && candidate.toLowerCase().endsWith('.app') && stat.isDirectory()) {
      // Do not accept an empty/stale application bundle as an installation.
      await fs.access(path.join(candidate, 'Contents', 'MacOS', 'STM32CubeMX'), constants.X_OK);
      return candidate;
    }
    if (!stat.isFile()) return;
    await fs.access(candidate, platform === 'win32' ? constants.F_OK : constants.X_OK);
    return candidate;
  } catch { return; }
}

async function resolveLocation(location: string, platform: NodeJS.Platform): Promise<string | undefined> {
  const direct = await executable(location, platform);
  if (direct) return direct;
  const names = platform === 'win32' ? ['STM32CubeMX.exe'] : platform === 'darwin' ? ['STM32CubeMX.app', 'STM32CubeMX'] : ['STM32CubeMX', 'stm32cubemx'];
  for (const name of names) {
    const found = await executable(path.join(location, name), platform);
    if (found) return found;
  }
}

export async function findCubeMX(configuredPath = '', host = environment(), locations = cubeMXLocations(host)): Promise<string | undefined> {
  if (!['win32', 'darwin', 'linux'].includes(host.platform)) throw new Error(`STM32CubeMX launch is not supported on ${host.platform}.`);
  if (configuredPath.trim()) {
    const found = await resolveLocation(configuredPath.trim(), host.platform);
    if (!found) throw new Error(`STM32CubeMX was not found at "${configuredPath}". Check dauhuniec.cubeMXPath or install STM32CubeMX.`);
    return found;
  }
  for (const location of locations) {
    const found = await resolveLocation(location, host.platform);
    if (found) return found;
    // macOS installers also use versioned names such as STM32CubeMX-6.12.0.app.
    if (host.platform === 'darwin') {
      const entries = await fs.readdir(location).catch(() => [] as string[]);
      for (const name of entries.filter(name => /^STM32CubeMX.*\.app$/i.test(name)).sort().reverse()) {
        const bundle = await executable(path.join(location, name), host.platform);
        if (bundle) return bundle;
      }
    }
  }
}

export function cubeMXLaunch(application: string, ioc?: string, platform = process.platform): { command: string; args: string[] } {
  const args = ioc ? ['-i', ioc] : [];
  if (platform === 'darwin' && application.toLowerCase().endsWith('.app')) {
    // A new instance ensures the project arguments reach CubeMX even if it is already running.
    return { command: '/usr/bin/open', args: ['-n', '-a', application, '--args', ...args] };
  }
  return { command: application, args };
}

export async function launchCubeMX(application: string, ioc?: string): Promise<void> {
  const { command, args } = cubeMXLaunch(application, ioc);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: 'ignore', shell: false });
    child.once('error', error => reject(new Error(`Could not start STM32CubeMX: ${error.message}`)));
    if (command === '/usr/bin/open') {
      child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Could not start STM32CubeMX (open exited with code ${code}).`)));
    } else {
      child.once('spawn', () => { child.unref(); resolve(); });
    }
  });
}
