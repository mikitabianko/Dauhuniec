export interface Probe { serial: string; name?: string; firmware?: string; }
export interface ProbeReport { schemaVersion: 1; probes: Probe[]; selected?: Probe; selectionError?: string; }
export interface TargetBackend {
  list(root: string): Promise<ProbeReport>;
  save(root: string, serial: string): Promise<Probe>;
  pick(probes: Probe[], selected?: Probe): Promise<Probe | undefined>;
  changed(root: string): void;
}

export function parseProbeReport(text: string): ProbeReport {
  const value = JSON.parse(text);
  const valid = (probe: Probe) => probe && typeof probe.serial === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(probe.serial)
    && (probe.name === undefined || typeof probe.name === 'string');
  if (!value || value.schemaVersion !== 1 || !Array.isArray(value.probes) || !value.probes.every(valid)
    || value.selected !== undefined && !valid(value.selected)
    || value.selectionError !== undefined && typeof value.selectionError !== 'string') throw new Error('Invalid target board response.');
  return value;
}

export function pinDebugTarget<T extends object>(configuration: T, serial: string): T & { serialNumber: string; serverArgs: string[]; serverpath?: string } {
  // Older Dauhuniec launch files used serverPath, which Cortex-Debug ignores.
  // Repair the launch in memory and keep an explicitly configured serverpath.
  const normalized = { ...configuration } as T & { serverpath?: string; serverPath?: string };
  if (!normalized.serverpath && normalized.serverPath) normalized.serverpath = normalized.serverPath;
  delete normalized.serverPath;
  const args: string[] = [];
  const previous = (configuration as { serverArgs?: string[] }).serverArgs || [];
  for (let index = 0; index < previous.length; index++) {
    const argument = previous[index];
    if (argument === '-i' || argument === '--serial-number') { index++; continue; }
    if (argument.startsWith('--serial-number=')) continue;
    args.push(argument);
  }
  return { ...normalized, serialNumber: serial, serverArgs: args };
}

export function connectedTarget(report: ProbeReport, explicit?: string): Probe | undefined {
  if (report.selectionError && !explicit) throw new Error(report.selectionError);
  const serial = explicit || report.selected?.serial;
  if (serial) {
    const matches = report.probes.filter(probe => probe.serial.toUpperCase() === serial.toUpperCase());
    if (!matches.length) throw new Error(`Selected ST-LINK ${serial} is disconnected. Reconnect it or choose another Target Board in the left panel.`);
    if (matches.length !== 1) throw new Error(`ST-LINK serial ${serial} is duplicated. The target cannot be identified uniquely.`);
    return matches[0];
  }
  if (!report.probes.length) throw new Error('No ST-LINK connected. Connect the target board and try again.');
  return report.probes.length === 1 ? report.probes[0] : undefined;
}

/** Per-project queues prevent background refreshes and simultaneous actions from changing a pending choice. */
export class TargetBoards {
  private readonly reports = new Map<string, ProbeReport>();
  private readonly errors = new Map<string, string>();
  private readonly queues = new Map<string, Promise<unknown>>();
  constructor(private readonly backend: TargetBackend) {}
  get(root: string): ProbeReport | undefined { return this.reports.get(root); }
  error(root: string): string | undefined { return this.errors.get(root); }

  private queued<T>(root: string, action: () => Promise<T>): Promise<T> {
    const next = (this.queues.get(root) || Promise.resolve()).catch(() => {}).then(action);
    this.queues.set(root, next);
    void next.finally(() => { if (this.queues.get(root) === next) this.queues.delete(root); }).catch(() => {});
    return next;
  }

  private async load(root: string, autoSelect: boolean): Promise<ProbeReport> {
    try {
      const report = await this.backend.list(root);
      if (autoSelect && !report.selected && !report.selectionError && report.probes.length === 1) {
        report.selected = await this.backend.save(root, report.probes[0].serial);
      }
      this.reports.set(root, report); this.errors.delete(root); this.backend.changed(root);
      return report;
    } catch (error) {
      this.errors.set(root, error instanceof Error ? error.message : String(error)); this.backend.changed(root);
      throw error;
    }
  }

  private async pick(root: string, report: ProbeReport): Promise<string | undefined> {
    if (!report.probes.length) throw new Error('No ST-LINK connected. Connect the target board and try again.');
    const picked = await this.backend.pick(report.probes, report.selected);
    if (!picked) return;
    report.selected = await this.backend.save(root, picked.serial);
    delete report.selectionError;
    this.reports.set(root, report); this.backend.changed(root);
    return report.selected.serial;
  }

  refresh(root: string): Promise<ProbeReport> { return this.queued(root, () => this.load(root, true)); }
  select(root: string): Promise<string | undefined> { return this.queued(root, async () => this.pick(root, await this.load(root, false))); }
  ensure(root: string, explicit?: string): Promise<string | undefined> {
    return this.queued(root, async () => {
      const report = await this.load(root, !explicit);
      const found = connectedTarget(report, explicit);
      return found ? found.serial : this.pick(root, report);
    });
  }
}
