// 视频读写（Mediabunny，MPL-2.0，原样使用）：大文件只读音轨来识别；烧录字幕导出 MP4（WebCodecs 硬件编码，声音原样拷贝）
// 700KB，用到时才加载
import { Input, Output, Conversion, BlobSource, BufferTarget, Mp4OutputFormat, ALL_FORMATS, QUALITY_HIGH, canEncodeVideo, AudioBufferSink } from '../vendor/mediabunny/mediabunny.min.mjs';
import { drawCue, cueAt } from './render.js';

// 只把音轨解码出来，混成单声道，重采样到 16k（不用把整个视频读进内存）
export async function audioOf(file, sr = 16000) {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const at = await input.getPrimaryAudioTrack();
  if (!at) throw new Error('这个文件里没有声音');
  const bufs = [];
  for await (const { buffer, timestamp } of new AudioBufferSink(at).buffers()) bufs.push({ buffer, timestamp });
  if (!bufs.length) throw new Error('声音解码失败');
  const rate = bufs[0].buffer.sampleRate;
  const last = bufs[bufs.length - 1], n = Math.ceil((last.timestamp + last.buffer.duration) * rate);
  const mono = new Float32Array(n);
  for (const { buffer: b, timestamp } of bufs) {
    const o = Math.round(Math.max(0, timestamp) * rate), C = b.numberOfChannels;
    for (let c = 0; c < C; c++) { const d = b.getChannelData(c); for (let i = 0; i < d.length && o + i < n; i++) mono[o + i] += d[i] / C; }
  }
  return resample(mono, rate, sr);
}

export async function resample(x, from, to) {
  if (from === to) return x;
  const AC = self.OfflineAudioContext || self.webkitOfflineAudioContext;
  const oc = new AC(1, Math.ceil(x.length * to / from), to), b = oc.createBuffer(1, x.length, from);
  b.getChannelData(0).set(x);
  const src = oc.createBufferSource(); src.buffer = b; src.connect(oc.destination); src.start();
  return (await oc.startRendering()).getChannelData(0);
}

// 能不能在这个浏览器里导出 MP4（要 WebCodecs H.264 编码；部分 App 内置浏览器、旧版 Safari 没有）
export async function canBurn(w, h) {
  if (typeof VideoEncoder === 'undefined' || typeof OffscreenCanvas === 'undefined') return false;
  try { return await canEncodeVideo('avc', { width: w, height: h }); } catch { return false; }
}

const WHY = {
  undecodable_source_codec: '这个浏览器解不开视频画面的编码（常见于 iPhone 拍的 HEVC 视频），换 Safari 或电脑 Chrome 试试',
  unknown_source_codec: '不认识这个视频的编码格式，可以先转成 MP4 再试',
  no_encodable_target_codec: '这个浏览器不支持导出 H.264 视频，换手机自带浏览器或电脑 Chrome 试试',
};

export async function burn(file, cues, opts, onProgress = () => {}) {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
  let canvas = null, g = null;
  const conv = await Conversion.init({
    input, output,
    video: {
      codec: 'avc', quality: QUALITY_HIGH, forceTranscode: true,
      allowTransformationMetadata: false,   // 手机竖拍的旋转信息先转进画面里，字幕才不会跟着横过来
      process: sample => {
        const W = sample.displayWidth, H = sample.displayHeight;
        if (!canvas || canvas.width !== W || canvas.height !== H) { canvas = new OffscreenCanvas(W, H); g = canvas.getContext('2d'); }
        sample.draw(g, 0, 0, W, H);
        const c = cueAt(cues, sample.timestamp);
        if (c) drawCue(g, c.text, W, H, opts);
        return canvas;
      },
    },
  });
  // 画面轨被丢掉时 isValid 仍可能是 true（只剩声音），所以单独检查画面
  const lost = conv.discardedTracks.find(d => d.track.type === 'video');
  if (lost || !conv.isValid) throw new Error(WHY[lost?.reason] || '这个视频格式导出不了（' + conv.discardedTracks.map(d => d.reason).join('、') + '）');
  conv.onProgress = p => onProgress(p);
  await conv.execute();
  return new Blob([output.target.buffer], { type: 'video/mp4' });
}
