// 把合成出来的 PCM（24kHz 单声道 Float32）存成 WAV / MP3 / SRT。纯函数，浏览器和 node 都能跑
export const SR = 24000;

// AI 合成内容的隐式标识：写进文件的元数据里（WAV 的 LIST/INFO，MP3 的 ID3）。字段名照《人工智能生成合成内容标识办法》配套国标 GB 45438-2025 的写法
export const aigcMeta = (id = '') => JSON.stringify({ Label: '1', ContentProducer: 'toolbox-tts', ProduceID: id, ReservedCode1: '', ContentPropagator: '', PropagateID: '', ReservedCode2: '' });

const ascii = s => Uint8Array.from(s, c => c.charCodeAt(0) & 0xff);
function infoChunk(tags) {
  const parts = [];
  for (const [id, text] of Object.entries(tags)) {
    const b = new TextEncoder().encode(text + '\0'), pad = b.length & 1;
    const h = new Uint8Array(8); h.set(ascii(id)); new DataView(h.buffer).setUint32(4, b.length, true);
    parts.push(h, b); if (pad) parts.push(new Uint8Array(1));
  }
  const size = 4 + parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(8 + size), dv = new DataView(out.buffer);
  out.set(ascii('LIST')); dv.setUint32(4, size, true); out.set(ascii('INFO'), 8);
  let o = 12;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
export function toPcm16(pcm) {
  const out = new Int16Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) { const v = Math.max(-1, Math.min(1, pcm[i])); out[i] = v < 0 ? v * 32768 : v * 32767; }
  return out;
}
// 16 位 PCM 的 WAV；meta = { aigc, title }
export function encodeWav(pcm, meta = {}) {
  const data = new Uint8Array(toPcm16(pcm).buffer);
  const info = infoChunk({ ISFT: 'toolbox AI TTS (Kokoro-82M v1.1-zh)', ICMT: 'AIGC ' + (meta.aigc || aigcMeta()), ...(meta.title ? { INAM: meta.title } : {}) });
  const out = new Uint8Array(44 + data.length + info.length), dv = new DataView(out.buffer);
  out.set(ascii('RIFF')); dv.setUint32(4, out.length - 8, true); out.set(ascii('WAVEfmt '), 8);
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true); dv.setUint32(24, SR, true); dv.setUint32(28, SR * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  out.set(ascii('data'), 36); dv.setUint32(40, data.length, true); out.set(data, 44);
  out.set(info, 44 + data.length);
  return out;
}

// ID3v2.3：TXXX 帧（AIGC 标识）+ 标题。放在 MP3 数据前面
function id3(meta = {}) {
  const frames = [];
  const frame = (id, body) => { const h = new Uint8Array(10); h.set(ascii(id)); new DataView(h.buffer).setUint32(4, body.length); frames.push(h, body); };
  const utf16 = s => { const b = new Uint8Array(2 + s.length * 2); b[0] = 0xff; b[1] = 0xfe; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); b[2 + i * 2] = c & 255; b[3 + i * 2] = c >> 8; } return b; };
  const cat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let p = 0; for (const x of a) { o.set(x, p); p += x.length; } return o; };
  frame('TXXX', cat(Uint8Array.of(0), ascii('AIGC'), Uint8Array.of(0), ascii(meta.aigc || aigcMeta())));
  frame('TSSE', cat(Uint8Array.of(0), ascii('toolbox AI TTS (Kokoro-82M v1.1-zh)')));
  if (meta.title) frame('TIT2', cat(Uint8Array.of(1), utf16(meta.title)));
  const body = cat(...frames), n = body.length;
  const head = Uint8Array.of(0x49, 0x44, 0x33, 3, 0, 0, (n >> 21) & 127, (n >> 14) & 127, (n >> 7) & 127, n & 127);
  return cat(head, body);
}
// MP3：LAME 的 WASM 版（wasm-media-encoders），用到时才加载。loadEncoder() 返回 createEncoder('audio/mpeg', wasm网址) 的结果
export function encodeMp3(pcm, encoder, meta = {}, bitrate = 64) {
  encoder.configure({ sampleRate: SR, channels: 1, bitrate });
  const chunks = [id3(meta)];
  const STEP = SR * 10;
  for (let o = 0; o < pcm.length; o += STEP) chunks.push(encoder.encode([pcm.subarray(o, Math.min(pcm.length, o + STEP))]).slice());
  chunks.push(encoder.finalize().slice());
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let p = 0;
  for (const c of chunks) { out.set(c, p); p += c.length; }
  return out;
}

const stamp = t => { const ms = Math.round(t * 1000), p = (n, w = 2) => String(n).padStart(w, '0'); return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`; };
// 字幕：一句一条，时间就是这句话在配音里的起止；太长的句子在逗号处折成两行
export function toSrt(items) {
  return items.map((it, i) => {
    let t = it.text.replace(/[，。、；：！？,.;:!?…\s]+$/u, '').replace(/^["“”「」]+|["“”「」]+$/gu, '');
    if (t.length > 18) {
      const mid = t.length / 2;
      let best = -1;
      for (let k = 1; k < t.length - 1; k++) if ('，,、；：'.includes(t[k]) && (best < 0 || Math.abs(k - mid) < Math.abs(best - mid))) best = k;
      if (best > 0) t = t.slice(0, best) + '\n' + t.slice(best + 1);
    }
    return `${i + 1}\n${stamp(it.start)} --> ${stamp(it.end)}\n${t}\n`;
  }).join('\n');
}

// 波形：每个柱子取这段里的最大幅度
export function peaks(pcm, n) {
  const out = new Float32Array(n), step = pcm.length / n;
  for (let i = 0; i < n; i++) {
    let m = 0;
    const a = Math.floor(i * step), b = Math.min(pcm.length, Math.floor((i + 1) * step) + 1);
    for (let k = a; k < b; k += 2) { const v = pcm[k] < 0 ? -pcm[k] : pcm[k]; if (v > m) m = v; }
    out[i] = m;
  }
  return out;
}
