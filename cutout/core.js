// AI 抠图核心：浏览器端移植自 rembg (MIT) 的 isnet-general-use 流程
// https://github.com/danielgatis/rembg  rembg/sessions/dis_general_use.py + rembg/bg.py
// 流程：缩到 1024×1024 → IS-Net 出蒙版 → 拉伸回原尺寸当 alpha → 去小碎块 → 边缘去色（去掉背景色描边）→ 换底色 / 主图排版 / 投影
import * as ort from '../vendor/ort/ort.wasm.min.mjs';

const BASE = new URL('..', import.meta.url).href;
ort.env.wasm.wasmPaths = BASE + 'vendor/ort/';
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;

export const MODEL_URL = BASE + 'models/isnet_general_int8w.onnx';
export const MAX_SIDE = 2048;   // 处理和导出的最长边
let sess = null;

export async function loadModel(onProgress = () => {}) {
  if (sess) return sess;
  onProgress(0);
  const buf = await fetchWithProgress(MODEL_URL, onProgress);
  sess = await ort.InferenceSession.create(buf, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  onProgress(1);
  return sess;
}

async function fetchWithProgress(url, onP) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('模型下载失败：' + r.status);
  // GitHub Pages 会 gzip：content-length 是压缩后的长度，流里拿到的是解压后的字节，只能拿它估进度，不能按它预分配
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

export const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const ctx2d = c => c.getContext('2d', { willReadFrequently: true });

export function toWorkCanvas(img, max = MAX_SIDE) {
  const w0 = img.naturalWidth || img.width, h0 = img.naturalHeight || img.height;
  const k = Math.min(1, max / Math.max(w0, h0));
  const c = canvas(Math.round(w0 * k), Math.round(h0 * k));
  const g = ctx2d(c); g.imageSmoothingQuality = 'high'; g.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

// ---------- 1. 蒙版：和 rembg 一样，先除以最大值，再减 0.5（std = 1）----------
export async function predictMask(src, S = 1024) {
  const small = canvas(S, S), g = ctx2d(small);
  g.imageSmoothingQuality = 'high'; g.drawImage(src, 0, 0, S, S);
  const px = g.getImageData(0, 0, S, S).data, n = S * S, x = new Float32Array(3 * n);
  let mx = 1;
  for (let i = 0; i < n * 4; i++) if ((i & 3) !== 3 && px[i] > mx) mx = px[i];
  for (let i = 0; i < n; i++) {
    x[i] = px[i * 4] / mx - 0.5; x[n + i] = px[i * 4 + 1] / mx - 0.5; x[2 * n + i] = px[i * 4 + 2] / mx - 0.5;
  }
  const out = await sess.run({ [sess.inputNames[0]]: new ort.Tensor('float32', x, [1, 3, S, S]) });
  const pred = out[sess.outputNames[0]].data;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < n; i++) { const v = pred[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
  const m = new ImageData(S, S), k = 255 / Math.max(1e-6, hi - lo);
  for (let i = 0; i < n; i++) { const v = (pred[i] - lo) * k; m.data[i * 4] = m.data[i * 4 + 1] = m.data[i * 4 + 2] = v; m.data[i * 4 + 3] = 255; }
  const mc = canvas(S, S); ctx2d(mc).putImageData(m, 0, 0);
  // 拉伸回原图尺寸（原版用 LANCZOS，这里用浏览器的高质量缩放）
  const W = src.width, H = src.height, big = canvas(W, H), bg = ctx2d(big);
  bg.imageSmoothingQuality = 'high'; bg.drawImage(mc, 0, 0, W, H);
  const d = bg.getImageData(0, 0, W, H).data, alpha = new Uint8ClampedArray(W * H);
  for (let i = 0; i < W * H; i++) alpha[i] = d[i * 4];
  return alpha;
}

// ---------- 2. 清理：近乎透明 / 近乎不透明的拉到 0 / 255；去掉离主体很远的小碎块 ----------
export function cleanAlpha(alpha, W, H, minFrac = 0.02) {
  const N = W * H, bin = new Uint8Array(N);
  for (let i = 0; i < N; i++) { const a = alpha[i]; alpha[i] = a < 12 ? 0 : a > 243 ? 255 : (a - 12) * 255 / 231; bin[i] = alpha[i] > 127 ? 1 : 0; }
  // 连通块：面积小于最大块 2% 的当成误识别（比如背景里的一截充电线）
  const lab = new Int32Array(N), stack = new Int32Array(N), sizes = [0];
  for (let s = 0; s < N; s++) {
    if (!bin[s] || lab[s]) continue;
    const id = sizes.length; let sp = 0, size = 0; lab[s] = id; stack[sp++] = s;
    while (sp) {
      const i = stack[--sp], x = i % W; size++;
      if (x > 0 && bin[i - 1] && !lab[i - 1]) { lab[i - 1] = id; stack[sp++] = i - 1; }
      if (x < W - 1 && bin[i + 1] && !lab[i + 1]) { lab[i + 1] = id; stack[sp++] = i + 1; }
      if (i >= W && bin[i - W] && !lab[i - W]) { lab[i - W] = id; stack[sp++] = i - W; }
      if (i < N - W && bin[i + W] && !lab[i + W]) { lab[i + W] = id; stack[sp++] = i + W; }
    }
    sizes.push(size);
  }
  const big = Math.max(0, ...sizes.slice(1));
  if (!big) return alpha;
  const keep = new Uint8Array(N);
  for (let i = 0; i < N; i++) keep[i] = lab[i] && sizes[lab[i]] >= big * minFrac ? 1 : 0;
  // 保留块往外扩几个像素（它们的半透明边缘），其余全部透明
  const r = Math.max(3, Math.round(Math.max(W, H) / 300));
  const near = dilate(keep, W, H, r);
  for (let i = 0; i < N; i++) if (!near[i]) alpha[i] = 0;
  return alpha;
}

// 方形结构元素膨胀：先按行、再按列，看 r 以内有没有 1
function dilate(bin, W, H, r) {
  const tmp = new Uint8Array(W * H), out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const row = y * W; let last = -1e9;
    for (let x = 0; x < W; x++) { if (bin[row + x]) last = x; tmp[row + x] = x - last <= r ? 1 : 0; }
    last = 1e9;
    for (let x = W - 1; x >= 0; x--) { if (bin[row + x]) last = x; if (last - x <= r) tmp[row + x] = 1; }
  }
  for (let x = 0; x < W; x++) {
    let last = -1e9;
    for (let y = 0; y < H; y++) { if (tmp[y * W + x]) last = y; out[y * W + x] = y - last <= r ? 1 : 0; }
    last = 1e9;
    for (let y = H - 1; y >= 0; y--) { if (tmp[y * W + x]) last = y; if (last - y <= r) out[y * W + x] = 1; }
  }
  return out;
}

// ---------- 3. 边缘去色：半透明边缘的颜色里混着原背景（木桌的黄、床单的灰），
// 放到白底上会出一圈脏边。用附近不透明像素的颜色把它替换掉 ----------
export function decontaminate(src, alpha) {
  const W = src.width, H = src.height, N = W * H;
  const img = ctx2d(src).getImageData(0, 0, W, H), d = img.data;
  // 只拿「确定是主体」的像素做颜色场：alpha 当权重画到小图上，浏览器缩放时按预乘 alpha 平均，读回来就是加权平均色
  const fg = new ImageData(W, H);
  for (let i = 0; i < N; i++) {
    fg.data[i * 4] = d[i * 4]; fg.data[i * 4 + 1] = d[i * 4 + 1]; fg.data[i * 4 + 2] = d[i * 4 + 2];
    fg.data[i * 4 + 3] = alpha[i] > 235 ? 255 : 0;
  }
  const full = canvas(W, H); ctx2d(full).putImageData(fg, 0, 0);
  const field = (div) => {
    const w = Math.max(1, Math.round(W / div)), h = Math.max(1, Math.round(H / div));
    const s = canvas(w, h), sg = ctx2d(s); sg.imageSmoothingQuality = 'high'; sg.drawImage(full, 0, 0, w, h);
    const b = canvas(W, H), bg = ctx2d(b); bg.imageSmoothingQuality = 'high'; bg.drawImage(s, 0, 0, W, H);
    return bg.getImageData(0, 0, W, H).data;
  };
  const f1 = field(6), f2 = field(24);
  for (let i = 0; i < N; i++) {
    const a = alpha[i];
    if (a === 0 || a > 250) continue;
    // a 越小越用颜色场；颜色场覆盖不到的地方（离主体远）用更粗的那层
    const j = i * 4, src1 = f1[j + 3] > 8 ? f1 : f2;
    if (src1[j + 3] <= 8) continue;
    const t = Math.min(1, Math.max(0, (a / 255 - 0.55) / 0.4)), w = t * t * (3 - 2 * t);
    d[j] = d[j] * w + src1[j] * (1 - w); d[j + 1] = d[j + 1] * w + src1[j + 1] * (1 - w); d[j + 2] = d[j + 2] * w + src1[j + 2] * (1 - w);
  }
  for (let i = 0; i < N; i++) d[i * 4 + 3] = alpha[i];
  const out = canvas(W, H); ctx2d(out).putImageData(img, 0, 0);
  return out;
}

// 一步到位：图片 → { src, alpha, cut（透明底主体）}
export async function removeBackground(img, onStep = () => {}, size = 1024) {
  const src = toWorkCanvas(img);
  onStep('matting');
  const alpha = await predictMask(src, size);
  onStep('refine');
  cleanAlpha(alpha, src.width, src.height);
  const cut = decontaminate(src, alpha);
  return { src, alpha, cut };
}

// 用改过的 alpha（手动修边后）重新生成透明底主体
export function recut(src, alpha) { return decontaminate(src, alpha); }

// 主体外接框（alpha > 16）
export function bbox(alpha, W, H) {
  let t = H, b = -1, l = W, r = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (alpha[y * W + x] > 16) { if (y < t) t = y; if (y > b) b = y; if (x < l) l = x; if (x > r) r = x; }
  }
  return b < 0 ? { x: 0, y: 0, w: W, h: H } : { x: l, y: t, w: r - l + 1, h: b - t + 1 };
}

// ---------- 4. 出图：底色 + 版式 + 投影 ----------
// layout: 'orig' 原图尺寸 | [宽, 高] 主图画布（主体居中、四周留白 margin）
// bg: null = 透明；shadow: 地面接触阴影 + 柔和投影
// 返回 { canvas, map }：map 把画布坐标换回原图坐标（手动修边用）
export function compose(cut, box, { bg = '#ffffff', layout = 'orig', shadow = false, margin = 0.08 } = {}) {
  let W, H, k, ox, oy;
  if (layout === 'orig') {
    W = cut.width; H = cut.height; k = 1; ox = 0; oy = 0;
  } else {
    [W, H] = layout;
    const bw = W * (1 - 2 * margin), bh = H * (1 - 2 * margin);
    k = Math.min(bw / box.w, bh / box.h);
    ox = (W - box.w * k) / 2 - box.x * k;
    oy = (H - box.h * k) / 2 - box.y * k;
  }
  const o = canvas(W, H), g = ctx2d(o);
  if (bg) { g.fillStyle = bg; g.fillRect(0, 0, W, H); }
  g.imageSmoothingQuality = 'high';
  if (shadow) {
    const sw = box.w * k, cx = ox + (box.x + box.w / 2) * k, by = oy + (box.y + box.h) * k;
    // 接触阴影：主体底部一条压扁的径向渐变
    g.save();
    g.translate(cx, by); g.scale(1, 0.09);
    const rg = g.createRadialGradient(0, 0, 0, 0, 0, sw * 0.52);
    rg.addColorStop(0, 'rgba(0,0,0,.30)'); rg.addColorStop(0.6, 'rgba(0,0,0,.12)'); rg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = rg; g.beginPath(); g.arc(0, 0, sw * 0.52, 0, Math.PI * 2); g.fill();
    g.restore();
    // 柔和投影
    g.save();
    g.shadowColor = 'rgba(0,0,0,.16)'; g.shadowBlur = Math.max(W, H) * 0.025; g.shadowOffsetY = Math.max(W, H) * 0.008;
    g.drawImage(cut, ox, oy, cut.width * k, cut.height * k);
    g.restore();
  } else {
    g.drawImage(cut, ox, oy, cut.width * k, cut.height * k);
  }
  return { canvas: o, map: { k, ox, oy } };
}

// ---------- 5. 前后对比图（视频封面 / 分享用）----------
export function checker(g, W, H, cell = 16) {
  g.fillStyle = '#f4f5f8'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#e3e6ec';
  for (let y = 0; y < H; y += cell) for (let x = (y / cell) % 2 ? cell : 0; x < W; x += cell * 2) g.fillRect(x, y, cell, cell);
}
