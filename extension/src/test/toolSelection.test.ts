import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { historyKey, pickerDirectory, SelectionState } from '../toolSelection';
test('picker history persists by project/tool, and missing paths use nearest existing parent', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tool-history-'));
  const data = new Map<string, unknown>();
  const state: SelectionState = { get<T>(key: string) { return data.get(key) as T | undefined; }, async update(key, value) { data.set(key, value); } };
  try {
    const failed = path.join(dir, 'ü [test] Кириллица', 'missing', 'executable');
    await fs.mkdir(path.dirname(path.dirname(failed)));
    await state.update(historyKey('/project-A', 'cubeIDE'), failed);
    assert.equal(await pickerDirectory(state, '/project-A', 'cubeIDE', '/Applications'), path.dirname(path.dirname(failed)));
    // New state object models extension reactivation using the same persisted workspace data.
    assert.equal(await pickerDirectory({ ...state }, '/project-A', 'cubeIDE'), path.dirname(path.dirname(failed)));
    assert.equal(await pickerDirectory(state, '/project-B', 'cubeIDE', dir), dir);
    assert.equal(await pickerDirectory(state, '/project-A', 'make', dir), dir);
    assert.equal(await pickerDirectory(state, undefined, 'cubeMX', dir), dir);
    assert.equal(data.get(historyKey('/project-A', 'cubeIDE')), failed);
  }
  finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

