// 语音识别核心：浏览器端移植自 sherpa-onnx（Apache-2.0）的 SenseVoice 推理流程
// https://github.com/k2-fsa/sherpa-onnx  csrc/offline-recognizer-sense-voice-impl.h、features.cc、lfr.cc、offline-ctc-greedy-search-decoder.cc
// 模型：SenseVoiceSmall（FunAudioLLM / 阿里通义实验室，FunASR 模型许可证），用的是 sherpa-onnx 导出的 int8 版
// 流程：16k 单声道 → Kaldi fbank 80 维 → LFR（7 帧拼 1 帧，步长 6）→ CMVN → SenseVoice → CTC 贪心解码（每帧 60ms，带时间戳）
// 长音频先在停顿处切成不超过 15 秒的段，逐段识别；字幕的起止时间来自每个字的时间戳
import * as ort from '../vendor/ort/ort.wasm.min.mjs';

const BASE = new URL('..', import.meta.url).href;
ort.env.wasm.wasmPaths = BASE + 'vendor/ort/';
// GitHub Pages 不能开 COOP/COEP，线上只有单线程；?threads=1 强制单线程（录视频时用，和线上一样）
const THREADS = +new URLSearchParams(self.location.search).get('threads') || 4;
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(THREADS, navigator.hardwareConcurrency || 2) : 1;

export const MODEL_DIR = BASE + 'models/sensevoice/';
export const SR = 16000;
const CACHE = 'toolbox-models-v1';
let sess = null, tokens = null, meta = null;

// ---------- 加载：模型拆成几个不到 100MB 的分片（GitHub 单文件上限），下载后存进 Cache Storage，下次直接读 ----------
export async function loadModel(onProgress = () => {}) {
  if (sess) return;
  const man = await (await fetch(MODEL_DIR + 'manifest.json')).json();
  meta = man.meta;
  tokens = (await (await fetch(MODEL_DIR + man.tokens)).text()).split('\n').filter(Boolean).map(l => l.slice(0, l.lastIndexOf(' ')));
  const buf = new Uint8Array(man.total);
  let got = 0;
  onProgress(0);
  for (const p of man.parts) {
    const part = await fetchCached(MODEL_DIR + p.name, n => { got += n; onProgress(Math.min(0.99, got / man.total)); });
    if (part.length !== p.size) throw new Error('模型文件不完整，请刷新重试');
    buf.set(part, p.offset);
  }
  onProgress(0.995);
  sess = await ort.InferenceSession.create(buf, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  onProgress(1);
}

async function fetchCached(url, onBytes) {
  let cache = null;
  try {
    cache = await caches.open(CACHE);
    const hit = await cache.match(url);
    if (hit) { const b = new Uint8Array(await hit.arrayBuffer()); onBytes(b.length); return b; }
  } catch { cache = null; }   // 隐私模式、http 页面里没有 Cache Storage，就每次下载
  const r = await fetch(url);
  if (!r.ok) throw new Error('模型下载失败：' + r.status);
  // GitHub Pages 会 gzip：流里拿到的是解压后的字节，按块收集再拼，不按 content-length 预分配
  const chunks = [], rd = r.body.getReader(); let n = 0;
  for (;;) {
    const { done, value } = await rd.read();
    if (done) break;
    chunks.push(value); n += value.length; onBytes(value.length);
  }
  const out = new Uint8Array(n); let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  if (cache) cache.put(url, new Response(out)).catch(() => {});   // 空间不够存不下也不影响这次使用
  return out;
}

// ---------- 1. Kaldi fbank（sherpa-onnx 给 SenseVoice 的设置：hamming 窗、80 维、20Hz–8kHz、snip_edges、样本 ×32768）----------
const FRAME = 400, SHIFT = 160, NFFT = 512, NMEL = 80;
const WIN = new Float64Array(FRAME).map((_, i) => 0.54 - 0.46 * Math.cos(2 * Math.PI * i / (FRAME - 1)));
const MEL = (() => {
  const mel = f => 1127 * Math.log(1 + f / 700);
  const lo = mel(20), hi = mel(SR / 2), d = (hi - lo) / (NMEL + 1), banks = [];
  for (let b = 0; b < NMEL; b++) {
    const l = lo + b * d, c = l + d, r = c + d, w = [];
    let start = -1;
    for (let i = 0; i < NFFT / 2; i++) {
      const m = mel(i * SR / NFFT);
      if (m > l && m < r) { if (start < 0) start = i; w.push(m <= c ? (m - l) / (c - l) : (r - m) / (r - c)); }
    }
    banks.push({ start, w: Float64Array.from(w) });
  }
  return banks;
})();
const FFT = (() => {
  const rev = new Uint16Array(NFFT), bits = Math.log2(NFFT);
  for (let i = 0; i < NFFT; i++) { let r = 0; for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b); rev[i] = r; }
  const cos = new Float64Array(NFFT / 2), sin = new Float64Array(NFFT / 2);
  for (let i = 0; i < NFFT / 2; i++) { cos[i] = Math.cos(2 * Math.PI * i / NFFT); sin[i] = -Math.sin(2 * Math.PI * i / NFFT); }
  return { rev, cos, sin };
})();
function fft(re, im) {
  const { rev, cos, sin } = FFT;
  for (let i = 0; i < NFFT; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let size = 2; size <= NFFT; size <<= 1) {
    const half = size >> 1, step = NFFT / size;
    for (let s = 0; s < NFFT; s += size) for (let k = 0; k < half; k++) {
      const a = s + k, b = a + half, wr = cos[k * step], wi = sin[k * step];
      const tr = re[b] * wr - im[b] * wi, ti = re[b] * wi + im[b] * wr;
      re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
    }
  }
}

export function fbank(x) {
  const T = x.length < FRAME ? 0 : 1 + Math.floor((x.length - FRAME) / SHIFT);
  const out = new Float32Array(T * NMEL), re = new Float64Array(NFFT), im = new Float64Array(NFFT), pw = new Float64Array(NFFT / 2);
  for (let t = 0; t < T; t++) {
    const off = t * SHIFT; let mean = 0;
    for (let i = 0; i < FRAME; i++) { re[i] = x[off + i] * 32768; mean += re[i]; }
    mean /= FRAME;
    for (let i = 0; i < FRAME; i++) re[i] -= mean;
    for (let i = FRAME - 1; i > 0; i--) re[i] -= 0.97 * re[i - 1];
    re[0] -= 0.97 * re[0];
    for (let i = 0; i < FRAME; i++) re[i] *= WIN[i];
    re.fill(0, FRAME); im.fill(0);
    fft(re, im);
    for (let i = 0; i < NFFT / 2; i++) pw[i] = re[i] * re[i] + im[i] * im[i];
    for (let b = 0; b < NMEL; b++) {
      const { start, w } = MEL[b]; let e = 0;
      for (let k = 0; k < w.length; k++) e += w[k] * pw[start + k];
      out[t * NMEL + b] = Math.log(Math.max(e, 1.1920928955078125e-7));
    }
  }
  return { data: out, frames: T };
}

// ---------- 2. LFR + CMVN（左边补 3 帧首帧，右边不够就重复末帧，输出 ceil(T/6) 帧）----------
export function lfrCmvn({ data, frames: T }) {
  const m = meta.lfr_m, n = meta.lfr_n, D = NMEL * m, L = (m - 1) >> 1;
  const F = T ? 1 + Math.floor((T - 1) / n) : 0, out = new Float32Array(F * D);
  const nm = meta.neg_mean, is = meta.inv_stddev;
  for (let i = 0; i < F; i++) {
    const c = i * n, pad = c < L ? L - c : 0, first = c < L ? 0 : c - L, maxOff = T - 1 - first;
    for (let j = 0; j < m; j++) {
      const f = j < pad ? 0 : (j - pad > maxOff ? T - 1 : first + j - pad);
      const src = f * NMEL, dst = i * D + j * NMEL;
      for (let k = 0; k < NMEL; k++) out[dst + k] = (data[src + k] + nm[j * NMEL + k]) * is[j * NMEL + k];
    }
  }
  return { data: out, frames: F };
}

// ---------- 3. 识别一段（≤ 30 秒）→ [{s: 字, t: 秒}]，t 相对这段开头 ----------
export const LANGS = { auto: 0, zh: 3, en: 4, yue: 7, ja: 11, ko: 12 };
export async function recognize(x, lang = 'auto') {
  const f = lfrCmvn(fbank(x));
  if (f.frames < 2) return { tokens: [], lang: '' };
  const out = await sess.run({
    x: new ort.Tensor('float32', f.data, [1, f.frames, NMEL * meta.lfr_m]),
    x_length: new ort.Tensor('int32', Int32Array.of(f.frames), [1]),
    language: new ort.Tensor('int32', Int32Array.of(LANGS[lang] ?? 0), [1]),
    text_norm: new ort.Tensor('int32', Int32Array.of(meta.with_itn), [1]),
  });
  const lg = out.logits, [, Tn, V] = lg.dims, d = lg.data;
  const ids = [], ts = [];
  let prev = -1;
  for (let t = 0; t < Tn; t++) {
    let best = 0, bv = -Infinity;
    for (let v = 0, o = t * V; v < V; v++) if (d[o + v] > bv) { bv = d[o + v]; best = v; }
    if (best !== 0 && best !== prev) { ids.push(best); ts.push(t); }
    prev = best;
  }
  lg.dispose?.();
  // 前 4 个是语种 / 情绪 / 事件 / 文本规整标记（和 sherpa-onnx 一样跳过），时间按 (帧 - 4) × 60ms
  const res = [];
  for (let i = 4; i < ids.length; i++) {
    const s = tokens[ids[i]];
    if (/^<\|.*\|>$/.test(s)) continue;
    res.push({ s: s.replace(/▁/g, ' '), t: +((ts[i] - 4) * 0.01 * meta.lfr_n).toFixed(3) });
  }
  return { tokens: res, lang: ids.length ? tokens[ids[0]] : '' };
}

// ---------- 4. 长音频切段：在停顿处切，每段 4–15 秒（第一段不超过 8 秒，让第一批字幕早点出来）；整段都是静音的跳过 ----------
export function segments(x, { min = 4, max: max0 = 15, first = 8 } = {}) {
  const H = 160, K = Math.floor(x.length / H), db = new Float32Array(K);
  for (let k = 0; k < K; k++) {
    let e = 0; for (let i = k * H; i < (k + 1) * H; i++) e += x[i] * x[i];
    db[k] = 10 * Math.log10(e / H + 1e-10);
  }
  const sorted = Float32Array.from(db).sort(), q = p => sorted[Math.min(K - 1, Math.floor(p * K))] ?? -100;
  const floor = q(0.1), loud = q(0.95), thr = floor + Math.max(6, 0.3 * (loud - floor));
  const quiet = db.map(v => (v < thr ? 1 : 0));
  // 每帧所在静音段的长度（帧数），用来挑「最长的停顿」下刀
  const run = new Int32Array(K);
  for (let k = 0; k < K;) {
    if (!quiet[k]) { k++; continue; }
    let e = k; while (e < K && quiet[e]) e++;
    for (let i = k; i < e; i++) run[i] = e - k;
    k = e;
  }
  const segs = [], N = K;
  let s = 0;
  while (s < N) {
    const max = segs.length ? max0 : first;
    let e;
    if (N - s <= max * 100) e = N;
    else {
      let best = -1, score = -1;
      for (let k = s + min * 100; k < s + max * 100; k++) if (run[k] && (run[k] > score || (run[k] === score && k > best))) { score = run[k]; best = k; }
      if (best < 0 || score < 15) {   // 没有 0.15 秒以上的停顿：在最后 3 秒里找最安静的一帧
        best = s + max * 100 - 1;
        for (let k = s + (max - 3) * 100; k < s + max * 100; k++) if (db[k] < db[best]) best = k;
      } else {   // 切在这段停顿的中间
        let a = best, b = best; while (a > s && quiet[a - 1]) a--; while (b < N - 1 && quiet[b + 1]) b++;
        best = Math.min(s + max * 100, Math.max(s + min * 100, (a + b) >> 1));
      }
      e = best;
    }
    let voiced = 0; for (let k = s; k < e; k++) if (!quiet[k]) voiced++;
    if (voiced >= 20) segs.push({ start: s * H, end: Math.min(x.length, e * H) });
    s = e;
  }
  return segs;
}
