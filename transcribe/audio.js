// 读录音 → 16k 单声道 Float32Array（识别模型要的格式）
//   短录音：浏览器自带的 decodeAudioData（最快，格式最全）
//   长录音：Mediabunny（MPL-2.0，原样使用）边解码边混成单声道、边降采样到 16k，不把整段原始采样（1 小时 48k 立体声约 1.4GB）放进内存
const SR = 16000;
let mb = null;
const lib = () => (mb ||= import('../vendor/mediabunny/mediabunny.min.mjs'));

export async function viaBrowser(file) {
  const AC = self.OfflineAudioContext || self.webkitOfflineAudioContext, ctx = new AC(1, SR, SR);
  const buf = await file.arrayBuffer();
  const ab = await new Promise((res, rej) => { const p = ctx.decodeAudioData(buf, res, rej); if (p && p.then) p.then(res, rej); });
  const C = ab.numberOfChannels;
  if (C === 1) return ab.getChannelData(0);
  const x = new Float32Array(ab.length);
  for (let c = 0; c < C; c++) { const d = ab.getChannelData(c); for (let i = 0; i < x.length; i++) x[i] += d[i] / C; }
  return x;
}

// 流式降采样：加窗 sinc 插值（每边 16 个点、Blackman 窗，截止频率 0.92 × 8kHz），核函数查表
class Resampler {
  constructor(from, to = SR, W = 16) {
    this.r = from / to; this.W = W; this.fc = Math.min(1, to / from) * 0.92;
    const P = 256; this.P = P; this.tab = new Float32Array(2 * W * P + 2);
    for (let i = 0; i < this.tab.length; i++) {
      const t = i / P - W, a = Math.PI * this.fc * t, w = 0.42 + 0.5 * Math.cos(Math.PI * t / W) + 0.08 * Math.cos(2 * Math.PI * t / W);
      this.tab[i] = Math.abs(t) >= W ? 0 : this.fc * (t === 0 ? 1 : Math.sin(a) / a) * w;
    }
    this.buf = new Float32Array(0); this.base = 0; this.n = 0;   // buf[0] 是第 base 个输入样本；n 是下一个要输出的样本号
  }
  push(x, flush = false) {
    const all = new Float32Array(this.buf.length + x.length); all.set(this.buf); all.set(x, this.buf.length);
    const { r, W, P, tab } = this, end = this.base + all.length, out = [];
    for (;;) {
      const p = this.n * r, c = Math.floor(p);
      if (!flush && c + W >= end) break;
      if (c >= end) break;
      let s = 0; const f = p - c;
      for (let k = c - W + 1; k <= c + W; k++) {
        if (k < this.base || k >= end) continue;
        const u = (p - k + W) * P, i = u | 0, g = u - i;
        s += all[k - this.base] * (tab[i] + (tab[i + 1] - tab[i]) * g);
      }
      out.push(s); this.n++;
    }
    const keep = Math.max(0, Math.floor(this.n * r) - W - this.base);
    this.buf = all.subarray(Math.min(keep, all.length)).slice(); this.base += Math.min(keep, all.length);
    return Float32Array.from(out);
  }
}

export async function viaMedia(file, onProgress = () => {}) {
  const { Input, BlobSource, ALL_FORMATS, AudioBufferSink } = await lib();
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const at = await input.getPrimaryAudioTrack();
  if (!at) throw new Error('这个文件里没有声音');
  if (!(await at.canDecode())) throw new Error('这个浏览器解不开这种声音编码');
  const dur = await at.computeDuration();
  let out = new Float32Array(Math.ceil(dur * SR) + SR), n = 0, rs = null, t = 0, shown = 0;
  const put = y => {
    if (n + y.length > out.length) { const o = new Float32Array(Math.max(out.length * 1.25, n + y.length) | 0); o.set(out.subarray(0, n)); out = o; }
    out.set(y, n); n += y.length;
  };
  for await (const { buffer: b, timestamp } of new AudioBufferSink(at).buffers()) {
    rs ||= new Resampler(b.sampleRate);
    const C = b.numberOfChannels; let m = b.getChannelData(0);
    if (C > 1) { m = Float32Array.from(m); for (let c = 1; c < C; c++) { const d = b.getChannelData(c); for (let i = 0; i < m.length; i++) m[i] += d[i]; } for (let i = 0; i < m.length; i++) m[i] /= C; }
    // 时间戳有空洞（录音中间断开）就补静音
    const gap = Math.round((timestamp - t) * b.sampleRate);
    if (gap > b.sampleRate * 0.05) put(rs.push(new Float32Array(gap)));
    put(rs.push(m)); t = timestamp + b.duration;
    if (dur && performance.now() - shown > 250) { shown = performance.now(); onProgress(Math.min(1, t / dur)); }
  }
  if (!rs) throw new Error('声音解码失败');
  put(rs.push(new Float32Array(0), true));
  return out.subarray(0, n);
}
