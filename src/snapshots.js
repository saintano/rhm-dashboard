import { validateState } from '../shared/dashboard.js';
export async function snapshotRequest(id, payload) {
  const response = await fetch(`/api/snapshots${id ? `?id=${encodeURIComponent(id)}` : ''}`, {
    method: payload ? 'POST' : 'GET',
    headers: payload ? { 'Content-Type': 'application/json' } : {},
    body: payload ? JSON.stringify(payload) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  let data;
  try { data = await response.json(); } catch { throw new Error('Сервис снапшотов не ответил. Попробуйте ещё раз.'); }
  if (!response.ok) throw new Error(data.error || 'Не удалось выполнить запрос');
  if (id) validateState(data.state);
  return data;
}
