import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { cubeMXLaunch, cubeMXLocations, findCubeMX, launchCubeMX } from '../cubeMX';

test('installation locations cover desktop platforms and platform-specific PATH separators', () => {
  const windows = cubeMXLocations({ platform: 'win32', home: 'C:\\Users\\Dev', env: { ProgramFiles: 'D:\\Program Files', LOCALAPPDATA: 'C:\\Users\\Dev\\AppData\\Local', Path: 'D:\\Tools;"E:\\Cube Tools"' } });
  assert.ok(windows.includes('D:\\Program Files\\STMicroelectronics\\STM32Cube\\STM32CubeMX'));
  assert.ok(windows.includes('C:\\Users\\Dev\\AppData\\Local\\STMicroelectronics\\STM32Cube\\STM32CubeMX'));
  assert.ok(windows.includes('C:\\Users\\Dev\\AppData\\Local\\Programs\\STM32CubeMX'));
  assert.ok(windows.includes('C:\\Users\\Dev\\AppData\\Local\\Programs\\STMicroelectronics\\STM32Cube\\STM32CubeMX'));
  assert.ok(windows.includes('E:\\Cube Tools'));
  const mac = cubeMXLocations({ platform: 'darwin', home: '/Users/dev', env: {} });
  assert.ok(mac.includes('/Applications'));
  assert.ok(mac.includes('/Users/dev/Applications'));
  const linux = cubeMXLocations({ platform: 'linux', home: '/home/dev', env: { PATH: '/bin:/custom/tools' } });
  assert.ok(linux.includes('/usr/local/STMicroelectronics/STM32Cube/STM32CubeMX'));
  assert.ok(linux.includes('/home/dev/STM32CubeMX'));
  assert.ok(linux.includes('/custom/tools'));
});

test('Windows locations include per-user installs without LOCALAPPDATA and native Program Files', () => {
  const locations = cubeMXLocations({ platform: 'win32', home: 'D:\\Users\\Dev', env: {
    ProgramW6432: 'D:\\Program Files', ProgramFiles: 'D:\\Program Files (x86)'
  } });
  assert.ok(locations.includes('D:\\Users\\Dev\\AppData\\Local\\Programs\\STM32CubeMX'));
  assert.ok(locations.includes('D:\\Program Files\\STMicroelectronics\\STM32Cube\\STM32CubeMX'));
  assert.equal(locations.length, new Set(locations).size);
});

test('Windows detection resolves STM32CubeMX.exe from an installation directory', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dauhuniec-cubemx-win-'));
  try {
    const host = { platform: 'win32' as const, home: root, env: {} };
    const app = path.join(root, 'Programs', 'STM32CubeMX', 'STM32CubeMX.exe');
    await fs.mkdir(path.dirname(app), { recursive: true });
    await fs.writeFile(app, '');
    assert.equal(await findCubeMX('', host, [path.join(root, 'missing'), path.dirname(app)]), app);
    if (process.platform === 'win32') {
      assert.equal(await findCubeMX('', { ...host, env: { LOCALAPPDATA: root } }), app);
    }
    assert.equal(await findCubeMX(path.dirname(app), host), app);
    assert.equal(await findCubeMX(app, host), app);
    assert.equal(await findCubeMX(`  "${app}"  `, host), app);
    assert.equal(await findCubeMX('"%LOCALAPPDATA%/Programs/STM32CubeMX"', {
      ...host, env: { LocalAppData: root }
    }), app);
    await assert.rejects(findCubeMX('%UNKNOWN_CUBEMX_LOCATION%/STM32CubeMX.exe', host), /not found/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('launch arguments open an IOC or the new-project UI without shell interpolation', () => {
  const ioc = '/projects/My board; $(touch nope)/Board.ioc';
  for (const platform of ['win32', 'linux', 'darwin'] as NodeJS.Platform[]) {
    const app = platform === 'win32' ? 'C:\\Program Files\\CubeMX\\STM32CubeMX.exe' : '/tools/Cube MX/STM32CubeMX';
    assert.deepEqual(cubeMXLaunch(app, ioc, platform), { command: app, args: ['-i', ioc] });
    assert.deepEqual(cubeMXLaunch(app, undefined, platform), { command: app, args: [] });
  }
  assert.deepEqual(cubeMXLaunch('/Applications/STM32CubeMX.app', ioc, 'darwin'), {
    command: '/usr/bin/open', args: ['-n', '-a', '/Applications/STM32CubeMX.app', '--args', '-i', ioc]
  });
  assert.deepEqual(cubeMXLaunch('/Applications/STM32CubeMX.app', undefined, 'darwin').args,
    ['-n', '-a', '/Applications/STM32CubeMX.app', '--args']);
});

test('detect executable, installation directory and PATH; reject missing or unusable configured paths', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dauhuniec-cubemx-'));
  try {
    const app = path.join(root, process.platform === 'win32' ? 'STM32CubeMX.exe' : 'STM32CubeMX');
    await fs.writeFile(app, '', { mode: 0o755 });
    assert.equal(await findCubeMX(app), app);
    assert.equal(await findCubeMX(root), app);
    // Use a fixture PATH on all hosts, with no dependency on an installed CubeMX.
    assert.equal(await findCubeMX('', { platform: 'linux', home: root, env: { PATH: root } }, [root]), process.platform === 'win32' ? undefined : app);
    await assert.rejects(findCubeMX(path.join(root, 'missing')), /not found.*cubeMXPath/);
    await fs.rm(app);
    assert.equal(await findCubeMX('', { platform: 'win32', home: root, env: {} }, [root]), undefined);
    await assert.rejects(findCubeMX(root), /not found/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('macOS detection accepts versioned app bundles but rejects stale bundles', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dauhuniec-cubemx-app-'));
  try {
    const app = path.join(root, 'Applications', 'STM32CubeMX-6.12.0.app');
    await fs.mkdir(path.join(app, 'Contents', 'MacOS'), { recursive: true });
    const host = { platform: 'darwin' as const, home: root, env: {} };
    await assert.rejects(findCubeMX(app, host), /not found/);
    await fs.writeFile(path.join(app, 'Contents', 'MacOS', 'STM32CubeMX'), '', { mode: 0o755 });
    assert.equal(await findCubeMX(app, host), app);
    assert.equal(await findCubeMX('', host, [path.join(root, 'Applications')]), app);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('launch errors are reported instead of becoming unhandled process errors', async () => {
  await assert.rejects(launchCubeMX(path.join(os.tmpdir(), 'nonexistent-dauhuniec-cubemx', 'STM32CubeMX')), /Could not start STM32CubeMX/);
});

test('immediate native launcher failures are reported with their exit code', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dauhuniec-cubemx-failure-'));
  try {
    const app = path.join(root, process.platform === 'win32' ? 'STM32CubeMX.exe' : 'STM32CubeMX');
    let ioc: string | undefined;
    if (process.platform === 'win32') {
      await fs.copyFile(process.execPath, app);
      ioc = path.join(root, 'exit.ioc');
      await fs.writeFile(ioc, 'process.exit(23);');
    } else {
      // Avoid making the one-second early-exit check depend on Node startup under load.
      await fs.writeFile(app, '#!/bin/sh\nexit 23\n', { mode: 0o755 });
    }
    await assert.rejects(launchCubeMX(app, ioc), /Could not start STM32CubeMX.*exit code 23/);
  } finally {
    // Windows can briefly retain the executable lock after the child exits.
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('Windows native launch preserves Unicode, spaces and shell metacharacters in IOC paths', { skip: process.platform !== 'win32' }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'Cube MX тест &-'));
  try {
    // A real PE executable exercises Windows process creation and argv quoting.
    const app = path.join(root, 'STM32CubeMX.exe');
    await fs.copyFile(process.execPath, app);
    const result = path.join(root, 'args.json');
    const ioc = path.join(root, 'Плата with spaces & $name.ioc');
    await fs.writeFile(ioc, `require('node:fs').writeFileSync(${JSON.stringify(result)}, JSON.stringify({ argv: process.argv.slice(1), flags: process.execArgv }));`);
    await launchCubeMX(app, ioc);
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await fs.stat(result).then(() => true, () => false)) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.deepEqual(JSON.parse(await fs.readFile(result, 'utf8')), { argv: [ioc], flags: ['-i'] });
  } finally {
    // Windows can briefly retain the executable lock after the child exits.
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('native launch delivers exact project arguments to an executable', { skip: process.platform === 'win32' }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dauhuniec-cubemx-launch-'));
  try {
    const app = path.join(root, 'Cube MX');
    const result = path.join(root, 'args.json');
    await fs.writeFile(app, `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(result)}, JSON.stringify(process.argv.slice(2)));\n`, { mode: 0o755 });
    const ioc = path.join(root, 'Board with spaces; $test.ioc');
    await launchCubeMX(app, ioc);
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await fs.stat(result).then(() => true, () => false)) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.deepEqual(JSON.parse(await fs.readFile(result, 'utf8')), ['-i', ioc]);
    await fs.rm(result);
    await launchCubeMX(app);
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await fs.stat(result).then(() => true, () => false)) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.deepEqual(JSON.parse(await fs.readFile(result, 'utf8')), []);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
