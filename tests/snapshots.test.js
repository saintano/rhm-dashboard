import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createHandler } from '../server/snapshots-handler.js';
import { localStore } from '../server/local-store.js';
import { currentWeekIndex, isoWeek, validateState, weekMonth } from '../shared/dashboard.js';
import { snapshotFilename, sortSnapshots } from '../shared/snapshots.js';
const state = { resources: [{ id: 'r1', name: 'Разработчик', color: '#1E3A5F', blocks: [{ id: 'b1', title: 'Задача', kind: 'task', weekStart: 19, weeks: 2 }] }] };
function request(handler, method = 'GET', url = '/api/snapshots', body, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = { method, url, body, headers: { host: 'localhost:5173', 'content-type': 'application/json', ...headers } };
    const res = { headers: {}, setHeader(k,v) { this.headers[k]=v; }, end(raw) { resolve({ status: this.statusCode, headers: this.headers, data: JSON.parse(raw) }); } };
    handler(req,res).catch(reject);
  });
}
async function withStore(work) {
  const dir = await mkdtemp(`${tmpdir()}/rhm-store-test-`);
  try { await work(localStore(dir), dir); } finally { await rm(dir, { recursive: true, force: true }); }
}
test('имена файлов на диске совпадают со списком, одинаковое имя не перезаписывает файл', async () => withStore(async (store, dir) => {
  const handler = createHandler(store);
  const first = await request(handler, 'POST', undefined, { name: 'План.json', state });
  assert.equal(first.status, 201);
  assert.ok((await readdir(dir)).includes('План.json'));
  assert.deepEqual(JSON.parse(await readFile(`${dir}/План.json`, 'utf8')).resources, state.resources);
  const duplicate = await request(handler, 'POST', undefined, { name: 'План.json', state: {resources: []} });
  assert.equal(duplicate.status, 409);
  const fresh = createHandler(localStore(dir));
  const loaded = await request(fresh, 'GET', `/api/snapshots?id=${first.data.id}`);
  assert.deepEqual(loaded.data.state, state); assert.equal(loaded.headers['Cache-Control'], 'no-store');
  assert.equal((await request(fresh)).data.snapshots.length, 1);
}));
test('переименование меняет файл на диске, комментарий сохраняется после перезапуска, дата истории остаётся прежней', async () => withStore(async (store, dir) => {
  const saved = await store.save('Первый.json', state);
  const handler = createHandler(store), url = `/api/snapshots?id=${saved.id}`;
  assert.equal((await request(handler, 'PATCH', url, { name: 'Новое имя', comment: 'Согласовано' })).status, 200);
  assert.deepEqual((await readdir(dir)).filter(f => !f.startsWith('.')), ['Новое имя.json']);
  const [item] = await localStore(dir).list();
  assert.equal(item.id, saved.id); assert.equal(item.createdAt, saved.createdAt); assert.equal(item.comment, 'Согласовано');
  assert.deepEqual((await store.read(saved.id)).state, state);
}));
test('загрузка файлов без метаданных и сортировка по дате в имени, независимо от даты копирования', async () => withStore(async (store, dir) => {
  await writeFile(`${dir}/rhm-dashboard-2026-09-11.json`, JSON.stringify(state));
  await writeFile(`${dir}/rhm-dashboard-2026-05-05.json`, JSON.stringify({ resources: [] }));
  const items = await store.list(); assert.equal(items[0].name, 'rhm-dashboard-2026-09-11.json');
  const older = items[1];
  await store.update(older.id, { name: 'План от мая.json', comment: 'История' });
  const next = await localStore(dir).list();
  assert.equal(next[0].name, items[0].name); assert.equal(next[1].id, older.id); assert.equal(next[1].createdAt, older.createdAt);
}));
test('удаление убирает файл из списка, восстановление возвращает имя, комментарий и данные', async () => withStore(async (store, dir) => {
  const item = await store.save('Удаляемый.json', state, 'Комментарий');
  const handler = createHandler(store), url = `/api/snapshots?id=${item.id}`;
  assert.equal((await request(handler, 'DELETE', url)).status, 200);
  assert.equal((await store.list()).length, 0); assert.equal(await store.read(item.id), null);
  assert.equal((await request(handler, 'GET', url)).status, 404);
  assert.equal((await request(handler, 'PATCH', url, {restore: true})).status, 200);
  assert.deepEqual((await localStore(dir).read(item.id)).state, state);
  assert.equal((await store.list())[0].comment, 'Комментарий');
}));
test('переименование и восстановление не затирают другой существующий файл', async () => withStore(async store => {
  const a = await store.save('A.json', state), b = await store.save('B.json', {resources: []});
  await assert.rejects(store.update(a.id, {name: 'B.json'}), {status:409});
  assert.equal((await store.read(a.id)).name, 'A.json');
  await store.remove(a.id); await store.save('A.json', {resources: []});
  await assert.rejects(store.restore(a.id), {status:409});
  assert.deepEqual((await store.read(b.id)).state, {resources: []});
}));
test('API отклоняет повреждённый JSON, обход пути, большой файл, чужой origin и изменение содержимого через PATCH', async () => withStore(async store => {
  const handler = createHandler(store);
  for (const payload of [{name:'',state}, {name:'../План',state}, {name:'План',state:{resources:[{}]}}, '{broken', {name:'План',comment:4,state}]) {
    assert.equal((await request(handler,'POST',undefined,payload)).status,400);
  }
  assert.equal((await request(handler,'POST',undefined,'x'.repeat(1024*1024+1))).status,413);
  assert.equal((await request(handler,'POST',undefined,{name:'План',state},{origin:'https://other.example'})).status,403);
  assert.equal((await request(handler,'PUT')).status,405);
  assert.equal((await request(handler,'POST',undefined,{name:'План',state},{'content-type':'text/plain'})).status,415);
  const a=await store.save('A.json',state);
  await request(handler,'PATCH',`/api/snapshots?id=${a.id}`,{comment:'OK',state:{resources:[]},createdAt:'invalid'});
  assert.deepEqual((await store.read(a.id)).state,state);
}));
test('ошибка хранилища возвращает 503 без ложного успеха', async () => {
  const handler = createHandler({list() {throw new Error('offline');}});
  assert.equal((await request(handler)).status,503);
});
test('валидация блоков и календарные даты на смене года и DST', () => {
  assert.throws(()=>validateState({resources:[state.resources[0],state.resources[0]]}));
  assert.throws(()=>validateState({resources:[{...state.resources[0],blocks:[{...state.resources[0].blocks[0],weekStart:1040}]}]}));
  assert.equal(currentWeekIndex(new Date(2026,8,14,0,0)),19);
  assert.equal(currentWeekIndex(new Date(2026,9,26,0,0)),25);
  assert.equal(isoWeek(new Date(2026,11,28)),53);
  assert.equal(isoWeek(new Date(2027,0,4)),1);
  assert.equal(snapshotFilename(new Date(2026,8,14,16,4,9)), 'rhm-dashboard-2026-09-14_16-04.json');
});


test('месяц недели выбирается по большинству дней, включая границу года', () => {
  assert.deepEqual(weekMonth(new Date(2026, 7, 31)), {month: 8, year: 2026});
  assert.deepEqual(weekMonth(new Date(2026, 8, 28)), {month: 9, year: 2026});
  assert.deepEqual(weekMonth(new Date(2026, 11, 28)), {month: 11, year: 2026});
  assert.deepEqual(weekMonth(new Date(2025, 11, 29)), {month: 0, year: 2026});
});
test('сортировка по дате работает в обе стороны и не меняет исходный список', () => {
  const items = [{name:'Z.json',createdAt:'2026-05-05T00:00:00.000Z'}, {name:'A.json',createdAt:'2026-09-11T00:00:00.000Z'}];
  assert.equal(sortSnapshots(items)[0].name, 'A.json');
  assert.equal(sortSnapshots(items, 'asc')[0].name, 'Z.json');
  assert.equal(items[0].name, 'Z.json');
});
test('повторные автосохранения в одну минуту создают отдельные файлы без секунд', async () => withStore(async (store, dir) => {
  const handler = createHandler(store), name='rhm-dashboard-2026-09-14_17-20.json';
  const first = await request(handler,'POST',undefined,{name,state,autoName:true});
  const second = await request(handler,'POST',undefined,{name,state:{resources:[]},autoName:true});
  assert.equal(first.data.name, name);
  assert.equal(second.data.name, 'rhm-dashboard-2026-09-14_17-20 (2).json');
  assert.equal(second.status, 201);
  assert.deepEqual((await store.read(first.data.id)).state, state);
  assert.deepEqual((await store.read(second.data.id)).state, {resources:[]});
  assert.equal((await readdir(dir)).filter(n=>n.endsWith('.json')).length, 2);
}));
test('файлы с минутами без секунд читаются с правильным временем', async () => withStore(async (store, dir) => {
  const name='rhm-dashboard-2026-09-14_17-20.json';
  await writeFile(`${dir}/${name}`, JSON.stringify(state));
  assert.equal((await store.list())[0].createdAt, new Date(2026, 8, 14, 17, 20).toISOString());
}));
