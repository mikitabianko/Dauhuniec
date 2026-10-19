import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as https from 'node:https';
import { randomUUID } from 'node:crypto';
import { OfficialDocument } from './officialDocumentation';

const maximumBytes = 100 * 1024 * 1024;
const pending = new Map<string, Promise<string>>();

export function documentCachePath(storage: string, document: OfficialDocument): string {
  if (document.format !== 'pdf' || !/^[a-z0-9-]+$/i.test(document.id)) throw new Error('Unsupported documentation cache entry.');
  return path.join(storage, 'documentation', `${document.id}.pdf`);
}

export function isPDF(data: Uint8Array): boolean {
  return data.byteLength >= 20 && data.byteLength <= maximumBytes
    && Buffer.from(data.subarray(0, 5)).toString('ascii') === '%PDF-'
    && Buffer.from(data.subarray(Math.max(0, data.byteLength - 1024))).includes(Buffer.from('%%EOF'));
}

export function downloadOfficialPDF(address: string, redirects = 0): Promise<Uint8Array> {
  const url = new URL(address);
  if (url.protocol !== 'https:' || !['st.com', 'freertos.org'].some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) {
    return Promise.reject(new Error('Documentation downloads must use an official ST or FreeRTOS HTTPS host.'));
  }
  if (redirects > 5) return Promise.reject(new Error('Too many documentation redirects.'));
  return new Promise((resolve, reject) => {
    const request = https.get(url, { signal: AbortSignal.timeout(60000), headers: { 'User-Agent': 'Dauhuniec', Accept: 'application/pdf' } }, response => {
      if (response.statusCode && [301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        response.resume();
        resolve(downloadOfficialPDF(new URL(response.headers.location, url).href, redirects + 1));
        return;
      }
      if (response.statusCode !== 200) {
        response.resume(); reject(new Error(`Publisher returned HTTP ${response.statusCode}.`)); return;
      }
      if (Number(response.headers['content-length']) > maximumBytes) {
        response.destroy(); reject(new Error('Documentation PDF exceeds 100 MB.')); return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > maximumBytes) response.destroy(new Error('Documentation PDF exceeds 100 MB.'));
        else chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => {
        const data = Buffer.concat(chunks);
        if (!isPDF(data)) reject(new Error('Publisher did not return a complete PDF (possibly a sign-in or error page).'));
        else resolve(data);
      });
    });
    request.on('error', reject);
  });
}

/** Publish only complete downloads; failed refreshes preserve the previous offline copy. */
export async function cacheOfficialPDF(storage: string, document: OfficialDocument, refresh = false,
  download: (url: string) => Promise<Uint8Array> = downloadOfficialPDF): Promise<string> {
  const destination = documentCachePath(storage, document);
  const running = pending.get(destination);
  if (running) return running;
  const operation = (async () => {
    if (!refresh) {
      try { if (isPDF(await fs.readFile(destination))) return destination; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    const data = await download(document.url);
    if (!isPDF(data)) throw new Error('The downloaded document is not a complete PDF.');
    await fs.mkdir(path.dirname(destination), { recursive: true });
    const temporary = `${destination}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, data, { flag: 'wx' });
      await fs.rename(temporary, destination);
    } finally { await fs.rm(temporary, { force: true }); }
    return destination;
  })();
  pending.set(destination, operation);
  try { return await operation; }
  finally { pending.delete(destination); }
}
