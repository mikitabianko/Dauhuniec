import type { Check } from './service';

export const clangdExtension = 'llvm-vs-code-extensions.vscode-clangd';

/** Inspect effective settings, including user and workspace overrides. */
export function intelliSenseChecks(engine: unknown, clangdEnabled: boolean, stm32ClangdEnabled: boolean, installed = true): Check[] {
  if (!installed)
    return [{ id: 'intellisense', label: 'Install clangd', status: 'warning',
      message: 'Install or enable the clangd extension and its language server for code navigation.', action: 'installClangd' }];
  const problems: string[] = [];
  if (engine !== 'disabled') problems.push('Microsoft C/C++ IntelliSense is enabled alongside clangd');
  if (!clangdEnabled) problems.push('clangd is disabled');
  if (stm32ClangdEnabled) problems.push('the second STM32 clangd server is enabled');
  return problems.length ? [{ id: 'intellisense', label: 'clangd settings', status: 'warning',
    message: `${problems.join('; ')}. Run Configure Project to restore clangd. Reload Window if the language servers do not restart.`, action: 'configure' }] : [];
}

interface ClangdInstaller {
  installed(): boolean;
  installExtension(): PromiseLike<unknown>;
  activate(): PromiseLike<unknown>;
  downloadServer(): PromiseLike<unknown>;
}

/** The official extension owns server downloads, platform selection and updates. */
export async function ensureClangd(installer: ClangdInstaller, download = false): Promise<void> {
  // VS Code can expose the manifest of a disabled extension. Always ask the
  // host to install or enable it before activation, including on later retries.
  await installer.installExtension();
  if (!installer.installed()) throw new Error('Enable the clangd extension in this workspace, then retry.');
  await installer.activate();
  if (download) await installer.downloadServer();
}
