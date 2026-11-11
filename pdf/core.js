// PDF 合并 · 压缩：PDF.js 出缩略图 → pdf-lib 按页的顺序、方向拼成一个 PDF → Hyper Compress（BentoPDF 的压缩引擎，WASM，在 worker.js 里跑）压缩
// 文件只在浏览器里处理，没有任何上传
// 本目录的代码以 AGPL-3.0 发布（见同目录 LICENSE.md）
import * as pdfjs from '../vendor/pdfjs/pdf.min.mjs';

const V = new URL('../vendor/pdfjs/', import.meta.url).href;
pdfjs.GlobalWorkerOptions.workerSrc = V + 'pdf.worker.min.mjs';
const DOC_OPTS = {
  cMapUrl: V + 'cmaps/', cMapPacked: true, standardFontDataUrl: V + 'standard_fonts/', wasmUrl: V + 'wasm/', iccUrl: V + 'iccs/',
  isEvalSupported: false, enableXfa: false,
};
// 所有文档共用一个 PDF.js worker（每次 getDocument 默认都新开一个，要重新下载、解析 1.3MB 的脚本）
let pjsWorker = null;
const docOpts = bytes => ({ data: bytes.slice(), ...DOC_OPTS, worker: pjsWorker ||= new pdfjs.PDFWorker() });

export const A4 = [595.28, 841.89];
export const isPdf = f => /pdf/i.test(f.type) || /\.pdf$/i.test(f.name);
export const isImage = f => /^image\//.test(f.type) || /\.(jpe?g|png|webp|gif|bmp)$/i.test(f.name);

// ---------- 打开 ----------
// PDF：返回 { kind:'pdf', doc, pages:[{w,h}] }（w/h 是按页面自带的方向显示时的尺寸，pt）
// askPassword(reason) → 密码或 null（null = 放弃）
export async function openPdf(bytes, askPassword) {
  const task = pdfjs.getDocument(docOpts(bytes));
  let password = '';
  task.onPassword = (update, reason) => {
    const p = askPassword(reason);
    if (p == null) task.destroy(); else { password = p; update(p); }
  };
  const doc = await task.promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    pages.push({ page, w: vp.width, h: vp.height });
  }
  return { doc, pages, password };
}
export function closeDoc(doc) { if (doc) (doc.loadingTask || doc).destroy?.(); }

// 图片：浏览器按 EXIF 方向摆正后的尺寸
export async function openImage(file) {
  const bmp = await createImageBitmap(file);
  const r = { bmp, w: bmp.width, h: bmp.height };
  return r;
}

// ---------- 缩略图 ----------
export async function renderPdfThumb(pg, cv, cssW, dpr) {
  const scale = cssW * dpr / pg.w;
  const vp = pg.page.getViewport({ scale });
  cv.width = Math.max(1, Math.round(vp.width)); cv.height = Math.max(1, Math.round(vp.height));
  const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
  await pg.page.render({ canvas: cv, canvasContext: g, viewport: vp }).promise;
}
export function renderImageThumb(img, cv, cssW, dpr) {
  const k = cssW * dpr / img.w;
  cv.width = Math.max(1, Math.round(img.w * k)); cv.height = Math.max(1, Math.round(img.h * k));
  const g = cv.getContext('2d'); g.imageSmoothingQuality = 'high';
  g.drawImage(img.bmp, 0, 0, cv.width, cv.height);
}

// 预览导出的 PDF 的某一页（看到的就是对方收到的）
export async function previewPage(bytes, n, cv, cssW, dpr) {
  const task = pdfjs.getDocument(docOpts(bytes));
  try {
    const doc = await task.promise;
    const page = await doc.getPage(Math.min(n, doc.numPages));
    const vp1 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: cssW * dpr / vp1.width });
    cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
    const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
    await page.render({ canvas: cv, canvasContext: g, viewport: vp }).promise;
    return doc.numPages;
  } finally { task.destroy(); }
}

// ---------- pdf-lib ----------
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

// JPEG 的 EXIF 方向（1 = 正常；读不到也当 1）
export function jpegOrientation(b) {
  if (b[0] !== 0xFF || b[1] !== 0xD8) return 0;
  let i = 2;
  while (i + 4 < b.length && b[i] === 0xFF) {
    const m = b[i + 1], len = (b[i + 2] << 8) | b[i + 3];
    if (m === 0xE1 && b[i + 4] === 0x45 && b[i + 5] === 0x78 && b[i + 6] === 0x69 && b[i + 7] === 0x66) {
      const t = i + 10, le = b[t] === 0x49;
      const u16 = o => le ? b[t + o] | (b[t + o + 1] << 8) : (b[t + o] << 8) | b[t + o + 1];
      const u32 = o => le ? (u16(o) | (u16(o + 2) << 16)) >>> 0 : ((u16(o) << 16) | u16(o + 2)) >>> 0;
      const ifd = u32(4), n = u16(ifd);
      for (let k = 0; k < n; k++) { const e = ifd + 2 + k * 12; if (u16(e) === 0x0112) return u16(e + 8); }
      return 1;
    }
    if (m === 0xDA) break;
    i += 2 + len;
  }
  return 1;
}

// 图片 → 嵌进 PDF 的数据。JPEG / PNG 方向正常、不太大就原样嵌（不重新压缩，画质一点不损失）；
// 其他（带旋转标记的手机照片、WebP、超大图）经过 canvas：浏览器会按 EXIF 摆正
const MAX_SIDE = 5000;
async function imageForPdf(out, file, img) {
  const b = new Uint8Array(await file.arrayBuffer());
  const big = Math.max(img.w, img.h) > MAX_SIDE;
  if (!big && /jpe?g/i.test(file.type || file.name) && jpegOrientation(b) <= 1) return out.embedJpg(b);
  if (!big && /png/i.test(file.type || file.name)) return out.embedPng(b);
  const k = Math.min(1, MAX_SIDE / Math.max(img.w, img.h));
  const c = new OffscreenCanvas(Math.round(img.w * k), Math.round(img.h * k)), g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(img.bmp, 0, 0, c.width, c.height);
  const blob = await c.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
  return out.embedJpg(new Uint8Array(await blob.arrayBuffer()));
}

// pages：[{ file, idx, rot }]，按这个顺序拼。file = { kind, bytes, file, img, lib }
// 照片放在 A4 上（照片横的就横放 A4），四周留 5mm
export async function buildPdf(pages, onStep = () => {}) {
  const { PDFDocument, degrees } = await loadPdfLib();
  const out = await PDFDocument.create();
  // 同一个文件要的页一次拷完（分开拷，字体等共用的资源会重复好几份）
  const copied = new Map();
  for (const f of new Set(pages.map(p => p.file))) {
    if (f.kind !== 'pdf') continue;
    f.lib ||= await PDFDocument.load(f.plain || f.bytes, { updateMetadata: false });
    const idxs = pages.filter(p => p.file === f).map(p => p.idx);
    const got = await out.copyPages(f.lib, idxs);
    idxs.forEach((ix, k) => copied.set(f.id + ':' + ix, got[k]));
  }
  const M = 5 / 25.4 * 72;
  let n = 0;
  for (const p of pages) {
    onStep(++n, pages.length);
    if (p.file.kind === 'pdf') {
      const pg = copied.get(p.file.id + ':' + p.idx);
      if (p.rot) pg.setRotation(degrees((pg.getRotation().angle + p.rot) % 360));
      out.addPage(pg);
    } else {
      const f = p.file;
      f.emb ||= await imageForPdf(out, f.file, f.img);
      const land = f.img.w > f.img.h;
      const [W, H] = land ? [A4[1], A4[0]] : A4;
      const k = Math.min((W - 2 * M) / f.img.w, (H - 2 * M) / f.img.h);
      const w = f.img.w * k, h = f.img.h * k;
      const pg = out.addPage([W, H]);
      pg.drawImage(f.emb, { x: (W - w) / 2, y: (H - h) / 2, width: w, height: h });
      if (p.rot) pg.setRotation(degrees(p.rot));
    }
    if (n % 20 === 0) await new Promise(r => setTimeout(r));
  }
  for (const f of new Set(pages.map(p => p.file))) f.emb = null;   // 嵌入对象属于这一份 out，下次重新嵌
  out.setProducer('开源宝藏工具箱 · PDF 合并压缩（pdf-lib）');
  return out.save({ useObjectStreams: true });
}

// 加了密码（或者禁止编辑）的 PDF，pdf-lib 拷不了页：先用压缩引擎无损解密一遍
export async function isEncrypted(bytes) {
  const { PDFDocument } = await loadPdfLib();
  try { await PDFDocument.load(bytes, { updateMetadata: false }); return false; }
  catch (e) { if (/encrypt/i.test(e.name + e.message)) return true; throw e; }
}

// ---------- 压缩（worker.js） ----------
let worker = null, seq = 0;
const jobs = new Map();
function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = e => {
    const m = e.data, j = jobs.get(m.id);
    if (!j) return;
    if (m.type === 'step') j.onStep(m);
    else { jobs.delete(m.id); m.type === 'error' ? j.bad(Object.assign(new Error(m.message), { code: m.code })) : j.ok(m); }
  };
  worker.onerror = e => { for (const j of jobs.values()) j.bad(new Error('压缩组件加载失败：' + (e.message || '请检查网络'))); jobs.clear(); worker = null; };
  return worker;
}
// 提前把 7MB 的引擎下载、编译好（选了文件就开始，点按钮时不用等）
export function warmup() { return call({ type: 'warmup' }); }
function call(msg, transfer = [], onStep = () => {}) {
  const id = ++seq;
  return new Promise((ok, bad) => { jobs.set(id, { ok, bad, onStep }); getWorker().postMessage({ ...msg, id }, transfer); });
}
// level：'hq' | 'std' | 'min' | { target: 字节数 }
export function compress(bytes, level, onStep) {
  const b = bytes.slice();
  return call({ type: 'compress', bytes: b, level }, [b.buffer], onStep);
}
export function decrypt(bytes, password) {
  const b = bytes.slice();
  return call({ type: 'decrypt', bytes: b, password }, [b.buffer]);
}

// 大小按 1000 进制显示（和手机文件管理器、「指定大小」的算法一致）
export const fmtSize = n => n < 1e6 ? `${Math.max(1, Math.round(n / 1e3))}KB` : `${(n / 1e6).toFixed(n < 1e7 ? 1 : 0)}MB`;
