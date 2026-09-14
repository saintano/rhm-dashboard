import { get, list, put, del } from '@vercel/blob';
import { randomUUID } from 'node:crypto';
import { validateFilename, snapshotMeta, sortSnapshots, numberedFilename } from '../shared/snapshots.js';
const PREFIX = 'rhm-snapshots/v1/';
const TRASH = 'rhm-snapshots/trash/';
const fail = message => Object.assign(new Error(message), { status: 409 });
export function blobStore() {
  async function entries(prefix = PREFIX) {
    const result = []; let cursor;
    do {
      const page = await list({ prefix, cursor, limit: 1000 });
      result.push(...page.blobs); cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return result;
  }
  async function readBlob(blob) {
    const result = await get(blob.url, { access: 'private', useCache: false });
    if (!result || result.statusCode !== 200) return null;
    const snapshot = JSON.parse(await new Response(result.stream).text());
    return { ...snapshot, name: validateFilename(snapshot.name), comment: snapshot.comment || '', updatedAt: snapshot.updatedAt || snapshot.createdAt };
  }
  async function find(id) { return (await entries(`${PREFIX}${id}/`))[0]; }
  async function catalog() {
    return sortSnapshots((await Promise.all((await entries()).map(readBlob))).filter(Boolean));
  }
  async function checkName(name, exceptId) {
    if ((await catalog()).some(item => item.id !== exceptId && item.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw fail('Файл с таким именем уже существует');
  }
  async function write(item) {
    return put(`${PREFIX}${item.id}/${encodeURIComponent(item.name)}`, JSON.stringify(item), { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json' });
  }
  return {
    async list() { return (await catalog()).map(snapshotMeta); },
    async read(id) { const blob = await find(id); return blob ? readBlob(blob) : null; },
    async save(name, state, comment = '', { autoName = false } = {}) {
      name = validateFilename(name);
      const existing = await catalog();
      const baseName = name;
      let number = 1;
      while (existing.some(item => item.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
        if (!autoName || number >= 1000) throw fail('Файл с таким именем уже существует');
        name = numberedFilename(baseName, ++number);
      }
      const createdAt = new Date().toISOString();
      const item = { id: randomUUID(), name, state, comment, createdAt, updatedAt: createdAt };
      await write(item); return item;
    },
    async update(id, patch) {
      const blob = await find(id); if (!blob) return null;
      const previous = await readBlob(blob); if (!previous) return null;
      const next = { ...previous, ...patch, updatedAt: new Date().toISOString() };
      await checkName(next.name, id);
      const saved = await write(next);
      if (saved.pathname !== blob.pathname) await del(blob.url);
      return next;
    },
    async remove(id) {
      const blob = await find(id); if (!blob) return null;
      const item = await readBlob(blob); if (!item) return null;
      await put(`${TRASH}${id}.json`, JSON.stringify(item), { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json' });
      await del(blob.url); return snapshotMeta(item);
    },
    async restore(id) {
      const blob = (await entries(`${TRASH}${id}.json`))[0]; if (!blob) return null;
      const item = await readBlob(blob); if (!item) return null;
      await checkName(item.name); await write(item); await del(blob.url); return item;
    },
  };
}
