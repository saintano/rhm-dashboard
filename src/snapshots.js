import { validateState } from '../shared/dashboard.js';
export async function snapshotRequest(id, payload, method = payload ? 'POST' : 'GET') {
  let response;
  try {
    response = await fetch(`/api/snapshots${id ? `?id=${encodeURIComponent(id)}` : ''}`, {
      method,
      headers: payload ? { 'Content-Type': 'application/json' } : {},
      body: payload ? JSON.stringify(payload) : undefined,
      signal: AbortSignal.timeout(30000),
    });
  } catch { throw new Error('Нет связи с папкой снапшотов. Повторите попытку.'); }
  let data;
  try { data = await response.json(); } catch { throw new Error('Не удалось прочитать ответ сервера.'); }
  if (!response.ok) throw new Error(data.error || 'Не удалось выполнить действие');
  if (id && method === 'GET') validateState(data.state);
  return data;
}
