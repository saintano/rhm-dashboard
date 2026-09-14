export const MAX_BODY_BYTES = 1024 * 1024;
export function validateState(value) {
  if (!value || !Array.isArray(value.resources) || value.resources.length > 100) throw new Error('Некорректный список исполнителей');
  const resourceIds = new Set(), blockIds = new Set();
  const str = (s, max) => typeof s === 'string' && s.length <= max;
  const color = s => typeof s === 'string' && /^#[\da-f]{6}$/i.test(s);
  let count = 0;
  for (const r of value.resources) {
    if (!str(r.id, 100) || !r.id || resourceIds.has(r.id) || !str(r.name, 500) || !color(r.color) || !Array.isArray(r.blocks)) throw new Error('Некорректный исполнитель');
    resourceIds.add(r.id);
    for (const b of r.blocks) {
      if (++count > 5000 || !str(b.id, 100) || !b.id || blockIds.has(b.id) || !['task', 'vacation', 'label'].includes(b.kind) || !str(b.title, 2000) || !Number.isInteger(b.weekStart) || b.weekStart < 0 || !Number.isInteger(b.weeks) || b.weeks < 1 || b.weekStart + b.weeks > 1040 || (b.desc !== undefined && !str(b.desc, 20000)) || (b.num !== undefined && !str(b.num, 100)) || (b.color !== undefined && !color(b.color))) throw new Error('Некорректный блок или срок задачи');
      blockIds.add(b.id);
    }
  }
  return value;
}
export function currentWeekIndex(now = new Date()) {
  const day = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.floor((day - Date.UTC(2026, 4, 4)) / 604800000);
}
export function isoWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  return Math.ceil((((d - new Date(Date.UTC(d.getUTCFullYear(), 0, 1))) / 86400000) + 1) / 7);
}
