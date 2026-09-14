export function snapshotFilename(now = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return `rhm-dashboard-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}.json`;
}
export function validateFilename(value) {
  if (typeof value !== 'string') throw new Error('Введите имя файла');
  const name = value.trim().normalize('NFC');
  if (!name || name.startsWith('.') || /[\\/:*?"<>|\u0000-\u001f]/.test(name)) throw new Error('Имя файла содержит недопустимые символы');
  const filename = /\.json$/i.test(name) ? name : `${name}.json`;
  if (new TextEncoder().encode(filename).length > 240) throw new Error('Имя файла слишком длинное');
  return filename;
}
export function snapshotMeta(snapshot) {
  const { state, ...meta } = snapshot;
  return meta;
}
export function sortSnapshots(items, direction = 'desc') {
  const factor = direction === 'asc' ? 1 : -1;
  return [...items].sort((a, b) => factor * (a.createdAt.localeCompare(b.createdAt) || a.name.localeCompare(b.name)));
}
export function numberedFilename(name, number) {
  return number === 1 ? name : name.replace(/\.json$/i, ` (${number}).json`);
}
