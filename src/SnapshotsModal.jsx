import { useEffect, useRef, useState } from 'react';
import { snapshotRequest } from './snapshots';
import './snapshots.css';
const formatDate = value => new Date(value).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' });
export default function SnapshotsModal({ state, onLoad, onClose }) {
  const dialog = useRef(null), nameInput = useRef(null);
  const [items, setItems] = useState([]), [name, setName] = useState('');
  const [busy, setBusy] = useState('list'), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [pending, setPending] = useState(null), [loaded, setLoaded] = useState(false);
  const lock = useRef(false);
  useEffect(() => { dialog.current.showModal(); nameInput.current.focus(); }, []);
  async function refresh() {
    if (lock.current) return;
    lock.current = true; setBusy('list'); setError('');
    try { setItems((await snapshotRequest()).snapshots); setLoaded(true); }
    catch (e) { setError(e.message); }
    finally { lock.current = false; setBusy(''); }
  }
  useEffect(() => { refresh(); }, []);
  useEffect(() => { if (loaded) nameInput.current?.focus(); }, [loaded]);
  async function save(e) {
    e.preventDefault(); if (lock.current || !name.trim()) return;
    lock.current = true; setBusy('save'); setError(''); setMessage('');
    try {
      const saved = await snapshotRequest(null, { name: name.trim(), state });
      setItems(prev => [saved, ...prev]); setName(''); setMessage(`Снапшот «${saved.name}» сохранён и доступен команде.`);
    } catch (e) { setError(e.message); }
    finally { lock.current = false; setBusy(''); }
  }
  async function load() {
    if (lock.current) return;
    lock.current = true; setBusy('load'); setError('');
    try { const snapshot = await snapshotRequest(pending.id); onLoad(snapshot); }
    catch (e) { setError(e.message); }
    finally { lock.current = false; setBusy(''); }
  }
  return <dialog ref={dialog} className="snapshots" aria-labelledby="snapshots-title" onCancel={e => { e.preventDefault(); if (!busy) onClose(); }} onClose={onClose}>
    <header><h2 id="snapshots-title">Снапшоты</h2><button type="button" onClick={onClose} disabled={!!busy} aria-label="Закрыть снапшоты">✕</button></header>
    <p className="snapshot-note">Сохранённые версии доступны всем по ссылке на дашборд. Изменения рабочего плана автоматически сохраняются только в вашем браузере.</p>
    {import.meta.env.DEV && <p className="snapshot-note">Локальный режим: тестовые снапшоты хранятся на этом компьютере отдельно от сайта Vercel.</p>}
    <form onSubmit={save}>
      <label htmlFor="snapshot-name">Название снапшота</label>
      <div className="snapshot-save"><input ref={nameInput} id="snapshot-name" placeholder="Например, План после встречи 14 сентября" value={name} onChange={e => setName(e.target.value)} maxLength={80} disabled={!!busy} required /><button className="snapshot-primary" disabled={!!busy || !name.trim()}>{busy === 'save' ? 'Сохраняем…' : 'Сохранить текущий план'}</button></div>
    </form>
    {error && <p role="alert" className="snapshot-error">{error}</p>}
    {message && <p role="status" className="snapshot-success">{message}</p>}
    {pending ? <section className="snapshot-confirm" aria-label="Подтверждение загрузки">
      <h3>Загрузить «{pending.name}»?</h3><p>Текущий рабочий план будет заменён. Загрузку можно отменить кнопкой «Откат».</p>
      <div className="snapshot-actions"><button disabled={!!busy} onClick={() => setPending(null)}>Отмена</button><button className="snapshot-primary" disabled={!!busy} onClick={load}>{busy === 'load' ? 'Загружаем…' : 'Загрузить снапшот'}</button></div>
    </section> : <>
      <div className="snapshot-list-heading"><h3>Сохранённые версии</h3><button disabled={!!busy} onClick={refresh}>Обновить список</button></div>
      {busy === 'list' && <p role="status">Загружаем список…</p>}
      {!busy && loaded && !items.length && <p>Пока нет снапшотов. Введите название выше и сохраните первый план.</p>}
      <ul>{items.map(item => <li key={item.id}><div><strong>{item.name}</strong><time dateTime={item.createdAt}>{formatDate(item.createdAt)}</time></div><button disabled={!!busy} onClick={() => { setPending(item); setError(''); setMessage(''); }} aria-label={`Загрузить ${item.name}`}>Загрузить</button></li>)}</ul>
    </>}
  </dialog>;
}
