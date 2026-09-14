import test from 'node:test';
import assert from 'node:assert/strict';
import { planTailMove } from '../shared/dashboard.js';
const resources = [{id:'r',blocks:[{id:'a',weekStart:0,weeks:2},{id:'b',weekStart:3,weeks:1},{id:'c',weekStart:6,weeks:4}]},{id:'other',blocks:[{id:'d',weekStart:0,weeks:1}]}];
const select = [{resourceId:'r',blockId:'b'}];
test('tail shift preserves gaps and durations, leaves preceding and other resources untouched',()=>{
 const before=structuredClone(resources);
 assert.deepEqual(planTailMove(resources,select,1),[{resourceId:'r',blockId:'b',weekStart:4},{resourceId:'r',blockId:'c',weekStart:7}]);
 assert.deepEqual(resources,before);
});
test('upward shift accepts exact adjacency but blocks overlap and start of timeline',()=>{
 assert.equal(planTailMove(resources,select,-1)[0].weekStart,2);
 assert.equal(planTailMove(resources,select,-2),null);
 assert.equal(planTailMove(resources,[{resourceId:'r',blockId:'a'}],-1),null);
});
test('multiple selections move each tail once, with atomic boundary check',()=>{
 assert.equal(planTailMove(resources,[...select,{resourceId:'r',blockId:'c'}],1).length,2);
 assert.equal(planTailMove(resources,[...select,{resourceId:'other',blockId:'d'}],-1),null);
});
test('tail cannot move beyond snapshot validation limit',()=>{
 assert.equal(planTailMove([{id:'r',blocks:[{id:'b',weekStart:1039,weeks:1}]}],select,1),null);
});
