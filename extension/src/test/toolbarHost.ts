import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { ProjectToolbar } from '../toolbar';
import { Report } from '../service';
export function testToolbar(): void {
  const items = new Map<string, {
    item: vscode.StatusBarItem;
    visible: boolean;
  }>();
  const toolbar = new ProjectToolbar((id, alignment, priority) => {
    const item = vscode.window.createStatusBarItem(id, alignment, priority);
    const state = { item, visible: false };
    const show = item.show.bind(item), hide = item.hide.bind(item);
    item.show = () => { state.visible = true; show(); };
    item.hide = () => { state.visible = false; hide(); };
    items.set(id.replace('dauhuniec.', ''), state);
    return item;
  });
  const visible = () => [...items].filter(([, value]) => value.visible).map(([key]) => key);
  const report: Report = { schemaVersion: 1, version: 'test', root: '/tmp/TestExtension', configured: true,
    ready: true, checks: [], tools: {}, project: { target: 'firmware', build_dir: 'build', device: 'STM32C071RBT6', ioc: 'Test.ioc' } };
  try {
    toolbar.update({ projectCount: 0 });
    assert.deepEqual(visible(), ['serialMonitor']);
    assert.equal(items.get('serialMonitor')!.item.command, 'dauhuniec.serialMonitor');
    toolbar.update({ projectCount: 2 });
    assert.deepEqual(visible(), ['home', 'cubeMX', 'serialMonitor']);
    assert.equal(items.get('home')!.item.command, 'workbench.view.extension.dauhuniec');
    assert.equal(items.get('cubeMX')!.item.command, 'dauhuniec.openIOC');
    assert.match(String(items.get('cubeMX')!.item.tooltip), /STM32CubeMX/);
    toolbar.update({ projectCount: 1, report: { ...report, ready: false } });
    assert.deepEqual(visible(), ['home', 'cubeMX', 'serialMonitor']);
    assert.match(items.get('home')!.item.text, /warning/);
    toolbar.update({projectCount:1,report:{...report,ready:false,toolDiscovery:{schemaVersion:1,version:'test',tools:{},checks:[],details:{},alternatives:{},actions:{build:{gcc:'gcc',objcopy:'objcopy',size:'size',make:'make'}}}}});
    assert.deepEqual(visible(),['home','cubeMX','build','serialMonitor'],'missing optional debug/programming tools do not hide Build');
    toolbar.update({ projectCount: 1, report });
    assert.deepEqual(visible(), ['home', 'cubeMX', 'build', 'upload', 'flash', 'debug', 'serialMonitor']);
    assert.equal(items.get('home')!.item.text, '$(home)');
    assert.match(String(items.get('home')!.item.tooltip), /STM32C071RBT6/);
    assert.match(String(items.get('home')!.item.tooltip), /TestExtension/);
    for (const action of ['build', 'upload', 'flash', 'debug']) {
      assert.equal(items.get(action)!.item.command, `dauhuniec.${action}`, `${action} executes directly`);
      assert.match(items.get(action)!.item.text, /^\$\([a-z-]+\)$/u, 'shortcut contains only an icon');
      assert.ok(items.get(action)!.item.accessibilityInformation?.label);
      assert.match(String(items.get(action)!.item.tooltip), /TestExtension/);
    }
    assert.match(String(items.get('upload')!.item.tooltip), /no build/);
    assert.match(String(items.get('flash')!.item.tooltip), /Build and Flash/);
    toolbar.update({ projectCount: 1, report, busy: 'Building…', cancellable: true });
    assert.deepEqual(visible(), ['home', 'cubeMX', 'serialMonitor', 'stop'], 'hide new task actions while a task runs');
    assert.equal(items.get('stop')!.item.command, 'dauhuniec.stopTask');
    assert.match(items.get('home')!.item.text, /sync~spin/);
    assert.match(String(items.get('home')!.item.tooltip), /Building/);
    toolbar.update({ projectCount: 1, report, busy: 'Configuring…' });
    assert.deepEqual(visible(), ['home', 'cubeMX', 'serialMonitor']);
    toolbar.update({ projectCount: 1, report, failed: 'build' });
    assert.deepEqual(visible(), ['home', 'cubeMX', 'build', 'upload', 'flash', 'debug', 'serialMonitor'], 'allow retry after failure');
    assert.match(items.get('home')!.item.text, /error/);
    assert.match(String(items.get('home')!.item.tooltip), /build failed/);
    toolbar.update({ projectCount: 1, report });
    assert.deepEqual(visible(), ['home', 'cubeMX', 'build', 'upload', 'flash', 'debug', 'serialMonitor']);
    assert.equal(items.get('home')!.item.text, '$(home)');
    toolbar.update({ projectCount: 0 });
    assert.deepEqual(visible(), ['serialMonitor'], 'serial monitor stays available without CubeMX projects');
  }
  finally {
    toolbar.dispose();
  }
  console.log('DAUHUNIEC_TOOLBAR_TEST_PASS: direct icon shortcuts, command routing, setup, progress, stop, failure recovery and workspace removal');
}
