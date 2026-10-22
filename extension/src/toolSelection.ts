import * as fs from 'node:fs/promises';
import * as path from 'node:path';
export interface SelectionState {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void>;
}
export const historyKey = (root: string | undefined, tool: string) => `toolSelection:${root || 'workspace'}:${tool}`;
export async function pickerDirectory(state: SelectionState, root: string | undefined, tool: string, current?: string, discovered?: string): Promise<string | undefined> {
  for (const value of [state.get<string>(historyKey(root, tool)), current, discovered]) {
    if (!value)
      continue;
    let candidate = value;
    for (;;) {
      try {
        const info = await fs.stat(candidate);
        return info.isDirectory() ? candidate : path.dirname(candidate);
      }
      catch { /* nearest existing parent */ }
      const parent = path.dirname(candidate);
      if (parent === candidate)
        break;
      candidate = parent;
    }
  }
}

