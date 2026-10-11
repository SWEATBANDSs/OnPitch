import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

// Tiny JSON-file store. Fine for a seeded local player base; swap for a real DB later.
export class Store {
  constructor(file) {
    this.file = file;
    this.data = { players: [], calls: [], notifications: [], leads: [] };
    if (file && existsSync(file)) this.data = { ...this.data, ...JSON.parse(readFileSync(file, 'utf8')) };
  }
  save() {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file + '.tmp', JSON.stringify(this.data, null, 2));
    renameSync(this.file + '.tmp', this.file);
  }
}
