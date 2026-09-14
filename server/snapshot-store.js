import { get, list, put } from '@vercel/blob';
import { randomUUID } from 'node:crypto';
const PREFIX = 'rhm-snapshots/v1/';
const metadata = blob => {
  const [id, filename] = blob.pathname.slice(PREFIX.length).split('/');
  return { id, name: decodeURIComponent(filename.slice(0, -5)), createdAt: new Date(blob.uploadedAt).toISOString() };
};
export function blobStore() {
  return {
    async list() {
      const result = [];
      let cursor;
      do {
        const page = await list({ prefix: PREFIX, cursor, limit: 1000 });
        result.push(...page.blobs.map(metadata));
        cursor = page.hasMore ? page.cursor : undefined;
      } while (cursor);
      return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    async read(id) {
      const page = await list({ prefix: `${PREFIX}${id}/`, limit: 1 });
      if (!page.blobs.length) return null;
      const result = await get(page.blobs[0].url, { access: 'private', useCache: false });
      if (!result || result.statusCode !== 200) return null;
      return JSON.parse(await new Response(result.stream).text());
    },
    async save(name, state) {
      const snapshot = { id: randomUUID(), name, createdAt: new Date().toISOString(), state };
      await put(`${PREFIX}${snapshot.id}/${encodeURIComponent(name)}.json`, JSON.stringify(snapshot), { access: 'private', addRandomSuffix: false, contentType: 'application/json' });
      return snapshot;
    },
  };
}
