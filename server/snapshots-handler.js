import { MAX_BODY_BYTES, validateState } from '../shared/dashboard.js';
export function createHandler(store) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const send = (code, value) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(value)); };
    try {
      if (req.method === 'GET') {
        const id = new URL(req.url, 'http://localhost').searchParams.get('id');
        if (!id) return send(200, { snapshots: await store.list() });
        if (!/^[\da-f-]{36}$/i.test(id)) return send(400, { error: 'Некорректный идентификатор снапшота' });
        const snapshot = await store.read(id);
        return snapshot ? send(200, snapshot) : send(404, { error: 'Снапшот не найден. Обновите список.' });
      }
      if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return send(405, { error: 'Метод не поддерживается' }); }
      if (!req.headers['content-type']?.startsWith('application/json')) return send(415, { error: 'Ожидается JSON' });
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host) return send(403, { error: 'Сохранение разрешено только из дашборда' });
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
        if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 80) throw new Error('Введите название до 80 символов');
        validateState(body.state);
      } catch (error) { return send(400, { error: error instanceof SyntaxError ? 'Некорректный JSON' : error.message }); }
      const saved = await store.save(body.name.trim(), body.state);
      return send(201, { id: saved.id, name: saved.name, createdAt: saved.createdAt });
    } catch (error) {
      console.error('Snapshot storage failed:', error.name);
      send(503, { error: 'Хранилище недоступно. Попробуйте ещё раз. Ваш рабочий план не изменён.' });
    }
  };
}
