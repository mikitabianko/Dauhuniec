const fs = require('node:fs');
const path = require('node:path');
const extension = path.resolve(__dirname, '..');
const root = path.dirname(extension);
const resources = ['bin', 'LICENSE', 'GO-LICENSE.txt', 'THIRD-PARTY-NOTICES.txt'];
for (const name of resources) {
  const from = path.join(root, name);
  if (!fs.existsSync(from)) throw new Error(`Missing ${name}. Run go run ./cmd/package first.`);
}
fs.mkdirSync(path.join(root, 'releases'), { recursive: true });
for (const name of resources) {
  const from = path.join(root, name);
  fs.rmSync(path.join(extension, name), { recursive: true, force: true });
  fs.cpSync(from, path.join(extension, name), { recursive: true });
}
