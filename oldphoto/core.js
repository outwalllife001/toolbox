// 黑白老照片上色：浏览器端移植 DDColor（Apache-2.0，ICCV 2023）的 ddcolor_paper_tiny
// https://github.com/piddnad/DDColor  ddcolor/pipeline.py（ColorizationPipeline.process）
// 原版流程：整图转 Lab 取亮度 L → 缩到正方形 → 只留 L（a、b 置 0）转回 RGB 灰度图 → 模型预测 a、b 两个颜色通道
//          → a、b 放大回原尺寸，和原图的 L 拼起来转回 RGB。所以清晰度、明暗全部来自原照片，AI 只「猜」颜色
// 和原版不一样的地方：
//   · 输入边长 384（原版 512）：这个小模型在 512 下左下角常冒出一小块彩色噪点（第三方导出的模型也一样），384 没有，还快一倍
//   · a、b 放大用双线性（原版 F.interpolate 默认最近邻，放大后颜色边缘有锯齿）
//   · 喂给模型的灰度图先模糊（σ 1.4）：颗粒重的老照片不模糊会整张不上色（见 blur 上面的说明）；还是没颜色就加大模糊再跑一次
//   · 可选「修复褪色」：先把 L 的直方图拉开再喂给模型、再合成；色彩浓淡 = a、b 乘一个倍数
const BASE = new URL('..', import.meta.url).href;
export const MODEL = BASE + 'models/ddcolor_tiny_int8w.onnx';
const MODEL_BYTES = 56.9e6, CACHE = 'toolbox-models-v1', CACHE_KEY = MODEL + '?v=1';
// 喂给模型的边长（32 的倍数）。默认 384；手机上没有 GPU 加速、用 CPU 算时降到 256（内存少一半多、快一倍，见 README 的实测）
export let SIDE = 384;
export function setSide(n) { SIDE = n; }
export const PREVIEW = 1280;                 // 预览画布的最长边
export const MAX_OUT = 4096 * 4096;          // 保存时的像素上限（iPhone 单个 canvas 约 1677 万像素）

export const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const ctx2d = c => c.getContext('2d', { willReadFrequently: true });

// 'webgpu' | 'wasm'。软件模拟的 WebGPU（SwiftShader / fallback adapter）比 CPU 还慢，当成没有
export const softGpu = a => !a || a.info?.isFallbackAdapter || /swiftshader/i.test(a.info?.architecture || '') || /swiftshader/i.test(a.info?.description || '');
export async function pickBackend() {
  try { return navigator.gpu && !softGpu(await navigator.gpu.requestAdapter()) ? 'webgpu' : 'wasm'; } catch { return 'wasm'; }
}
// ?threads=1 强制单线程（测速用）
const FORCE_T = +new URLSearchParams(self.location?.search || '').get('threads') || 0;
export const threads = () => (self.crossOriginIsolated ? Math.min(FORCE_T || 4, navigator.hardwareConcurrency || 2) : 1);

// ---------- 模型下载（存进 Cache Storage，下次打开不用再下）----------
export async function isCached() {
  try { return !!(await (await caches.open(CACHE)).match(CACHE_KEY)); } catch { return false; }
}
async function fetchModel(onP) {
  let cache = null;
  try { cache = await caches.open(CACHE); const hit = await cache.match(CACHE_KEY); if (hit) return new Uint8Array(await hit.arrayBuffer()); } catch {}
  const r = await fetch(MODEL);
  if (!r.ok) throw new Error('模型下载失败：' + r.status);
  let out;
  if (!r.body) out = new Uint8Array(await r.arrayBuffer());
  else {
    // GitHub Pages 会 gzip：content-length 是压缩后的长度，不能按它预分配，进度按解压后的大小算
    const chunks = [], rd = r.body.getReader(); let got = 0;
    for (;;) {
      const { done, value } = await rd.read();
      if (done) break;
      chunks.push(value); got += value.length;
      onP(Math.min(0.99, got / MODEL_BYTES));
    }
    out = new Uint8Array(got); let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
  }
  try { if (cache) await cache.put(CACHE_KEY, new Response(out.slice(), { headers: { 'content-type': 'application/octet-stream' } })); } catch {}
  return out;
}

let worker = null, seq = 0, loading = null;
export let backend = '';
const jobs = new Map();
function call(msg, transfer = []) {
  return new Promise((ok, fail) => { const id = msg.id ?? ++seq; jobs.set(id, { ok, fail }); worker.postMessage({ ...msg, id }, transfer); });
}
// 下载模型 → 起 Worker。WebGPU 建不起来就退回 CPU
export function load(want, onProgress = () => {}) {
  return (loading ||= (async () => {
    const buf = await fetchModel(onProgress);
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
  })().catch(e => { loading = null; throw e; }));
}

// ---------- 颜色换算（和 OpenCV 的浮点 BGR2Lab / Lab2BGR 一样：sRGB、D65，L 0–100，a、b 约 ±127）----------
const LIN = new Float32Array(256);            // sRGB 8 位 → 线性
for (let i = 0; i < 256; i++) { const c = i / 255; LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
const NQ = 4095;
const ENC = new Uint8ClampedArray(NQ + 1);    // 线性 → sRGB 8 位
const ENCF = new Float32Array(NQ + 1);        // 线性 → sRGB 0–1
for (let i = 0; i <= NQ; i++) { const c = i / NQ, v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; ENCF[i] = v; ENC[i] = Math.round(v * 255); }
const LSTAR = new Float32Array(NQ + 1);       // 线性亮度 Y → L*
for (let i = 0; i <= NQ; i++) { const y = i / NQ; LSTAR[i] = y > 0.008856 ? 116 * Math.cbrt(y) - 16 : 903.3 * y; }
const D = 6 / 29, finv = t => (t > D ? t * t * t : 3 * D * D * (t - 4 / 29));
const XN = 0.950456, ZN = 1.088754;
const yIdx = (d, s) => (LIN[d[s]] * 0.212671 + LIN[d[s + 1]] * 0.715160 + LIN[d[s + 2]] * 0.072169) * NQ + 0.5 | 0;

// 修复褪色：把亮度的 lo…hi 拉到 0…100（lo / hi 是 0.5% 和 99.5% 分位）。lv = null 不拉
const stretch = (L, lv) => (lv ? Math.max(0, Math.min(100, (L - lv.lo) * 100 / (lv.hi - lv.lo))) : L);

// 读图 → 模型尺寸的亮度 + 分位数。faded：整体发灰（最暗的地方不够黑或最亮的地方不够白），默认打开「修复褪色」
export function analyze(src) {
  const S = SIDE, c = canvas(S, S), g = ctx2d(c);
  g.fillStyle = '#fff'; g.fillRect(0, 0, S, S);
  g.imageSmoothingQuality = 'high'; g.drawImage(src, 0, 0, S, S);
  const d = g.getImageData(0, 0, S, S).data, n = S * S, L = new Float32Array(n), hist = new Uint32Array(1001);
  let chroma = 0;
  for (let i = 0; i < n; i++) {
    const s = i * 4; L[i] = LSTAR[yIdx(d, s)]; hist[L[i] * 10 | 0]++;
    chroma += Math.max(d[s], d[s + 1], d[s + 2]) - Math.min(d[s], d[s + 1], d[s + 2]);
  }
  const pct = p => { let acc = 0; for (let i = 0; i <= 1000; i++) { acc += hist[i]; if (acc >= n * p) return i / 10; } return 100; };
  let lo = pct(0.005), hi = pct(0.995);
  const faded = lo > 12 || hi < 86;
  lo = Math.min(lo, 40); hi = Math.max(hi, 60);      // 别把本来就一片灰的图拉过头
  return { L, lo, hi, faded, chroma: chroma / n };
}

// 喂给模型的灰度图先模糊一下（σ = 1.4 像素）。胶片颗粒、翻拍噪点多的照片，这个小模型会「认定它就是黑白照」，
// 整张几乎不上色，左下角还会冒出一块彩色噪点；模糊掉颗粒就正常了。实测 σ 0.8 还在临界点上（缩放方式稍微一变就又不上色），
// 1.2–1.6 在测试图上都稳，干净的照片颜色不受影响（days/day15-oldphoto/README.md 有数据）。
// 只影响模型看到的小图，成片的清晰度来自原图的亮度，不受影响
export const SIGMA = 1.4, SIGMA_RETRY = 2.6, MIN_COLOR = 3;
function blur(src, S, sigma) {
  const r = Math.ceil(4 * sigma), k = new Float32Array(2 * r + 1); let sum = 0;
  for (let i = -r; i <= r; i++) { k[i + r] = Math.exp(-i * i / (2 * sigma * sigma)); sum += k[i + r]; }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let v = 0; for (let i = -r; i <= r; i++) v += k[i + r] * src[y * S + Math.max(0, Math.min(S - 1, x + i))];
    tmp[y * S + x] = v;
  }
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let v = 0; for (let i = -r; i <= r; i++) v += k[i + r] * tmp[Math.max(0, Math.min(S - 1, y + i)) * S + x];
    out[y * S + x] = v;
  }
  return out;
}

// 保险：万一还是冒出那种逐像素乱跳的彩色噪点块，把那一块的颜色压掉（变回黑白）。
// 判断：a、b 和自己 3×3 中值的差，在 16×16 窗口里取平均。正常的颜色图很平滑（实测 < 25），噪点块在 150–950
const med3 = (p, i, S) => {
  const v = [p[i - S - 1], p[i - S], p[i - S + 1], p[i - 1], p[i], p[i + 1], p[i + S - 1], p[i + S], p[i + S + 1]];
  v.sort((a, b) => a - b); return v[4];
};
function boxBlur(src, S, r) {
  const tmp = new Float32Array(S * S), out = new Float32Array(S * S), n = 2 * r + 1;
  for (let y = 0; y < S; y++) { let acc = 0; for (let x = -r; x < S + r; x++) { if (x + r < S) acc += src[y * S + x + r]; if (x - r - 1 >= 0) acc -= src[y * S + x - r - 1]; if (x >= 0 && x < S) tmp[y * S + x] = acc / n; } }
  for (let x = 0; x < S; x++) { let acc = 0; for (let y = -r; y < S + r; y++) { if (y + r < S) acc += tmp[(y + r) * S + x]; if (y - r - 1 >= 0) acc -= tmp[(y - r - 1) * S + x]; if (y >= 0 && y < S) out[y * S + x] = acc / n; } }
  return out;
}
export function despeckle(ab, S) {
  const N = S * S, d = new Float32Array(N);
  for (let y = 1; y < S - 1; y++) for (let x = 1; x < S - 1; x++) {
    const i = y * S + x;
    d[i] = Math.abs(ab[i] - med3(ab, i, S)) + Math.abs(ab[N + i] - med3(ab.subarray(N), i, S));
  }
  const R = boxBlur(d, S, 8);
  let worst = 0; for (let i = 0; i < N; i++) if (R[i] > worst) worst = R[i];
  if (worst < 30) return 0;
  const m = new Float32Array(N);
  for (let i = 0; i < N; i++) m[i] = R[i] > 30 ? 1 : 0;
  const w = boxBlur(m, S, 10);
  for (let i = 0; i < N; i++) { const k = 1 - Math.min(1, w[i] * 2.5); ab[i] *= k; ab[N + i] *= k; }
  return worst;
}

// 跑模型：{ab（2×S×S，先 a 后 b）, ms, color（a、b 绝对值的平均，太小说明几乎没上出颜色）, speckle（压掉过噪点块时 > 0）, tries}
// 几乎没上出颜色（color < MIN_COLOR）就把模糊加大再跑一次，取颜色多的那次
export async function colorize(L, lv) {
  const n = L.length, S = Math.round(Math.sqrt(n)), st = new Float32Array(n);
  for (let i = 0; i < n; i++) st[i] = stretch(L[i], lv);
  let best = null, ms = 0, tries = 0;
  for (const sigma of [SIGMA, SIGMA_RETRY]) {
    const Lb = blur(st, S, sigma), gray = new Float32Array(n);
    for (let i = 0; i < n; i++) gray[i] = ENCF[Math.max(0, Math.min(1, finv((Lb[i] + 16) / 116))) * NQ + 0.5 | 0];
    const r = await call({ type: 'run', gray, S }, [gray.buffer]);
    const speckle = despeckle(r.ab, S);
    let color = 0; for (let i = 0; i < 2 * n; i++) color += Math.abs(r.ab[i]);
    color /= 2 * n; ms += r.ms; tries++;
    if (!best || color > best.color) best = { ab: r.ab, color, speckle };
    if (color >= MIN_COLOR) break;
  }
  return { ...best, ms, tries };
}

// 把 src 画成 W×H，逐像素：原图亮度 L（可选拉开）+ 模型的 a、b（双线性放大，乘 sat）→ sRGB，画进 dst
export function render(dst, src, W, H, { ab, lv = null, sat = 1, label = false }) {
  dst.width = W; dst.height = H;
  const g = ctx2d(dst);
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
  g.imageSmoothingQuality = 'high'; g.drawImage(src, 0, 0, W, H);
  const im = g.getImageData(0, 0, W, H), d = im.data, S = Math.round(Math.sqrt(ab.length / 2)), N = S * S;
  const FY = new Float32Array(NQ + 1);
  for (let i = 0; i <= NQ; i++) FY[i] = (stretch(LSTAR[i], lv) + 16) / 116;
  const x0 = new Int32Array(W), x1 = new Int32Array(W), wx = new Float32Array(W);
  for (let x = 0; x < W; x++) { const f = Math.max(0, Math.min(S - 1, (x + 0.5) * S / W - 0.5)), i = f | 0; x0[x] = i; x1[x] = Math.min(S - 1, i + 1); wx[x] = f - i; }
  const ka = sat / 500, kb = sat / 200;
  for (let y = 0; y < H; y++) {
    const f = Math.max(0, Math.min(S - 1, (y + 0.5) * S / H - 0.5)), yi = f | 0, wy = f - yi, r0 = yi * S, r1 = Math.min(S - 1, yi + 1) * S;
    let s = y * W * 4;
    for (let x = 0; x < W; x++, s += 4) {
      const a0 = x0[x], a1 = x1[x], u = wx[x];
      const ta = ab[r0 + a0] + (ab[r0 + a1] - ab[r0 + a0]) * u, ba = ab[r1 + a0] + (ab[r1 + a1] - ab[r1 + a0]) * u;
      const tb = ab[N + r0 + a0] + (ab[N + r0 + a1] - ab[N + r0 + a0]) * u, bb = ab[N + r1 + a0] + (ab[N + r1 + a1] - ab[N + r1 + a0]) * u;
      const fy = FY[yIdx(d, s)], X = XN * finv(fy + (ta + (ba - ta) * wy) * ka), Y = finv(fy), Z = ZN * finv(fy - (tb + (bb - tb) * wy) * kb);
      const R = 3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z, G = -0.9692660 * X + 1.8760108 * Y + 0.0415560 * Z, B = 0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z;
      d[s] = ENC[R <= 0 ? 0 : R >= 1 ? NQ : R * NQ + 0.5 | 0]; d[s + 1] = ENC[G <= 0 ? 0 : G >= 1 ? NQ : G * NQ + 0.5 | 0]; d[s + 2] = ENC[B <= 0 ? 0 : B >= 1 ? NQ : B * NQ + 0.5 | 0]; d[s + 3] = 255;
    }
  }
  g.putImageData(im, 0, 0);
  if (label) drawLabel(g, W, H);
  return dst;
}

// 右下角的「AI 上色」小字
function drawLabel(g, W, H) {
  const fs = Math.max(11, Math.round(Math.min(W, H) * 0.028)), pad = Math.round(fs * 0.7);
  g.save();
  g.font = `600 ${fs}px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`;
  g.textAlign = 'right'; g.textBaseline = 'bottom';
  g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = fs * 0.35;
  g.fillStyle = 'rgba(255,255,255,.82)';
  g.fillText('AI 上色', W - pad, H - pad);
  g.restore();
}

export function previewSize(w0, h0) {
  const k = Math.min(1, PREVIEW / Math.max(w0, h0));
  return { W: Math.max(1, Math.round(w0 * k)), H: Math.max(1, Math.round(h0 * k)) };
}
export function outSize(w0, h0) {
  const k = Math.min(1, Math.sqrt(MAX_OUT / (w0 * h0)));
  return { W: Math.max(1, Math.floor(w0 * k)), H: Math.max(1, Math.floor(h0 * k)) };
}

// 导出 JPEG，并在文件里写一段注释说明「AI 上色」（JPEG 的 COM 段，看图软件的详细信息里能看到）
export async function toJpeg(c, q = 0.92) {
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', q));
  const b = new Uint8Array(await blob.arrayBuffer());
  if (b[0] !== 0xff || b[1] !== 0xd8) return blob;
  const txt = new TextEncoder().encode('AIGC: colors generated by AI (DDColor colorization). AI 上色，颜色为模型推测。开源宝藏工具箱');
  const seg = new Uint8Array(4 + txt.length);
  seg[0] = 0xff; seg[1] = 0xfe; seg[2] = (txt.length + 2) >> 8; seg[3] = (txt.length + 2) & 255; seg.set(txt, 4);
  return new Blob([b.subarray(0, 2), seg, b.subarray(2)], { type: 'image/jpeg' });
}
