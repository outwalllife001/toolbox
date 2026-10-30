// 手机签名盖到 PDF：PDF.js 显示 → 找「签字 / 日期」位置 → 手写签名（signature_pad）→ pdf-lib 把签名图片盖到原 PDF 上
// 原 PDF 的文字和排版原样保留（只是在页面上多画一张透明 PNG），不是整页截图
import * as pdfjs from '../vendor/pdfjs/pdf.min.mjs';

const V = new URL('../vendor/pdfjs/', import.meta.url).href;
pdfjs.GlobalWorkerOptions.workerSrc = V + 'pdf.worker.min.mjs';
const DOC_OPTS = {
  cMapUrl: V + 'cmaps/', cMapPacked: true, standardFontDataUrl: V + 'standard_fonts/', wasmUrl: V + 'wasm/', iccUrl: V + 'iccs/',
  isEvalSupported: false, enableXfa: false,
};

// ---------- 打开 ----------
// bytes：Uint8Array。PDF.js 会把传进去的缓冲区转给 worker，所以传副本，原件留给导出
// askPassword(reason) 返回密码或 null（null = 放弃）
// 所有文档共用一个 worker（每次 getDocument 默认都新开一个，要重新下载、解析 1.3MB 的 worker 脚本）
let worker = null;
const opts = bytes => ({ data: bytes.slice(), ...DOC_OPTS, worker: worker ||= new pdfjs.PDFWorker() });

export async function openPdf(bytes, askPassword) {
  const task = pdfjs.getDocument(opts(bytes));
  let pw = '';
  task.onPassword = (update, reason) => {
    const p = askPassword(reason);
    if (p == null) task.destroy(); else { pw = p; update(p); }
  };
  const doc = await task.promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    pages.push({ n: i, page, vp, w: vp.width, h: vp.height });
  }
  return { doc, pages, password: pw };
}

// PDF.js 6 的文档对象没有 destroy()，要关它的 loadingTask
export function closeDoc(doc) { if (doc) (doc.loadingTask || doc).destroy?.(); }

let libP = null;
export function loadPdfLib() {
  if (window.PDFLib) return Promise.resolve(window.PDFLib);
  return libP ||= new Promise((ok, bad) => {
    const s = document.createElement('script');
    s.src = new URL('../vendor/pdf-lib/pdf-lib.min.js', import.meta.url).href;
    s.onload = () => ok(window.PDFLib); s.onerror = () => { libP = null; bad(new Error('PDF 组件加载失败，请检查网络')); };
    document.head.appendChild(s);
  });
}

// 照片（合同拍照 / 截图）→ 每张一页的 PDF。宽固定 A4 宽（595pt），高按照片比例
// 先经过 canvas：浏览器会按 EXIF 方向摆正（直接嵌 JPEG 原文件，竖拍的照片会横过来）
export async function imagesToPdf(files) {
  const { PDFDocument } = await loadPdfLib();
  const out = await PDFDocument.create();
  for (const f of files) {
    const bmp = await createImageBitmap(f);
    const k = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
    const c = canvas(Math.round(bmp.width * k), Math.round(bmp.height * k)), g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(bmp, 0, 0, c.width, c.height); bmp.close?.();
    const jpg = await out.embedJpg(await blobBytes(await toBlob(c, 'image/jpeg', 0.9)));
    const W = 595.28, H = W * c.height / c.width;
    out.addPage([W, H]).drawImage(jpg, { x: 0, y: 0, width: W, height: H });
  }
  return out.save();
}

// ---------- 显示 ----------
export async function renderPage(p, cv, cssW, dpr) {
  const scale = cssW * dpr / p.w;
  const vp = p.page.getViewport({ scale });
  cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
  await p.page.render({ canvas: cv, canvasContext: cv.getContext('2d'), viewport: vp }).promise;
}

// ---------- 找签字处 ----------
// 文字版 PDF：同一行的文字拼起来，找「签字 / 签名 / 盖章 / 签章 / 签署」后面紧跟冒号、下划线或行尾的地方（正文里的「双方签字盖章后生效」不算），
// 以及「日期：」。返回位置用页面比例（0–1，按显示方向），扫描件 / 照片没有文字，返回空
const SIGN_RE = /(?:签\s*字|签\s*名|签\s*章|盖\s*章|签\s*署)\s*(?:[)）]\s*)?(?:[:：]|(?=\s*_{2,})|$)/g;
const DATE_RE = /日\s*期\s*[:：]/g;
export async function findSpots(p) {
  const tc = await p.page.getTextContent();
  const vp = p.vp, items = [];
  for (const it of tc.items) {
    if (!it.str || !it.str.trim()) continue;
    // Chrome / Mac 导出的 PDF 常把「方」「日」这类字映射成康熙部首（⽅ U+2F45、⽇ U+2F47），长得一样、编码不同，先还原
    const str = it.str.replace(/[\u2E80-\u2FDF]/g, c => c.normalize('NFKC'));
    const m = pdfjs.Util.transform(vp.transform, it.transform);
    const fs = Math.hypot(m[2], m[3]);            // 字高（显示方向，pt）
    if (m[0] <= 0 || Math.abs(m[1]) > m[0] * 0.2) continue;   // 竖排 / 侧着 / 倒着显示的文字不管
    items.push({ s: str, x: m[4], y: m[5], w: it.width * vp.scale * Math.sign(m[0] || 1), fs });
  }
  // 按基线分行
  items.sort((a, b) => a.y - b.y || a.x - b.x);
  const lines = [];
  for (const it of items) {
    const L = lines.find(l => Math.abs(l.y - it.y) < Math.max(l.fs, it.fs) * 0.45);
    if (L) L.items.push(it); else lines.push({ y: it.y, fs: it.fs, items: [it] });
  }
  const spots = [];
  for (const L of lines) {
    L.items.sort((a, b) => a.x - b.x);
    // 拼成一行文字，记下每个字的右边界
    let text = '', rights = [], starts = [];
    for (const it of L.items) {
      const n = it.s.length;
      for (let i = 0; i < n; i++) { starts.push(it.x + it.w * i / n); rights.push(it.x + it.w * (i + 1) / n); }
      text += it.s;
    }
    let prevEnd = 0;
    const all = [...text.matchAll(SIGN_RE)].map(m => ({ m, kind: 'sign' })).concat([...text.matchAll(DATE_RE)].map(m => ({ m, kind: 'date' })))
      .sort((a, b) => a.m.index - b.m.index);
    for (const { m, kind } of all) {
      const end = m.index + m[0].length;
      if (end <= prevEnd) continue;
      // 标签：从上一个匹配（或行首 / 空格）到冒号
      let from = Math.max(prevEnd, text.lastIndexOf('  ', m.index) + 1);
      const label = text.slice(from, end).replace(/[\s_:：]+/g, ' ').trim().replace(/^[，。；、,.;]+/, '').slice(-14);
      prevEnd = end;
      const x = rights[end - 1] ?? rights[rights.length - 1];
      // 冒号后面紧挨着就有字（2.5 个字宽以内），比如「日期：2026 年 10 月 30 日」，说明填过了；
      // 隔得远的是同一行下一个签字处的标签（「甲方（签字）：　　　乙方（签字）：」），「日期：　年　月　日」这种空模板也不算
      let j = end; while (j < text.length && /[\s_]/.test(text[j])) j++;
      const taken = j < text.length && starts[j] - x < L.fs * 2.5 && !/[年月日]/.test(text[j]);
      spots.push({ kind, taken, label: label || (kind === 'sign' ? '签字处' : '日期'), page: p.n,
        x: x / p.w, y: (L.y - L.fs * 0.35) / p.h, base: L.y / p.h, fs: L.fs / p.h, x0: starts[m.index] / p.w });
    }
  }
  return spots;
}

// ---------- 签名图片 ----------
export function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
export const toBlob = (c, type = 'image/png', q) => new Promise(r => c.toBlob(r, type, q));
export const blobBytes = async b => new Uint8Array(await b.arrayBuffer());

// 裁掉四周透明的部分，留一点边
export function trim(src, pad = 6) {
  const g = src.getContext('2d', { willReadFrequently: true });
  const { width: W, height: H } = src, d = g.getImageData(0, 0, W, H).data;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (d[(y * W + x) * 4 + 3] > 10) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return null;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(W - 1, x1 + pad); y1 = Math.min(H - 1, y1 + pad);
  const c = canvas(x1 - x0 + 1, y1 - y0 + 1);
  c.getContext('2d').drawImage(src, x0, y0, c.width, c.height, 0, 0, c.width, c.height);
  return c;
}

// 纸上签名的照片 → 透明背景的签名：先估计纸张亮度（大范围模糊），比纸暗得多的才算笔迹，阴影、纸纹去掉
export function extractInk(bmp, color) {
  const k = Math.min(1, 1400 / Math.max(bmp.width, bmp.height));
  const W = Math.round(bmp.width * k), H = Math.round(bmp.height * k);
  const c = canvas(W, H), g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(bmp, 0, 0, W, H);
  const img = g.getImageData(0, 0, W, H), d = img.data;
  // 背景：缩到 1/24 再放大（相当于大半径模糊），取亮度
  const s = 24, bw = Math.max(1, Math.round(W / s)), bh = Math.max(1, Math.round(H / s));
  const b = canvas(bw, bh), bg = b.getContext('2d', { willReadFrequently: true });
  bg.filter = 'blur(1px)'; bg.drawImage(c, 0, 0, bw, bh);
  const big = canvas(W, H), gg = big.getContext('2d', { willReadFrequently: true });
  gg.imageSmoothingQuality = 'high'; gg.drawImage(b, 0, 0, W, H);
  const bd = gg.getImageData(0, 0, W, H).data;
  const [r, gr, bl] = hex(color);
  for (let i = 0; i < d.length; i += 4) {
    const L = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const B = Math.max(60, 0.299 * bd[i] + 0.587 * bd[i + 1] + 0.114 * bd[i + 2]);
    const ink = 1 - L / B;                                  // 比纸暗多少
    const a = Math.max(0, Math.min(1, (ink - 0.12) / 0.28));
    d[i] = r; d[i + 1] = gr; d[i + 2] = bl; d[i + 3] = Math.round(a * 255);
  }
  g.putImageData(img, 0, 0);
  return trim(c, 4);
}
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));

// 日期（按楷体画成图片，和签名一样盖上去；PDF 里不用嵌中文字体）
export function dateImage(text, color) {
  const c = canvas(1400, 220), g = c.getContext('2d');
  g.fillStyle = color; g.textBaseline = 'middle';
  g.font = '600 120px "Kaiti SC", STKaiti, KaiTi, "楷体", "Songti SC", serif';
  g.fillText(text, 20, 112);
  return trim(c, 8);
}

// ---------- 导出 ----------
// items：[{ page, x, y, w, h, src(dataURL) }]，位置是页面显示方向上的比例（0–1）
// 正常路径：pdf-lib 打开原文件，在对应页面上画签名，其它内容不动。
// 原文件加了密（或 pdf-lib 解析不了）：退回「每页渲染成图片 + 签名」重新合成，文字不能再选中复制
export async function exportPdf(bytes, pages, items, onProgress = () => {}) {
  const PDFLib = await loadPdfLib();
  const { PDFDocument, degrees } = PDFLib;
  let doc = null, why = '';
  try { doc = await PDFDocument.load(bytes, { updateMetadata: false }); }
  catch (e) { why = /encrypt/i.test(e.message) ? 'encrypted' : 'parse'; }
  const cache = new Map();
  const embed = async (d, src) => {
    if (!cache.has(src)) cache.set(src, await d.embedPng(dataUrlBytes(src)));
    return cache.get(src);
  };
  if (doc) {
    for (const it of items) {
      const p = pages[it.page - 1], vp = p.vp, pg = doc.getPage(it.page - 1);
      const X = it.x * p.w, Y = it.y * p.h, Wd = it.w * p.w, Hd = it.h * p.h;
      const BL = vp.convertToPdfPoint(X, Y + Hd), BR = vp.convertToPdfPoint(X + Wd, Y + Hd), TL = vp.convertToPdfPoint(X, Y);
      const ang = Math.atan2(BR[1] - BL[1], BR[0] - BL[0]) * 180 / Math.PI;
      pg.drawImage(await embed(doc, it.src), {
        x: BL[0], y: BL[1], width: Math.hypot(BR[0] - BL[0], BR[1] - BL[1]), height: Math.hypot(TL[0] - BL[0], TL[1] - BL[1]),
        rotate: degrees(Math.round(ang * 1000) / 1000),
      });
    }
    onProgress(1);
    return { bytes: await doc.save(), mode: 'vector' };
  }
  // 退回：渲染成图片
  const out = await PDFDocument.create();
  for (const p of pages) {
    const c = canvas(1, 1);
    await renderPage(p, c, p.w, 2);          // 144 dpi
    const jpg = await out.embedJpg(await blobBytes(await toBlob(c, 'image/jpeg', 0.88)));
    const pg = out.addPage([p.w, p.h]);
    pg.drawImage(jpg, { x: 0, y: 0, width: p.w, height: p.h });
    for (const it of items.filter(i => i.page === p.n)) {
      pg.drawImage(await embed(out, it.src), { x: it.x * p.w, y: p.h - (it.y + it.h) * p.h, width: it.w * p.w, height: it.h * p.h });
    }
    onProgress(p.n / pages.length);
  }
  return { bytes: await out.save(), mode: 'raster', why };
}

// 签好的一页存成 JPG（发微信用）：原页面按 2 倍渲染，再把签名画上去
export async function pageImage(p, items, scale = 2) {
  const c = canvas(1, 1);
  await renderPage(p, c, p.w, scale);
  const g = c.getContext('2d');
  for (const it of items.filter(i => i.page === p.n)) {
    const im = new Image(); im.src = it.src; await im.decode();
    g.drawImage(im, it.x * c.width, it.y * c.height, it.w * c.width, it.h * c.height);
  }
  return toBlob(c, 'image/jpeg', 0.9);
}

// 打开导出的 PDF，渲染第 n 页（结果预览：看到的就是对方收到的）
export async function previewPage(bytes, n, cv, cssW, dpr) {
  const doc = await pdfjs.getDocument(opts(bytes)).promise;
  const page = await doc.getPage(n), vp = page.getViewport({ scale: 1 });
  await renderPage({ page, w: vp.width }, cv, cssW, dpr);
  closeDoc(doc);
}

export function dataUrlBytes(u) {
  const b = atob(u.slice(u.indexOf(',') + 1)), a = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i);
  return a;
}
