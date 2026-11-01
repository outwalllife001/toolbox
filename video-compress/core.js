// 视频读写全部用 Mediabunny（MPL-2.0，原样使用）：解码 / 编码走浏览器自带的 WebCodecs（手机上一般是硬件编码），文件不出设备
// GIF 编码用 gifenc（MIT）。这个文件只管算和转，界面在 app.js
import { Input, Output, Conversion, BlobSource, BufferTarget, Mp4OutputFormat, ALL_FORMATS, Quality, CanvasSink, canEncodeVideo, canEncodeAudio } from '../vendor/mediabunny/mediabunny.min.mjs';
import { GIFEncoder, quantize, applyPalette } from '../vendor/gifenc/gifenc.esm.js';

const MB = 1e6;   // 和手机相册、文件管理里显示的「MB」一致（1MB = 100 万字节）
const even = n => Math.max(2, Math.round(n / 2) * 2);
const open = file => new Input({ source: new BlobSource(file), formats: ALL_FORMATS });

// ---------- 读视频信息 ----------
export async function probe(file) {
  const input = open(file);
  const v = await input.getPrimaryVideoTrack();
  if (!v) throw new Error('这个文件里没有画面（是不是录音文件？）');
  const a = await input.getPrimaryAudioTrack();
  const duration = await input.computeDuration();
  const vs = await v.computePacketStats(240);
  const as = a ? await a.computePacketStats(240).catch(() => null) : null;
  return {
    size: file.size, duration, w: v.displayWidth, h: v.displayHeight,
    fps: vs.averagePacketRate || 30, vcodec: v.codec, vbr: vs.averageBitrate || 0,
    acodec: a ? a.codec : null, abr: as ? as.averageBitrate : 0, channels: a ? a.numberOfChannels : 0,
    canDecode: await v.canDecode(),
  };
}

// ---------- 压缩方案：分辨率、帧率、码率 → 预计大小 ----------
// bpp = 每个像素每帧分到的比特数。第 8 期用 15 秒 1080P 的猫咪视频（原片 16.9Mbps）量过 VMAF（手机模型 / 电视模型）：
//   0.07（1080P 24 帧 ≈ 3.5Mbps）：Mac Chrome 硬件编码约 99.9 / 94；没有硬件编码器、走软件编码（OpenH264）时约 98 / 86
//   低于 0.035 开始明显糊，「指定大小」时就先降分辨率
export const PRESETS = {
  hd: { name: '高清', short: 1080, bpp: 0.11, abr: 128e3 },
  std: { name: '标准', short: 1080, bpp: 0.07, abr: 128e3 },
  small: { name: '最小', short: 720, bpp: 0.07, abr: 96e3 },
};
const SHORTS = [1080, 720, 540, 480, 360];

function dims(info, short) {
  const s = Math.min(info.w, info.h), k = Math.min(1, short / s);
  return { w: even(info.w * k), h: even(info.h * k) };
}
const outFps = info => (info.fps > 31 ? 30 : Math.round(info.fps * 100) / 100);
// 原声是 AAC、码率不高：原样拷贝（不重新编码，音质不变）
const copyAudio = (info, abr) => info.acodec === 'aac' && info.abr > 0 && info.abr <= Math.max(abr, 160e3) * 1.05;

export function plan(info, key, targetMB) {
  const fps = outFps(info);
  let p;
  if (key === 'target') {
    const abr0 = info.acodec ? (targetMB / info.duration * 8 * MB < 600e3 ? 64e3 : 96e3) : 0;
    const abr = info.acodec && copyAudio(info, abr0) && info.abr <= abr0 * 1.3 ? info.abr : abr0;
    // 留 4% 给封装开销和编码器的误差
    const vbr = Math.max(80e3, (targetMB * MB * 8 * 0.96) / info.duration - abr);
    let short = Math.min(1080, Math.min(info.w, info.h));
    for (const s of SHORTS) {
      if (s > short) continue;
      const d = dims(info, s);
      short = s;
      if (vbr / (d.w * d.h * fps) >= 0.04) break;
    }
    const d = dims(info, short);
    p = { key, ...d, fps, vbr, abr, copyAudio: !!info.acodec && abr === info.abr };
  } else {
    const pr = PRESETS[key], d = dims(info, pr.short);
    let vbr = d.w * d.h * fps * pr.bpp;
    // 不比原视频的码率还高（原片本来就很小时，最多压到原来的 75%）
    if (info.vbr) vbr = Math.min(vbr, info.vbr * 0.75);
    const cp = !!info.acodec && copyAudio(info, pr.abr);
    p = { key, ...d, fps, vbr, abr: info.acodec ? (cp ? info.abr : pr.abr) : 0, copyAudio: cp };
  }
  p.vbr = Math.round(p.vbr); p.abr = Math.round(p.abr);   // WebCodecs / Mediabunny 只收整数码率
  p.est = (p.vbr + p.abr) * info.duration / 8 * 1.01;   // 预计字节数
  p.tooLow = p.vbr / (p.w * p.h * p.fps) < 0.02;
  return p;
}

const WHY = {
  undecodable_source_codec: '这个浏览器解不开这个视频的编码（常见于 iPhone 拍的 HEVC 视频在部分安卓 / 电脑上），换手机自带浏览器或电脑 Chrome 试试',
  unknown_source_codec: '不认识这个视频的编码格式',
  no_encodable_target_codec: '这个浏览器不支持导出 MP4（H.264），换手机自带浏览器、Safari 或电脑 Chrome 试试',
};

export async function canCompress(p) {
  if (typeof VideoEncoder === 'undefined') return false;
  try { return await canEncodeVideo('avc', { width: p.w, height: p.h, bitrate: Math.round(p.vbr) }); } catch (e) { console.warn(e); return false; }
}

// ---------- 压缩：一律输出 H.264 + AAC 的 MP4（微信、苹果、安卓、电脑都能直接播） ----------
async function encode(file, p, onProgress, vbr) {
  const input = open(file);
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
  const conv = await Conversion.init({
    input, output, tracks: 'primary', showWarnings: false,
    video: {
      codec: 'avc', width: p.w, height: p.h, fit: 'fill', frameRate: p.fps,
      quality: new Quality({ bitrate: Math.round(vbr), bitrateMode: 'variable' }),
      forceTranscode: true, allowTransformationMetadata: false,   // 竖拍视频的旋转直接转进画面，老播放器也不会横过来
    },
    audio: p.abr ? (p.copyAudio ? {} : { codec: 'aac', quality: new Quality({ bitrate: p.abr }), numberOfChannels: Math.min(2, p.channels || 2) }) : { discard: true },
  });
  const lost = conv.discardedTracks.find(d => d.track.type === 'video');
  if (lost || !conv.isValid) throw new Error(WHY[lost?.reason] || '这个视频转不了（' + conv.discardedTracks.map(d => d.reason).join('、') + '）');
  conv.onProgress = onProgress;
  await conv.execute();
  return new Blob([output.target.buffer], { type: 'video/mp4' });
}

// 「指定大小」超了就按实际比例降码率再压一次（硬件编码器的码率控制有 ±10% 的误差）
export async function compress(file, p, onProgress = () => {}, targetMB = 0) {
  let blob = await encode(file, p, x => onProgress(targetMB ? x * 0.92 : x, 1), p.vbr);
  if (targetMB && blob.size > targetMB * MB) {
    const vbr2 = Math.round(Math.max(60e3, p.vbr * (targetMB * MB * 0.95) / blob.size));   // 按这次「实际 / 目标」的比例缩
    blob = await encode(file, p, x => onProgress(x, 2), vbr2);
  }
  return blob;
}

// ---------- 取同一时刻的一帧（对比原片和压缩后的画质） ----------
export async function frameAt(file, t, maxW = 1080) {
  const input = open(file);
  const v = await input.getPrimaryVideoTrack();
  const k = Math.min(1, maxW / v.displayWidth);
  const sink = new CanvasSink(v, { width: even(v.displayWidth * k), height: even(v.displayHeight * k), fit: 'fill' });
  const start = await v.getFirstTimestamp();
  const wc = await sink.getCanvas(Math.max(start, t));
  return wc ? wc.canvas : null;
}

// ---------- 转 GIF ----------
// 先从这一段里均匀取 8 帧算一个 256 色的公共调色板（每帧单独算调色板会闪），再逐帧套色。
// 试过 4×4 抖动：色带看不出改善，文件大 15–25%，就没加
// 解码出来的画布是 Mediabunny 建的（没开 willReadFrequently），先画到自己的画布上再读像素
let scratch = null;
function grab(canvas) {
  const { width: w, height: h } = canvas;
  if (!scratch || scratch.width !== w || scratch.height !== h) {
    scratch = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
    scratch.g = scratch.getContext('2d', { willReadFrequently: true });
  }
  scratch.g.drawImage(canvas, 0, 0);
  return scratch.g.getImageData(0, 0, w, h).data;
}

export async function toGif(file, { start, dur, width, fps }, onProgress = () => {}) {
  const input = open(file);
  const v = await input.getPrimaryVideoTrack();
  const w = even(Math.min(width, v.displayWidth)), h = even(w * v.displayHeight / v.displayWidth);
  const sink = new CanvasSink(v, { width: w, height: h, fit: 'fill', poolSize: 1 });
  const t0 = Math.max(start, await v.getFirstTimestamp());
  const n = Math.max(2, Math.round(dur * fps));
  const ts = Array.from({ length: n }, (_, i) => t0 + (i + 0.5) / fps);
  // 调色板
  const sample = [];
  for await (const wc of sink.canvasesAtTimestamps([0, 1, 2, 3, 4, 5, 6, 7].map(i => ts[Math.floor(i * (n - 1) / 7)]))) {
    if (!wc) continue;
    const px = grab(wc.canvas);
    for (let i = 0; i < px.length; i += 16) sample.push(px[i], px[i + 1], px[i + 2], 255);   // 每 4 个像素取 1 个
  }
  onProgress(0.08);
  const palette = quantize(new Uint8Array(sample), 256);
  const gif = GIFEncoder();
  let i = 0;
  const delay = Math.round(1000 / fps);
  for await (const wc of sink.canvasesAtTimestamps(ts)) {
    if (!wc) continue;
    const idx = applyPalette(grab(wc.canvas), palette);
    gif.writeFrame(idx, w, h, { palette: i === 0 ? palette : undefined, delay, repeat: 0 });
    onProgress(0.08 + 0.92 * (++i / n));
  }
  gif.finish();
  return { blob: new Blob([gif.bytesView()], { type: 'image/gif' }), w, h, frames: i };
}

// ---------- 提取声音：存成 M4A（AAC）。原声是 AAC 就原样拷出来，不重新编码，几乎是瞬间 ----------
export async function extractAudio(file, info, onProgress = () => {}) {
  if (!info.acodec) throw new Error('这个视频没有声音');
  const copy = info.acodec === 'aac';
  if (!copy && !(typeof AudioEncoder !== 'undefined' && await canEncodeAudio('aac').catch(() => false)))
    throw new Error('这个浏览器不支持把这种声音转成 M4A，换手机自带浏览器或电脑 Chrome 试试');
  const input = open(file);
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
  const conv = await Conversion.init({
    input, output, tracks: 'primary', showWarnings: false,
    video: { discard: true },
    audio: copy ? {} : { codec: 'aac', quality: new Quality({ bitrate: 160e3 }) },
  });
  if (!conv.isValid) throw new Error('这个视频的声音提取不了（' + conv.discardedTracks.map(d => d.reason).join('、') + '）');
  conv.onProgress = onProgress;
  await conv.execute();
  return { blob: new Blob([output.target.buffer], { type: 'audio/mp4' }), copied: copy };
}

export const fmtMB = n => n >= 100 * MB ? `${Math.round(n / MB)}MB` : n >= MB ? `${(n / MB).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1e3))}KB`;
export const fmtRate = b => b >= 1e6 ? `${(b / 1e6).toFixed(1)}Mbps` : `${Math.round(b / 1e3)}kbps`;
export const fmtDur = s => s >= 60 ? `${Math.floor(s / 60)}分${String(Math.round(s % 60)).padStart(2, '0')}秒` : `${Math.round(s * 10) / 10}秒`;
export { MB };
