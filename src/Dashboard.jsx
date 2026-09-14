import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import SnapshotsModal from "./SnapshotsModal";
import { snapshotRequest } from "./snapshots";
import { validateState, currentWeekIndex, isoWeek } from "../shared/dashboard.js";
import { Save, CalendarDays, Plus, Trash2, Download, Upload, HelpCircle, ChevronDown, ChevronUp, X, RotateCcw, RotateCw, MoreVertical, RefreshCw } from "lucide-react";

// ===== Версия данных =====
// Ключ рабочих данных сохраняется между релизами.
const APP_VERSION = 4;
const STORAGE_KEY = `dashboard-state-v${APP_VERSION}`;

// ===== Константы =====
const WEEK_PX = 60;         // высота одной недели в сетке (сплошная, без внешнего зазора)
const STEP_PX = WEEK_PX;    // шаг сетки = высоте недели
const GAP_PX = 8;           // визуальный «поясок» внутри блока (сверху и снизу) для разделения соседей
const COL_WIDTH = 310;
const MONTH_COL_WIDTH = 90;
const WEEK_COL_WIDTH = 100;
const HEADER_HEIGHT = 120;
const MIN_WEEKS = 1;
const START_DATE = new Date(2026, 4, 4);

const MONTH_NAMES = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];

const PALETTE = [
  "#FFA7FF", "#FF8C8C", "#D5D7FF", "#85BCBE", "#D7B989", "#00D600",
  "#FFD1DC", "#FFE5B4", "#FFF4A3", "#C8E6C9", "#B3E5FC", "#D1C4E9",
  "#F8BBD0", "#F5CBA7", "#AED6F1", "#ABEBC6", "#D7BDE2", "#F9E79F",
];
const HEADER_COLORS = ["#1E3A5F", "#3A4A5F", "#2C5F3A", "#5F3A5F", "#5F3A2C", "#2C4A5F", "#5F5A2C", "#4A2C5F", "#5F2C3A", "#2C5F5F"];
const VACATION_COLOR = "#00D600";
const CURRENT_WEEK_COLOR = "#ff3b30";

const uid = () => Math.random().toString(36).slice(2, 10);
const deepClone = (x) => JSON.parse(JSON.stringify(x));

function weekToDate(i) { const d = new Date(START_DATE); d.setDate(d.getDate() + i * 7); return d; }
function weekLabel(i) {
  const s = weekToDate(i), e = new Date(s); e.setDate(e.getDate() + 6);
  const num = isoWeek(s);
  const f = (d) => `${d.getDate()}.${String(d.getMonth() + 1).padStart(2, "0")}`;
  return { num, range: `${f(s)}–${f(e)}` };
}


// ===== Исходные данные =====
const INITIAL_STATE = {
  resources: [
    { id: "r1", name: "Артём Фетисов", color: HEADER_COLORS[0], blocks: [] },
    { id: "r2", name: "Женя Плеханов", color: HEADER_COLORS[1], blocks: [] },
    { id: "r3", name: "Андрей Звендинов", color: HEADER_COLORS[2], blocks: [] },
    { id: "r5", name: "Алексей Кремлёв", color: HEADER_COLORS[3], blocks: [] },
    { id: "r7", name: "Сергей Мараев", color: HEADER_COLORS[6], blocks: [] },
  ]
};

function columnEndWeek(r) { return r.blocks.reduce((m, b) => Math.max(m, b.weekStart + b.weeks), 0); }
function columnManWeeks(r) { return r.blocks.filter(b => b.kind === "task").reduce((s, b) => s + b.weeks, 0); }

// ===== Root =====
export default function Dashboard() {
  const [state, setState] = useState(() => {
    try { const raw = localStorage.getItem(STORAGE_KEY); if (raw) return validateState(JSON.parse(raw)); } catch {}
    return INITIAL_STATE;
  });
  const [storageReady, setStorageReady] = useState(false);
  const [snapshotsOpen, setSnapshotsOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [booting, setBooting] = useState(true);
  const timelineRef = useRef(null);
  const [currWeek, setCurrWeek] = useState(currentWeekIndex);
  const goToCurrentWeek = useCallback((smooth = true) => {
    const row = timelineRef.current?.querySelector('[data-current-week="true"]');
    if (!row) return;
    const scroller = timelineRef.current;
    scroller.scrollTo({ top: Math.max(0, scroller.scrollTop + row.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 150), behavior: smooth && !window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'instant' });
  }, []);
  const [history, setHistory] = useState([]);
  const [future, setFuture] = useState([]);
  const [selectedBlocks, setSelectedBlocks] = useState([]); // массив { resourceId, blockId }

  // Обёртка: если shift — добавляем/убираем к выделению, иначе — сбрасываем на один
  const toggleSelection = useCallback((sel, shiftKey) => {
    if (!sel) {
      setSelectedBlocks([]);
      return;
    }
    if (shiftKey) {
      setSelectedBlocks(prev => {
        const exists = prev.some(s => s.blockId === sel.blockId);
        if (exists) return prev.filter(s => s.blockId !== sel.blockId);
        return [...prev, sel];
      });
    } else {
      setSelectedBlocks([sel]);
    }
  }, []);
  const [editingBlock, setEditingBlock] = useState(null);
  const [editingResource, setEditingResource] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [statsOpen, setStatsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [dropIndicator, setDropIndicator] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [zoom, setZoom] = useState(1); // 1 | 0.75 | 0.5
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) { validateState(JSON.parse(raw)); setStorageReady(true); setBooting(false); return; }
      } catch { setNotice("Не удалось прочитать локальный план. Откройте сохранённый снапшот."); setBooting(false); return; }
      try {
        const { snapshots } = await snapshotRequest();
        if (cancelled) return;
        if (snapshots.length) {
          const latest = await snapshotRequest(snapshots[0].id);
          if (cancelled) return;
          setState(latest.state); setNotice(`Загружен снапшот «${latest.name}».`);
        }
        setStorageReady(true);
      } catch (e) { if (!cancelled) setNotice(e.message + " Откройте окно «Снапшоты», чтобы повторить загрузку."); }
      finally { if (!cancelled) setBooting(false); }
    }
    init();
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!storageReady) return;
    const t = setTimeout(() => {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
      catch { setNotice("Не удалось сохранить план в браузере. Сохраните общий снапшот или экспортируйте JSON."); }
    }, 400);
    return () => clearTimeout(t);
  }, [state, storageReady]);
  useEffect(() => {
    const id = setInterval(() => setCurrWeek(currentWeekIndex()), 60000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (!booting) goToCurrentWeek(false);
  }, [booting, currWeek, zoom, goToCurrentWeek]);

  const pushHistory = useCallback(() => {
    setStorageReady(true);
    const snapshot = deepClone(stateRef.current);
    setHistory(h => [...h.slice(-49), snapshot]);
    setFuture([]);
  }, []);

  const undo = useCallback(() => {
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    const current = deepClone(stateRef.current);
    setFuture(f => [current, ...f.slice(0, 49)]);
    setHistory(h => h.slice(0, -1));
    setState(prev);
  }, [history]);

  const redo = useCallback(() => {
    if (future.length === 0) return;
    const next = future[0];
    const current = deepClone(stateRef.current);
    setHistory(h => [...h.slice(-49), current]);
    setFuture(f => f.slice(1));
    setState(next);
  }, [future]);
  const update = useCallback((mutator) => {
    pushHistory();
    setState(prev => { const next = deepClone(prev); mutator(next); return next; });
  }, [pushHistory]);

  // ===== Мутации =====
  const deleteBlock = (rId, bId) => update(s => {
    const r = s.resources.find(x => x.id === rId);
    if (r) r.blocks = r.blocks.filter(b => b.id !== bId);
  });
  const resizeBlock = (rId, bId, newWeeks) => update(s => {
    const r = s.resources.find(x => x.id === rId);
    if (!r) return;
    const b = r.blocks.find(x => x.id === bId);
    if (!b) return;

    const oldWeeks = b.weeks;
    const targetWeeks = Math.max(MIN_WEEKS, newWeeks);
    if (targetWeeks === oldWeeks) return;

    // Находим ближайшего соседа снизу ДО изменения
    const sortedBefore = [...r.blocks].sort((a, b) => a.weekStart - b.weekStart);
    const idx = sortedBefore.findIndex(x => x.id === bId);
    const below = sortedBefore[idx + 1];
    const oldGapBelow = below ? below.weekStart - (b.weekStart + oldWeeks) : null;

    b.weeks = targetWeeks;

    if (targetWeeks > oldWeeks) {
      // Увеличение — сдвигаем соседей вниз, если налезли
      pushDownCollisions(r, b);
    } else {
      // Уменьшение — если нижний сосед стоял впритык, подтягиваем всю цепочку ниже на разницу
      if (below && oldGapBelow === 0) {
        const shrink = oldWeeks - targetWeeks;
        // Собираем все блоки ниже перемещённого по старому порядку
        const lowerSorted = sortedBefore.slice(idx + 1);
        for (const other of lowerSorted) {
          other.weekStart = Math.max(0, other.weekStart - shrink);
        }
        // После сдвига проверяем, не налезли ли они на b (теоретически не должны, но safety)
        pushDownCollisions(r, b);
      }
    }
  });
  const updateBlock = (rId, bId, patch) => update(s => {
    const r = s.resources.find(x => x.id === rId);
    const b = r?.blocks.find(x => x.id === bId);
    if (b) Object.assign(b, patch);
  });
  const moveBlockBy = (rId, bId, deltaWeeks) => update(s => {
    const r = s.resources.find(x => x.id === rId);
    if (!r) return;
    const b = r.blocks.find(x => x.id === bId);
    if (!b) return;
    const newStart = Math.max(0, b.weekStart + deltaWeeks);
    if (newStart === b.weekStart) return;

    const draggedCenter = newStart + b.weeks / 2;
    const candidates = r.blocks.filter(x => x.id !== bId);
    const swapTarget = candidates.find(
      x => draggedCenter >= x.weekStart && draggedCenter < x.weekStart + x.weeks
    );

    if (swapTarget) {
      // Swap: блок встаёт на начало соседа, сосед — сразу за новым положением блока
      const oldStart = swapTarget.weekStart;
      b.weekStart = oldStart;
      swapTarget.weekStart = oldStart + b.weeks;
      pushDownCollisions(r, swapTarget);
    } else {
      b.weekStart = newStart;
      pushDownCollisions(r, b);
    }
  });

  // Перемещение с swap при наезде на соседа
  // Пересобирает колонку: берёт текущий порядок блоков по weekStart и применяет массив зазоров
  // (зазор = расстояние между концом предыдущего блока и началом следующего).
  // Первый блок сохраняет свой weekStart.
  function applyGaps(resource, gaps) {
    const sorted = [...resource.blocks].sort((a, b) => a.weekStart - b.weekStart);
    if (sorted.length === 0) return;
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const gap = gaps[i - 1] ?? 0;
      sorted[i].weekStart = prev.weekStart + prev.weeks + gap;
    }
  }

  // Считает зазоры между последовательными блоками (длина = blocks.length - 1).
  function computeGaps(resource) {
    const sorted = [...resource.blocks].sort((a, b) => a.weekStart - b.weekStart);
    const gaps = [];
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const cur = sorted[i];
      gaps.push(Math.max(0, cur.weekStart - (prev.weekStart + prev.weeks)));
    }
    return gaps;
  }

  function pushDownCollisions(resource, blockA) {
    const aEnd = blockA.weekStart + blockA.weeks;
    for (const other of resource.blocks) {
      if (other.id === blockA.id) continue;
      const oStart = other.weekStart;
      const oEnd = oStart + other.weeks;
      if (oStart < aEnd && oEnd > blockA.weekStart) {
        const shift = aEnd - other.weekStart;
        if (shift > 0) {
          other.weekStart = aEnd;
          pushDownCollisions(resource, other);
        }
      }
    }
  }

  const moveBlockTo = (srcId, bId, dstId, targetWeek, forceExact = false) => update(s => {
    const src = s.resources.find(x => x.id === srcId);
    const dst = s.resources.find(x => x.id === dstId);
    if (!src || !dst) return;

    const origIdx = src.blocks.findIndex(b => b.id === bId);
    if (origIdx < 0) return;
    const block = src.blocks[origIdx];

    const week = Math.max(0, targetWeek);

    // Удаляем блок из источника — остальные блоки остаются на своих абсолютных позициях
    src.blocks.splice(origIdx, 1);

    // Если forceExact — ставим на точную позицию без swap (используется при drop в стык).
    // Иначе ищем блок, на который наезжаем центром, и делаем swap.
    let swapTarget = null;
    if (!forceExact) {
      const candidates = dst.blocks;
      const draggedCenter = week + block.weeks / 2;
      swapTarget = candidates.find(
        b => draggedCenter >= b.weekStart && draggedCenter < b.weekStart + b.weeks
      );
    }

    if (swapTarget) {
      // Swap — блоки меняются местами: moved встаёт на начало swapTarget, swapTarget уходит на конец moved
      const oldStart = swapTarget.weekStart;
      block.weekStart = oldStart;
      swapTarget.weekStart = oldStart + block.weeks;
      dst.blocks.push(block);
      pushDownCollisions(dst, swapTarget);
    } else {
      // Просто ставим в указанную позицию; если пересекается с соседями — они сдвинутся вниз
      block.weekStart = week;
      dst.blocks.push(block);
      pushDownCollisions(dst, block);
    }

    dst.blocks.sort((a, b) => a.weekStart - b.weekStart);
    if (src !== dst) src.blocks.sort((a, b) => a.weekStart - b.weekStart);
  });

  const addResource = () => update(s => {
    s.resources.push({
      id: uid(), name: "Новый ресурс",
      color: HEADER_COLORS[s.resources.length % HEADER_COLORS.length],
      blocks: []
    });
  });
  const removeResource = (rId) => {
    if (!confirm("Удалить ресурс со всеми его блоками?")) return;
    update(s => { s.resources = s.resources.filter(r => r.id !== rId); });
  };
  const updateResource = (rId, patch) => update(s => {
    const r = s.resources.find(x => x.id === rId);
    if (r) Object.assign(r, patch);
  });

  const addBlock = (rId, kind = "task") => update(s => {
    const r = s.resources.find(x => x.id === rId);
    if (!r) return;
    const endWeek = r.blocks.reduce((m, b) => Math.max(m, b.weekStart + b.weeks), 0);
    let block;
    const common = { id: uid(), weekStart: endWeek };
    if (kind === "task") block = { ...common, kind: "task", num: "1", title: "Новый блок", desc: "Описание задачи", weeks: 2, color: PALETTE[0] };
    else if (kind === "vacation") block = { ...common, kind: "vacation", title: "Отпуск", weeks: 1 };
    else block = { ...common, kind: "label", title: "Название раздела", weeks: 2 };
    r.blocks.push(block);
  });

  const exportJson = () => {
    try {
      const data = JSON.stringify(state, null, 2);
      const blob = new Blob([data], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `rhm-dashboard-${new Date().toISOString().slice(0, 10)}.json`;
      a.rel = "noopener";
      a.target = "_self";
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 150);
    } catch (err) {
      alert("Ошибка экспорта: " + err.message);
    }
  };

  const importJson = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.onchange = async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        validateState(parsed);
        pushHistory();
        setState(parsed);
      } catch (err) {
        alert("Не удалось импортировать: " + err.message);
      }
    };
    input.click();
  };

  const resetToDefault = () => {
    pushHistory();
    setState(deepClone(INITIAL_STATE));
    setConfirmReset(false);
  };

  useEffect(() => {
    const onKey = (e) => {
      const t = e.target;
      const isEditing = t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable;
      if (e.key === "Escape" && !snapshotsOpen) { setEditingBlock(null); setEditingResource(null); setHelpOpen(false); setConfirmReset(false); setContextMenu(null); setSelectedBlocks([]); return; }
      if (isEditing || booting || snapshotsOpen || editingBlock || editingResource || helpOpen || confirmReset) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); undo(); return; }
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "y" || (e.shiftKey && e.key.toLowerCase() === "z"))) { e.preventDefault(); redo(); return; }
      if (selectedBlocks.length > 0) {
        if (e.key === "Delete" || e.key === "Backspace") {
          e.preventDefault();
          // Удаляем все выделенные
          for (const sel of selectedBlocks) deleteBlock(sel.resourceId, sel.blockId);
          setSelectedBlocks([]);
          return;
        }
        // Стрелки — движение всех выбранных на одну неделю
        // При движении группы — нужно сдвигать от края: вверх → сверху-вниз, вниз → снизу-вверх
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          const delta = e.key === "ArrowDown" ? 1 : -1;
          if (e.shiftKey) {
            // Shift+стрелки — ресайз всех выбранных
            for (const sel of selectedBlocks) {
              const r = state.resources.find(rr => rr.id === sel.resourceId);
              const b = r?.blocks.find(bb => bb.id === sel.blockId);
              if (b) resizeBlock(sel.resourceId, sel.blockId, b.weeks + delta);
            }
          } else {
            // Для группы сортируем блоки — при движении вниз сначала двигаем нижние, при движении вверх — верхние
            const withBlocks = selectedBlocks.map(sel => {
              const r = state.resources.find(rr => rr.id === sel.resourceId);
              const b = r?.blocks.find(bb => bb.id === sel.blockId);
              return { sel, weekStart: b?.weekStart ?? 0 };
            }).sort((a, b) => delta > 0 ? b.weekStart - a.weekStart : a.weekStart - b.weekStart);
            for (const { sel } of withBlocks) moveBlockBy(sel.resourceId, sel.blockId, delta);
          }
          return;
        }
      }
      if (e.key === "?") { e.preventDefault(); setHelpOpen(true); }
      if (e.key === "Escape") { setSelectedBlocks([]); setContextMenu(null); setHelpOpen(false); setConfirmReset(false); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedBlocks, state, undo, redo, booting, snapshotsOpen, editingBlock, editingResource, helpOpen, confirmReset]);

  const maxWeeks = useMemo(() => {
    const extra = isDragging ? 8 : 2;
    return Math.max(30, currWeek + 5, ...state.resources.map(r => columnEndWeek(r) + extra));
  }, [state, isDragging, currWeek]);
  // Реальная длина проекта — максимум, на котором кончается самый длинный ресурс (без технических запасов)
  const projectWeeks = useMemo(
    () => Math.max(0, ...state.resources.map(r => columnEndWeek(r))),
    [state]
  );
  const totalManWeeks = useMemo(() => state.resources.reduce((s, r) => s + columnManWeeks(r), 0), [state]);
  const totalTasks = useMemo(() => state.resources.reduce((s, r) => s + r.blocks.filter(b => b.kind === "task").length, 0), [state]);
  const timelineHeight = maxWeeks * STEP_PX;

  return (
    <div style={{ fontFamily: "Arial, sans-serif", background: "#F7F7F7", height: "100dvh", display: "flex", flexDirection: "column", overflow: "hidden", color: "#1a1a1a" }}
      onClick={() => setContextMenu(null)}>
      <div style={{
        flexShrink: 0, position: "relative", zIndex: 50, background: "#fff",
        borderBottom: "1px solid #e0e0e0", padding: "14px 24px",
        display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap"
      }}>
        <h1 style={{ fontFamily: "Georgia, serif", fontSize: 24, margin: 0, fontWeight: 400 }}>RHM MP 1.0 Платформа</h1>
        <button onClick={() => setStatsOpen(v => !v)} style={btnSecondary}>
          {statsOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />} Статистика
        </button>
        <div style={{ display: "inline-flex", border: "1px solid #d0d0d0", borderRadius: 6, overflow: "hidden" }}>
          {[1, 0.75, 0.5].map(z => (
            <button key={z}
              onClick={() => setZoom(z)}
              style={{
                background: zoom === z ? "#1E3A5F" : "#fff",
                color: zoom === z ? "#fff" : "#333",
                border: "none", padding: "8px 10px", cursor: "pointer",
                fontSize: 12, fontFamily: "Arial",
                borderLeft: z !== 1 ? "1px solid #d0d0d0" : "none"
              }}
              title={`Масштаб ${Math.round(z * 100)}%`}
            >
              {Math.round(z * 100)}%
            </button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <button onClick={undo} disabled={history.length === 0} style={btnSecondary} title="Ctrl+Z"><RotateCcw size={14} /> Откат</button>
        <button onClick={redo} disabled={future.length === 0} style={btnSecondary} title="Ctrl+Shift+Z"><RotateCw size={14} /> Повтор</button>
        <button onClick={addResource} style={btnPrimary}><Plus size={14} /> Ресурс</button>
        <button onClick={() => setSnapshotsOpen(true)} style={btnPrimary}><Save size={14} /> Снапшоты</button>
        <button onClick={() => goToCurrentWeek()} style={btnSecondary} disabled={currWeek < 0}><CalendarDays size={14} /> Текущая неделя</button>
        <button onClick={importJson} style={btnSecondary}><Upload size={14} /> Импорт</button>
        <button onClick={exportJson} style={btnSecondary}><Download size={14} /> Экспорт</button>
        <button onClick={() => setConfirmReset(true)} style={{ ...btnSecondary, color: "#c00" }}><RefreshCw size={14} /> Сброс</button>
        <button onClick={() => setHelpOpen(true)} style={{ ...btnSecondary, padding: "8px 10px" }}><HelpCircle size={14} /></button>
      </div>

      {notice && <div role="status" style={{ padding: "8px 24px", background: "#edf2f7", fontSize: 13, display: "flex", alignItems: "center", gap: 12 }}><span style={{ flex: 1 }}>{notice}</span><button onClick={() => setNotice("")} style={btnSecondary} aria-label="Скрыть уведомление">×</button></div>}
      {booting && <div role="status" style={{ position: "fixed", inset: 0, zIndex: 190, background: "#f7f7f7ee", display: "grid", placeItems: "center" }}>Загружаем рабочий план…</div>}
      {statsOpen && (
        <div style={{
          flexShrink: 0, position: "relative", zIndex: 40, background: "#fff",
          margin: "8px 24px 0", padding: "12px 16px", borderRadius: 8,
          border: "1px solid #e0e0e0", fontSize: 13, display: "flex", gap: 28, flexWrap: "wrap"
        }}>
          <div><b>Ресурсов:</b> {state.resources.length}</div>
          <div><b>Задач:</b> {totalTasks}</div>
          <div><b>Суммарно ч/н:</b> {totalManWeeks}</div>
          <div><b>Длина проекта:</b> {projectWeeks} нед. (~{Math.ceil(projectWeeks / 4.33)} мес.)</div>
          <div><b>Текущая неделя:</b> {currWeek >= 0 ? `#${weekLabel(currWeek).num}` : "до старта"}</div>
        </div>
      )}

      <div
        ref={timelineRef}
        data-testid="timeline"
        style={{ overflow: "auto", flex: 1, minHeight: 0, padding: "20px 0 120px" }}
        onDragOver={(e) => {
          // Подавляем дефолтный курсор-иконку браузера во время drag блока
          if (window.__dashboardDragging) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
          }
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", minWidth: "max-content", paddingLeft: 0 }}>
          {/* Месяцы — scaled обёртка */}
          <div style={{
            width: MONTH_COL_WIDTH * zoom, flexShrink: 0, paddingLeft: 24,
            height: (HEADER_HEIGHT + timelineHeight) * zoom
          }}>
            <div style={{
              zoom,
              width: MONTH_COL_WIDTH
            }}>
              <div style={{ height: HEADER_HEIGHT }} />
              <MonthRail maxWeeks={maxWeeks} />
            </div>
          </div>
          {/* Недели — sticky, в собственной scaled обёртке */}
          <div style={{
            width: WEEK_COL_WIDTH * zoom, flexShrink: 0,
            position: "sticky", left: 0, zIndex: 20,
            background: "#F7F7F7",
            boxShadow: "4px 0 10px -4px rgba(0,0,0,0.12)",
            height: (HEADER_HEIGHT + timelineHeight) * zoom
          }}>
            <div style={{
              zoom,
              width: WEEK_COL_WIDTH
            }}>
              <div style={{ height: HEADER_HEIGHT, background: "#F7F7F7" }} />
              <WeekScale maxWeeks={maxWeeks} currWeek={currWeek} zoom={zoom} />
            </div>
          </div>
          {/* Масштабируемая область с ресурсами */}
          <div style={{
            width: (state.resources.length * (COL_WIDTH + 14)) * zoom,
            height: (HEADER_HEIGHT + timelineHeight + 60) * zoom,
            flexShrink: 0
          }}>
            <div style={{
              display: "flex", alignItems: "flex-start",
              zoom,
              transformOrigin: "top left"
            }}>
              {state.resources.map((resource) => (
                <ResourceColumn
                  key={resource.id}
                  resource={resource}
                  maxWeeks={maxWeeks}
                  timelineHeight={timelineHeight}
                  currWeek={currWeek}
                  selectedBlocks={selectedBlocks}
                  toggleSelection={toggleSelection}
                  setEditingBlock={setEditingBlock}
                  setEditingResource={setEditingResource}
                  setContextMenu={setContextMenu}
                  resizeBlock={resizeBlock}
                  moveBlockTo={moveBlockTo}
                  addBlock={addBlock}
                  removeResource={removeResource}
                  dropIndicator={dropIndicator}
                  setDropIndicator={setDropIndicator}
                  isDragging={isDragging}
                  setIsDragging={setIsDragging}
                  zoom={zoom}
                />
              ))}
            </div>
          </div>
          {/* Правый отступ для удобной прокрутки к краю */}
          <div style={{ width: 24, flexShrink: 0 }} />
        </div>
      </div>

      {snapshotsOpen && <SnapshotsModal state={state} onClose={() => setSnapshotsOpen(false)} onLoad={snapshot => {
        pushHistory(); setState(snapshot.state); setSelectedBlocks([]); setSnapshotsOpen(false);
        setNotice(`Загружен снапшот «${snapshot.name}». Доступен откат к предыдущему плану.`);
        requestAnimationFrame(() => goToCurrentWeek(false));
      }} />}
      {contextMenu && (
        <ContextMenuView
          menu={contextMenu}
          onClose={() => setContextMenu(null)}
          onDelete={() => { deleteBlock(contextMenu.resourceId, contextMenu.blockId); setContextMenu(null); }}
          onEdit={() => { setEditingBlock(contextMenu); setContextMenu(null); }}
          block={state.resources.find(r => r.id === contextMenu.resourceId)?.blocks.find(b => b.id === contextMenu.blockId)}
        />
      )}
      {editingBlock && (
        <EditBlockModal
          block={state.resources.find(r => r.id === editingBlock.resourceId)?.blocks.find(b => b.id === editingBlock.blockId)}
          onClose={() => setEditingBlock(null)}
          onSave={(patch) => { updateBlock(editingBlock.resourceId, editingBlock.blockId, patch); setEditingBlock(null); }}
          onDelete={() => { deleteBlock(editingBlock.resourceId, editingBlock.blockId); setEditingBlock(null); }}
        />
      )}
      {editingResource && (
        <EditResourceModal
          resource={state.resources.find(r => r.id === editingResource)}
          onClose={() => setEditingResource(null)}
          onSave={(patch) => { updateResource(editingResource, patch); setEditingResource(null); }}
          onDelete={() => { removeResource(editingResource); setEditingResource(null); }}
        />
      )}
      {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} />}
      {confirmReset && (
        <ModalShell title="Сбросить дашборд?" onClose={() => setConfirmReset(false)}>
          <p style={{ fontFamily: "Arial", fontSize: 14, lineHeight: 1.5 }}>
            Текущий план будет очищен. Сохранённые снапшоты останутся доступны.
            Это действие можно будет отменить через Ctrl+Z.
          </p>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
            <button onClick={() => setConfirmReset(false)} style={btnSecondary}>Отмена</button>
            <button onClick={resetToDefault} style={{ ...btnPrimary, background: "#c00" }}>Сбросить</button>
          </div>
        </ModalShell>
      )}
    </div>
  );
}

// ===== Шкала месяцев (прокручивается) =====
function MonthRail({ maxWeeks }) {
  const monthRanges = [];
  let prevM = -1, prevY = -1, start = 0;
  for (let i = 0; i < maxWeeks; i++) {
    const d = weekToDate(i);
    const m = d.getMonth(), y = d.getFullYear();
    if (m !== prevM || y !== prevY) {
      if (i > 0) monthRanges.push({ start, end: i, m: prevM, y: prevY });
      prevM = m; prevY = y; start = i;
    }
  }
  monthRanges.push({ start, end: maxWeeks, m: prevM, y: prevY });

  return (
    <div style={{ position: "relative", height: maxWeeks * STEP_PX, width: 66 }}>
      {monthRanges.map((mr, idx) => {
        const top = mr.start * STEP_PX + 2;
        const height = (mr.end - mr.start) * STEP_PX - 4;
        const isEven = idx % 2 === 0;
        return (
          <div key={idx} style={{
            position: "absolute", top, left: 0, width: 66, height,
            boxSizing: "border-box",
            background: isEven ? "#1E3A5F" : "#3A4A5F",
            color: "#fff", borderRadius: 6, padding: "10px 4px",
            fontFamily: "Georgia, serif", fontSize: 13, fontWeight: 600,
            textAlign: "center", lineHeight: 1.2,
            display: "flex", alignItems: "flex-start", justifyContent: "center"
          }}>
            <div>
              {MONTH_NAMES[mr.m]}
              <div style={{ fontSize: 10, fontWeight: 400, opacity: 0.85, marginTop: 2 }}>{mr.y}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ===== Шкала недель (закрепляется при горизонтальном скролле) =====
function WeekScale({ maxWeeks, currWeek, zoom = 1 }) {
  const isCompact = zoom < 1;
  return (
    <div style={{ position: "relative", height: maxWeeks * STEP_PX }}>
      {Array.from({ length: maxWeeks }).map((_, i) => {
        const wl = weekLabel(i);
        const isCurr = i === currWeek;
        return (
          <div key={i} data-current-week={isCurr ? "true" : undefined} style={{
            height: WEEK_PX,
            boxSizing: "border-box",
            display: "flex", flexDirection: "column", justifyContent: "center",
            borderLeft: "1px solid #ddd",
            color: isCurr ? "#fffafa" : "inherit",
            borderTop: i === 0 ? "none" : "1px solid rgba(0,0,0,0.06)",
            paddingLeft: 8, background: isCurr ? "#b92d27" : "transparent"
          }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>№ {wl.num}</div>
            {!isCompact && <div style={{ fontSize: 10, color: isCurr ? "#fffafa" : "#666" }}>{wl.range}</div>}
            {isCurr && <div style={{ fontSize: 9, color: "#fffafa", fontWeight: 700 }}>сейчас</div>}
          </div>
        );
      })}
    </div>
  );
}

// ===== Колонка =====
function ResourceColumn({
  resource, maxWeeks, timelineHeight, currWeek,
  selectedBlocks, toggleSelection, setEditingBlock, setEditingResource,
  setContextMenu, resizeBlock, moveBlockTo, addBlock, removeResource,
  dropIndicator, setDropIndicator, isDragging, setIsDragging, zoom = 1
}) {
  const manWeeks = columnManWeeks(resource);
  const endWeek = columnEndWeek(resource);
  const [menuOpen, setMenuOpen] = useState(false);
  const columnRef = useRef(null);

  const handleDragOver = (e) => {
    if (!window.__dashboardDragging) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const rect = columnRef.current.getBoundingClientRect();
    const yCursor = (e.clientY - rect.top) / zoom;
    const dragging = window.__dashboardDragging;
    const grabOffset = dragging.grabOffsetWeeks || 0;
    const y = yCursor - grabOffset * STEP_PX;
    const weekFloat = y / STEP_PX;

    // Логика: ищем, в какой блок попал курсор (по дробной позиции).
    // Если курсор в верхней половине блока — вставляем ПЕРЕД ним.
    // Если в нижней — вставляем ПОСЛЕ.
    // Если попали между блоками (в пустое пространство) — ставим в эту пустоту.
    const candidates = resource.blocks.filter(b => b.id !== dragging.blockId);
    let snapWeek = Math.max(0, Math.round(weekFloat));
    let onJoint = false;
    let jointWeek = null;

    // Ищем блок, внутрь которого попал курсор
    const insideBlock = candidates.find(
      b => weekFloat >= b.weekStart && weekFloat < b.weekStart + b.weeks
    );

    if (insideBlock) {
      const center = insideBlock.weekStart + insideBlock.weeks / 2;
      if (weekFloat < center) {
        // Верхняя половина — вставить перед insideBlock
        snapWeek = Math.max(0, insideBlock.weekStart - dragging.weeks);
        jointWeek = insideBlock.weekStart;
      } else {
        // Нижняя половина — вставить после insideBlock
        snapWeek = insideBlock.weekStart + insideBlock.weeks;
        jointWeek = insideBlock.weekStart + insideBlock.weeks;
      }
      onJoint = true;
    }

    setDropIndicator({ resourceId: resource.id, weekStart: snapWeek, weeks: dragging.weeks, onJoint, jointWeek });
  };

  const handleDragLeave = (e) => {
    if (e.currentTarget.contains(e.relatedTarget)) return;
    if (dropIndicator?.resourceId === resource.id) setDropIndicator(null);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const dragging = window.__dashboardDragging;
    const indicator = dropIndicator;
    setDropIndicator(null);
    if (!dragging) return;
    // Если есть активный индикатор для этой колонки — используем его позицию, и если он на стыке —
    // просим moveBlockTo вставить точно туда без swap-логики
    let targetWeek;
    let forceExact = false;
    if (indicator && indicator.resourceId === resource.id) {
      targetWeek = indicator.weekStart;
      forceExact = true; // индикатор всегда определяет точную позицию вставки
    } else {
      const rect = columnRef.current.getBoundingClientRect();
      const yCursor = (e.clientY - rect.top) / zoom;
      const grabOffset = dragging.grabOffsetWeeks || 0;
      const y = yCursor - grabOffset * STEP_PX;
      targetWeek = Math.max(0, Math.round(y / STEP_PX));
    }
    moveBlockTo(dragging.resourceId, dragging.blockId, resource.id, targetWeek, forceExact);
    window.__dashboardDragging = null;
  };

  return (
    <div style={{ width: COL_WIDTH, flexShrink: 0, marginRight: 14, position: "relative" }}>
      <div style={{
        height: HEADER_HEIGHT - 10, marginBottom: 10,
        boxSizing: "border-box",
        background: resource.color, color: "#fff",
        borderRadius: 8, padding: "12px 14px",
        display: "flex", flexDirection: "column", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 12
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
          <div style={{ fontFamily: "Georgia, serif", fontSize: 17, fontWeight: 600, lineHeight: 1.2, cursor: "pointer", flex: 1 }}
            onDoubleClick={() => setEditingResource(resource.id)}>
            {resource.name}
          </div>
          <button onClick={(e) => { e.stopPropagation(); setMenuOpen(v => !v); }} style={iconBtnOnDark} title="Меню ресурса">
            <MoreVertical size={14} />
          </button>
        </div>
        <div style={{ fontSize: 11, opacity: 0.9, fontFamily: "Arial" }}>
          {manWeeks} ч/н · {endWeek} нед.
        </div>

        {menuOpen && (
          <div style={{
            position: "absolute", top: "100%", right: 0, marginTop: 4, zIndex: 30,
            background: "#fff", color: "#000", borderRadius: 6,
            boxShadow: "0 6px 20px rgba(0,0,0,0.18)", padding: 4, minWidth: 200
          }} onClick={e => e.stopPropagation()}>
            <button style={menuItem} onClick={() => { setEditingResource(resource.id); setMenuOpen(false); }}>Редактировать ресурс…</button>
            <button style={menuItem} onClick={() => { addBlock(resource.id, "task"); setMenuOpen(false); }}>+ Блок-задача</button>
            <button style={menuItem} onClick={() => { addBlock(resource.id, "label"); setMenuOpen(false); }}>+ Блок-лейбл</button>
            <button style={menuItem} onClick={() => { addBlock(resource.id, "vacation"); setMenuOpen(false); }}>+ Отпуск 🌴</button>
            <div style={{ height: 1, background: "#eee", margin: "4px 0" }} />
            <button style={{ ...menuItem, color: "#c00" }} onClick={() => { removeResource(resource.id); setMenuOpen(false); }}>Удалить ресурс</button>
          </div>
        )}
      </div>

      <div
        ref={columnRef}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        style={{
          position: "relative", height: timelineHeight,
          background: `repeating-linear-gradient(to bottom,
            rgba(0,0,0,0.02) 0,
            rgba(0,0,0,0.02) ${STEP_PX - 1}px,
            rgba(0,0,0,0.08) ${STEP_PX - 1}px,
            rgba(0,0,0,0.08) ${STEP_PX}px
          )`,
          borderRadius: 6
        }}
      >
        {currWeek >= 0 && currWeek < maxWeeks && <div data-testid="current-week-band" style={{
          position: "absolute", top: currWeek * STEP_PX, left: 0, right: 0, height: WEEK_PX,
          boxSizing: "border-box", background: "rgba(255,59,48,0.12)",
          borderTop: `2px solid ${CURRENT_WEEK_COLOR}`, borderBottom: `2px solid ${CURRENT_WEEK_COLOR}`,
          pointerEvents: "none", zIndex: 6,
        }} />}
        {/* Drop-indicator */}
        {dropIndicator && dropIndicator.resourceId === resource.id && (
          dropIndicator.onJoint ? (
            // Точно на стыке — показываем яркую полосу на уровне границы недели
            <div style={{
              position: "absolute", left: 2, right: 2,
              top: dropIndicator.jointWeek * STEP_PX - 6,
              height: 12,
              background: "rgba(30,58,95,0.15)",
              border: "2px solid #1E3A5F",
              borderRadius: 4, pointerEvents: "none", zIndex: 3,
              boxShadow: "0 0 12px rgba(30,58,95,0.4)"
            }} />
          ) : (
            // Над пустым местом — прямоугольник будущего положения, совпадающий со шкалой
            <div style={{
              position: "absolute", left: 4, right: 4,
              top: dropIndicator.weekStart * STEP_PX + GAP_PX / 2,
              height: dropIndicator.weeks * STEP_PX - GAP_PX,
              border: "2px dashed #1E3A5F",
              background: "rgba(30,58,95,0.08)",
              borderRadius: 6, pointerEvents: "none", zIndex: 1
            }} />
          )
        )}

        {resource.blocks.map((block) => (
          <Block
            key={block.id}
            block={block}
            resource={resource}
            isSelected={selectedBlocks.some(s => s.blockId === block.id)}
            onSelect={(shiftKey) => toggleSelection({ resourceId: resource.id, blockId: block.id }, shiftKey)}
            onEdit={() => setEditingBlock({ resourceId: resource.id, blockId: block.id })}
            onContextMenu={(e) => {
              e.preventDefault();
              setContextMenu({ x: e.clientX, y: e.clientY, resourceId: resource.id, blockId: block.id });
            }}
            onResize={(newWeeks) => resizeBlock(resource.id, block.id, newWeeks)}
            zoom={zoom}
            setIsDragging={setIsDragging}
          />
        ))}

        {!isDragging && (
          <button
            onClick={() => addBlock(resource.id, "task")}
            style={{
              position: "absolute", left: 4, right: 4,
              top: endWeek * STEP_PX + 4, height: 40,
              border: "2px dashed #bbb", background: "rgba(255,255,255,0.6)",
              borderRadius: 6, color: "#888", cursor: "pointer",
              fontFamily: "Arial", fontSize: 13,
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6
            }}
          >
            <Plus size={14} /> Добавить блок
          </button>
        )}
      </div>
    </div>
  );
}

// ===== Block =====
function Block({ block, resource, isSelected, onSelect, onEdit, onContextMenu, onResize, zoom = 1, setIsDragging }) {
  // Блок точно совпадает с сеткой недель: верх — на границе недели, высота — weeks × STEP_PX.
  // Визуальный зазор между блоками создаёт прозрачный поясок через внутренний padding и обводку,
  // а не вычитанием из размеров.
  const top = block.weekStart * STEP_PX;
  const h = block.weeks * STEP_PX;
  const [resizing, setResizing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const startY = useRef(0);
  const startWeeks = useRef(block.weeks);
  const accum = useRef(0);

  const onResizeStart = (e) => {
    e.stopPropagation();
    e.preventDefault();
    setResizing(true);
    startY.current = e.clientY;
    startWeeks.current = block.weeks;
    accum.current = 0;
    const onMove = (ev) => {
      const dy = (ev.clientY - startY.current) / zoom;
      const steps = Math.round(dy / STEP_PX);
      if (steps !== accum.current) {
        const newWeeks = Math.max(MIN_WEEKS, startWeeks.current + steps);
        onResize(newWeeks);
        accum.current = steps;
      }
    };
    const onUp = () => {
      setResizing(false);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const onDragStart = (e) => {
    e.stopPropagation();
    // Упрощённая модель: во время drag верхняя граница блока следует за курсором.
    // Пользователю не нужно считать grab-offset — визуальный индикатор покажет результат.
    window.__dashboardDragging = {
      resourceId: resource.id,
      blockId: block.id,
      weeks: block.weeks,
      grabOffsetWeeks: 0
    };
    // Используем text/plain с пустой строкой — Chrome иначе показывает глобус URL
    e.dataTransfer.setData("text/plain", "");
    e.dataTransfer.effectAllowed = "move";
    // Подавляем дефолтное drag-превью через реальный видимый элемент с opacity:0
    try {
      const ghost = document.createElement("div");
      ghost.textContent = " ";
      ghost.style.cssText = "position:absolute;top:0;left:0;width:1px;height:1px;opacity:0;background:transparent;pointer-events:none;";
      document.body.appendChild(ghost);
      e.dataTransfer.setDragImage(ghost, 0, 0);
      setTimeout(() => { try { document.body.removeChild(ghost); } catch {} }, 100);
    } catch {}
    setDragging(true);
    if (setIsDragging) setIsDragging(true);
  };
  const onDragEnd = () => {
    setDragging(false);
    window.__dashboardDragging = null;
    if (setIsDragging) setIsDragging(false);
  };

  const commonStyle = {
    position: "absolute",
    left: 4, right: 4, top, height: h,
    cursor: resizing ? "ns-resize" : "grab",
    opacity: dragging ? 0.3 : 1,
    transition: dragging || resizing ? "none" : "top 0.15s ease, height 0.15s ease",
    zIndex: isSelected ? 5 : 2,
    // Визуальный «поясок» сверху и снизу блока — создаёт зазор между соседями,
    // не ломая выравнивание с сеткой недель
    boxSizing: "border-box",
    borderTop: `${GAP_PX / 2}px solid transparent`,
    borderBottom: `${GAP_PX / 2}px solid transparent`,
    backgroundClip: "padding-box"
  };

  const isCompact = zoom < 1;

  if (block.kind === "label") {
    return (
      <div
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onClick={(e) => { e.stopPropagation(); onSelect(e.shiftKey); }}
        onDoubleClick={onEdit}
        onContextMenu={onContextMenu}
        style={{
          ...commonStyle,
          background: "transparent",
          border: isSelected ? "2px solid #1E3A5F" : "1px solid #c8c8c8",
          borderRadius: 4,
          display: "flex", alignItems: "center", justifyContent: "center",
          overflow: "hidden"
        }}
      >
        {!isCompact && (
          <button
            onClick={(e) => { e.stopPropagation(); onEdit(); }}
            style={{
              position: "absolute", top: 8, left: 8,
              background: "rgba(255,255,255,0.85)", border: "1px solid #ddd",
              borderRadius: 4, padding: 3, cursor: "pointer",
              display: "flex", alignItems: "center"
            }}
            title="Редактировать"
          ><MoreVertical size={12} /></button>
        )}
        <div style={{
          transform: "rotate(-90deg)", whiteSpace: "nowrap",
          fontFamily: "Arial", fontSize: 20, color: "#555"
        }}>
          {block.title}
        </div>
        {!isCompact && (
          <div style={{
            position: "absolute", bottom: 4, left: 8,
            fontSize: 10, opacity: 0.6, fontFamily: "Arial", color: "#555"
          }}>
            {block.weeks} нед.
          </div>
        )}
        <ResizeHandle onMouseDown={onResizeStart} resizing={resizing} />
      </div>
    );
  }

  const isVacation = block.kind === "vacation";
  const bg = isVacation ? VACATION_COLOR : (block.color || PALETTE[0]);

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={(e) => { e.stopPropagation(); onSelect(e.shiftKey); }}
      onDoubleClick={onEdit}
      onContextMenu={onContextMenu}
      style={{
        ...commonStyle,
        background: bg, borderRadius: 6,
        boxShadow: isSelected ? "0 0 0 3px #1E3A5F, 0 2px 8px rgba(0,0,0,0.15)" : "0 1px 4px rgba(0,0,0,0.1)",
        color: "#000", overflow: "hidden",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        padding: isCompact ? "8px 10px" : "12px 14px", textAlign: "center"
      }}
    >
      {/* Бейдж с номером / пальмой — в компактном режиме скрываем номер, оставляем пальму */}
      {(!isCompact || isVacation) && (
        <div style={{
          position: "absolute", top: 8, right: 8, background: "#fff",
          borderRadius: 100, minWidth: 30, padding: "3px 10px",
          fontSize: 13, fontWeight: 700, fontFamily: "Arial", color: "#000"
        }}>
          {isVacation ? "🌴" : (block.num || "?")}
        </div>
      )}

      {/* Кнопка "⋮" — только на 100% */}
      {!isCompact && (
        <button
          onClick={(e) => { e.stopPropagation(); onEdit(); }}
          style={{
            position: "absolute", top: 8, left: 8,
            background: "rgba(255,255,255,0.85)", border: "none",
            borderRadius: 4, padding: 3, cursor: "pointer",
            display: "flex", alignItems: "center"
          }}
          title="Редактировать"
        ><MoreVertical size={12} /></button>
      )}

      <div style={{
        fontFamily: "Georgia, serif",
        fontSize: block.title.length > 24 ? 14 : (block.title.length > 16 ? 16 : 18),
        fontWeight: 400, lineHeight: 1.15, marginBottom: (isVacation || isCompact) ? 0 : 6,
        maxWidth: "100%", wordBreak: "break-word"
      }}>
        {block.title}
      </div>

      {/* Описание — только на 100% */}
      {!isCompact && !isVacation && block.desc && (
        <div style={{
          fontFamily: "Arial", fontSize: 11.5, lineHeight: 1.3,
          maxWidth: "100%", wordBreak: "break-word", whiteSpace: "pre-line"
        }}>
          {block.desc}
        </div>
      )}

      {/* Длительность — только на 100% */}
      {!isCompact && (
        <div style={{
          position: "absolute", bottom: 6, left: 8,
          fontSize: 10, opacity: 0.6, fontFamily: "Arial"
        }}>
          {block.weeks} нед.
        </div>
      )}

      <ResizeHandle onMouseDown={onResizeStart} resizing={resizing} />
    </div>
  );
}

function ResizeHandle({ onMouseDown, resizing }) {
  return (
    <div
      onMouseDown={onMouseDown}
      style={{
        position: "absolute", left: 0, right: 0, bottom: -5, height: 12,
        cursor: "ns-resize", zIndex: 10,
        display: "flex", alignItems: "center", justifyContent: "center",
        pointerEvents: "auto"
      }}
    >
      <div style={{
        width: 18, height: 6, borderRadius: 3,
        background: resizing ? "#1E3A5F" : "rgba(30,58,95,0.6)",
        border: "1.5px solid #fff",
        boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
        transition: "background 0.15s, transform 0.1s",
        transform: resizing ? "scale(1.2)" : "scale(1)"
      }} />
    </div>
  );
}

function ContextMenuView({ menu, onClose, onDelete, onEdit, block }) {
  if (!block) return null;
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 99 }} />
      <div style={{
        position: "fixed", top: menu.y, left: menu.x, zIndex: 100,
        background: "#fff", borderRadius: 6, boxShadow: "0 6px 24px rgba(0,0,0,0.2)",
        padding: 4, minWidth: 180, fontFamily: "Arial", fontSize: 13
      }}>
        <button style={menuItem} onClick={onEdit}>Редактировать…</button>
        <div style={{ height: 1, background: "#eee", margin: "4px 0" }} />
        <button style={{ ...menuItem, color: "#c00" }} onClick={onDelete}>
          <Trash2 size={12} style={{ display: "inline", marginRight: 6, verticalAlign: "middle" }} /> Удалить
        </button>
      </div>
    </>
  );
}

function EditBlockModal({ block, onClose, onSave, onDelete }) {
  const [num, setNum] = useState(block?.num || "");
  const [title, setTitle] = useState(block?.title || "");
  const [desc, setDesc] = useState(block?.desc || "");
  const [weeks, setWeeks] = useState(block?.weeks || 1);
  const [color, setColor] = useState(block?.color || PALETTE[0]);

  if (!block) return null;
  const isTask = block.kind === "task";
  const isVacation = block.kind === "vacation";
  const isLabel = block.kind === "label";

  return (
    <ModalShell
      title={isTask ? "Редактировать задачу" : isVacation ? "Редактировать отпуск" : "Редактировать лейбл"}
      onClose={onClose}
    >
      {isTask && (
        <Field label="Номер">
          <input value={num} onChange={e => setNum(e.target.value)} style={input} />
        </Field>
      )}
      <Field label={isLabel ? "Текст" : "Название"}>
        <input value={title} onChange={e => setTitle(e.target.value)} style={input} autoFocus />
      </Field>
      {isTask && (
        <Field label="Описание">
          <textarea value={desc} onChange={e => setDesc(e.target.value)} style={{ ...input, height: 100, resize: "vertical" }} />
        </Field>
      )}
      <Field label="Длительность (нед.)">
        <input type="number" min={1} value={weeks}
          onChange={e => setWeeks(Math.max(1, parseInt(e.target.value) || 1))} style={input} />
      </Field>
      {isTask && (
        <Field label="Цвет">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(9, 1fr)", gap: 6 }}>
            {PALETTE.map(c => (
              <div key={c} onClick={() => setColor(c)}
                style={{
                  height: 32, borderRadius: 4, background: c, cursor: "pointer",
                  border: color === c ? "3px solid #1E3A5F" : "1px solid #ccc"
                }} />
            ))}
          </div>
        </Field>
      )}
      <div style={{ display: "flex", gap: 8, justifyContent: "space-between", marginTop: 20 }}>
        <button onClick={() => { if (confirm("Удалить блок?")) onDelete(); }} style={{ ...btnSecondary, color: "#c00" }}>
          <Trash2 size={14} /> Удалить
        </button>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onClose} style={btnSecondary}>Отмена</button>
          <button onClick={() => {
            const patch = { weeks, title };
            if (isTask) { patch.num = num; patch.desc = desc; patch.color = color; }
            onSave(patch);
          }} style={btnPrimary}>Сохранить</button>
        </div>
      </div>
    </ModalShell>
  );
}

function EditResourceModal({ resource, onClose, onSave, onDelete }) {
  const [name, setName] = useState(resource?.name || "");
  const [color, setColor] = useState(resource?.color || HEADER_COLORS[0]);
  if (!resource) return null;
  return (
    <ModalShell title="Редактировать ресурс" onClose={onClose}>
      <Field label="Имя">
        <input value={name} onChange={e => setName(e.target.value)} style={input} autoFocus />
      </Field>
      <Field label="Цвет шапки">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(10, 1fr)", gap: 6 }}>
          {HEADER_COLORS.map(c => (
            <div key={c} onClick={() => setColor(c)}
              style={{
                height: 32, borderRadius: 4, background: c, cursor: "pointer",
                boxShadow: color === c ? "0 0 0 3px #1E3A5F inset, 0 0 0 2px #fff inset" : "none",
                border: "1px solid #ccc"
              }} />
          ))}
        </div>
      </Field>
      <div style={{ display: "flex", gap: 8, justifyContent: "space-between", marginTop: 20 }}>
        <button onClick={() => { if (confirm("Удалить ресурс со всеми его блоками?")) onDelete(); }} style={{ ...btnSecondary, color: "#c00" }}>
          <Trash2 size={14} /> Удалить
        </button>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onClose} style={btnSecondary}>Отмена</button>
          <button onClick={() => onSave({ name, color })} style={btnPrimary}>Сохранить</button>
        </div>
      </div>
    </ModalShell>
  );
}

function HelpModal({ onClose }) {
  return (
    <ModalShell title="Справка" onClose={onClose}>
      <div style={{ fontSize: 13, lineHeight: 1.6, fontFamily: "Arial" }}>
        <p><b>Работа с блоками</b></p>
        <ul style={{ marginTop: 4, paddingLeft: 20 }}>
          <li>Клик — выделить</li>
          <li>Двойной клик или кнопка «⋮» на блоке — редактирование (название, описание, длительность, цвет)</li>
          <li>Тянуть за кружок внизу — менять длительность, шаг 1 неделя</li>
          <li>Drag & drop — свободное перемещение по вертикали и между колонками со snap к неделям</li>
          <li>Наезд на соседний блок — блоки обмениваются местами</li>
          <li>Наведение на стык двух блоков подсвечивается сплошной рамкой</li>
          <li>ПКМ по блоку — контекстное меню</li>
        </ul>
        <p><b>Горячие клавиши</b></p>
        <ul style={{ marginTop: 4, paddingLeft: 20 }}>
          <li><kbd>Ctrl+Z</kbd> / <kbd>Ctrl+Shift+Z</kbd> — откат / повтор</li>
          <li><kbd>Delete</kbd> — удалить выделенный блок</li>
          <li><kbd>↑</kbd> / <kbd>↓</kbd> — сдвиг блока на 1 неделю</li>
          <li><kbd>Shift+↑</kbd> / <kbd>Shift+↓</kbd> — изменение длительности на ±1 неделю</li>
          <li><kbd>?</kbd> — справка, <kbd>Esc</kbd> — отмена / закрыть</li>
        </ul>
        <p><b>Типы блоков</b></p>
        <ul style={{ marginTop: 4, paddingLeft: 20 }}>
          <li><b>Задача</b> — цветной блок с номером, названием и описанием</li>
          <li><b>Отпуск</b> — зелёный блок с 🌴, только название</li>
          <li><b>Лейбл</b> — прозрачный блок с вертикальным текстом</li>
        </ul>
        <p><b>Сохранение</b></p>
        <ul style={{ marginTop: 4, paddingLeft: 20 }}>
          <li>Автосохранение в браузере после каждого изменения</li>
          <li>«Экспорт» сохраняет JSON-файл, «Импорт» загружает</li>
          <li>«Сброс» восстанавливает исходное состояние из макета</li>
        </ul>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
        <button onClick={onClose} style={btnPrimary}>Понятно</button>
      </div>
    </ModalShell>
  );
}

function ModalShell({ title, onClose, children }) {
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 200 }} />
      <div style={{
        position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
        zIndex: 201, background: "#fff", borderRadius: 10, padding: 24,
        minWidth: 460, maxWidth: 600, maxHeight: "85vh", overflowY: "auto",
        boxShadow: "0 20px 60px rgba(0,0,0,0.3)", fontFamily: "Arial"
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h2 style={{ fontFamily: "Georgia, serif", fontSize: 20, margin: 0, fontWeight: 400 }}>{title}</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 12, color: "#555", marginBottom: 5, fontFamily: "Arial" }}>{label}</div>
      {children}
    </div>
  );
}

const btnPrimary = {
  background: "#1E3A5F", color: "#fff", border: "none", borderRadius: 6,
  padding: "8px 14px", cursor: "pointer", fontSize: 13, fontFamily: "Arial",
  display: "inline-flex", alignItems: "center", gap: 6
};
const btnSecondary = {
  background: "#fff", color: "#333", border: "1px solid #d0d0d0", borderRadius: 6,
  padding: "8px 12px", cursor: "pointer", fontSize: 13, fontFamily: "Arial",
  display: "inline-flex", alignItems: "center", gap: 6
};
const input = {
  width: "100%", padding: "8px 10px", fontSize: 13, fontFamily: "Arial",
  border: "1px solid #d0d0d0", borderRadius: 4, boxSizing: "border-box"
};
const iconBtnOnDark = {
  background: "rgba(255,255,255,0.2)", color: "#fff", border: "none",
  borderRadius: 4, padding: 4, cursor: "pointer", fontSize: 11,
  display: "inline-flex", alignItems: "center", lineHeight: 1
};
const menuItem = {
  display: "block", width: "100%", textAlign: "left", padding: "7px 10px",
  background: "transparent", border: "none", cursor: "pointer",
  fontFamily: "Arial", fontSize: 13, borderRadius: 4
};
