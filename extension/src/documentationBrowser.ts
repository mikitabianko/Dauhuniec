import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { halManual, halManuals, firmwareDocumentation, rtosDocuments, OfficialDocument } from './officialDocumentation';
import { cacheOfficialPDF, documentCachePath } from './documentationCache';
import { documentationLinks, parseDocumentationTarget } from './documentation';

interface Entry extends vscode.QuickPickItem { uri?: vscode.Uri; document?: OfficialDocument; action?: 'manual' | 'browse' | 'hal' | 'refresh'; }

export async function openDocumentation(context: vscode.ExtensionContext, root?: string, ioc?: vscode.Uri): Promise<void> {
  const items: Entry[] = [];
  const storage = context.globalStorageUri.fsPath;
  const documentEntry = async (document: OfficialDocument): Promise<Entry> => {
    const cached = document.format === 'pdf' && await fs.stat(documentCachePath(storage, document)).then(() => true, () => false);
    return { label: document.label, document, description: document.publisher,
      detail: document.format === 'pdf'
        ? `Full official PDF · ${cached ? 'Downloaded · Available offline' : 'Download on first open, then available offline'} · ${document.url}`
        : `Full official documentation · Internet required · ${document.url}` };
  };
  const separator = (label: string): Entry => ({ label, kind: vscode.QuickPickItemKind.Separator });
  if (ioc) {
    const target = parseDocumentationTarget(new TextDecoder().decode(await vscode.workspace.fs.readFile(ioc)));
    const links = documentationLinks(target);
    items.push(separator(`Project · ${path.basename(ioc.fsPath)}`));
    items.push(...links.map(link => ({ label: link.label, detail: link.detail, uri: vscode.Uri.parse(link.url) })));
    const manual = halManual(target.device), firmware = firmwareDocumentation(target.device);
    if (manual) items.push(await documentEntry(manual));
    if (firmware) items.push(await documentEntry(firmware));
    if (!links.length && !manual && !firmware) items.push({ label: 'MCU / ST board could not be identified', detail: 'Choose a model below, or open a local manual.', action: 'manual' });
  }
  items.push(separator('Official HAL / LL manuals'),
    { label: 'HAL / LL · Choose STM32 family…', detail: 'Full STMicroelectronics manuals · Download PDFs for offline access', action: 'hal' });
  items.push(separator('Official RTOS documentation'), ...await Promise.all(rtosDocuments.map(documentEntry)));
  if (root) {
    const config = vscode.workspace.getConfiguration('dauhuniec', vscode.Uri.file(root));
    const folders = [root, ...config.get<string[]>('documentationPaths', []).filter(folder => folder.trim()).map(folder => path.resolve(root, folder))];
    const found = new Map<string, vscode.Uri>();
    let limited = false;
    for (const folder of new Set(folders)) {
      const files = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, '**/*.{pdf,PDF,md,MD,html,HTML,htm,HTM}'),
        '**/{.git,node_modules,build,.build,dist,.dauhuniec}/**', 201);
      limited ||= files.length > 200;
      for (const file of files.slice(0, 200)) found.set(file.toString(), file);
    }
    if (found.size) items.push(separator(`Local documents${limited ? ' · results limited; use Open Local Document for more' : ''}`),
      ...[...found.values()].sort((a, b) => a.fsPath.localeCompare(b.fsPath)).map(uri => ({
        label: path.basename(uri.fsPath), description: path.relative(root, uri.fsPath), detail: uri.fsPath, uri
      })));
  }
  items.push(separator('Other documentation'),
    { label: 'Choose MCU or ST board…', detail: 'Enter a model, for example STM32F411CEU6 or NUCLEO-F411RE', action: 'manual' },
    { label: 'Update Downloaded Manual…', detail: 'Download a fresh copy from the publisher; keep the previous copy if the update fails', action: 'refresh' },
    { label: 'Open Local Document…', detail: 'Datasheet, schematic or manual for any board or component', action: 'browse' });
  const picked = await vscode.window.showQuickPick(items, { title: 'Dauhuniec · Documentation',
    placeHolder: 'Search MCU, board, HAL, RTOS or local documents', matchOnDescription: true, matchOnDetail: true });
  if (!picked) return;
  let uri = picked.uri;
  let document = picked.document;
  if (picked.action === 'hal' || picked.action === 'refresh') {
    let documents = [...halManuals, ...rtosDocuments.filter(item => item.format === 'pdf')];
    if (picked.action === 'hal') documents = [...halManuals];
    else {
      const cached = await Promise.all(documents.map(async item => await fs.stat(documentCachePath(storage, item)).then(() => true, () => false)));
      documents = documents.filter((_, index) => cached[index]);
      if (!documents.length) { await vscode.window.showInformationMessage('No downloaded manuals yet. Open an official PDF manual to save it for offline use.'); return; }
    }
    document = (await vscode.window.showQuickPick(await Promise.all(documents.map(documentEntry)), {
      title: picked.action === 'hal' ? 'Dauhuniec · Official HAL / LL manual' : 'Dauhuniec · Update downloaded manual',
      placeHolder: 'Choose the family matching your project and installed firmware package', matchOnDetail: true
    }))?.document;
    if (!document) return;
  }
  if (document) {
    if (document.format === 'web') uri = vscode.Uri.parse(document.url);
    else {
      try {
        const file = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification,
          title: `Dauhuniec: opening ${document.label}` }, () => cacheOfficialPDF(storage, document!, picked.action === 'refresh'));
        uri = vscode.Uri.file(file);
      } catch (error) {
        const action = await vscode.window.showWarningMessage(`Could not download the official manual: ${error instanceof Error ? error.message : String(error)}`, 'Open Online');
        if (action !== 'Open Online') return;
        uri = vscode.Uri.parse(document.url);
      }
    }
  }
  if (picked.action === 'manual') {
    const model = await vscode.window.showInputBox({ title: 'Dauhuniec · MCU or ST board model',
      prompt: 'ST product model. For third-party boards, use Open Local Document.',
      validateInput: value => documentationLinks({ device: value, board: value }).length ? undefined : 'Enter an STM32 MCU or ST board model, for example STM32F411CEU6 or NUCLEO-F411RE.' });
    if (!model) return;
    uri = vscode.Uri.parse(documentationLinks({ device: model, board: model })[0].url);
  } else if (picked.action === 'browse') {
    uri = (await vscode.window.showOpenDialog({ canSelectMany: false, openLabel: 'Open Documentation',
      filters: { Documentation: ['pdf', 'md', 'html', 'htm'] } }))?.[0];
  }
  if (!uri) return;
  if (uri.scheme === 'https') {
    if (!await vscode.env.openExternal(uri)) throw new Error('Could not open documentation in the browser.');
  } else if (uri.path.toLowerCase().endsWith('.md')) {
    await vscode.commands.executeCommand('markdown.showPreview', uri);
  } else if (uri.scheme === 'file' && !vscode.env.remoteName) {
    if (!await vscode.env.openExternal(uri)) throw new Error('Could not open the document. Install a PDF/HTML viewer or open the file in VS Code.');
  } else {
    await vscode.commands.executeCommand('vscode.open', uri);
  }
}
