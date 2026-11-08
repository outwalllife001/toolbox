// 照片变涂色画：浏览器端移植 informative-drawings（MIT，CVPR 2022）的 anime_style 生成器
// https://github.com/carolineec/informative-drawings  model.py Generator + test.py
// 流程：缩到 side（细节档）→ Worker 里跑模型出灰度线稿 → （可选）IS-Net 蒙版去背景 → 放大到工作尺寸 → 阈值 + 去小碎点 → 模糊，
//       之后「线条粗细」只是对模糊结果换阈值（不重算，拖滑块是实时的）→ 导出 A4 PDF / 图片；手指涂色在一半分辨率的网格上做
const BASE = new URL('..', import.meta.url).href;
export const LINE_MODEL = BASE + 'models/line_art_anime_fp16w.onnx';
export const MASK_MODEL = BASE + 'models/isnet_general_int8w.onnx';
export const SIDES = { low: 512, mid: 768, high: 1024 };   // 细节：少 / 中 / 多 = 喂给模型的最长边。喂得越小，线越简单、相对越粗
export const WORK = 2048;      // 工作尺寸的最长边：印到 A4 上约 175dpi
const INK_THR = 0.28;          // 墨量低于它的灰线不要（模型会画一些很淡的线，打印出来脏）
const MIN_SPECK = 12;          // 小于这个面积（模型输出的像素）的独立小点不要
const MASK_S = 640;            // 去背景的输入边长（64 的倍数）

export const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const ctx2d = (c, o) => c.getContext('2d', { willReadFrequently: true, ...o });
const toWhite = c => { const g = ctx2d(c); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); return g; };

// 'webgpu' | 'wasm'。软件模拟的 WebGPU（SwiftShader / fallback adapter）比 CPU 还慢很多，当成没有
export const softGpu = a => !a || a.info?.isFallbackAdapter || /swiftshader/i.test(a.info?.architecture || '') || /swiftshader/i.test(a.info?.description || '');
export async function pickBackend() {
  try { return navigator.gpu && !softGpu(await navigator.gpu.requestAdapter()) ? 'webgpu' : 'wasm'; } catch { return 'wasm'; }
}

let worker = null, seq = 0;
const jobs = new Map();
function call(msg, transfer = []) {
  return new Promise((ok, fail) => { const id = msg.id ?? ++seq; jobs.set(id, { ok, fail }); worker.postMessage({ ...msg, id }, transfer); });
}

async function fetchWithProgress(url, onP) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('模型下载失败：' + r.status);
  // GitHub Pages 会 gzip：content-length 是压缩后的长度，只能拿来估进度，不能按它预分配
  const total = +r.headers.get('content-length') || 0;
  if (!r.body) return new Uint8Array(await r.arrayBuffer());
  const chunks = [], rd = r.body.getReader(); let got = 0;
  for (;;) {
    const { done, value } = await rd.read();
    if (done) break;
    chunks.push(value); got += value.length;
    if (total) onP(Math.min(0.99, got / total));
  }
  const out = new Uint8Array(got); let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

export let backend = '';
export const threads = () => (self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1);
// 下载线稿模型 → 起 Worker。WebGPU 建不起来就退回 CPU
export async function load(want, onProgress = () => {}) {
  if (worker) return backend;
  const buf = await fetchWithProgress(LINE_MODEL, onProgress);
  const start = async be => {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      const j = jobs.get(data.id); if (!j) return;
      jobs.delete(data.id);
      if (data.type === 'error') j.fail(new Error(data.message)); else j.ok(data);
    };
    worker.onerror = e => { for (const [k, j] of jobs) { jobs.delete(k); j.fail(new Error(e.message || '推理线程出错')); } };
    await call({ type: 'init', id: 'init', buf: buf.slice().buffer, backend: be, threads: threads(), base: BASE });
    return (backend = be);
  };
  if (want === 'webgpu') {
    try { return await start('webgpu'); } catch (e) { console.warn('WebGPU 不可用，改用 CPU：', e.message); worker.terminate(); worker = null; jobs.clear(); }
  }
  return start('wasm');
}

// 模型用的高宽：最长边 side，都是 4 的倍数
export function modelSize(w0, h0, side) {
  const k = side / Math.max(w0, h0);
  return { w: Math.max(32, Math.round(w0 * k / 4) * 4), h: Math.max(32, Math.round(h0 * k / 4) * 4) };
}
export function workSize(w0, h0) {
  const k = WORK / Math.max(w0, h0);
  return { W: Math.round(w0 * k), H: Math.round(h0 * k) };
}
const rgbaOf = (img, w, h) => {
  const c = canvas(w, h), g = ctx2d(c); g.imageSmoothingQuality = 'high';
  g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);   // 透明 PNG 铺白底
  g.drawImage(img, 0, 0, w, h);
  return g.getImageData(0, 0, w, h).data;
};

// 跑模型：{gray, w, h, ms}（gray 255 是白）
export async function lineart(img, side) {
  const { w, h } = modelSize(img.naturalWidth || img.width, img.naturalHeight || img.height, side);
  const rgba = rgbaOf(img, w, h);
  const r = await call({ type: 'lines', rgba, w, h }, [rgba.buffer]);
  return { gray: r.gray, w, h, ms: r.ms };
}

// 去背景蒙版：{alpha, S}（S×S，255 是主体）。第一次调用要下载约 40MB 模型
let maskLoaded = false;
export async function subjectMask(img, onProgress = () => {}) {
  if (!maskLoaded) {
    const buf = await fetchWithProgress(MASK_MODEL, onProgress);
    await call({ type: 'maskInit', buf: buf.buffer }, [buf.buffer]);
    maskLoaded = true;
  }
  const rgba = rgbaOf(img, MASK_S, MASK_S);
  const r = await call({ type: 'mask', rgba, S: MASK_S }, [rgba.buffer]);
  return { alpha: cleanMask(r.alpha, MASK_S), S: MASK_S, ms: r.ms };
}

// 蒙版清理：去掉面积小于最大块 2% 的误识别，再往外扩一点（别把贴着主体边缘的外轮廓切断）
function cleanMask(alpha, S) {
  const N = S * S, bin = new Uint8Array(N), lab = new Int32Array(N), stack = new Int32Array(N), sizes = [0];
  for (let i = 0; i < N; i++) bin[i] = alpha[i] > 90 ? 1 : 0;
  for (let s = 0; s < N; s++) {
    if (!bin[s] || lab[s]) continue;
    const id = sizes.length; let sp = 0, size = 0; lab[s] = id; stack[sp++] = s;
    while (sp) {
      const i = stack[--sp], x = i % S; size++;
      if (x > 0 && bin[i - 1] && !lab[i - 1]) { lab[i - 1] = id; stack[sp++] = i - 1; }
      if (x < S - 1 && bin[i + 1] && !lab[i + 1]) { lab[i + 1] = id; stack[sp++] = i + 1; }
      if (i >= S && bin[i - S] && !lab[i - S]) { lab[i - S] = id; stack[sp++] = i - S; }
      if (i < N - S && bin[i + S] && !lab[i + S]) { lab[i + S] = id; stack[sp++] = i + S; }
    }
    sizes.push(size);
  }
  const big = Math.max(0, ...sizes.slice(1));
  const keep = new Uint8Array(N);
  for (let i = 0; i < N; i++) keep[i] = lab[i] && sizes[lab[i]] >= big * 0.02 ? 1 : 0;
  // 方形膨胀 r 像素：先按行、再按列
  const r = 4, tmp = new Uint8Array(N), out = new Uint8ClampedArray(N);
  for (let y = 0; y < S; y++) {
    const row = y * S; let last = -1e9;
    for (let x = 0; x < S; x++) { if (keep[row + x]) last = x; tmp[row + x] = x - last <= r ? 1 : 0; }
    last = 1e9;
    for (let x = S - 1; x >= 0; x--) { if (keep[row + x]) last = x; if (last - x <= r) tmp[row + x] = 1; }
  }
  for (let x = 0; x < S; x++) {
    let last = -1e9;
    for (let y = 0; y < S; y++) { if (tmp[y * S + x]) last = y; out[y * S + x] = y - last <= r ? 255 : 0; }
    last = 1e9;
    for (let y = S - 1; y >= 0; y--) { if (tmp[y * S + x]) last = y; if (last - y <= r) out[y * S + x] = 255; }
  }
  return out;
}

// 灰度线稿 + 蒙版 → 工作尺寸的「模糊后的墨量」soft（Uint8，255 是纯墨）
export function soften(line, mask, W, H) {
  const { gray, w, h } = line;
  // 1. 去背景：墨量 × 蒙版（蒙版边缘从 0 到 1 过渡一小段）。白色 = 没有线
  const lo = new ImageData(w, h), d = lo.data;
  let mk = null;
  if (mask) {
    const mc = canvas(mask.S, mask.S), mi = new ImageData(mask.S, mask.S);
    for (let i = 0; i < mask.S * mask.S; i++) { mi.data[i * 4] = mask.alpha[i]; mi.data[i * 4 + 3] = 255; }
    ctx2d(mc).putImageData(mi, 0, 0);
    const m2 = canvas(w, h), mg = ctx2d(m2); mg.imageSmoothingQuality = 'high'; mg.drawImage(mc, 0, 0, w, h);
    mk = mg.getImageData(0, 0, w, h).data;
  }
  for (let i = 0; i < w * h; i++) {
    let v = gray[i];
    if (mk) { const m = Math.min(1, Math.max(0, (mk[i * 4] / 255 - 0.35) / 0.3)); v = 255 - (255 - v) * m; }
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255;
  }
  // 2. 放大到工作尺寸（浏览器的高质量缩放），二值化
  const lc = canvas(w, h); ctx2d(lc).putImageData(lo, 0, 0);
  const big = canvas(W, H), bg = ctx2d(big); bg.imageSmoothingQuality = 'high'; bg.drawImage(lc, 0, 0, W, H);
  const px = bg.getImageData(0, 0, W, H).data, N = W * H, bin = new Uint8Array(N), thr = 255 * (1 - INK_THR);
  for (let i = 0; i < N; i++) bin[i] = px[i * 4] < thr ? 1 : 0;
  // 3. 去小碎点：8 连通，面积小于 MIN_SPECK 个模型像素（换算到工作尺寸）的连通块抹掉
  removeSpecks(bin, W, H, MIN_SPECK * (W / w) * (H / h));
  // 4. 模糊（两遍盒式）：平滑放大带来的锯齿；之后换阈值就是变粗变细
  return boxBlur(bin, W, H, Math.max(2, Math.round(4 * Math.max(W, H) / WORK)));
}

function removeSpecks(bin, W, H, minArea) {
  const N = W * H, seen = new Uint8Array(N), stack = new Int32Array(N);
  for (let s = 0; s < N; s++) {
    if (!bin[s] || seen[s]) continue;
    let sp = 0, top = 0; seen[s] = 1; stack[sp++] = s;
    // stack 同时当访问列表：top 之前都处理过，sp 是总数
    while (top < sp) {
      const i = stack[top++], x = i % W, y = (i - x) / W;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
        const k = Y * W + X; if (bin[k] && !seen[k]) { seen[k] = 1; stack[sp++] = k; }
      }
    }
    if (sp < minArea) for (let j = 0; j < sp; j++) bin[stack[j]] = 0;
  }
}

function boxBlur(bin, W, H, r) {
  const N = W * H, a = new Float32Array(N), b = new Float32Array(N), n = 2 * r + 1;
  for (let i = 0; i < N; i++) a[i] = bin[i] * 255;
  const hPass = (src, dst) => {
    for (let y = 0; y < H; y++) {
      const row = y * W; let s = 0;
      for (let x = -r; x <= r; x++) s += src[row + Math.min(W - 1, Math.max(0, x))];
      for (let x = 0; x < W; x++) {
        dst[row + x] = s / n;
        s += src[row + Math.min(W - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
      }
    }
  };
  const vPass = (src, dst) => {
    for (let x = 0; x < W; x++) {
      let s = 0;
      for (let y = -r; y <= r; y++) s += src[Math.min(H - 1, Math.max(0, y)) * W + x];
      for (let y = 0; y < H; y++) {
        dst[y * W + x] = s / n;
        s += src[Math.min(H - 1, y + r + 1) * W + x] - src[Math.max(0, y - r) * W + x];
      }
    }
  };
  hPass(a, b); vPass(b, a); hPass(a, b); vPass(b, a);
  const out = new Uint8Array(N);
  for (let i = 0; i < N; i++) out[i] = a[i];
  return out;
}

// 粗细档（1 细 … 5 粗，可以是小数）→ 阈值。阈值越低，线越粗
export const threshOf = level => { const T = [0.46, 0.34, 0.25, 0.17, 0.10]; const i = Math.max(0, Math.min(3.999, level - 1)), f = i - Math.floor(i); return T[Math.floor(i)] * (1 - f) + T[Math.floor(i) + 1] * f; };

// 把 soft 按阈值画到 canvas 上（黑线白底，边缘带抗锯齿）
export function drawLines(c, soft, W, H, level) {
  if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
  const t = threshOf(level) * 255, w = 0.1 * 255 * Math.max(0.5, threshOf(level) / 0.25);
  const lut = new Uint32Array(256);
  for (let v = 0; v < 256; v++) {
    const a = Math.min(1, Math.max(0, (v - t) / w + 0.5)), g = Math.round(255 * (1 - a));
    lut[v] = (255 << 24 | g << 16 | g << 8 | g) >>> 0;
  }
  const img = new ImageData(W, H), o = new Uint32Array(img.data.buffer), n = W * H;
  for (let i = 0; i < n; i++) o[i] = lut[soft[i]];
  c.getContext('2d', { alpha: false }).putImageData(img, 0, 0);
  return (t / 255);
}

// 二值图的方形膨胀 / 腐蚀（按行、按列各一遍滑动窗口）。闭运算 = 膨胀 r 再腐蚀 r，能补上宽不到 2r 的缺口
const CLOSE_R = 4;   // 涂色网格的像素（工作尺寸的一半）：补 8 格以内的断线
function morph(src, w, h, r, dilate) {
  const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h), hit = dilate ? 1 : 0;
  // 窗口里有没有 hit：前缀和
  const pass = (get, set, n, m) => {
    const pre = new Int32Array(n + 1);
    for (let j = 0; j < m; j++) {
      for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + (get(j, i) === hit ? 1 : 0);
      for (let i = 0; i < n; i++) { const a = Math.max(0, i - r), b = Math.min(n, i + r + 1); set(j, i, pre[b] - pre[a] > 0 ? hit : 1 - hit); }
    }
  };
  pass((y, x) => src[y * w + x], (y, x, v) => { tmp[y * w + x] = v; }, w, h);
  pass((x, y) => tmp[y * w + x], (x, y, v) => { out[y * w + x] = v; }, h, w);
  return out;
}
// 图像边界外当成「不是线」：腐蚀时边上的线不会被吃掉
function closeMask(m, w, h, r) { return r > 0 ? morph(morph(m, w, h, r, true), w, h, r, false) : m; }

// ---------- 手指涂色：网格是工作尺寸的一半，比较快。每一笔由很多「圆点」组成，
// 圆点只从手指的位置往外填、碰到线就停（局部洪水填充），所以颜色不会跨过线；线上的像素染上颜色，不留白边 ----------
export class Painter {
  constructor(soft, W, H, level, target) {
    this.w = Math.ceil(W / 2); this.h = Math.ceil(H / 2); this.target = target;
    target.width = this.w; target.height = this.h;
    this.g = target.getContext('2d');
    this.px = new Uint8ClampedArray(this.w * this.h * 4);
    this.stamp = new Int32Array(this.w * this.h); this.dab_ = 0;
    this.stack = new Int32Array(this.w * this.h);
    this.undoes = []; this.before = null; this.box = null;
    this.setLines(soft, W, H, level);
  }
  setLines(soft, W, H, level) {
    const t = threshOf(level) * 255 + 6, wall = new Uint8Array(this.w * this.h);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (soft[y * W + x] > t) wall[(y >> 1) * this.w + (x >> 1)] = 1;
    // 闭运算（先膨胀再腐蚀）：线条之间的小缺口（AI 画的线常常断一小截）当成连着的，颜色不从缺口漏出去；线本身不变粗
    this.wall = closeMask(wall, this.w, this.h, CLOSE_R);
  }
  // 从 (x, y) 开始、半径 r、不穿线地涂一个点；color = [r,g,b]，null 是橡皮
  dab(cx, cy, r, color) {
    const { w, h, wall, stamp, stack, px } = this;
    cx = Math.round(cx); cy = Math.round(cy);
    if (cx < 0 || cy < 0 || cx >= w || cy >= h) return;
    let s = cy * w + cx;
    if (wall[s]) {   // 手指正好压在线上：就近找一个不是线的点开始
      let found = -1;
      for (let d = 1; d <= 6 && found < 0; d++) for (let a = 0; a < 8; a++) {
        const X = cx + Math.round(d * Math.cos(a * 0.785)), Y = cy + Math.round(d * Math.sin(a * 0.785));
        if (X >= 0 && Y >= 0 && X < w && Y < h && !wall[Y * w + X]) { found = Y * w + X; break; }
      }
      if (found < 0) return;
      s = found;
    }
    const id = ++this.dab_, R2 = r * r;
    let x0 = cx, x1 = cx, y0 = cy, y1 = cy, sp = 0;
    const put = i => {
      const o = i * 4;
      if (color) { px[o] = color[0]; px[o + 1] = color[1]; px[o + 2] = color[2]; px[o + 3] = 255; } else { px[o + 3] = 0; }
    };
    stamp[s] = id; stack[sp++] = s;
    while (sp) {
      const i = stack[--sp], x = i % w, y = (i - x) / w;
      put(i);
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let k = 0; k < 4; k++) {
        const X = x + (k === 0 ? -1 : k === 1 ? 1 : 0), Y = y + (k === 2 ? -1 : k === 3 ? 1 : 0);
        if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
        const j = Y * w + X;
        if (stamp[j] === id || (X - cx) * (X - cx) + (Y - cy) * (Y - cy) > R2) continue;
        stamp[j] = id;
        if (wall[j]) put(j); else stack[sp++] = j;   // 线上的像素染色但不再往外走
      }
    }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    this.g.putImageData(new ImageData(px, w, h), 0, 0, x0, y0, bw, bh);
    if (this.box) { const b = this.box; b[0] = Math.min(b[0], x0); b[1] = Math.min(b[1], y0); b[2] = Math.max(b[2], x1); b[3] = Math.max(b[3], y1); }
  }
  begin() { this.before = this.px.slice(); this.box = [1e9, 1e9, -1, -1]; }
  end() {
    if (!this.box || this.box[2] < 0) { this.before = null; this.box = null; return; }
    const [x0, y0, x1, y1] = this.box, bw = x1 - x0 + 1, bh = y1 - y0 + 1, data = new Uint8ClampedArray(bw * bh * 4);
    for (let y = 0; y < bh; y++) data.set(this.before.subarray(((y0 + y) * this.w + x0) * 4, ((y0 + y) * this.w + x0 + bw) * 4), y * bw * 4);
    this.undoes.push({ x0, y0, bw, bh, data });
    if (this.undoes.length > 30) this.undoes.shift();
    this.before = null; this.box = null;
  }
  undo() {
    const u = this.undoes.pop(); if (!u) return false;
    for (let y = 0; y < u.bh; y++) this.px.set(u.data.subarray(y * u.bw * 4, (y + 1) * u.bw * 4), ((u.y0 + y) * this.w + u.x0) * 4);
    this.g.putImageData(new ImageData(this.px, this.w, this.h), 0, 0, u.x0, u.y0, u.bw, u.bh);
    return true;
  }
  clear() { this.px.fill(0); this.undoes = []; this.g.clearRect(0, 0, this.w, this.h); }
  // 成品：白底 + 颜色 + 线（正片叠底）
  flatten(lineCanvas) {
    const W = lineCanvas.width, H = lineCanvas.height, c = canvas(W, H), g = c.getContext('2d', { alpha: false });
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
    g.imageSmoothingQuality = 'high'; g.drawImage(this.target, 0, 0, W, H);
    g.globalCompositeOperation = 'multiply'; g.drawImage(lineCanvas, 0, 0);
    return c;
  }
}

// ---------- 导出 ----------
export const toBlob = (c, type = 'image/png', q) => new Promise((ok, no) => c.toBlob(b => (b ? ok(b) : no(new Error('导出图片失败'))), type, q));
let libp = null;
export function loadPdfLib() {
  return (libp ||= new Promise((ok, no) => {
    if (window.PDFLib) return ok(window.PDFLib);
    const s = document.createElement('script');
    s.src = BASE + 'vendor/pdf-lib/pdf-lib.min.js';
    s.onload = () => ok(window.PDFLib); s.onerror = () => { libp = null; no(new Error('PDF 组件下载失败，请检查网络')); };
    document.head.appendChild(s);
  }));
}
// 每张图一页 A4（横图就横放），四周留 8mm 白边。pages: [Blob(png)]
export async function makePdf(pages, title = '涂色画') {
  const { PDFDocument } = await loadPdfLib();
  const doc = await PDFDocument.create();
  doc.setTitle(title); doc.setProducer('开源宝藏工具箱'); doc.setCreator('开源宝藏工具箱');
  const A4 = [595.28, 841.89], M = 22.7;
  for (const b of pages) {
    const im = await doc.embedPng(new Uint8Array(await b.arrayBuffer()));
    const land = im.width > im.height, PW = land ? A4[1] : A4[0], PH = land ? A4[0] : A4[1];
    const k = Math.min((PW - 2 * M) / im.width, (PH - 2 * M) / im.height), w = im.width * k, h = im.height * k;
    doc.addPage([PW, PH]).drawImage(im, { x: (PW - w) / 2, y: (PH - h) / 2, width: w, height: h });
  }
  return doc.save();
}
