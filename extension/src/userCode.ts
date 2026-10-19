export interface UserBlock { label: string; start: number; end: number; }
export interface GeneratedRange { start: number; end: number; }
export interface UserCodeLayout { blocks: UserBlock[]; generated: GeneratedRange[]; issues: string[]; }

/** Keep function signatures and boundary braces as landmarks, without a language server. */
function functionContext(text: string): GeneratedRange[] {
  // Preserve offsets/line numbers while removing comments, literals and directives.
  const code = text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|^[ \t]*#(?:\\\r?\n|[^\n])*/gm,
    value => value.replace(/[^\n]/g, ' '));
  const tokens = [...code.matchAll(/[A-Za-z_$][\w$]*|[^\s]/g)];
  const lineAt = (offset: number) => code.slice(0, offset).split('\n').length - 1;
  const ranges: GeneratedRange[] = [];
  const braces: boolean[] = [];
  const controls = new Set(['if', 'for', 'while', 'switch', 'catch', 'sizeof', '_Alignof', 'alignof']);
  let segment = 0;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index][0];
    if (token === '{') {
      let isFunction = false;
      if (tokens[index - 1]?.[0] === ')') {
        let depth = 1, open = index - 2;
        for (; open >= segment; open--) {
          if (tokens[open][0] === ')') depth++;
          if (tokens[open][0] === '(') { depth--; if (depth === 0) break; }
        }
        const name = tokens[open - 1]?.[0];
        isFunction = open >= segment && !!name && /^[A-Za-z_$][\w$]*$/.test(name) && !controls.has(name)
          && !tokens.slice(segment, index).some(part => part[0] === '=');
      }
      braces.push(isFunction);
      if (isFunction) ranges.push({ start: lineAt(tokens[segment].index!), end: lineAt(tokens[index].index!) });
      segment = index + 1;
    } else if (token === '}') {
      if (braces.pop()) { const line = lineAt(tokens[index].index!); ranges.push({ start: line, end: line }); }
      segment = index + 1;
    } else if (token === ';') segment = index + 1;
  }
  return ranges;
}

/** Only whole-line CubeMX comments count; marker-shaped strings are normal code. */
export function userCodeLayout(text: string): UserCodeLayout {
  const lines = text.split(/\r?\n/);
  const stack: Array<{ label: string; start: number }> = [];
  const blocks: UserBlock[] = [];
  const issues: string[] = [];
  const marker = /^\s*\/\*\s*USER CODE (BEGIN|END)\s+(.+?)\s*\*\/\s*$/;
  for (let line = 0; line < lines.length; line++) {
    const match = marker.exec(lines[line]);
    if (!match) continue;
    const label = match[2].trim();
    if (match[1] === 'BEGIN') { stack.push({ label, start: line }); continue; }
    const begin = stack[stack.length - 1];
    if (!begin || begin.label !== label) {
      issues.push(`Line ${line + 1}: USER CODE END ${label} has no matching BEGIN.`);
      continue;
    }
    stack.pop();
    blocks.push({ ...begin, end: line });
  }
  for (const begin of stack) issues.push(`Line ${begin.start + 1}: USER CODE BEGIN ${begin.label} has no matching END.`);
  blocks.sort((a, b) => a.start - b.start);
  // An incomplete pair must never cause a user's code to be classified as generated.
  if (issues.length || !blocks.length) return { blocks, generated: [], issues };
  const protectedBlocks: GeneratedRange[] = [];
  const landmarks = [...blocks, ...functionContext(text)].sort((a, b) => a.start - b.start);
  for (const block of landmarks) {
    const previous = protectedBlocks[protectedBlocks.length - 1];
    if (!previous || block.start > previous.end + 1) protectedBlocks.push({ start: block.start, end: block.end });
    else previous.end = Math.max(previous.end, block.end);
  }
  const generated: GeneratedRange[] = [];
  const first = protectedBlocks[0];
  if (first.start > 1) generated.push({ start: 0, end: first.start - 1 });
  for (let index = 0; index < protectedBlocks.length; index++) {
    const block = protectedBlocks[index];
    const end = index + 1 < protectedBlocks.length ? protectedBlocks[index + 1].start - 1 : lines.length - 1;
    // Folding hides lines AFTER start. Anchor at the END marker so every line
    // of a generated gap can fold, while user blocks and function landmarks stay visible.
    if (end > block.end) generated.push({ start: block.end, end });
  }
  return { blocks, generated, issues };
}
