// 流式中文语音识别：浏览器端移植 sherpa-onnx（Apache-2.0）的流式 Zipformer transducer 推理流程
// https://github.com/k2-fsa/sherpa-onnx  csrc/features.cc、online-zipformer-transducer-model.cc、online-transducer-greedy-search-decoder.cc
// 模型：streaming zipformer zh-14M（k2-fsa / icefall 训练，Apache-2.0），权重换了存法、计算仍是 fp32，见 site/models/README.md
// 流程：16k 单声道 → Kaldi fbank 80 维（povey 窗，一来够一帧就算一帧）→ 每 32 帧（0.32 秒）送一块 39 帧进编码器
//       （35 个状态张量带着上文）→ 逐帧 joiner + 贪心解码 → 一个字一个字吐出来
import * as ort from '../vendor/ort/ort.wasm.min.mjs';

const BASE = new URL('..', import.meta.url).href;
ort.env.wasm.wasmPaths = BASE + 'vendor/ort/';
ort.env.wasm.numThreads = 1;      // 模型小，单线程就比说话快得多；不用跨源隔离

export const MODEL_DIR = BASE + 'models/zipformer-zh-14m/';
export const SR = 16000;
const CACHE = 'toolbox-models-v1';
let enc = null, dec = null, joi = null, tokens = null, meta = null;

export async function loadModel(onProgress = () => {}) {
  if (enc) return;
  const man = await (await fetch(MODEL_DIR + 'manifest.json')).json();
  meta = man.meta;
  tokens = (await (await fetch(MODEL_DIR + man.tokens)).text()).split('\n').filter(Boolean).map(l => l.slice(0, l.lastIndexOf(' ')));
  let got = 0; onProgress(0);
  const bufs = [];
  for (const f of man.files) {
    const b = await fetchCached(MODEL_DIR + f.name, n => { got += n; onProgress(Math.min(0.98, got / man.total)); });
    if (b.length !== f.size) throw new Error('模型文件不完整，请刷新重试');
    bufs.push(b);
  }
  const opt = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' };
  const e = await ort.InferenceSession.create(bufs[0], opt);
  const d = await ort.InferenceSession.create(bufs[1], opt);
  const j = await ort.InferenceSession.create(bufs[2], opt);
  enc = e; dec = d; joi = j;
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
  if (cache) cache.put(url, new Response(out)).catch(() => {});
  return out;
}

// ---------- 1. Kaldi fbank（sherpa-onnx 给流式模型的设置：povey 窗、80 维、20–7600Hz、snip_edges=false、样本 −1…1、不加抖动）----------
const FRAME = 400, SHIFT = 160, NFFT = 512, NMEL = 80;
const WIN = new Float64Array(FRAME).map((_, i) => Math.pow(0.5 - 0.5 * Math.cos(2 * Math.PI * i / (FRAME - 1)), 0.85));
const MEL = (() => {
  const mel = f => 1127 * Math.log(1 + f / 700);
  const lo = mel(20), hi = mel(SR / 2 - 400), d = (hi - lo) / (NMEL + 1), banks = [];
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
const RE = new Float64Array(NFFT), IM = new Float64Array(NFFT), PW = new Float64Array(NFFT / 2);
// win：长度 400 的一帧样本（会被改写），结果写进 out[off … off+80)
function fbankFrame(win, out, off) {
  let mean = 0;
  for (let i = 0; i < FRAME; i++) mean += win[i];
  mean /= FRAME;
  for (let i = 0; i < FRAME; i++) RE[i] = win[i] - mean;
  for (let i = FRAME - 1; i > 0; i--) RE[i] -= 0.97 * RE[i - 1];
  RE[0] -= 0.97 * RE[0];
  for (let i = 0; i < FRAME; i++) RE[i] *= WIN[i];
  RE.fill(0, FRAME); IM.fill(0);
  fft(RE, IM);
  for (let i = 0; i < NFFT / 2; i++) PW[i] = RE[i] * RE[i] + IM[i] * IM[i];
  for (let b = 0; b < NMEL; b++) {
    const { start, w } = MEL[b]; let e = 0;
    for (let k = 0; k < w.length; k++) e += w[k] * PW[start + k];
    out[off + b] = Math.log(Math.max(e, 1.1920928955078125e-7));
  }
}

// ---------- 2. 任意采样率 → 16k（先低通再线性插值，一块一块来）----------
export class Resampler {
  constructor(rate) {
    this.rate = rate; this.step = rate / SR; this.same = rate === SR;
    const N = 48, fc = Math.min(7200, rate * 0.45) / rate;      // 截止 7.2kHz 的加窗 sinc
    this.h = new Float32Array(N + 1);
    let sum = 0;
    for (let i = 0; i <= N; i++) {
      const x = i - N / 2, s = x === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * x) / (Math.PI * x);
      this.h[i] = s * (0.54 - 0.46 * Math.cos(2 * Math.PI * i / N)); sum += this.h[i];
    }
    for (let i = 0; i <= N; i++) this.h[i] /= sum;
    this.tail = new Float32Array(N);      // 上一块末尾，滤波用
    this.prev = 0; this.pos = 0;          // 上一块滤波后的最后一个样本；下一个输出点相对本块开头的位置
  }
  push(x) {
    if (this.same) return x;
    const h = this.h, N = h.length - 1, n = x.length;
    const ext = new Float32Array(N + n); ext.set(this.tail); ext.set(x, N);
    const y = new Float32Array(n);
    for (let i = 0; i < n; i++) { let s = 0; for (let k = 0; k <= N; k++) s += h[k] * ext[i + N - k]; y[i] = s; }
    this.tail = ext.slice(n);
    const out = new Float32Array(Math.ceil((n - this.pos) / this.step) + 1);
    let m = 0, p = this.pos;
    for (; p < n; p += this.step) {
      const i = Math.floor(p), f = p - i, a = i === 0 ? this.prev : y[i - 1], b = y[i];
      out[m++] = a + (b - a) * f;         // 点 p 落在 y[i-1] 和 y[i] 之间
    }
    this.pos = p - n; if (n) this.prev = y[n - 1];
    return out.subarray(0, m);
  }
}

// ---------- 3. 流：攒样本 → 出特征帧 → 够一块就过编码器 → 贪心解码 ----------
export class Stream {
  constructor() {
    if (!enc) throw new Error('模型还没加载');
    this.buf = new Float32Array(SR);  // 还没用完的样本，buf[0] 对应第 this.base 个样本
    this.len = 0; this.base = 0; this.total = 0;
    this.nFrames = 0;                 // 已经算出的特征帧数
    this.feats = [];                  // 还没被编码器吃掉的特征帧（每帧 Float32Array(80)），feats[0] 是第 this.fBase 帧
    this.fBase = 0;
    this.states = {};
    for (const s of meta.states) {
      const n = s.dims.reduce((a, b) => a * b, 1);
      this.states[s.name] = s.type === 'int64' ? new ort.Tensor('int64', new BigInt64Array(n), s.dims) : new ort.Tensor('float32', new Float32Array(n), s.dims);
    }
    this.ctx = new Array(meta.context).fill(-1); this.ctx[meta.context - 1] = meta.blank;   // 和 sherpa-onnx 一样：[-1, 0]
    this.decOut = null;
    this.blanks = 0;                  // 结尾连续多少帧没出字（判断是不是停下来了）
    this.outFrames = 0;               // 编码器已经输出的帧数（每帧 40ms）
    this.win = new Float64Array(FRAME);
  }
  // 喂 16k 的样本；返回这次新认出来的字 [{ ch, t }]（t：这个字说完的大致时刻，秒，按音频时间算）
  async accept(x) {
    if (this.len + x.length > this.buf.length) {
      const nb = new Float32Array(Math.max(this.buf.length * 2, this.len + x.length)); nb.set(this.buf.subarray(0, this.len)); this.buf = nb;
    }
    this.buf.set(x, this.len); this.len += x.length; this.total += x.length;
    // 第 i 帧的窗从 i*160 − 120 开始（snip_edges=false：以 i*160+80 为中心），开头不够的镜像补
    for (;;) {
      const start = this.nFrames * SHIFT - 120;
      if (start + FRAME > this.total) break;
      for (let k = 0; k < FRAME; k++) { let s = start + k; if (s < 0) s = -s - 1; this.win[k] = this.buf[s - this.base]; }
      const f = new Float32Array(NMEL); fbankFrame(this.win, f, 0);
      this.feats.push(f); this.nFrames++;
      const keep = Math.max(0, this.nFrames * SHIFT - 120);      // 下一帧最早要用到的样本
      if (keep - this.base > SR / 2) { this.buf.copyWithin(0, keep - this.base, this.len); this.len -= keep - this.base; this.base = keep; }
    }
    const out = [];
    while (this.feats.length >= meta.T) {
      const x = new Float32Array(meta.T * NMEL);
      for (let i = 0; i < meta.T; i++) x.set(this.feats[i], i * NMEL);
      this.feats.splice(0, meta.shift); this.fBase += meta.shift;
      const res = await enc.run({ x: new ort.Tensor('float32', x, [1, meta.T, NMEL]), ...this.states });
      for (const s of meta.states) this.states[s.name] = res['new_' + s.name];
      const eo = res.encoder_out, Tn = eo.dims[1], D = eo.dims[2];
      for (let t = 0; t < Tn; t++, this.outFrames++) {
        if (!this.decOut) this.decOut = (await dec.run({ y: new ort.Tensor('int64', BigInt64Array.from(this.ctx.map(BigInt)), [1, meta.context]) })).decoder_out;
        const logit = (await joi.run({ encoder_out: new ort.Tensor('float32', eo.data.subarray(t * D, (t + 1) * D), [1, D]), decoder_out: this.decOut })).logit.data;
        let best = 0, bv = -Infinity;
        for (let k = 0; k < logit.length; k++) if (logit[k] > bv) { bv = logit[k]; best = k; }
        if (best !== meta.blank && best !== meta.unk) {
          this.ctx.push(best); this.ctx.shift(); this.decOut = null; this.blanks = 0;
          out.push({ ch: tokens[best], t: this.outFrames * 0.04 });
        } else this.blanks++;
      }
    }
    return out;
  }
  get seconds() { return this.total / SR; }
}
