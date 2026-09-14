import { MAX_BODY_BYTES, validateState } from '../shared/dashboard.js';
import { validateFilename, snapshotMeta } from '../shared/snapshots.js';
const validId = id => typeof id === 'string' && /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id);
export function createHandler(store) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const send = (code, value) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(value)); };
    const found = snapshot => snapshot ? send(200, snapshotMeta(snapshot)) : send(404, { error: 'Файл не найден. Обновите список.' });
    try {
      const id = new URL(req.url, 'http://localhost').searchParams.get('id');
      if (id && !validId(id)) return send(400, { error: 'Некорректный идентификатор файла' });
      if (req.method === 'GET') {
        if (!id) return send(200, { snapshots: await store.list() });
        const snapshot = await store.read(id);
        return snapshot ? send(200, snapshot) : send(404, { error: 'Файл не найден. Обновите список.' });
      }
      if (!['POST', 'PATCH', 'DELETE'].includes(req.method)) {
        res.setHeader('Allow', 'GET, POST, PATCH, DELETE'); return send(405, { error: 'Метод не поддерживается' });
      }
      if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return send(403, { error: 'Действие разрешено только из дашборда' });
      if (req.method === 'DELETE') {
        if (!id) return send(400, { error: 'Выберите файл' });
        return found(await store.remove(id));
      }
      if (!req.headers['content-type']?.startsWith('application/json')) return send(415, { error: 'Ожидается JSON' });
      let body;
      try {
        if (req.body !== undefined) {
          const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
          if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return send(413, { error: 'Снапшот больше 1 МБ' });
          body = JSON.parse(raw);
        } else {
          const chunks = []; let size = 0;
          for await (const chunk of req) { size += chunk.length; if (size > MAX_BODY_BYTES) return send(413, { error: 'Снапшот больше 1 МБ' }); chunks.push(chunk); }
          body = JSON.parse(Buffer.concat(chunks).toString());
        }
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Некорректные данные');
        if (body.autoName !== undefined && typeof body.autoName !== 'boolean') throw new Error('Некорректный режим имени файла');
        if (body.name !== undefined) body.name = validateFilename(body.name);
        if (body.comment !== undefined && (typeof body.comment !== 'string' || body.comment.length > 2000)) throw new Error('Комментарий должен быть короче 2000 символов');
        if (req.method === 'POST') { if (!body.name) throw new Error('Введите имя файла'); validateState(body.state); }
        if (req.method === 'PATCH' && (!id || (!body.restore && body.name === undefined && body.comment === undefined))) throw new Error('Выберите файл и изменение');
      } catch (error) { return send(400, { error: error instanceof SyntaxError ? 'Некорректный JSON' : error.message }); }
      if (req.method === 'PATCH') {
        if (body.restore === true) return found(await store.restore(id));
        const patch = {};
        if (body.name !== undefined) patch.name = body.name;
        if (body.comment !== undefined) patch.comment = body.comment;
        return found(await store.update(id, patch));
      }
      return send(201, snapshotMeta(await store.save(body.name, body.state, body.comment || '', { autoName: body.autoName === true })));
    } catch (error) {
      console.error('Snapshot storage failed:', error.name);
      send(error.status || 503, { error: error.status ? error.message : 'Не удалось выполнить действие. Попробуйте ещё раз.' });
    }
  };
}
