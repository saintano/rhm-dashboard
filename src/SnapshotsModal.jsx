import { useEffect, useRef, useState, useMemo } from 'react';
import { FileJson, Folder, RefreshCw, Pencil, MessageSquare, Trash2, Check, X, Save, ArrowUp, ArrowDown } from 'lucide-react';
import { snapshotRequest } from './snapshots';
import { snapshotFilename, sortSnapshots } from '../shared/snapshots.js';
import './snapshots.css';
const formatDate = value => new Date(value).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
export default function SnapshotsModal({ state, currentFile, onLoad, onSaved, onFileChange, onClose }) {
  const dialog = useRef(null), lock = useRef(false), editInput = useRef(null);
  const [dateSort, setDateSort] = useState('desc');
  const [items, setItems] = useState([]), [name, setName] = useState(snapshotFilename), [customName, setCustomName] = useState(false);
  const sortedItems = useMemo(() => sortSnapshots(items, dateSort), [items, dateSort]);
  const [busy, setBusy] = useState('list'), [error, setError] = useState(''), [status, setStatus] = useState('');
  const [pending, setPending] = useState(null), [editing, setEditing] = useState(null), [deleted, setDeleted] = useState(null);
  useEffect(() => { dialog.current.showModal(); }, []);
  useEffect(() => {
    if (customName) return;
    const timer = setInterval(() => setName(snapshotFilename()), 1000);
    return () => clearInterval(timer);
  }, [customName]);
  useEffect(() => { editInput.current?.focus(); editInput.current?.select(); }, [editing?.id, editing?.field]);
  async function run(action, work) {
    if (lock.current) return;
    lock.current = true; setBusy(action); setError(''); setStatus('');
    try { await work(); } catch (e) { setError(e.message); }
    finally { lock.current = false; setBusy(''); }
  }
  const refresh = () => run('list', async () => setItems((await snapshotRequest()).snapshots));
  useEffect(() => { refresh(); }, []);
  function startEdit(item, field) {
    setEditing({ id: item.id, field, value: field === 'name' ? item.name.replace(/\.json$/i, '') : item.comment || '' });
    setError(''); setPending(null);
  }
  const saveEdit = () => run('edit', async () => {
    const updated = await snapshotRequest(editing.id, { [editing.field]: editing.value }, 'PATCH');
    setItems(prev => sortSnapshots(prev.map(item => item.id === updated.id ? updated : item)));
    onFileChange(updated); setEditing(null);
  });
  function editField(item, field) {
    if (editing?.id !== item.id || editing.field !== field) return null;
    return <div className="snapshot-inline-edit" onClick={e => e.stopPropagation()}>
      <input ref={editInput} aria-label={field === 'name' ? 'Новое имя файла' : 'Комментарий к файлу'} value={editing.value} maxLength={field === 'name' ? 180 : 2000} disabled={!!busy}
        onChange={e => setEditing({ ...editing, value: e.target.value })}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); saveEdit(); } if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setEditing(null); } }} />
      {field === 'name' && <span className="snapshot-extension">.json</span>}
      <button className="snapshot-icon" aria-label="Применить изменение" title="Применить" disabled={!!busy} onClick={saveEdit}><Check size={15} /></button>
      <button className="snapshot-icon" aria-label="Отменить изменение" title="Отмена" disabled={!!busy} onClick={() => setEditing(null)}><X size={15} /></button>
    </div>;
  }
  const save = e => {
    e.preventDefault();
    if (editing) return;
    run('save', async () => {
      const saved = await snapshotRequest(null, { name: customName ? name : snapshotFilename(), state, autoName: !customName });
      setItems(prev => sortSnapshots([saved, ...prev])); onSaved(saved);
      setCustomName(false); setName(snapshotFilename()); setStatus('Файл сохранён');
    });
  };
  const confirm = () => run(pending.action, async () => {
    if (pending.action === 'load') { onLoad(await snapshotRequest(pending.file.id)); return; }
    const removed = await snapshotRequest(pending.file.id, undefined, 'DELETE');
    setItems(prev => prev.filter(item => item.id !== removed.id));
    setDeleted(removed); onFileChange({ ...removed, deleted: true }); setPending(null); setStatus('Файл удалён');
  });
  const restore = () => run('restore', async () => {
    const restored = await snapshotRequest(deleted.id, { restore: true }, 'PATCH');
    setItems(prev => sortSnapshots([restored, ...prev])); onFileChange(restored);
    setDeleted(null); setStatus('Файл восстановлен');
  });
  return <dialog ref={dialog} className="snapshots" aria-labelledby="snapshots-title" onCancel={e => { e.preventDefault(); if (busy) return; if (pending) setPending(null); else if (editing) setEditing(null); else onClose(); }} onClose={onClose}>
    <header className="snapshot-header"><h2 id="snapshots-title">Снапшоты</h2><button className="snapshot-icon" type="button" onClick={onClose} disabled={!!busy} aria-label="Закрыть снапшоты"><X size={19} /></button></header>
    <div className="snapshot-path"><Folder size={17} /><span>snapshots</span><button className="snapshot-icon" disabled={!!busy} onClick={refresh} aria-label="Обновить список" title="Обновить"><RefreshCw size={15} /></button></div>
    {error && !pending && <p role="alert" className="snapshot-error">{error}</p>}
    <div className="snapshot-files" aria-busy={!!busy}>
      <table><colgroup><col className="snapshot-name-col" /><col className="snapshot-date-col" /><col /><col className="snapshot-tools-col" /></colgroup>
        <thead><tr><th>Имя файла</th><th aria-sort={dateSort === 'desc' ? 'descending' : 'ascending'}><button className="snapshot-date-sort" onClick={() => setDateSort(value => value === 'desc' ? 'asc' : 'desc')} disabled={!!editing} title={dateSort === 'desc' ? 'Сначала старые' : 'Сначала новые'} aria-label="Сортировать по дате">Дата{dateSort === 'desc' ? <ArrowDown size={13} /> : <ArrowUp size={13} />}</button></th><th>Комментарий</th><th><span className="sr-only">Действия</span></th></tr></thead>
        <tbody>{sortedItems.map(item => editing?.id === item.id ? <tr key={item.id}><td colSpan={4}><div className="snapshot-edit-row"><span>{editing.field === 'name' ? 'Имя файла' : 'Комментарий'}</span>{editField(item, editing.field)}</div></td></tr> : <tr key={item.id} aria-selected={currentFile?.id === item.id} className={currentFile?.id === item.id ? 'snapshot-active' : ''} onClick={() => { if (!busy && !editing) setPending({ action: 'load', file: item }); }}>
          <td>{editField(item, 'name') || <button className="snapshot-file-name" disabled={!!busy || !!editing} onClick={e => { e.stopPropagation(); setPending({ action: 'load', file: item }); }} title={item.name}><FileJson size={19} /><span><span>{item.name}</span><time className="snapshot-inline-date" dateTime={item.createdAt}>{formatDate(item.createdAt)}</time></span></button>}</td>
          <td><time dateTime={item.createdAt}>{formatDate(item.createdAt)}</time></td>
          <td>{editField(item, 'comment') || <button className="snapshot-comment" disabled={!!busy || !!editing} title={item.comment || 'Добавить комментарий'} onClick={e => { e.stopPropagation(); startEdit(item, 'comment'); }}>{item.comment || <><MessageSquare size={14} /><span>Добавить</span></>}</button>}</td>
          <td><div className="snapshot-row-actions"><button className="snapshot-icon" disabled={!!busy || !!editing} title="Переименовать" aria-label={`Переименовать ${item.name}`} onClick={e => { e.stopPropagation(); startEdit(item, 'name'); }}><Pencil size={15} /></button><button className="snapshot-icon snapshot-delete" disabled={!!busy || !!editing} title="Удалить" aria-label={`Удалить ${item.name}`} onClick={e => { e.stopPropagation(); setPending({ action: 'delete', file: item }); }}><Trash2 size={15} /></button></div></td>
        </tr>)}</tbody>
      </table>
      {busy === 'list' && !items.length && <p className="snapshot-empty" role="status">Загрузка…</p>}
      {!busy && !items.length && !error && <p className="snapshot-empty">Папка пуста</p>}
    </div>
    <div className="snapshot-bottom-status"><span role="status">{status || `${items.length} файлов`}</span>{deleted && <button onClick={restore} disabled={!!busy}>Восстановить удалённый файл</button>}</div>
<form className="snapshot-save" onSubmit={save}><label htmlFor="snapshot-name">Имя файла</label><input id="snapshot-name" value={name} onChange={e => { setName(e.target.value); setCustomName(true); }} disabled={!!busy || !!editing} required /><button className="snapshot-primary" disabled={!!busy || !!editing || !name.trim()}><Save size={15} />{busy === 'save' ? 'Сохранение…' : 'Сохранить'}</button></form>
    {pending && <SnapshotConfirmation pending={pending} busy={!!busy} error={error} onCancel={() => { setPending(null); setError(''); }} onConfirm={confirm} />}
  </dialog>;
}

function SnapshotConfirmation({ pending, busy, error, onCancel, onConfirm }) {
  const dialog = useRef(null);
  useEffect(() => {
    const node = dialog.current;
    node.showModal();
    return () => node.close();
  }, []);
  const loading = pending.action === 'load';
  return <dialog ref={dialog} className="snapshot-confirm" aria-labelledby="snapshot-confirm-title" aria-describedby="snapshot-confirm-file"
    onCancel={e => { e.preventDefault(); e.stopPropagation(); if (!busy) onCancel(); }}
    onClose={e => e.stopPropagation()}>
    <h2 id="snapshot-confirm-title">{loading ? 'Загрузить снапшот?' : 'Удалить снапшот?'}</h2>
    <p id="snapshot-confirm-file">{pending.file.name}</p>
    {loading && <p className="snapshot-confirm-note">Текущий план будет заменён.</p>}
    {error && <p role="alert" className="snapshot-error">{error}</p>}
    <div className="snapshot-actions">
      <button autoFocus disabled={busy} onClick={onCancel}>Отмена</button>
      <button className={loading ? 'snapshot-primary' : 'snapshot-danger'} disabled={busy} onClick={onConfirm}>{busy ? 'Подождите…' : loading ? 'Загрузить' : 'Удалить'}</button>
    </div>
  </dialog>;
}
