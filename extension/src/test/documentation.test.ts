import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { documentationLinks, parseDocumentationTarget, mcuProduct } from '../documentation';
import { halManual, halManuals, rtosDocuments, stm32Family } from '../officialDocumentation';
import { cacheOfficialPDF, documentCachePath, isPDF, downloadOfficialPDF } from '../documentationCache';

test('IOC documentation identity works before generation and ignores project names', () => {
  const target = parseDocumentationTarget('\uFEFF# board=wrong\r\nMcu.CPN=STM32F411CEU6\r\nMcu.Name=STM32F429ZITx\r\nboard=NUCLEO-F411RE\r\nProjectManager.ProjectName=Other\r\n');
  assert.deepEqual(target, { device: 'STM32F411CEU6', board: 'NUCLEO-F411RE' });
  const links = documentationLinks(target);
  assert.equal(links[0].url, 'https://www.st.com/en/microcontrollers-microprocessors/stm32f411ce.html#documentation');
  assert.equal(links[1].url, 'https://www.st.com/en/evaluation-tools/nucleo-f411re.html#documentation');
  assert.equal(parseDocumentationTarget('Mcu.Name=STM32F429ZITx').device, 'STM32F429ZITx');
  assert.equal(documentationLinks(parseDocumentationTarget('board=custom')).length, 0);
});

test('MCU normalization preserves flash and pin codes and rejects unknown models', () => {
  for (const [part, product] of [['STM32F429ZIT6', 'STM32F429ZI'], ['STM32F446RETx', 'STM32F446RE'],
    ['stm32f103c8t6', 'STM32F103C8'], ['STM32H7A3ZIT6', 'STM32H7A3ZI'], ['STM32U5A5ZJ', 'STM32U5A5ZJ'],
    ['STM32WB55RGV6', 'STM32WB55RG'], ['STM32WBA52CGU6', 'STM32WBA52CG']]) assert.equal(mcuProduct(part), product, part);
  for (const device of ['', 'STM32', 'STM32F4', 'STM32F411CE/../../evil', 'https://example.com', 'STM32MP157AAA3']) assert.equal(mcuProduct(device), undefined);
  assert.equal(documentationLinks({ board: 'custom' }).length, 0);
  assert.equal(documentationLinks({ board: 'STM32F407G-DISC1' }).length, 1);
  assert.equal(documentationLinks({ board: 'STM32F429I-DISCO' }).length, 1);
  assert.equal(documentationLinks({ board: '32F411EDISCOVERY' }).length, 1);
});

function harness() {
  let choices = ['FreeRTOS · Full'];
  const cacheRequests: any[] = [];
  const state = { cached: false, downloadFails: false, acceptFallback: true };
  const commands: { name: string; uri: any }[] = [], external: any[] = [], searches: any[] = [];
  const uri = (fsPath: string, scheme = 'file'): any => ({ fsPath, path: fsPath, scheme, toString: () => `${scheme}:${fsPath}` });
  const vscode: any = {
    Uri: { file: (file: string) => uri(file), parse: (url: string) => uri(url, 'https'), joinPath: (base: any, ...parts: string[]) => uri(path.join(base.fsPath, ...parts)) },
    RelativePattern: class { constructor(readonly base: string, readonly pattern: string) {} },
    QuickPickItemKind: { Separator: -1 }, ProgressLocation: { Notification: 15 },
    workspace: {
      fs: { readFile: async () => Buffer.from('Mcu.CPN=STM32F411CEU6\nboard=NUCLEO-F411RE') },
      getConfiguration: () => ({ get: () => ['../Firmware Docs'] }),
      findFiles: async (pattern: any) => { searches.push(pattern); return [uri('/project/Docs/Manual.pdf'), uri('/project/Docs/Readme.md')]; }
    },
    window: {
      showQuickPick: async (items: any[]) => { const choice = choices.shift() ?? 'cancel'; return items.find(item => item.label.includes(choice)); },
      withProgress: async (_: any, task: any) => task(),
      showWarningMessage: async () => state.acceptFallback ? 'Open Online' : undefined,
      showInformationMessage: async () => undefined,
      showInputBox: async () => 'NUCLEO-F411RE',
      showOpenDialog: async () => [uri('/other/Schematic.pdf')]
    },
    env: { openExternal: async (value: any) => { external.push(value); return true; } },
    commands: { executeCommand: async (name: string, value: any) => commands.push({ name, uri: value }) }
  };
  const filename = path.join(__dirname, '../documentationBrowser.js');
  const nativeRequire = createRequire(filename), module = { exports: {} as any };
  vm.runInNewContext(readFileSync(filename, 'utf8'), { TextDecoder, module, exports: module.exports,
    require: (name: string) => name === 'vscode' ? vscode : name === 'node:fs/promises' ? {
      stat: async () => { if (!state.cached) throw new Error('not found'); return {}; }
    } : name === './documentationCache' ? { documentCachePath,
      cacheOfficialPDF: async (storage: string, document: any, refresh: boolean) => {
        cacheRequests.push({ storage, document, refresh });
        if (state.downloadFails) throw new Error('offline');
        return documentCachePath(storage, document);
      }
    } : nativeRequire(name) });
  return { open: (root?: string) => module.exports.openDocumentation({ globalStorageUri: uri('/cache') }, root, root ? uri(`${root}/Board.ioc`) : undefined),
    choose: (...values: string[]) => { choices = values; }, commands, external, searches, vscode, cacheRequests, state };
}

test('official RTOS API references open publisher websites without a workspace', async () => {
  const h = harness();
  await h.open();
  h.choose('CMSIS-RTOS2'); await h.open();
  h.choose('CMSIS-RTOS v1'); await h.open();
  assert.equal(h.searches.length, 0);
  assert.equal(h.commands.length, 0);
  assert.match(h.external[0].fsPath, /^https:\/\/www.freertos.org\/Documentation/);
  assert.match(h.external[1].fsPath, /^https:\/\/arm-software.github.io\/CMSIS_6/);
  assert.match(h.external[2].fsPath, /^https:\/\/arm-software.github.io\/CMSIS_5/);
});

test('family selection uses the correct full ST manual and PDF caching, including refresh', async () => {
  const h = harness();
  h.choose('STM32F4 HAL'); await h.open('/project');
  assert.equal(h.cacheRequests[0].document.id, 'UM1725');
  assert.equal(h.external[0].fsPath, documentCachePath('/cache', halManual('STM32F411CEU6')!));
  h.choose('HAL / LL · Choose', 'STM32F1 HAL'); await h.open();
  assert.equal(h.cacheRequests[1].document.id, 'UM1850');
  h.choose('Update Downloaded'); await h.open();
  assert.equal(h.cacheRequests.length, 2, 'no cached documents to refresh');
  h.state.cached = true;
  h.choose('Update Downloaded', 'STM32H7 HAL'); await h.open();
  assert.equal(h.cacheRequests[2].document.id, 'UM2217');
  assert.equal(h.cacheRequests[2].refresh, true);
  h.state.downloadFails = true;
  h.choose('STM32F4 HAL'); await h.open('/project');
  assert.equal(h.external.at(-1).fsPath, halManual('STM32F411CEU6')!.url, 'download failure offers the official online PDF');
  h.state.acceptFallback = false;
  const before = h.external.length;
  h.choose('STM32F4 HAL'); await h.open('/project');
  assert.equal(h.external.length, before, 'cancel does not launch a browser');
});

test('hardware links, configured folders and local/remote viewer routing work before setup', async () => {
  const h = harness();
  h.choose('MCU documentation'); await h.open('/project');
  assert.match(h.external[0].fsPath, /stm32f411ce.html#documentation$/);
  assert.deepEqual(h.searches.map(search => search.base), ['/project', path.resolve('/project', '../Firmware Docs')]);
  h.choose('Board documentation'); await h.open('/project');
  assert.match(h.external[1].fsPath, /nucleo-f411re.html#documentation$/);
  h.choose('Manual.pdf'); await h.open('/project');
  assert.equal(h.external[2].fsPath, '/project/Docs/Manual.pdf');
  h.vscode.env.remoteName = 'ssh-remote'; h.choose('Manual.pdf'); await h.open('/project');
  assert.equal(h.commands.at(-1)?.name, 'vscode.open');
  h.choose('Readme.md'); await h.open('/project');
  assert.equal(h.commands.at(-1)?.name, 'markdown.showPreview');
});

test('manual model selection, file browsing, cancellation and browser failure', async () => {
  const h = harness();
  h.choose('Choose MCU'); await h.open();
  assert.match(h.external[0].fsPath, /nucleo-f411re.html/);
  h.choose('Open Local'); await h.open();
  assert.equal(h.external[1].fsPath, '/other/Schematic.pdf');
  h.choose('cancel'); await h.open();
  assert.equal(h.external.length, 2);
  h.choose('Choose MCU'); h.vscode.env.openExternal = async () => false;
  await assert.rejects(h.open(), /Could not open documentation/);
});


test('official HAL catalog keeps distinct families separate and labels legacy RTOS PDFs', () => {
  for (const [device, id] of [['STM32F103C8T6', 'UM1850'], ['STM32F411CEU6', 'UM1725'],
    ['STM32H743ZIT6', 'UM2217'], ['STM32G474RET6', 'UM2570'], ['STM32L476RGT6', 'UM1884'],
    ['STM32U575ZIT6', 'UM2911'], ['STM32WB55RGV6', 'UM2442'], ['STM32WLE5JCI6', 'UM2642']]) {
    assert.equal(halManual(device)?.id, id, device);
  }
  for (const device of ['STM32WBA52CGU6', 'STM32H7S3L8', 'STM32WB09KEV6', 'custom', undefined]) assert.equal(halManual(device), undefined);
  assert.equal(stm32Family('STM32WBA52CGU6'), 'STM32WBA');
  assert.equal(stm32Family('STM32H7R3L8'), 'STM32H7RS');
  assert.equal(new Set(halManuals.map(manual => manual.id)).size, halManuals.length);
  for (const manual of halManuals) assert.match(manual.url, /^https:\/\/www.st.com\/resource\/en\/user_manual\/.+\.pdf$/);
  assert.match(rtosDocuments.find(document => document.id === 'freertos-reference-v10')!.label, /V10.0.0.*legacy/);
});

const pdf = Buffer.from('%PDF-1.7\nOfficial document fixture\n%%EOF\n');

test('official PDF cache downloads once, works offline, deduplicates concurrent opens and refreshes atomically', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cr-docs-'));
  const manual = halManual('STM32F411CEU6')!;
  let downloads = 0;
  const download = async (url: string) => { assert.equal(url, manual.url); downloads++; return pdf; };
  try {
    const [first, second] = await Promise.all([cacheOfficialPDF(root, manual, false, download), cacheOfficialPDF(root, manual, false, download)]);
    assert.equal(first, second); assert.equal(downloads, 1);
    assert.deepEqual(await fs.readFile(first), pdf);
    await cacheOfficialPDF(root, manual, false, async () => { throw new Error('offline'); });
    await assert.rejects(cacheOfficialPDF(root, manual, true, async () => Buffer.from('<html>Error</html>')), /not a complete PDF/);
    assert.deepEqual(await fs.readFile(first), pdf, 'failed refresh preserves the offline copy');
    await cacheOfficialPDF(root, manual, true, download); assert.equal(downloads, 2);
    await fs.writeFile(first, '%PDF-truncated');
    await cacheOfficialPDF(root, manual, false, download); assert.equal(downloads, 3, 'repair an incomplete cache entry');
    assert.deepEqual(await fs.readdir(path.dirname(first)), ['UM1725.pdf'], 'temporary files are cleaned up');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('documentation downloads reject non-publishers, insecure URLs and incomplete PDF payloads', async () => {
  assert.equal(isPDF(pdf), true);
  for (const data of ['<html>Sign in</html>', '%PDF-1.7 truncated', 'not a PDF %%EOF']) assert.equal(isPDF(Buffer.from(data)), false);
  for (const address of ['http://www.st.com/manual.pdf', 'https://example.com/manual.pdf', 'https://st.com.evil.test/manual.pdf']) {
    await assert.rejects(downloadOfficialPDF(address), /official.*HTTPS/);
  }
  assert.throws(() => documentCachePath('/cache', { ...halManuals[0], id: '../bad' }), /Unsupported/);
});
