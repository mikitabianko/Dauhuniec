import { spawn } from 'node:child_process';

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
    const child = spawn(command, args, { detached: true, stdio: 'ignore', shell: false, windowsHide: true });
    let timer: NodeJS.Timeout | undefined;
    const finish = (error?: Error) => {
      clearTimeout(timer);
      child.removeListener('exit', onExit);
      child.unref();
      if (error) reject(error); else resolve();
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      finish(code === 0 ? undefined : new Error(`Could not start STM32CubeMX at "${application}" (${signal ? `signal ${signal}` : `exit code ${code}`}). Try launching it directly to check its installation and Java runtime.`));
    };
    child.once('error', error => finish(new Error(`Could not start STM32CubeMX at "${application}": ${error.message}`)));
    child.once('exit', onExit);
    // Catch immediate launcher/JVM failures before detaching. This does not prove GUI readiness.
    if (command !== '/usr/bin/open') child.once('spawn', () => { timer = setTimeout(() => finish(), 1000); });
  });
}
