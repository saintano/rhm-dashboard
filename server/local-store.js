import { mkdir, readdir, readFile, writeFile, stat, link, unlink, rename } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import path from 'node:path';
import { MAX_BODY_BYTES, validateState } from '../shared/dashboard.js';
import { validateFilename, snapshotMeta, sortSnapshots, numberedFilename } from '../shared/snapshots.js';
const fail = (message, status = 409) => Object.assign(new Error(message), { status });
const stableId = name => {
  const h = createHash('sha256').update(name).digest('hex');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}`;
};
function dateFromFilename(name, fallback) {
  const match = name.match(/rhm-dashboard-(\d{4}-\d{2}-\d{2})(?:_(\d{2})-(\d{2})(?:-(\d{2}))?)?/);
  const date = match && new Date(`${match[1]}T${match[2] || '00'}:${match[3] || '00'}:${match[4] || '00'}`);
  return date && Number.isFinite(+date) ? date.toISOString() : fallback;
}
export function localStore(dir) {
  let queue = Promise.resolve();
  const mutate = action => {
    const result = queue.then(action);
    queue = result.catch(() => {});
    return result;
  };
  async function readFileSnapshot(name, folder = dir) {
    const filename = path.join(folder, name);
    const info = await stat(filename);
    if (!info.isFile() || info.size > MAX_BODY_BYTES + 4096) throw fail(`Не удалось прочитать ${name}`, 422);
    const raw = JSON.parse(await readFile(filename, 'utf8'));
    const { _snapshot: meta = {}, ...state } = raw;
    validateState(state);
    const createdAt = meta.createdAt || dateFromFilename(name, info.mtime.toISOString());
    return { id: meta.id || stableId(name), name, comment: meta.comment || '', createdAt, updatedAt: meta.updatedAt || createdAt, state };
  }
  async function scan() {
    await mkdir(dir, { recursive: true });
    const entries = await readdir(dir, { withFileTypes: true });
    return Promise.all(entries.filter(e => e.isFile() && !e.name.startsWith('.') && e.name.endsWith('.json')).map(e => readFileSnapshot(e.name)));
  }
  async function write(snapshot, exclusive = false) {
    const { state, name, ...meta } = snapshot;
    const target = path.join(dir, validateFilename(name));
    const temp = path.join(dir, `.${randomUUID()}.tmp`);
    await mkdir(dir, { recursive: true });
    try {
      await writeFile(temp, JSON.stringify({ ...state, _snapshot: meta }, null, 2) + '\n', { flag: 'wx' });
      if (exclusive) await link(temp, target);
      else await rename(temp, target);
    } catch (error) {
      if (error.code === 'EEXIST') throw fail('Файл с таким именем уже существует');
      throw error;
    } finally { await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  }
  return {
    async list() { return sortSnapshots((await scan()).map(snapshotMeta)); },
    async read(id) { return (await scan()).find(item => item.id === id) || null; },
    save(name, state, comment = '', { autoName = false } = {}) { return mutate(async () => {
      const createdAt = new Date().toISOString();
      const snapshot = { id: randomUUID(), name: validateFilename(name), comment, createdAt, updatedAt: createdAt, state };
      const baseName = snapshot.name;
      for (let number = 1; number <= 1000; number++) {
        snapshot.name = numberedFilename(baseName, number);
        try { await write(snapshot, true); return snapshot; }
        catch (error) { if (!autoName || error.status !== 409) throw error; }
      }
      throw fail('Слишком много файлов с таким именем');
    }); },
    update(id, patch) { return mutate(async () => {
      const previous = (await scan()).find(item => item.id === id);
      if (!previous) return null;
      const next = { ...previous, ...patch, updatedAt: new Date().toISOString() };
      await write(next, next.name !== previous.name);
      if (next.name !== previous.name) await unlink(path.join(dir, previous.name));
      return next;
    }); },
    remove(id) { return mutate(async () => {
      const item = (await scan()).find(item => item.id === id);
      if (!item) return null;
      // Normalize metadata before moving, so raw imported files retain their stable identity.
      await write(item);
      const trash = path.join(dir, '.trash', item.id);
      await mkdir(trash, { recursive: true });
      await rename(path.join(dir, item.name), path.join(trash, item.name));
      return snapshotMeta(item);
    }); },
    restore(id) { return mutate(async () => {
      const trash = path.join(dir, '.trash', id);
      let names;
      try { names = await readdir(trash); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
      const name = names.find(n => n.endsWith('.json'));
      if (!name) return null;
      const item = await readFileSnapshot(name, trash);
      await write(item, true);
      await unlink(path.join(trash, name));
      return item;
    }); },
  };
}
