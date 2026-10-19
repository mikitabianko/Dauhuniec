import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { Probe, TargetBoards, connectedTarget, parseProbeReport, pinDebugTarget } from '../targetBoard';

const a: Probe = { serial:'AAAAAAAA', name:'NUCLEO-C071RB' }, b: Probe = { serial:'BBBBBBBB', name:'NUCLEO-C071RB' };
function fixture() {
  const saved = new Map<string, Probe>();
  let probes = [a, b], picks = 0;
  let choice: Probe | undefined = b;
  const targets = new TargetBoards({
    list: async root => ({ schemaVersion:1, probes:[...probes], selected:saved.get(root) }),
    save: async (root, serial) => {
      const selected = connectedTarget({schemaVersion:1, probes}, serial)!;
      saved.set(root, selected); return selected;
    },
    pick: async () => { picks++; return choice; }, changed() {}
  });
  return { targets, saved, setProbes: (value: Probe[]) => { probes = value; },
    setChoice: (value: Probe | undefined) => { choice = value; }, picks: () => picks };
}

test('same-model boards trigger an explicit choice which is remembered across connection changes', async () => {
  const f = fixture();
  await f.targets.refresh('/project');
  assert.equal(f.saved.size, 0, 'background refresh cannot choose the first of two boards');
  assert.equal(await f.targets.ensure('/project'), b.serial);
  assert.equal(f.picks(), 1);
  f.setProbes([b, a, {serial:'CCCCCCCC',name:a.name}]);
  await f.targets.refresh('/project');
  assert.equal(await f.targets.ensure('/project'), b.serial);
  assert.equal(f.picks(), 1, 'adding another board never replaces the selection or asks again');
  f.setProbes([a]);
  await assert.rejects(f.targets.ensure('/project'), /BBBBBBBB.*disconnected/);
  assert.equal(f.saved.get('/project')?.serial, b.serial);
});

test('single board is pinned immediately and selections are independent per project', async () => {
  const f = fixture(); f.setProbes([a]);
  await f.targets.refresh('/one');
  assert.equal(f.saved.get('/one')?.serial, a.serial);
  f.setProbes([a, b]);
  assert.equal(await f.targets.ensure('/one'), a.serial);
  assert.equal(await f.targets.ensure('/two'), b.serial);
  assert.equal(f.saved.get('/one')?.serial, a.serial);
});

test('cancelled selection does not permit flashing and concurrent requests share the stored choice', async () => {
  const f = fixture(); f.setChoice(undefined);
  assert.equal(await f.targets.ensure('/project'), undefined);
  assert.equal(f.saved.size, 0);
  f.setChoice(a);
  const choices = await Promise.all([f.targets.ensure('/project'), f.targets.ensure('/project')]);
  assert.deepEqual(choices, [a.serial,a.serial]);
  assert.equal(f.picks(), 2, 'only one successful picker after the initial cancellation');
  f.setChoice(b);
  await f.targets.select('/project');
  assert.equal(f.saved.get('/project')?.serial, b.serial);
});

test('a captured task target is checked explicitly; corrupt state and duplicate serials never fall back', async () => {
  const f = fixture();
  await f.targets.ensure('/project');
  assert.equal(await f.targets.ensure('/project', a.serial), a.serial);
  f.setProbes([b]);
  await assert.rejects(f.targets.ensure('/project', a.serial), /disconnected/);
  assert.throws(() => connectedTarget({schemaVersion:1,probes:[a,a],selected:a}), /duplicated/);
  assert.throws(() => connectedTarget({schemaVersion:1,probes:[a],selectionError:'Saved target is corrupt'}), /corrupt/);
  assert.equal(parseProbeReport(JSON.stringify({schemaVersion:1,probes:[a,b]})).probes.length, 2);
  assert.throws(() => parseProbeReport('{"schemaVersion":1,"probes":[{"serial":"bad serial"}]}'), /Invalid/);
});

test('debug uses the selected serial and removes conflicting old server arguments', () => {
  const configuration = pinDebugTarget({ name:'Dauhuniec: Debug', serialNumber:b.serial,
    serverArgs:['-k','-i',b.serial,'--serial-number='+b.serial,'--serial-number',b.serial,'-p','3333'] }, a.serial);
  assert.equal(configuration.serialNumber, a.serial);
  assert.deepEqual(configuration.serverArgs, ['-k','-p','3333']);
});
