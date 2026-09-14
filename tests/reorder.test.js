import test from 'node:test';
import assert from 'node:assert/strict';
import { reorderBlock, placeBlock } from '../shared/dashboard.js';
const fixture=()=>({id:'r',blocks:[{id:'vac',weekStart:21,weeks:1},{id:'panel',weekStart:22,weeks:4},{id:'red',weekStart:26,weeks:2}]});
const starts=r=>Object.fromEntries(r.blocks.map(b=>[b.id,b.weekStart]));
test('vacation swaps with long neighbor, retaining start and subsequent dates',()=>{
 const r=fixture(); reorderBlock(r,'vac','panel','after');
 assert.deepEqual(starts(r),{vac:25,panel:21,red:26});
 reorderBlock(r,'vac','panel','before'); assert.deepEqual(r,fixture());
});
test('drag uses same reorder as arrows and adjacent unchanged insertion is no-op',()=>{
 const r=fixture(); placeBlock([r],'r','vac','r',{targetId:'panel',side:'before'}); assert.deepEqual(r,fixture());
 placeBlock([r],'r','vac','r',{targetId:'panel',side:'after'});
 assert.deepEqual(starts(r),{vac:25,panel:21,red:26});
});
test('distant reorder preserves gaps, total span and can be reversed',()=>{
 const r=fixture();r.blocks[2].weekStart=29;
 const before=structuredClone(r);
 reorderBlock(r,'vac','red','after');
 assert.deepEqual(starts(r),{vac:30,panel:21,red:25});
 reorderBlock(r,'vac','panel','before');assert.deepEqual(r,before);
});
test('cross resource insert keeps source dates and pushes target collisions in temporal order',()=>{
 const src=fixture(),dst={id:'d',blocks:[{id:'last',weekStart:5,weeks:1},{id:'first',weekStart:2,weeks:3}]};
 placeBlock([src,dst],'r','vac','d',{targetId:'first',side:'before'});
 assert.deepEqual(starts(src),{panel:22,red:26});assert.deepEqual(starts(dst),{first:3,last:6,vac:2});
});
test('empty-space drop honors absolute week',()=>{
 const r=fixture();placeBlock([r],'r','vac','r',{weekStart:10});
 assert.deepEqual(starts(r),{vac:10,panel:22,red:26});
});
