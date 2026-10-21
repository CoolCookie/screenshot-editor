// Screenshot-Editor – alles läuft ausschließlich im Browser.
// Es werden keine Daten an einen Server gesendet und nichts im Browser gespeichert.

import {
  LINE_TYPES, FONT_FAMILY,
  bbox, drawShape, handles, hitTest, moveShape, normalize, normRect, resizeShape, snapAngle, textMetrics,
} from './shapes.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const canvas = $('#canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const viewport = $('#viewport');
const stage = $('#stage');
const emptyEl = $('#empty');
const textEditor = $('#text-editor');
const fileInput = $('#file-input');

// ---------- Konfiguration ----------

const TOOLS = {
  select:    { name: 'Auswählen',     key: 'v', cursor: 'default' },
  rect:      { name: 'Rahmen',        key: 'r', cursor: 'crosshair' },
  ellipse:   { name: 'Ellipse',       key: 'e', cursor: 'crosshair' },
  line:      { name: 'Linie',         key: 'l', cursor: 'crosshair' },
  arrow:     { name: 'Pfeil',         key: 'a', cursor: 'crosshair' },
  freehand:  { name: 'Freihand',      key: 'f', cursor: 'crosshair' },
  text:      { name: 'Text',          key: 't', cursor: 'text' },
  counter:   { name: 'Nummer',        key: 'n', cursor: 'crosshair' },
  highlight: { name: 'Textmarker',    key: 'h', cursor: 'crosshair' },
  pixelate:  { name: 'Verpixeln',     key: 'p', cursor: 'crosshair' },
  blur:      { name: 'Weichzeichnen', key: 'b', cursor: 'crosshair' },
  redact:    { name: 'Schwärzen',     key: 's', cursor: 'crosshair' },
  crop:      { name: 'Zuschneiden',   key: 'c', cursor: 'crosshair' },
};

const PROPS = {
  rect: ['color', 'width', 'fill', 'shadow'],
  ellipse: ['color', 'width', 'fill', 'shadow'],
  line: ['color', 'width', 'shadow'],
  arrow: ['color', 'width', 'shadow'],
  freehand: ['color', 'width', 'shadow'],
  text: ['color', 'fontSize', 'fill'],
  counter: ['color', 'size'],
  highlight: ['color'],
  pixelate: ['strength'],
  blur: ['strength'],
  redact: ['color'],
};

const HINTS = {
  select: 'Element anklicken zum Auswählen und Verschieben · Doppelklick auf Text zum Bearbeiten',
  text: 'Klicken, um Text zu setzen · Enter übernimmt, Umschalt+Enter = neue Zeile',
  counter: 'Klicken, um die nächste Nummer zu setzen',
  pixelate: 'Für Passwörter & Co. ist „Schwärzen“ am sichersten',
  blur: 'Für Passwörter & Co. ist „Schwärzen“ am sichersten',
  crop: 'Bereich aufziehen, dann Enter oder „Anwenden“',
  line: 'Umschalt = 45°-Schritte',
  arrow: 'Umschalt = 45°-Schritte',
  rect: 'Umschalt = Quadrat',
};

const SWATCHES = ['#e53935', '#fb8c00', '#fdd835', '#43a047', '#1e88e5', '#8e24aa', '#000000', '#ffffff'];

const settings = {
  rect:      { color: '#e53935', width: 3, fill: false, fillColor: '#ffffff', shadow: true },
  ellipse:   { color: '#e53935', width: 3, fill: false, fillColor: '#ffffff', shadow: true },
  line:      { color: '#e53935', width: 3, shadow: true },
  arrow:     { color: '#e53935', width: 3, shadow: true },
  freehand:  { color: '#e53935', width: 3, shadow: false },
  text:      { color: '#e53935', fontSize: 20, fill: false, fillColor: '#ffffff' },
  counter:   { color: '#e53935', size: 28 },
  highlight: { color: '#fff176' },
  pixelate:  { strength: 12 },
  blur:      { strength: 10 },
  redact:    { color: '#000000' },
};

const ZOOM_STEPS = [0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8];
const HISTORY_LIMIT = 100;

// ---------- Zustand ----------

const state = {
  base: null,        // Canvas mit dem Originalbild
  shapes: [],
  selectedId: null,
  tool: 'rect',
  scale: 1,          // 1 = ein Bildpixel pro Gerätepixel
  fitMode: true,
  crop: null,
  editingId: null,
};

let nextId = 1;
const undoStack = [];
const redoStack = [];
let drag = null;
let textEdit = null;
let lastPropKey = null;
let lastPropTime = 0;

// ---------- Hilfen ----------

const byId = (id) => state.shapes.find((s) => s.id === id);
const selectedShape = () => (state.selectedId == null ? null : byId(state.selectedId));
const cssScale = () => state.scale / (window.devicePixelRatio || 1);
const tolerance = () => 6 / cssScale();

function isTypingTarget(el) {
  if (!el) return false;
  if (el.tagName === 'TEXTAREA') return true;
  return el.tagName === 'INPUT' && ['text', 'number', 'search'].includes(el.type);
}

function isFormControl(el) {
  return el && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

function toImage(e) {
  const r = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - r.left) * canvas.width / r.width,
    y: (e.clientY - r.top) * canvas.height / r.height,
  };
}

let toastTimer = null;
function toast(msg, kind = 'ok') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, kind === 'error' ? 5000 : 2600);
}

// ---------- Verlauf ----------

function snapshot() {
  return { base: state.base, shapes: structuredClone(state.shapes) };
}

function pushUndo(snap) {
  undoStack.push(snap);
  if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
  redoStack.length = 0;
  lastPropKey = null;
  updateUI();
}

function restore(snap) {
  const baseChanged = snap.base !== state.base;
  state.base = snap.base;
  state.shapes = snap.shapes;
  if (!selectedShape()) state.selectedId = null;
  if (baseChanged) setupCanvas();
  render();
  updateUI();
}

function undo() {
  finishTransient();
  if (!undoStack.length) return;
  redoStack.push(snapshot());
  restore(undoStack.pop());
}

function redo() {
  finishTransient();
  if (!redoStack.length) return;
  undoStack.push(snapshot());
  restore(redoStack.pop());
}

// Zusammenhängende Änderungen (Slider ziehen, Pfeiltasten) bilden einen Undo-Schritt.
function coalescedCheckpoint(key) {
  const now = Date.now();
  if (key !== lastPropKey || now - lastPropTime > 1500) pushUndo(snapshot());
  lastPropKey = key;
  lastPropTime = now;
}

function finishTransient() {
  commitText();
  if (state.crop) cancelCrop();
}

// ---------- Bild laden ----------

async function loadImageFile(file) {
  try {
    const bmp = await createImageBitmap(file);
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    c.getContext('2d').drawImage(bmp, 0, 0);
    bmp.close?.();
    setImage(c);
  } catch {
    toast('Das Bild konnte nicht gelesen werden.', 'error');
  }
}

function setImage(c) {
  finishTransient();
  pushUndo(snapshot());
  state.base = c;
  state.shapes = [];
  state.selectedId = null;
  state.fitMode = true;
  setupCanvas();
  render();
  updateUI();
}

function clearImage() {
  if (!state.base) return;
  if (!confirm('Bild und alle Änderungen verwerfen?')) return;
  finishTransient();
  state.base = null;
  state.shapes = [];
  state.selectedId = null;
  undoStack.length = 0;
  redoStack.length = 0;
  canvas.width = canvas.height = 1;
  updateUI();
}

async function pasteFromClipboardButton() {
  if (!navigator.clipboard?.read) {
    toast('Bitte Strg+V drücken, um einzufügen.');
    return;
  }
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const type = item.types.find((t) => t.startsWith('image/'));
      if (type) {
        await loadImageFile(await item.getType(type));
        return;
      }
    }
    toast('Die Zwischenablage enthält kein Bild.', 'error');
  } catch {
    toast('Kein Zugriff auf die Zwischenablage – bitte Strg+V drücken.', 'error');
  }
}

// ---------- Leinwand & Zoom ----------

function setupCanvas() {
  if (!state.base) return;
  canvas.width = state.base.width;
  canvas.height = state.base.height;
  applyZoom();
}

function fitScale() {
  if (!state.base) return 1;
  const dpr = window.devicePixelRatio || 1;
  const w = viewport.clientWidth - 48;
  const h = viewport.clientHeight - 48;
  return Math.max(0.05, Math.min(1, (w * dpr) / state.base.width, (h * dpr) / state.base.height));
}

function applyZoom() {
  if (!state.base) return;
  if (state.fitMode) state.scale = fitScale();
  const k = cssScale();
  canvas.style.width = `${state.base.width * k}px`;
  canvas.style.height = `${state.base.height * k}px`;
  $('#btn-zoom-fit').textContent = `${Math.round(state.scale * 100)} %`;
  if (textEdit) styleTextEditor();
}

function zoomTo(scale) {
  state.fitMode = false;
  state.scale = Math.min(8, Math.max(0.05, scale));
  applyZoom();
  render();
}

function zoomStep(dir) {
  const cur = state.scale;
  const next = dir > 0
    ? ZOOM_STEPS.find((z) => z > cur + 0.001) ?? ZOOM_STEPS.at(-1)
    : [...ZOOM_STEPS].reverse().find((z) => z < cur - 0.001) ?? ZOOM_STEPS[0];
  zoomTo(next);
}

function zoomFit() {
  state.fitMode = true;
  applyZoom();
  render();
}

// ---------- Rendern ----------

function renderScene(c, skipId = null) {
  c.save();
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalCompositeOperation = 'source-over';
  c.clearRect(0, 0, c.canvas.width, c.canvas.height);
  c.drawImage(state.base, 0, 0);
  for (const s of state.shapes) {
    if (s.id !== skipId) drawShape(c, s);
  }
  c.restore();
}

function drawSelection() {
  const s = selectedShape();
  if (!s || s.id === state.editingId) return;
  const k = 1 / cssScale();
  ctx.save();
  if (!LINE_TYPES.has(s.type)) {
    const b = bbox(s);
    const pad = 4 * k;
    ctx.lineWidth = k;
    ctx.strokeStyle = '#ffffff';
    ctx.strokeRect(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2);
    ctx.setLineDash([4 * k, 3 * k]);
    ctx.strokeStyle = '#1e88e5';
    ctx.strokeRect(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2);
    ctx.setLineDash([]);
  }
  const size = 8 * k;
  ctx.lineWidth = 1.5 * k;
  for (const h of handles(s)) {
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#1e88e5';
    ctx.fillRect(h.x - size / 2, h.y - size / 2, size, size);
    ctx.strokeRect(h.x - size / 2, h.y - size / 2, size, size);
  }
  ctx.restore();
}

function drawCrop() {
  if (!state.crop) return;
  const c = normRect(state.crop);
  const k = 1 / cssScale();
  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.beginPath();
  ctx.rect(0, 0, canvas.width, canvas.height);
  ctx.rect(c.x, c.y, c.w, c.h);
  ctx.fill('evenodd');
  ctx.lineWidth = k;
  ctx.strokeStyle = '#ffffff';
  ctx.setLineDash([6 * k, 4 * k]);
  ctx.strokeRect(c.x, c.y, c.w, c.h);
  ctx.restore();
}

function render() {
  if (!state.base) return;
  renderScene(ctx, state.editingId);
  drawSelection();
  drawCrop();
}

let renderQueued = false;
function requestRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    render();
  });
}

function exportCanvas() {
  const c = document.createElement('canvas');
  c.width = state.base.width;
  c.height = state.base.height;
  renderScene(c.getContext('2d', { willReadFrequently: true }));
  return c;
}

// ---------- Export ----------

async function copyToClipboard() {
  if (!state.base) return;
  finishTransient();
  if (!window.isSecureContext || !navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
    toast('Kopieren in die Zwischenablage erfordert HTTPS. Alternativ „PNG speichern“ nutzen.', 'error');
    return;
  }
  const c = exportCanvas();
  const blob = new Promise((resolve, reject) => {
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG-Erzeugung fehlgeschlagen'))), 'image/png');
  });
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    toast('In die Zwischenablage kopiert – jetzt mit Strg+V einfügen.');
  } catch (err) {
    toast(`Kopieren fehlgeschlagen: ${err.message}`, 'error');
  }
}

function download() {
  if (!state.base) return;
  finishTransient();
  exportCanvas().toBlob((blob) => {
    if (!blob) return;
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const name = `screenshot-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.png`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, 'image/png');
}

// ---------- Auswahl & Werkzeuge ----------

function shapeAt(p, tol) {
  for (let i = state.shapes.length - 1; i >= 0; i--) {
    if (hitTest(state.shapes[i], p.x, p.y, tol)) return state.shapes[i];
  }
  return null;
}

function handleAt(s, p, tol) {
  const r = tol * 1.3;
  return handles(s).find((h) => Math.abs(h.x - p.x) <= r && Math.abs(h.y - p.y) <= r) || null;
}

function select(id) {
  state.selectedId = id;
  updatePanel();
  requestRender();
}

function setTool(tool) {
  if (!TOOLS[tool]) return;
  commitText();
  if (tool !== 'crop' && state.crop) cancelCrop();
  state.tool = tool;
  state.selectedId = null;
  $$('.tool').forEach((b) => b.classList.toggle('active', b.dataset.tool === tool));
  canvas.style.cursor = TOOLS[tool].cursor;
  updatePanel();
  requestRender();
}

function deleteSelected() {
  const s = selectedShape();
  if (!s) return;
  pushUndo(snapshot());
  state.shapes = state.shapes.filter((x) => x !== s);
  select(null);
}

function reorderSelected(toFront) {
  const s = selectedShape();
  if (!s) return;
  pushUndo(snapshot());
  state.shapes = state.shapes.filter((x) => x !== s);
  if (toFront) state.shapes.push(s); else state.shapes.unshift(s);
  requestRender();
}

function nextCounter() {
  return state.shapes.reduce((m, s) => (s.type === 'counter' ? Math.max(m, s.n) : m), 0) + 1;
}

function createShape(tool, p) {
  const s = { id: nextId++, type: tool, ...structuredClone(settings[tool]) };
  if (LINE_TYPES.has(tool)) return Object.assign(s, { x1: p.x, y1: p.y, x2: p.x, y2: p.y });
  if (tool === 'freehand') return Object.assign(s, { points: [[p.x, p.y]] });
  return Object.assign(s, { x: p.x, y: p.y, w: 0, h: 0 });
}

function updateCreate(s, start, p, shift) {
  if (LINE_TYPES.has(s.type)) {
    const q = shift ? snapAngle(s.x1, s.y1, p.x, p.y) : p;
    s.x2 = q.x;
    s.y2 = q.y;
  } else if (s.type === 'freehand') {
    const last = s.points.at(-1);
    if (Math.hypot(p.x - last[0], p.y - last[1]) >= 1.5 / cssScale()) s.points.push([p.x, p.y]);
  } else {
    let w = p.x - start.x;
    let h = p.y - start.y;
    if (shift) {
      const m = Math.max(Math.abs(w), Math.abs(h));
      w = Math.sign(w || 1) * m;
      h = Math.sign(h || 1) * m;
    }
    s.w = w;
    s.h = h;
  }
}

// ---------- Zuschneiden ----------

function applyCrop() {
  if (!state.crop) return;
  const c = normRect(state.crop);
  const x = Math.max(0, Math.round(c.x));
  const y = Math.max(0, Math.round(c.y));
  const w = Math.min(state.base.width, Math.round(c.x + c.w)) - x;
  const h = Math.min(state.base.height, Math.round(c.y + c.h)) - y;
  state.crop = null;
  if (w < 2 || h < 2) {
    updatePanel();
    render();
    return;
  }
  pushUndo(snapshot());
  const nc = document.createElement('canvas');
  nc.width = w;
  nc.height = h;
  nc.getContext('2d').drawImage(state.base, -x, -y);
  state.base = nc;
  for (const s of state.shapes) moveShape(s, structuredClone(s), -x, -y);
  state.fitMode = true;
  setupCanvas();
  render();
  updateUI();
}

function cancelCrop() {
  state.crop = null;
  updatePanel();
  requestRender();
}

// ---------- Text ----------

function startTextEdit(shape, p) {
  const before = snapshot();
  let isNew = false;
  if (!shape) {
    const st = settings.text;
    const pad = Math.round(st.fontSize * 0.3);
    shape = {
      id: nextId++, type: 'text', text: '', ...structuredClone(st),
      x: p.x - pad, y: p.y - (st.fontSize * 1.25) / 2 - pad,
    };
    state.shapes.push(shape);
    isNew = true;
  }
  state.selectedId = shape.id;
  state.editingId = shape.id;
  textEdit = { id: shape.id, isNew, before, original: shape.text };
  textEditor.value = shape.text;
  textEditor.hidden = false;
  styleTextEditor();
  updatePanel();
  render();
  setTimeout(() => {
    textEditor.focus();
    textEditor.select();
  }, 0);
}

function styleTextEditor() {
  const s = byId(textEdit.id);
  if (!s) return;
  const k = cssScale();
  const m = textMetrics({ ...s, text: textEditor.value || ' ' });
  Object.assign(textEditor.style, {
    left: `${s.x * k - 1}px`,
    top: `${s.y * k - 1}px`,
    width: `${Math.max((m.w - m.pad * 2 + s.fontSize) * k, 40)}px`,
    height: `${(m.h - m.pad * 2) * k}px`,
    padding: `${m.pad * k}px`,
    fontSize: `${s.fontSize * k}px`,
    lineHeight: `${m.lh * k}px`,
    fontFamily: FONT_FAMILY,
    color: s.color,
    background: s.fill ? s.fillColor : 'transparent',
  });
}

function commitText(cancel = false) {
  if (!textEdit) return;
  const t = textEdit;
  textEdit = null;
  state.editingId = null;
  textEditor.hidden = true;
  const s = byId(t.id);
  if (s) {
    s.text = cancel ? t.original : textEditor.value.replace(/\s+$/, '');
    if (!s.text.trim()) {
      state.shapes = state.shapes.filter((x) => x !== s);
      state.selectedId = null;
      if (!t.isNew) pushUndo(t.before);
    } else if (t.isNew || s.text !== t.original) {
      pushUndo(t.before);
    }
  }
  updatePanel();
  render();
}

textEditor.addEventListener('input', () => {
  const s = byId(textEdit?.id);
  if (!s) return;
  s.text = textEditor.value;
  styleTextEditor();
});

textEditor.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    commitText();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    commitText(true);
  }
});

textEditor.addEventListener('blur', () => commitText());

// ---------- Zeiger-Interaktion ----------

canvas.addEventListener('pointerdown', (e) => {
  if (!state.base || e.button !== 0) return;
  if (textEdit) {
    commitText();
    return;
  }
  const p = toImage(e);
  const tol = tolerance();
  const before = snapshot();
  const base = { before, start: p, client: { x: e.clientX, y: e.clientY }, moved: false };

  if (state.tool === 'crop') {
    state.crop = { x: p.x, y: p.y, w: 0, h: 0 };
    drag = { ...base, mode: 'crop' };
    canvas.setPointerCapture(e.pointerId);
    return;
  }

  const sel = selectedShape();
  if (sel) {
    const h = handleAt(sel, p, tol);
    if (h) {
      drag = { ...base, mode: 'resize', id: sel.id, handle: h.id, orig: structuredClone(sel) };
      canvas.setPointerCapture(e.pointerId);
      return;
    }
  }

  let hit = null;
  if (state.tool === 'select') hit = shapeAt(p, tol);
  else if (sel && hitTest(sel, p.x, p.y, tol)) hit = sel;
  else if (state.tool === 'text') {
    const t = shapeAt(p, tol);
    if (t?.type === 'text') hit = t;
  }

  if (hit) {
    if (hit.id !== state.selectedId) select(hit.id);
    drag = {
      ...base, mode: 'move', id: hit.id, orig: structuredClone(hit),
      editOnClick: hit.type === 'text' && state.tool === 'text',
    };
    canvas.setPointerCapture(e.pointerId);
    return;
  }

  if (state.tool === 'select') {
    select(null);
    return;
  }
  if (state.tool === 'text') {
    // Erst beim Loslassen öffnen, damit der Mausklick den Fokus nicht wieder wegnimmt.
    e.preventDefault();
    drag = { ...base, mode: 'newtext' };
    canvas.setPointerCapture(e.pointerId);
    return;
  }
  if (state.tool === 'counter') {
    const s = { id: nextId++, type: 'counter', ...structuredClone(settings.counter), x: p.x, y: p.y, n: nextCounter() };
    state.shapes.push(s);
    pushUndo(before);
    select(s.id);
    return;
  }

  const s = createShape(state.tool, p);
  state.shapes.push(s);
  state.selectedId = s.id;
  drag = { ...base, mode: 'create', id: s.id };
  canvas.setPointerCapture(e.pointerId);
  requestRender();
});

canvas.addEventListener('pointermove', (e) => {
  if (!state.base) return;
  const p = toImage(e);
  if (!drag) {
    updateCursor(p);
    return;
  }
  if (Math.hypot(e.clientX - drag.client.x, e.clientY - drag.client.y) >= 3) drag.moved = true;
  if (!drag.moved) return;
  const s = byId(drag.id);
  switch (drag.mode) {
    case 'create': updateCreate(s, drag.start, p, e.shiftKey); break;
    case 'move': moveShape(s, drag.orig, p.x - drag.start.x, p.y - drag.start.y); break;
    case 'resize': resizeShape(s, drag.orig, drag.handle, p, e.shiftKey); break;
    case 'crop': state.crop = { x: drag.start.x, y: drag.start.y, w: p.x - drag.start.x, h: p.y - drag.start.y }; break;
  }
  requestRender();
});

function endDrag(e) {
  if (!drag) return;
  const d = drag;
  drag = null;
  if (canvas.hasPointerCapture?.(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  const s = byId(d.id);

  if (d.mode === 'create') {
    if (!d.moved) {
      // Einfacher Klick mit Zeichenwerkzeug: vorhandenes Element auswählen.
      state.shapes = state.shapes.filter((x) => x !== s);
      const hit = shapeAt(d.start, tolerance());
      select(hit ? hit.id : null);
    } else {
      normalize(s);
      pushUndo(d.before);
    }
  } else if (d.mode === 'move' || d.mode === 'resize') {
    if (d.moved) {
      normalize(s);
      pushUndo(d.before);
    } else if (d.editOnClick) {
      startTextEdit(s);
    }
  } else if (d.mode === 'crop') {
    if (!d.moved) state.crop = null;
    else state.crop = normRect(state.crop);
  } else if (d.mode === 'newtext') {
    startTextEdit(null, d.start);
    return;
  }
  updatePanel();
  requestRender();
}

canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

canvas.addEventListener('dblclick', (e) => {
  if (!state.base || state.tool === 'crop') return;
  const hit = shapeAt(toImage(e), tolerance());
  if (hit?.type === 'text') startTextEdit(hit);
});

function updateCursor(p) {
  let cursor = TOOLS[state.tool].cursor;
  if (state.tool !== 'crop') {
    const tol = tolerance();
    const sel = selectedShape();
    const h = sel && handleAt(sel, p, tol);
    if (h) cursor = h.cursor;
    else if (sel && hitTest(sel, p.x, p.y, tol)) cursor = 'move';
    else if (state.tool === 'select' && shapeAt(p, tol)) cursor = 'move';
  }
  canvas.style.cursor = cursor;
}

// ---------- Eigenschaften-Leiste ----------

function panelTarget() {
  const s = selectedShape();
  if (s) return { type: s.type, obj: s, isShape: true };
  return { type: state.tool, obj: settings[state.tool] || {}, isShape: false };
}

function updatePanel() {
  const t = panelTarget();
  const props = PROPS[t.type] || [];
  $('#props-title').textContent = TOOLS[t.type].name + (t.isShape ? ' (ausgewählt)' : '');
  $$('.prop').forEach((el) => { el.hidden = !props.includes(el.dataset.prop); });

  const o = t.obj;
  if (o.color) $('#p-color').value = o.color;
  for (const key of ['width', 'fontSize', 'size', 'strength']) {
    if (o[key] != null) {
      $(`#p-${key}`).value = o[key];
      $(`#o-${key}`).textContent = o[key];
    }
  }
  if (o.fill != null) $('#p-fill').checked = o.fill;
  if (o.fillColor) $('#p-fillColor').value = o.fillColor;
  if (o.shadow != null) $('#p-shadow').checked = o.shadow;
  $('#l-strength').textContent = t.type === 'pixelate' ? 'Blockgröße' : 'Radius';
  $('#l-color').textContent = t.type === 'highlight' ? 'Markerfarbe' : 'Farbe';

  const hint = HINTS[t.isShape ? '' : t.type] || '';
  $('#props-hint').textContent = hint;
  $('#props-hint').hidden = !hint;

  $('#shape-actions').hidden = !t.isShape;
  $('#crop-actions').hidden = !(state.tool === 'crop' && state.crop);
}

function applyProp(key, value) {
  const t = panelTarget();
  if (!PROPS[t.type]) return;
  if (t.isShape) {
    coalescedCheckpoint(`${t.obj.id}:${key}`);
    t.obj[key] = value;
  }
  if (settings[t.type]) settings[t.type][key] = value;
  const out = $(`#o-${key}`);
  if (out) out.textContent = value;
  if (key === 'fillColor' && !t.obj.fill) {
    t.obj.fill = true;
    if (settings[t.type]) settings[t.type].fill = true;
    $('#p-fill').checked = true;
  }
  requestRender();
}

for (const key of ['color', 'fillColor']) {
  $(`#p-${key}`).addEventListener('input', (e) => applyProp(key, e.target.value));
}
for (const key of ['width', 'fontSize', 'size', 'strength']) {
  $(`#p-${key}`).addEventListener('input', (e) => applyProp(key, Number(e.target.value)));
}
for (const key of ['fill', 'shadow']) {
  $(`#p-${key}`).addEventListener('change', (e) => applyProp(key, e.target.checked));
}

const swatchBox = $('#swatches');
for (const c of SWATCHES) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'swatch';
  b.title = c;
  b.style.background = c;
  b.addEventListener('click', () => {
    $('#p-color').value = c;
    applyProp('color', c);
  });
  swatchBox.appendChild(b);
}

// ---------- UI-Status ----------

function updateUI() {
  const has = !!state.base;
  emptyEl.hidden = has;
  stage.hidden = !has;
  for (const id of ['#btn-copy', '#btn-download', '#btn-clear', '#btn-zoom-in', '#btn-zoom-out', '#btn-zoom-fit', '#btn-zoom-100']) {
    $(id).disabled = !has;
  }
  $('#btn-undo').disabled = !undoStack.length;
  $('#btn-redo').disabled = !redoStack.length;
  $('#status-size').textContent = has ? `${state.base.width} × ${state.base.height} px` : 'Kein Bild';
  updatePanel();
}

// ---------- Ereignisse ----------

document.addEventListener('paste', (e) => {
  if (isTypingTarget(e.target)) return;
  const items = e.clipboardData?.items || [];
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      const f = item.getAsFile();
      if (f) {
        e.preventDefault();
        loadImageFile(f);
        return;
      }
    }
  }
  const files = e.clipboardData?.files || [];
  for (const f of files) {
    if (f.type.startsWith('image/')) {
      e.preventDefault();
      loadImageFile(f);
      return;
    }
  }
  toast('Die Zwischenablage enthält kein Bild.', 'error');
});

document.addEventListener('keydown', (e) => {
  if (isTypingTarget(e.target)) return;
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();

  if (mod) {
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
    else if (k === 'c' && state.base && !window.getSelection()?.toString()) { e.preventDefault(); copyToClipboard(); }
    else if (k === 's') { e.preventDefault(); download(); }
    else if (k === 'o') { e.preventDefault(); fileInput.click(); }
    else if (k === '0') { e.preventDefault(); zoomFit(); }
    else if (k === '+' || k === '=') { e.preventDefault(); zoomStep(1); }
    else if (k === '-') { e.preventDefault(); zoomStep(-1); }
    return;
  }
  if (isFormControl(e.target) || e.altKey) return;
  if ($('#dlg-info').open) return;

  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (selectedShape()) { e.preventDefault(); deleteSelected(); }
  } else if (e.key === 'Escape') {
    if (state.crop) cancelCrop(); else select(null);
  } else if (e.key === 'Enter') {
    if (state.crop) { e.preventDefault(); applyCrop(); }
  } else if (e.key.startsWith('Arrow')) {
    const s = selectedShape();
    if (!s) return;
    e.preventDefault();
    const step = e.shiftKey ? 10 : 1;
    const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
    const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
    coalescedCheckpoint(`${s.id}:move`);
    moveShape(s, structuredClone(s), dx, dy);
    requestRender();
  } else {
    const tool = Object.keys(TOOLS).find((t) => TOOLS[t].key === k);
    if (tool && state.base) setTool(tool);
  }
});

viewport.addEventListener('wheel', (e) => {
  if (!state.base || !(e.ctrlKey || e.metaKey)) return;
  e.preventDefault();
  zoomStep(e.deltaY < 0 ? 1 : -1);
}, { passive: false });

viewport.addEventListener('dragover', (e) => {
  e.preventDefault();
  viewport.classList.add('dragging');
});
viewport.addEventListener('dragleave', () => viewport.classList.remove('dragging'));
viewport.addEventListener('drop', (e) => {
  e.preventDefault();
  viewport.classList.remove('dragging');
  const f = [...(e.dataTransfer?.files || [])].find((x) => x.type.startsWith('image/'));
  if (f) loadImageFile(f);
  else toast('Bitte eine Bilddatei ablegen.', 'error');
});

fileInput.addEventListener('change', () => {
  const f = fileInput.files?.[0];
  if (f) loadImageFile(f);
  fileInput.value = '';
});

window.addEventListener('resize', () => {
  if (state.fitMode) {
    applyZoom();
    render();
  }
});

$$('.tool').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));
$('#btn-open').addEventListener('click', () => fileInput.click());
$('#btn-open-empty').addEventListener('click', () => fileInput.click());
$('#btn-paste-empty').addEventListener('click', pasteFromClipboardButton);
$('#btn-clear').addEventListener('click', clearImage);
$('#btn-undo').addEventListener('click', undo);
$('#btn-redo').addEventListener('click', redo);
$('#btn-zoom-in').addEventListener('click', () => zoomStep(1));
$('#btn-zoom-out').addEventListener('click', () => zoomStep(-1));
$('#btn-zoom-fit').addEventListener('click', zoomFit);
$('#btn-zoom-100').addEventListener('click', () => zoomTo(1));
$('#btn-copy').addEventListener('click', copyToClipboard);
$('#btn-download').addEventListener('click', download);
$('#btn-delete').addEventListener('click', deleteSelected);
$('#btn-front').addEventListener('click', () => reorderSelected(true));
$('#btn-back').addEventListener('click', () => reorderSelected(false));
$('#btn-crop-apply').addEventListener('click', applyCrop);
$('#btn-crop-cancel').addEventListener('click', cancelCrop);
$('#btn-info').addEventListener('click', () => $('#dlg-info').showModal());
$('#btn-info-close').addEventListener('click', () => $('#dlg-info').close());

if (!window.isSecureContext) {
  $('#insecure-warning').hidden = false;
}

setTool('rect');
updateUI();
