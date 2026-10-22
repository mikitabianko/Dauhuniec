import * as os from 'node:os';
export interface DiagnosticEvent {
  sequence?: number;
  time: string;
  stage: string;
  data: unknown;
}
const limit = 256 * 1024;
/** Bounded before failures occur; never records the full environment or source files. */
export class DiagnosticRecorder {
  private events: DiagnosticEvent[] = [];
  private bytes = 0;
  private sequence = 0;
  private context = new Map<string, DiagnosticEvent>();
  dropped = 0;
  record(stage: string, data: unknown): void {
    let encoded = JSON.stringify(data, (_key, value) => typeof value === 'string' && Buffer.byteLength(value) > 16384 ? Buffer.from(value).subarray(0, 16384).toString('utf8') + '\n[truncated]' : value);
    if (stage === 'discovery' && Buffer.byteLength(encoded) > limit / 2) {
      const report = JSON.parse(encoded);
      const original = report.candidates?.length || 0;
      while (report.candidates?.length && Buffer.byteLength(JSON.stringify(report)) > limit / 2)
        report.candidates.pop();
      report.truncatedCandidates = original - (report.candidates?.length || 0);
      if (Buffer.byteLength(JSON.stringify(report)) > limit / 2) {
        report.alternatives = { unavailable: 'omitted: discovery context size limit' };
        report.truncatedAlternatives = true;
      }
      encoded = JSON.stringify(report);
    }
    if (Buffer.byteLength(encoded) > limit / 2)
      encoded = JSON.stringify({ truncated: true, reason: 'context size limit', excerpt: Buffer.from(encoded).subarray(0, limit / 8).toString('utf8') });
    const entry = { sequence: ++this.sequence, time: new Date().toISOString(), stage, data: JSON.parse(encoded) };
    const size = Buffer.byteLength(JSON.stringify(entry));
    if (stage === 'discovery' || stage === 'debug.configuration')
      this.context.set(stage, entry);
    if (/failure|error/.test(stage))
      this.context.set('lastFailure', entry);
    this.events.push(entry);
    this.bytes += size;
    while (this.bytes > limit && this.events.length) {
      this.bytes -= Buffer.byteLength(JSON.stringify(this.events.shift()));
      this.dropped++;
    }
  }
  snapshot(): DiagnosticEvent[] { return structuredClone([...new Set([...this.context.values(), ...this.events])].sort((a, b) => (a.sequence || 0) - (b.sequence || 0))); }
}
export const diagnostics = new DiagnosticRecorder();
/** Preserve path-encoding clues even when the home directory itself is redacted. */
export function pathCharacteristics(value: string) {
  return { length: [...value].length, spaces: /\s/u.test(value), brackets: /[\[\]]/u.test(value), wildcards: /[*?]/u.test(value), unicodeCodePoints: [...new Set([...value].filter(char => char.codePointAt(0)! > 127).map(char => 'U+' + char.codePointAt(0)!.toString(16).toUpperCase().padStart(4,'0')))].sort() };
}
function username(): string {try{return os.userInfo().username;}catch{return '';}}
/** A single redactor is shared by JSON, summary and every log. Path suffixes stay literal. */
export function createRedactor(identifiers: string[] = [], home = os.homedir(), user = username()): (text: string) => string {
  const replacements = new Map<string, string>();
  if (home)
    for (const value of [home, home.replace(/\\/g, '/'), home.replace(/\\/g, '\\\\')])
      replacements.set(value, '<HOME>');
  if (user)
    replacements.set(user, '<USER>');
  identifiers.filter(Boolean).forEach((value, index) => replacements.set(value, `<ID_${index + 1}>`));
  const ordered = [...replacements].sort((a, b) => b[0].length - a[0].length);
  return text => {
    for (const [value, replacement] of ordered)
      text = text.split(value).join(replacement);
    text = text.replace(/((?:\/Users\/|\/home\/|[A-Za-z]:[\\/]+Users[\\/]+))([^\\/\s"']+)/g, '$1<USER>');
    text = text.replace(/((?:serialNumber|probeSerial|serial(?:\s+number)?|sn)\s*["']?\s*[:=]\s*["']?)([A-Za-z0-9_-]{6,})/gi, '$1<ID>');
    text=text.replace(/(--serial-number(?:=|\s+))([A-Za-z0-9_-]{6,})/gi,'$1<ID>');
    text=text.replace(/(ST-LINK\s+)([A-Za-z0-9_-]{8,})/gi,(match,prefix:string,value:string)=>/^[A-Fa-f0-9]+$/.test(value)||/[0-9]/.test(value)||value===value.toUpperCase()?prefix+'<ID>':match);
    return text;
  };
}
function crc32(data: Buffer): number {
  let value = 0xffffffff;
  for (const byte of data) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++)
      value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}
/** Portable store-only ZIP, UTF-8 names, bounded input; no external zip executable needed. */
export function zipFiles(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [], directory: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const filename = Buffer.from(name), data = Buffer.from(text), crc = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(filename.length, 26);
    locals.push(header, filename, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(filename.length, 28);
    central.writeUInt32LE(offset, 42);
    directory.push(central, filename);
    offset += header.length + filename.length + data.length;
  }
  const central = Buffer.concat(directory), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, central, end]);
}
export function reportFiles(categories: Record<string, unknown>, events: DiagnosticEvent[], redactor: (text: string) => string): Record<string, string> {
  const lastError = [...events].reverse().find(event => /error|failure/.test(event.stage));
  const discovery = [...events].reverse().find(event => event.stage === 'discovery')?.data as {
    checks?: {
      id: string;
      status: string;
      message: string;
    }[];
  } | undefined;
  const summary = `Dauhuniec diagnostic report\n${new Date().toISOString()} (UTC)\n${lastError ? `${lastError.stage}: ${JSON.stringify(lastError.data).slice(0, 2048)}` : 'No captured failure; see collected checks.'}\n\nAutomatic validation:\n` +
    (discovery?.checks?.map(c => `${c.status}: ${c.id}: ${c.message}`).join('\n') || 'Unavailable: discovery did not complete in this session.') +
    '\n\nCollection status:\n' + Object.entries(categories).map(([key, value]) => `${key}: ${(value as {
    collected?: boolean;
  })?.collected === false ? 'unavailable (see diagnostics.json for reason)' : 'collected; see diagnostics.json'}`).join('\n') + '\n\nSource files, firmware, full environment and unrelated settings are excluded. No actions were rerun.\n';
  return Object.fromEntries(Object.entries({
    'summary.txt': summary,
    'diagnostics.json': JSON.stringify({ schemaVersion: 1, createdAt: new Date().toISOString(), categories, events }, null, 2),
    'logs/dauhuniec.jsonl': events.map(event => JSON.stringify(event)).join('\n')
  }).map(([key, value]) => [key, redactor(value)]));
}

