import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
export function localStore(dir) {
  return {
    async list() {
      await mkdir(dir, { recursive: true });
      const result = await Promise.all((await readdir(dir)).filter(f => f.endsWith('.json')).map(async f => {
        const { state, ...meta } = JSON.parse(await readFile(`${dir}/${f}`, 'utf8')); return meta;
      }));
      return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    async read(id) { try { return JSON.parse(await readFile(`${dir}/${id}.json`, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } },
    async save(name, state) {
      await mkdir(dir, { recursive: true });
      const result = { id: randomUUID(), name, createdAt: new Date().toISOString(), state };
      await writeFile(`${dir}/${result.id}.json`, JSON.stringify(result), { flag: 'wx' }); return result;
    },
  };
}
