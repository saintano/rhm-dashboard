import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createHandler } from '../server/snapshots-handler.js';
import { localStore } from '../server/local-store.js';
import { currentWeekIndex, isoWeek, validateState } from '../shared/dashboard.js';
const state = { resources: [{ id: 'r1', name: 'Разработчик', color: '#1E3A5F', blocks: [{ id: 'b1', title: 'Задача', kind: 'task', weekStart: 19, weeks: 2 }] }] };
function request(handler, method = 'GET', url = '/api/snapshots', body, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = { method, url, body, headers: { host: 'localhost:5173', 'content-type': 'application/json', ...headers } };
    const res = { headers: {}, setHeader(k,v) { this.headers[k]=v; }, end(raw) { resolve({ status: this.statusCode, headers: this.headers, data: JSON.parse(raw) }); } };
    handler(req,res).catch(reject);
  });
}
test('сохранение переживает создание нового экземпляра хранилища; одинаковые имена не перезаписывают версии', async () => {
  const dir = await mkdtemp(`${tmpdir()}/rhm-store-test-`);
  try {
    const handler = createHandler(localStore(dir));
    const first = await request(handler, 'POST', undefined, { name: 'План', state });
    const second = await request(handler, 'POST', undefined, { name: 'План', state: {resources: []} });
    assert.equal(first.status, 201); assert.notEqual(first.data.id, second.data.id);
    const freshHandler = createHandler(localStore(dir));
    const list = await request(freshHandler); assert.equal(list.data.snapshots.length, 2);
    const loaded = await request(freshHandler, 'GET', `/api/snapshots?id=${first.data.id}`);
    assert.deepEqual(loaded.data.state, state); assert.equal(loaded.headers['Cache-Control'], 'no-store');
    assert.equal((await request(freshHandler, 'GET', '/api/snapshots?id=00000000-0000-0000-0000-000000000000')).status, 404);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('отклонение повреждённых данных, слишком большого JSON, чужого origin и неподдерживаемых методов', async () => {
  let writes = 0; const handler = createHandler({save() {writes++;}});
  for (const payload of [{name:'',state}, {name:'План',state:{resources:[{}]}}, '{broken', {name:'План',state:{resources:[{...state.resources[0],blocks:[{...state.resources[0].blocks[0],weeks:-1}]}]}}]) {
    assert.equal((await request(handler,'POST',undefined,payload)).status,400);
  }
  assert.equal((await request(handler,'POST',undefined,'x'.repeat(1024*1024+1))).status,413);
  assert.equal((await request(handler,'POST',undefined,{name:'План',state},{origin:'https://other.example'})).status,403);
  assert.equal((await request(handler,'DELETE')).status,405);
  assert.equal((await request(handler,'POST',undefined,{name:'План',state},{'content-type':'text/plain'})).status,415);
  assert.equal(writes,0);
});
test('ошибка хранилища возвращает 503 без ложного успеха', async () => {
  const handler = createHandler({list() {throw new Error('offline');}});
  assert.equal((await request(handler)).status,503);
});
test('проверка схемы: повторные id и недопустимый срок', () => {
  assert.throws(()=>validateState({resources:[state.resources[0],state.resources[0]]}));
  assert.throws(()=>validateState({resources:[{...state.resources[0],blocks:[{...state.resources[0].blocks[0],weekStart:1040}]}]}));
  assert.deepEqual(validateState(state),state);
});
test('неделя определяется по календарной дате, включая DST и 53-ю неделю 2026 года', () => {
  assert.equal(currentWeekIndex(new Date(2026,8,14,0,0)),19);
  assert.equal(currentWeekIndex(new Date(2026,9,26,0,0)),25);
  assert.equal(currentWeekIndex(new Date(2026,4,3)), -1);
  assert.equal(isoWeek(new Date(2026,11,28)),53);
  assert.equal(isoWeek(new Date(2027,0,4)),1);
});
