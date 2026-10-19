/** Documentation identity is taken from the project, never from an ST-LINK serial. */
export interface DocumentationTarget { device?: string; board?: string; }
export interface DocumentationLink { label: string; url: string; detail: string; }

export function parseDocumentationTarget(ioc: string): DocumentationTarget {
  const properties = new Map<string, string>();
  for (const line of ioc.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    if (/^\s*[#!]/.test(line)) continue;
    const separator = line.indexOf('=');
    if (separator >= 0) properties.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
  }
  return { device: properties.get('Mcu.CPN') || properties.get('Mcu.Name') || undefined,
    board: properties.get('board') || properties.get('Board') || undefined };
}

export function mcuProduct(device?: string): string | undefined {
  // Remove package/temperature suffixes (F411CEU6, F429ZITx), keeping pin/flash codes.
  // Unknown naming schemes deliberately require manual selection instead of guessing.
  return device?.trim().toUpperCase().match(/^(STM32(?:[A-Z][0-9][A-Z0-9]{2}|W[BL][A-Z]?[0-9]{2})[A-Z0-9]{2})(?:[A-Z][0-9X][A-Z0-9]*)?$/)?.[1];
}

export function boardProduct(board?: string): string | undefined {
  const name = board?.trim().toUpperCase();
  return name && /^(?:NUCLEO-[A-Z0-9]+(?:-[A-Z0-9]+)*|STM32[A-Z0-9]+-(?:DISCO|DISC[0-9]+|EVAL|DK)|STM32[A-Z0-9]+DISCOVERY|[A-Z0-9]+DISCOVERY|B-[A-Z0-9]+(?:-[A-Z0-9]+)*)$/.test(name) ? name : undefined;
}

export function documentationLinks(target: DocumentationTarget): DocumentationLink[] {
  const device = mcuProduct(target.device), board = boardProduct(target.board);
  return [
    ...(device ? [{ label: `${device} · MCU documentation`,
      url: `https://www.st.com/en/microcontrollers-microprocessors/${device.toLowerCase()}.html#documentation`,
      detail: 'ST website · Datasheet, reference manual, programming manual and errata · Internet required' }] : []),
    ...(board ? [{ label: `${board} · Board documentation`,
      url: `https://www.st.com/en/evaluation-tools/${board.toLowerCase()}.html#documentation`,
      detail: 'ST website · User manual, schematics and board resources · Internet required' }] : [])
  ];
}
