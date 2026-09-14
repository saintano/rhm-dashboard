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

// The fourth day determines the month containing most days of a Monday–Sunday week.
export function weekMonth(start) {
  const middle = new Date(start);
  middle.setDate(middle.getDate() + 3);
  return { month: middle.getMonth(), year: middle.getFullYear() };
}

// Plan a whole-tail move before applying it, so a blocked move creates no undo entry.
export function planTailMove(resources, selections, delta) {
  const moves = [];
  for (const resource of resources) {
    const ids = new Set(selections.filter(s => s.resourceId === resource.id).map(s => s.blockId));
    const selected = resource.blocks.filter(b => ids.has(b.id));
    if (!selected.length) continue;
    const start = Math.min(...selected.map(b => b.weekStart));
    const tail = resource.blocks.filter(b => b.weekStart >= start);
    const boundary = Math.max(0, ...resource.blocks.filter(b => b.weekStart < start).map(b => b.weekStart + b.weeks));
    if (start + delta < boundary || tail.some(b => b.weekStart + b.weeks + delta > 1040)) return null;
    moves.push(...tail.map(b => ({ resourceId: resource.id, blockId: b.id, weekStart: b.weekStart + delta })));
  }
  return moves;
}

// Reorder within the occupied interval, retaining its start, duration and slot gaps.
export function reorderBlock(resource, blockId, targetId, side) {
  const ordered = [...resource.blocks].sort((a,b) => a.weekStart-b.weekStart);
  const from = ordered.findIndex(b=>b.id===blockId);
  const target = ordered.findIndex(b=>b.id===targetId);
  if (from < 0 || target < 0 || from === target) return;
  const remaining = ordered.filter(b=>b.id!==blockId);
  const to = remaining.findIndex(b=>b.id===targetId)+(side==='after'?1:0);
  remaining.splice(to,0,ordered[from]);
  const lo=Math.min(from,to), hi=Math.max(from,to);
  let start=ordered[lo].weekStart;
  const gaps=ordered.slice(lo,hi).map((b,i)=>ordered[lo+i+1].weekStart-b.weekStart-b.weeks);
  for(let i=lo;i<=hi;i++) {
    remaining[i].weekStart=start;
    start+=remaining[i].weeks+(gaps[i-lo]??0);
  }
}

export function placeBlock(resources, srcId, blockId, dstId, intent) {
  const src=resources.find(r=>r.id===srcId), dst=resources.find(r=>r.id===dstId);
  const block=src?.blocks.find(b=>b.id===blockId);
  if(!block || !dst) return;
  if(src===dst && intent.targetId) {
    reorderBlock(src,blockId,intent.targetId,intent.side);
    return;
  }
  const target=dst.blocks.find(b=>b.id===intent.targetId);
  const week=target ? target.weekStart+(intent.side==='after'?target.weeks:0) : Math.max(0,intent.weekStart);
  src.blocks=src.blocks.filter(b=>b.id!==blockId);
  block.weekStart=week;
  // Stable forward pass handles every collision, without recursive order-dependent jumps.
  let end=week+block.weeks;
  for(const other of [...dst.blocks].sort((a,b)=>a.weekStart-b.weekStart)) {
    if(other.weekStart+other.weeks<=week) continue;
    if(other.weekStart<end) other.weekStart=end;
    end=other.weekStart+other.weeks;
  }
  dst.blocks.push(block);
  dst.blocks.sort((a,b)=>a.weekStart-b.weekStart);
}
