// Geometrie, Zeichnen und Treffertests der Annotationen.
// Alle Koordinaten sind Bildpixel (native Auflösung des Screenshots).

export const FONT_FAMILY = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
const LINE_HEIGHT = 1.25;

export const BOX_TYPES = new Set(['rect', 'ellipse', 'highlight', 'pixelate', 'blur', 'redact']);
export const LINE_TYPES = new Set(['line', 'arrow']);

const measureCtx = document.createElement('canvas').getContext('2d');

// ---------- Hilfsfunktionen ----------

export function normRect(r) {
  return {
    x: Math.min(r.x, r.x + r.w),
    y: Math.min(r.y, r.y + r.h),
    w: Math.abs(r.w),
    h: Math.abs(r.h),
  };
}

export function normalize(s) {
  if (BOX_TYPES.has(s.type)) Object.assign(s, normRect(s));
  return s;
}

export function textFont(s) {
  return `${s.fontSize}px ${FONT_FAMILY}`;
}

export function textMetrics(s) {
  measureCtx.font = textFont(s);
  const lines = String(s.text ?? '').split('\n');
  const lh = s.fontSize * LINE_HEIGHT;
  const pad = Math.round(s.fontSize * 0.3);
  let w = 0;
  for (const l of lines) w = Math.max(w, measureCtx.measureText(l).width);
  return { lines, lh, pad, w: Math.ceil(w) + pad * 2, h: Math.ceil(lines.length * lh) + pad * 2 };
}

export function bbox(s) {
  switch (s.type) {
    case 'line':
    case 'arrow':
      return {
        x: Math.min(s.x1, s.x2), y: Math.min(s.y1, s.y2),
        w: Math.abs(s.x2 - s.x1), h: Math.abs(s.y2 - s.y1),
      };
    case 'freehand': {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [x, y] of s.points) {
        x0 = Math.min(x0, x); y0 = Math.min(y0, y);
        x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      }
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    case 'text': {
      const m = textMetrics(s);
      return { x: s.x, y: s.y, w: m.w, h: m.h };
    }
    case 'counter': {
      const r = s.size / 2;
      return { x: s.x - r, y: s.y - r, w: s.size, h: s.size };
    }
    default:
      return normRect(s);
  }
}

export function snapAngle(x0, y0, x, y) {
  const len = Math.hypot(x - x0, y - y0);
  const step = Math.PI / 4;
  const a = Math.round(Math.atan2(y - y0, x - x0) / step) * step;
  return { x: x0 + Math.cos(a) * len, y: y0 + Math.sin(a) * len };
}

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - x1) * dx + (py - y1) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function contrastColor(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) > 160 ? '#000000' : '#ffffff';
}

// ---------- Treffertest & Griffe ----------

export function hitTest(s, px, py, tol) {
  switch (s.type) {
    case 'rect':
    case 'ellipse': {
      const b = normRect(s);
      const t = tol + s.width / 2;
      if (px < b.x - t || px > b.x + b.w + t || py < b.y - t || py > b.y + b.h + t) return false;
      if (s.fill) return true;
      if (s.type === 'rect') {
        const inner = px > b.x + t && px < b.x + b.w - t && py > b.y + t && py < b.y + b.h - t;
        return !inner;
      }
      const rx = b.w / 2, ry = b.h / 2;
      if (rx < t || ry < t) return true;
      const d = Math.hypot((px - b.x - rx) / rx, (py - b.y - ry) / ry);
      return Math.abs(d - 1) * Math.min(rx, ry) <= t;
    }
    case 'line':
    case 'arrow':
      return distToSegment(px, py, s.x1, s.y1, s.x2, s.y2) <= tol + s.width / 2;
    case 'freehand': {
      const t = tol + s.width / 2;
      const pts = s.points;
      if (pts.length === 1) return Math.hypot(px - pts[0][0], py - pts[0][1]) <= t;
      for (let i = 1; i < pts.length; i++) {
        if (distToSegment(px, py, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]) <= t) return true;
      }
      return false;
    }
    default: {
      const b = bbox(s);
      return px >= b.x - tol && px <= b.x + b.w + tol && py >= b.y - tol && py <= b.y + b.h + tol;
    }
  }
}

const HANDLE_CURSORS = {
  nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize',
  n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize',
  p1: 'crosshair', p2: 'crosshair',
};

export function handles(s) {
  if (LINE_TYPES.has(s.type)) {
    return [
      { id: 'p1', x: s.x1, y: s.y1, cursor: HANDLE_CURSORS.p1 },
      { id: 'p2', x: s.x2, y: s.y2, cursor: HANDLE_CURSORS.p2 },
    ];
  }
  if (!BOX_TYPES.has(s.type)) return [];
  const { x, y, w, h } = normRect(s);
  const pts = {
    nw: [x, y], n: [x + w / 2, y], ne: [x + w, y], e: [x + w, y + h / 2],
    se: [x + w, y + h], s: [x + w / 2, y + h], sw: [x, y + h], w: [x, y + h / 2],
  };
  return Object.entries(pts).map(([id, [hx, hy]]) => ({ id, x: hx, y: hy, cursor: HANDLE_CURSORS[id] }));
}

export function moveShape(s, o, dx, dy) {
  if (LINE_TYPES.has(s.type)) {
    s.x1 = o.x1 + dx; s.y1 = o.y1 + dy;
    s.x2 = o.x2 + dx; s.y2 = o.y2 + dy;
  } else if (s.type === 'freehand') {
    s.points = o.points.map(([x, y]) => [x + dx, y + dy]);
  } else {
    s.x = o.x + dx; s.y = o.y + dy;
  }
}

export function resizeShape(s, o, handle, p, shift) {
  if (LINE_TYPES.has(s.type)) {
    if (handle === 'p1') {
      const q = shift ? snapAngle(o.x2, o.y2, p.x, p.y) : p;
      s.x1 = q.x; s.y1 = q.y;
    } else {
      const q = shift ? snapAngle(o.x1, o.y1, p.x, p.y) : p;
      s.x2 = q.x; s.y2 = q.y;
    }
    return;
  }
  const b = normRect(o);
  let l = b.x, t = b.y, r = b.x + b.w, bt = b.y + b.h;
  if (handle.includes('w')) l = p.x;
  if (handle.includes('e')) r = p.x;
  if (handle.includes('n')) t = p.y;
  if (handle.includes('s')) bt = p.y;
  s.x = l; s.y = t; s.w = r - l; s.h = bt - t;
}

// ---------- Effekte (Unkenntlichmachen) ----------

function clipToCanvas(c, b) {
  const x = Math.max(0, Math.floor(b.x));
  const y = Math.max(0, Math.floor(b.y));
  const x2 = Math.min(c.width, Math.ceil(b.x + b.w));
  const y2 = Math.min(c.height, Math.ceil(b.y + b.h));
  if (x2 - x < 1 || y2 - y < 1) return null;
  return { x, y, w: x2 - x, h: y2 - y };
}

function pixelate(ctx, b, size) {
  const r = clipToCanvas(ctx.canvas, b);
  if (!r) return;
  const img = ctx.getImageData(r.x, r.y, r.w, r.h);
  const d = img.data;
  size = Math.max(2, Math.round(size));
  for (let by = 0; by < r.h; by += size) {
    const bh = Math.min(size, r.h - by);
    for (let bx = 0; bx < r.w; bx += size) {
      const bw = Math.min(size, r.w - bx);
      let R = 0, G = 0, B = 0, A = 0;
      for (let y = by; y < by + bh; y++) {
        let i = (y * r.w + bx) * 4;
        for (let x = 0; x < bw; x++, i += 4) {
          R += d[i]; G += d[i + 1]; B += d[i + 2]; A += d[i + 3];
        }
      }
      const n = bw * bh;
      R /= n; G /= n; B /= n; A /= n;
      for (let y = by; y < by + bh; y++) {
        let i = (y * r.w + bx) * 4;
        for (let x = 0; x < bw; x++, i += 4) {
          d[i] = R; d[i + 1] = G; d[i + 2] = B; d[i + 3] = A;
        }
      }
    }
  }
  ctx.putImageData(img, r.x, r.y);
}

// Box-Blur (3 Durchgänge ≈ Gauß), läuft in jedem Browser identisch.
function boxPass(src, dst, w, h, r, horizontal) {
  const div = r * 2 + 1;
  const outer = horizontal ? h : w;
  const inner = horizontal ? w : h;
  const step = horizontal ? 4 : w * 4;
  for (let o = 0; o < outer; o++) {
    const start = horizontal ? o * w * 4 : o * 4;
    for (let c = 0; c < 4; c++) {
      let sum = 0;
      for (let k = -r; k <= r; k++) {
        const idx = Math.min(inner - 1, Math.max(0, k));
        sum += src[start + idx * step + c];
      }
      for (let i = 0; i < inner; i++) {
        dst[start + i * step + c] = sum / div;
        const add = Math.min(inner - 1, i + r + 1);
        const rem = Math.max(0, i - r);
        sum += src[start + add * step + c] - src[start + rem * step + c];
      }
    }
  }
}

function blur(ctx, b, radius) {
  const r = clipToCanvas(ctx.canvas, b);
  if (!r) return;
  const img = ctx.getImageData(r.x, r.y, r.w, r.h);
  const rad = Math.max(1, Math.round(radius));
  const tmp = new Uint8ClampedArray(img.data.length);
  for (let i = 0; i < 3; i++) {
    boxPass(img.data, tmp, r.w, r.h, rad, true);
    boxPass(tmp, img.data, r.w, r.h, rad, false);
  }
  ctx.putImageData(img, r.x, r.y);
}

// ---------- Zeichnen ----------

function applyShadow(ctx, s) {
  const w = s.width || 2;
  ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
  ctx.shadowBlur = Math.max(3, w * 1.5);
  ctx.shadowOffsetX = ctx.shadowOffsetY = Math.max(1, w * 0.6);
}

function clearShadow(ctx) {
  ctx.shadowColor = 'transparent';
}

export function drawShape(ctx, s) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (s.shadow) applyShadow(ctx, s);

  switch (s.type) {
    case 'rect': {
      const b = normRect(s);
      if (s.fill) {
        ctx.fillStyle = s.fillColor;
        ctx.fillRect(b.x, b.y, b.w, b.h);
        clearShadow(ctx);
      }
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.width;
      ctx.lineJoin = 'miter';
      ctx.strokeRect(b.x, b.y, b.w, b.h);
      break;
    }
    case 'ellipse': {
      const b = normRect(s);
      ctx.beginPath();
      ctx.ellipse(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, b.h / 2, 0, 0, Math.PI * 2);
      if (s.fill) {
        ctx.fillStyle = s.fillColor;
        ctx.fill();
        clearShadow(ctx);
      }
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.width;
      ctx.stroke();
      break;
    }
    case 'line': {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.width;
      ctx.beginPath();
      ctx.moveTo(s.x1, s.y1);
      ctx.lineTo(s.x2, s.y2);
      ctx.stroke();
      break;
    }
    case 'arrow': {
      const ang = Math.atan2(s.y2 - s.y1, s.x2 - s.x1);
      const len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
      const head = Math.min(Math.max(12, s.width * 4), len);
      const spread = 0.45;
      ctx.strokeStyle = s.color;
      ctx.fillStyle = s.color;
      ctx.lineWidth = s.width;
      ctx.beginPath();
      ctx.moveTo(s.x1, s.y1);
      ctx.lineTo(s.x2 - Math.cos(ang) * head * 0.6, s.y2 - Math.sin(ang) * head * 0.6);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(s.x2, s.y2);
      ctx.lineTo(s.x2 - head * Math.cos(ang - spread), s.y2 - head * Math.sin(ang - spread));
      ctx.lineTo(s.x2 - head * Math.cos(ang + spread), s.y2 - head * Math.sin(ang + spread));
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'freehand': {
      const pts = s.points;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.width;
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      if (pts.length === 1) ctx.lineTo(pts[0][0] + 0.01, pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.stroke();
      break;
    }
    case 'text': {
      const m = textMetrics(s);
      if (s.fill) {
        ctx.fillStyle = s.fillColor;
        ctx.fillRect(s.x, s.y, m.w, m.h);
      }
      ctx.font = textFont(s);
      ctx.fillStyle = s.color;
      ctx.textBaseline = 'middle';
      m.lines.forEach((line, i) => {
        ctx.fillText(line, s.x + m.pad, s.y + m.pad + i * m.lh + m.lh / 2);
      });
      break;
    }
    case 'counter': {
      const r = s.size / 2;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      ctx.fillStyle = s.color;
      ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
      ctx.shadowBlur = Math.max(2, s.size * 0.12);
      ctx.shadowOffsetX = ctx.shadowOffsetY = Math.max(1, s.size * 0.04);
      ctx.fill();
      clearShadow(ctx);
      ctx.lineWidth = Math.max(1.5, s.size * 0.07);
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
      ctx.fillStyle = contrastColor(s.color);
      ctx.font = `bold ${Math.round(s.size * 0.55)}px ${FONT_FAMILY}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(s.n), s.x, s.y + s.size * 0.03);
      break;
    }
    case 'highlight': {
      const b = normRect(s);
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = s.color;
      ctx.fillRect(b.x, b.y, b.w, b.h);
      break;
    }
    case 'redact': {
      const b = normRect(s);
      ctx.fillStyle = s.color;
      ctx.fillRect(b.x, b.y, b.w, b.h);
      break;
    }
    case 'pixelate':
      pixelate(ctx, normRect(s), s.strength);
      break;
    case 'blur':
      blur(ctx, normRect(s), s.strength);
      break;
  }
  ctx.restore();
}
