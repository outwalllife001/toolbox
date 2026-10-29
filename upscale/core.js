// 模糊照片变高清：浏览器端移植 Real-ESRGAN (BSD-3-Clause) 的 realesr-general-x4v3
// https://github.com/xinntao/Real-ESRGAN  inference_realesrgan.py + realesrgan/utils.py（RealESRGANer）
// 流程：读图 → 太大先缩（见 plan）→ Worker 里分块跑 ×4 网络 → 拼回整张 → 要 2 倍就再缩一半（原版也是先 ×4 再按 outscale 缩）
// 模型：原版默认 denoise_strength=0.5，把两套权重各取一半插好了（days/day06-upscale/make_model.py）
const BASE = new URL('..', import.meta.url).href;
// webgpu16：整网 fp16，给支持 shader-f16 的 GPU（Mac 上比 fp32 快约 7 倍）；其余用 fp32 计算的版本
export const MODEL_URLS = { wasm: BASE + 'models/realesr_general_x4v3.onnx', webgpu: BASE + 'models/realesr_general_x4v3.onnx', webgpu16: BASE + 'models/realesr_general_x4v3_fp16.onnx' };
// 4 倍中间结果的面积上限：iPhone 上单个 canvas 最多约 1677 万像素（4096×4096）
export const MAX_BIG = 4096 * 4096;
// 原图面积上限（按后端）：超过就先缩小再放大。CPU（WASM 单线程）很慢，见 days/day06-upscale/README.md 的实测
export const MAX_IN = { webgpu16: 1024 * 1024, webgpu: 1024 * 1024, wasm: 480 * 480 };
export const TILE = { webgpu16: 256, webgpu: 256, wasm: 160 };
export const PAD = 24;

export const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const ctx2d = c => c.getContext('2d', { willReadFrequently: true });

// 'webgpu16' | 'webgpu' | 'wasm'
export async function pickBackend() {
  try {
    const a = navigator.gpu && await navigator.gpu.requestAdapter();
    if (!a) return 'wasm';
    return a.features.has('shader-f16') ? 'webgpu16' : 'webgpu';
  } catch { return 'wasm'; }
}

let worker = null, backend = '', seq = 0;
const jobs = new Map();

// 下载模型（显示进度）→ 起 Worker 建推理会话。want: pickBackend() 的结果；WebGPU 建不起来就退回 CPU
export async function load(want, onProgress = () => {}) {
  if (worker) return backend;
  if (want !== 'wasm') {
    try { return await start(want, onProgress); } catch (e) { console.warn('WebGPU 不可用，改用 CPU：', e.message); stop(); }
  }
  return start('wasm', onProgress);
}

async function start(be, onProgress) {
  onProgress(0);
  const buf = await fetchWithProgress(MODEL_URLS[be], onProgress);
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    const j = jobs.get(data.id ?? 'init');
    if (!j) return;
    if (data.type === 'tile') j.onTile(data);
    else if (data.type === 'done' || data.type === 'ready') { jobs.delete(data.id ?? 'init'); j.ok(data); }
    else if (data.type === 'error') { jobs.delete(data.id ?? 'init'); j.fail(new Error(data.message)); }
  };
  worker.onerror = e => { for (const [k, j] of jobs) { jobs.delete(k); j.fail(new Error(e.message || '推理线程出错')); } };
  const threads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;
  await new Promise((ok, fail) => {
    jobs.set('init', { ok, fail });
    worker.postMessage({ type: 'init', model: buf.buffer, backend: be === 'wasm' ? 'wasm' : 'webgpu', threads, base: BASE }, [buf.buffer]);
  });
  onProgress(1);
  return (backend = be);
}

function stop() { if (worker) worker.terminate(); worker = null; jobs.clear(); }

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

// 算尺寸：原图（必要时先缩小）w×h → 4 倍中间结果 → 最终 scale 倍
export function plan(w0, h0, scale, be = backend) {
  const maxIn = Math.min(MAX_IN[be] || MAX_IN.wasm, MAX_BIG / 16);
  const k = Math.min(1, Math.sqrt(maxIn / (w0 * h0)));
  // 向下取整：保证 4 倍后不超过 MAX_BIG（四舍五入会多出一点点）
  const w = Math.max(1, Math.floor(w0 * k)), h = Math.max(1, Math.floor(h0 * k));
  return { w0, h0, w, h, shrunk: k < 1, scale, W: w * scale, H: h * scale };
}

// 原图 → 工作画布（按 plan 缩放）；顺便看有没有透明像素
export function toWorkCanvas(img, p) {
  const c = canvas(p.w, p.h), g = ctx2d(c);
  g.imageSmoothingQuality = 'high'; g.drawImage(img, 0, 0, p.w, p.h);
  const d = g.getImageData(0, 0, p.w, p.h).data;
  let alpha = false;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 250) { alpha = true; break; }
  return { src: c, alpha };
}

// 跑 ×4：每算完一块就把它画进 big（4 倍画布）并回调 onTile({n, total})
export function upscale4(src, big, onTile = () => {}) {
  const w = src.width, h = src.height, id = ++seq;
  const rgba = ctx2d(src).getImageData(0, 0, w, h).data;
  const g = ctx2d(big);
  return new Promise((ok, fail) => {
    jobs.set(id, {
      ok, fail,
      onTile: t => { g.putImageData(new ImageData(t.px, t.w, t.h), t.x, t.y); onTile(t); },
    });
    worker.postMessage({ type: 'run', id, rgba, w, h, tile: TILE[backend] || TILE.wasm, pad: PAD }, [rgba.buffer]);
  });
}

export function cancel() { if (worker) worker.postMessage({ type: 'cancel', id: seq }); jobs.delete(seq); }

// 4 倍结果 → 最终尺寸（2 倍时缩一半；原版用 LANCZOS4，这里用浏览器的高质量缩放）
// 原图有透明部分：透明度按普通插值放大后贴回去（原版默认把 alpha 也过一遍网络，这里从简）
export function finish(big, p, src, alpha) {
  let out = big;
  if (p.scale !== 4) {
    out = canvas(p.W, p.H);
    const g = ctx2d(out); g.imageSmoothingQuality = 'high'; g.drawImage(big, 0, 0, p.W, p.H);
  }
  if (alpha) {
    const a = canvas(p.W, p.H), ag = ctx2d(a); ag.imageSmoothingQuality = 'high'; ag.drawImage(src, 0, 0, p.W, p.H);
    const ad = ag.getImageData(0, 0, p.W, p.H).data, og = ctx2d(out), od = og.getImageData(0, 0, p.W, p.H);
    for (let i = 3; i < ad.length; i += 4) od.data[i] = ad[i];
    if (out === big) { out = canvas(p.W, p.H); }
    ctx2d(out).putImageData(od, 0, 0);
  }
  return out;
}

// 4 倍画布先铺一层普通放大的底图：分块结果一块块盖上去，没算到的地方不会是黑的
export function prefill(big, src) {
  const g = ctx2d(big); g.imageSmoothingQuality = 'high'; g.drawImage(src, 0, 0, big.width, big.height);
}
