// 字帖排版和绘制：A4 竖版，单位毫米；预览和导出 PDF 用同一个 drawPage（所见即所得）
// 字形来自 hanzi-writer-data 的笔画轮廓（文鼎楷体），坐标系 1024×1024：左上角 (0, 900)，右下角 (1024, -124)

export const PAGE = { w: 210, h: 297, margin: 15, top: 12, bottom: 12, head: 14 };
export const COLS = 10;                                  // 每行 10 格，格子 18mm
const CELL = (PAGE.w - PAGE.margin * 2) / COLS;
const STRIP = CELL / 2, STRIP_COLS = COLS * 2;            // 笔顺分解：半格大小，每行 20 格
const PY = 8;                                             // 拼音四线三格高度
const GAP = 1.5, BLOCK_GAP = 5;

const INK = '#141a26', TRACE = '#c3c6cc', NEW = '#e5484d', GRID = '#e06a6a', GRID_SOFT = '#efaaaa', PY_LINE = '#9fb3d9';

const stripRows = it => Math.ceil(it.data.strokes.length / STRIP_COLS);
export function blockHeight(it, o) {
  return (o.order ? stripRows(it) * STRIP + GAP : 0) + o.rows * ((o.pinyin ? PY : 0) + CELL) + (o.rows - 1) * GAP + BLOCK_GAP;
}

// 分页：每页从标题下面开始往下排，放不下就换页
export function paginate(items, o) {
  const pages = [];
  let cur = null, y = 0;
  const top = PAGE.top + PAGE.head, bottom = PAGE.h - PAGE.bottom;
  for (const it of items) {
    const h = blockHeight(it, o);
    if (!cur || y + h - BLOCK_GAP > bottom) { cur = []; pages.push(cur); y = top; }
    cur.push({ it, y });
    y += h;
  }
  return pages.length ? pages : [[]];
}

const paths = new WeakMap();
const strokePaths = data => {
  let p = paths.get(data);
  if (!p) { p = data.strokes.map(s => new Path2D(s)); paths.set(data, p); }
  return p;
};

// 在 (x, y) 起、边长 size 的方框里画字；color(i) 返回第 i 笔的颜色（null = 不画）
export function drawChar(g, data, x, y, size, color) {
  const ps = strokePaths(data), pad = size * 0.04, s = (size - pad * 2) / 1024;
  g.save();
  g.translate(x + pad, y + pad);
  g.scale(s, -s);
  g.translate(0, -900);
  ps.forEach((p, i) => { const c = color(i); if (c) { g.fillStyle = c; g.fill(p); } });
  g.restore();
}

export function gridCell(g, x, y, size, kind, mm, soft) {
  g.save();
  g.strokeStyle = soft ? GRID_SOFT : GRID;
  g.lineWidth = (soft ? 0.18 : 0.32) * mm;
  g.strokeRect(x, y, size, size);
  if (kind !== 'fang') {
    g.lineWidth = 0.16 * mm;
    g.setLineDash([0.9 * mm, 0.7 * mm]);
    g.beginPath();
    g.moveTo(x + size / 2, y); g.lineTo(x + size / 2, y + size);
    g.moveTo(x, y + size / 2); g.lineTo(x + size, y + size / 2);
    if (kind === 'mi') { g.moveTo(x, y); g.lineTo(x + size, y + size); g.moveTo(x + size, y); g.lineTo(x, y + size); }
    g.stroke();
  }
  g.restore();
}

// 四线三格：中间一格放小写字母的 x 高度
function pinyinCell(g, x, y, w, mm) {
  g.save();
  g.strokeStyle = PY_LINE;
  g.lineWidth = 0.14 * mm;
  for (let i = 0; i < 4; i++) {
    const yy = y + (PY * i / 3) * mm;
    if (i === 2) { g.setLineDash([]); g.strokeStyle = '#e8a0a0'; } else { g.strokeStyle = PY_LINE; }
    g.beginPath(); g.moveTo(x, yy); g.lineTo(x + w, yy); g.stroke();
  }
  g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + PY * mm); g.moveTo(x + w, y); g.lineTo(x + w, y + PY * mm); g.stroke();
  g.restore();
}
function pinyinText(g, text, x, y, w, mm, color) {
  if (!text) return;
  const band = PY / 3 * mm;
  let fs = band / 0.53;                                    // Helvetica / Arial 的 x 高度约 0.52em
  g.save();
  g.fillStyle = color;
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  const font = s => `500 ${s}px "Helvetica Neue", Helvetica, Arial, "PingFang SC", sans-serif`;
  g.font = font(fs);
  const tw = g.measureText(text).width;
  if (tw > w * 0.92) { fs *= w * 0.92 / tw; g.font = font(fs); }
  g.fillText(text, x + w / 2, y + band * 2);
  g.restore();
}

// 一页。g 的单位是像素，mm = 每毫米多少像素
export function drawPage(g, page, o, mm, pageNo = 1, pageCount = 1) {
  const W = PAGE.w * mm, H = PAGE.h * mm, X = PAGE.margin * mm;
  g.save();
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
  // 标题 + 姓名日期
  g.fillStyle = INK;
  g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  g.font = `700 ${6.2 * mm}px "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif`;
  g.fillText(o.title || '生字练习', W / 2, (PAGE.top + 5.5) * mm);
  g.font = `400 ${3.3 * mm}px "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif`;
  g.fillStyle = '#5b6474';
  g.textAlign = 'left';
  g.fillText('姓名＿＿＿＿＿＿　日期＿＿＿＿＿＿', X, (PAGE.top + 11) * mm);
  g.textAlign = 'right';
  if (pageCount > 1) g.fillText(`第 ${pageNo} / ${pageCount} 页`, W - X, (PAGE.top + 11) * mm);
  for (const { it, y } of page) drawBlock(g, it, y * mm, o, mm);
  g.restore();
}

function drawBlock(g, it, y, o, mm) {
  const X = PAGE.margin * mm, cell = CELL * mm, n = it.data.strokes.length;
  if (o.order) {
    const sc = STRIP * mm;
    for (let k = 0; k < n; k++) {
      const r = Math.floor(k / STRIP_COLS), c = k % STRIP_COLS, x = X + c * sc, yy = y + r * sc;
      gridCell(g, x, yy, sc, o.grid, mm, true);
      drawChar(g, it.data, x, yy, sc, i => i < k ? INK : i === k ? NEW : null);
    }
    y += stripRows(it) * sc + GAP * mm;
  }
  const trace = Math.min(o.trace, COLS - 1);
  for (let r = 0; r < o.rows; r++) {
    if (o.pinyin) {
      const ph = PY * mm;
      for (let c = 0; c < COLS; c++) {
        pinyinCell(g, X + c * cell, y, cell, mm);
        if (r === 0 && c <= trace) pinyinText(g, it.pinyin, X + c * cell, y, cell, mm, c === 0 ? INK : TRACE);
      }
      y += ph;
    }
    for (let c = 0; c < COLS; c++) {
      const x = X + c * cell;
      gridCell(g, x, y, cell, o.grid, mm, false);
      const col = r === 0 && c === 0 ? INK : (r === 0 && c <= trace) || (o.trace >= COLS && c > 0) ? TRACE : null;
      if (col) drawChar(g, it.data, x, y, cell, () => col);
    }
    y += cell + GAP * mm;
  }
}

// 每一页画到 300dpi 的画布上，转 JPEG，拼成 PDF
export async function makePdf(pages, o, onProgress) {
  const mm = 300 / 25.4, c = document.createElement('canvas');
  c.width = Math.round(PAGE.w * mm); c.height = Math.round(PAGE.h * mm);
  const g = c.getContext('2d'), jpegs = [];
  for (let i = 0; i < pages.length; i++) {
    drawPage(g, pages[i], o, mm, i + 1, pages.length);
    const b = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
    jpegs.push({ bytes: new Uint8Array(await b.arrayBuffer()), w: c.width, h: c.height });
    onProgress && onProgress((i + 1) / pages.length);
    await new Promise(r => setTimeout(r, 0));
  }
  c.width = c.height = 1;
  return buildPdf(jpegs);
}

// 最小的 PDF：每页一张 JPEG，铺满 A4（同 site/scan）
function buildPdf(jpegs) {
  const enc = new TextEncoder(), chunks = [], offsets = [];
  let pos = 0;
  const put = x => { const b = typeof x === 'string' ? enc.encode(x) : x; chunks.push(b); pos += b.length; };
  const obj = (id, body, stream) => {
    offsets[id] = pos;
    put(`${id} 0 obj\n${body}\n`);
    if (stream) { put('stream\n'); put(stream); put('\nendstream\n'); }
    put('endobj\n');
  };
  put('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const n = jpegs.length, kids = [];
  for (let i = 0; i < n; i++) kids.push(`${3 + i * 3} 0 R`);
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Count ${n} /Kids [${kids.join(' ')}] >>`);
  const PW = 595.28, PH = 841.89;
  jpegs.forEach(({ bytes, w, h }, i) => {
    const pid = 3 + i * 3, cid = pid + 1, iid = pid + 2;
    const content = enc.encode(`q ${PW} 0 0 ${PH} 0 0 cm /Im0 Do Q`);
    obj(pid, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources << /XObject << /Im0 ${iid} 0 R >> >> /Contents ${cid} 0 R >>`);
    obj(cid, `<< /Length ${content.length} >>`, content);
    obj(iid, `<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${bytes.length} >>`, bytes);
  });
  const xref = pos, total = 3 + n * 3;
  let x = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let i = 1; i < total; i++) x += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  put(x + `trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(chunks, { type: 'application/pdf' });
}
