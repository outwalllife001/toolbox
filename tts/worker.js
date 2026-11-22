// 配音在 Worker 里跑：文字前端（分词、拼音、变调 → 音素）+ Kokoro 模型推理，页面不卡
// 消息（→ Worker）：
//   init  { base, threads, modelUrl? }          下载模型（存进 Cache Storage）、建会话。回 progress {stage, p} …… ready {ms, threads}
//   speak { id, text, voice, speed, label? }    回 plan {id, chunks:[{text, para, label}…]}，然后每句一条 chunk {id, i, pcm, pause, ms, sec}，最后 done {id}
//                                               label：结尾的「AI 合成」语音提示，单独一句，页面可以选择用不用
//   cancel { id }                               这次配音剩下的句子不念了
//   warm  { id, voice }                         先悄悄合成一小句（把音色下好、让模型热起来）：回 warm {id, ms}
//   g2p   { id, text }                          只看音素（测试用）：回 g2p {id, list:[{text, norm, ps, n}]}
// 出错回 error {id, message}
import { createG2P, parseLex, splitText, needsEnglish } from './g2p.js';

const CACHE = 'kokoro-zh-v1';
const SR = 24000;
const MAX_LEN = 32;                // 一句最多念这么多字，再长在逗号处拆开（模型一次念太长会越念越快）
let ort = null, sess = null, base = '', makeG2P = null, g2p = null, enLex = null;
const voices = new Map();
const cancelled = new Set();

async function fetchCached(url, onBytes = () => {}) {
  let cache = null;
  try {
    cache = await caches.open(CACHE);
    const hit = await cache.match(url);
    if (hit) { const b = new Uint8Array(await hit.arrayBuffer()); onBytes(b.length); return b; }
  } catch { cache = null; }          // 隐私模式、http 页面里没有 Cache Storage，就每次下载
  const r = await fetch(url);
  if (!r.ok) throw new Error('下载失败（' + r.status + '）：' + url.split('/').pop());
  // GitHub Pages 会 gzip：流里拿到的是解压后的字节，按块收集再拼，不按 content-length 预分配
  const chunks = [], rd = r.body.getReader();
  let n = 0;
  for (;;) {
    const { done, value } = await rd.read();
    if (done) break;
    chunks.push(value); n += value.length; onBytes(value.length);
  }
  const out = new Uint8Array(n);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  if (cache) cache.put(url, new Response(out)).catch(() => {});
  return out;
}

async function init({ base: b, threads = 1, modelUrl = null }) {
  base = b;
  const t0 = performance.now();
  // 文字前端：结巴分词（WASM）+ pinyin-pro + 读音修正表
  const [jb, , fixTxt] = await Promise.all([
    import(base + 'vendor/jieba-wasm/jieba_rs_wasm.js'),
    import(base + 'vendor/pinyin-pro/pinyin-pro.min.js'),            // UMD：挂到 globalThis.pinyinPro
    fetch(new URL('py-fix.txt', import.meta.url)).then(r => r.text()),
  ]);
  await jb.default({ module_or_path: base + 'vendor/jieba-wasm/jieba_rs_wasm_bg.wasm' });
  const pyFix = parseLex(fixTxt);
  makeG2P = lex => createG2P({ pinyin: globalThis.pinyinPro.pinyin, jieba: jb, pyFix, enLex: lex });
  g2p = makeG2P(null);
  postMessage({ type: 'progress', stage: 'text', p: 1 });

  // 模型
  let buf;
  if (modelUrl) buf = await fetchCached(modelUrl, () => {});
  else {
    const man = await (await fetch(base + 'models/kokoro/manifest.json', { cache: 'no-cache' })).json();
    buf = new Uint8Array(man.total);
    let got = 0;
    for (const p of man.parts) {
      const part = await fetchCached(base + 'models/kokoro/' + p.name, n => { got += n; postMessage({ type: 'progress', stage: 'model', p: Math.min(0.99, got / man.total), got, total: man.total }); });
      if (part.length !== p.size) throw new Error('模型文件不完整，请刷新重试');
      buf.set(part, p.offset);
    }
  }
  postMessage({ type: 'progress', stage: 'session', p: 0 });
  ort = await import(base + 'vendor/ort/ort.wasm.min.mjs');
  ort.env.wasm.wasmPaths = base + 'vendor/ort/';
  ort.env.wasm.numThreads = threads;
  ort.env.logLevel = 'error';
  sess = await ort.InferenceSession.create(buf, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  buf = null;
  postMessage({ type: 'ready', ms: Math.round(performance.now() - t0), threads });
}

async function loadVoice(name) {
  let v = voices.get(name);
  if (!v) {
    const b = await fetchCached(base + 'models/kokoro/voices/' + name + '.bin');
    if (b.length !== 510 * 256 * 4) throw new Error('音色文件不完整，请刷新重试');
    v = new Float32Array(b.buffer, b.byteOffset, 510 * 256);
    voices.set(name, v);
  }
  return v;
}
async function needEnglish(text) {
  if (enLex || !needsEnglish(text)) return;
  const b = await fetchCached(new URL('en-lex.txt', import.meta.url).href);
  enLex = parseLex(new TextDecoder().decode(b));
  g2p = makeG2P(enLex);
}

// 官方示例的办法：音素越多语速放得越慢，抵消模型念长句时越来越快的毛病
const autoSpeed = n => (n <= 83 ? 1 : n < 183 ? 1 - (n - 83) / 500 : 0.8);
// 每句开头约 0.3 秒、结尾约 0.7 秒是静音，裁掉后由页面按标点统一加停顿
function trim(x) {
  let peak = 0;
  for (let i = 0; i < x.length; i++) { const a = x[i] < 0 ? -x[i] : x[i]; if (a > peak) peak = a; }
  const thr = Math.max(peak * 0.02, 0.004);
  let s = 0, e = x.length - 1;
  while (s < x.length && Math.abs(x[s]) < thr) s++;
  while (e > s && Math.abs(x[e]) < thr) e--;
  if (s >= e) return new Float32Array(0);
  s = Math.max(0, s - Math.round(0.03 * SR)); e = Math.min(x.length, e + Math.round(0.07 * SR));
  const out = x.slice(s, e), f = Math.min(Math.round(0.006 * SR), out.length >> 1);
  for (let i = 0; i < f; i++) { out[i] *= i / f; out[out.length - 1 - i] *= i / f; }
  return out;
}
const pauseOf = (c, next, speed) => {
  let p = c.soft ? 0.16 : /[；;：:]$/.test(c.text) ? 0.28 : 0.36;
  if (next && next.para !== c.para) p = 0.62;
  if (!next) p = 0.12;
  return p / Math.sqrt(speed);
};

async function speak({ id, text, voice, speed = 1, label = '' }) {
  const chunks = splitText(text, MAX_LEN);
  if (label && chunks.length) chunks.push({ text: label, para: 1e9, first: true, soft: false, label: true });
  await needEnglish(text);
  const v = await loadVoice(voice);
  postMessage({ type: 'plan', id, chunks: chunks.map(c => ({ text: c.text, para: c.para, label: !!c.label })) });
  for (let i = 0; i < chunks.length; i++) {
    await new Promise(r => setTimeout(r, 0));          // 让出一下：不然「停止」的消息要等全部句子合成完才轮得到处理
    if (cancelled.has(id)) break;
    const c = chunks[i], t0 = performance.now();
    const { ids } = g2p.phonemize(c.text);
    const n = Math.min(ids.length - 2, 509);
    let pcm = new Float32Array(0);
    if (n > 0) {
      const feeds = {
        input_ids: new ort.Tensor('int64', BigInt64Array.from(ids, x => BigInt(x)), [1, ids.length]),
        style: new ort.Tensor('float32', v.slice(n * 256, (n + 1) * 256), [1, 256]),
        speed: new ort.Tensor('float32', Float32Array.of(speed * autoSpeed(n)), [1]),
      };
      const out = await sess.run(feeds);
      pcm = trim(out.waveform.data);
      for (const k in out) out[k].dispose?.();
    }
    postMessage({ type: 'chunk', id, i, pcm, pause: pauseOf(c, chunks[i + 1], speed), ms: Math.round(performance.now() - t0), sec: pcm.length / SR }, [pcm.buffer]);
  }
  cancelled.delete(id);
  postMessage({ type: 'done', id });
}

let queue = Promise.resolve();
onmessage = ({ data }) => {
  if (data.type === 'cancel') { cancelled.add(data.id); return; }
  queue = queue.then(async () => {
    try {
      if (data.type === 'init') await init(data);
      else if (data.type === 'speak') await speak(data);
      else if (data.type === 'warm') {
        const t0 = performance.now(), v = await loadVoice(data.voice), { ids } = g2p.phonemize('你好。'), n = ids.length - 2;
        const out = await sess.run({ input_ids: new ort.Tensor('int64', BigInt64Array.from(ids, x => BigInt(x)), [1, ids.length]), style: new ort.Tensor('float32', v.slice(n * 256, (n + 1) * 256), [1, 256]), speed: new ort.Tensor('float32', Float32Array.of(1), [1]) });
        for (const k in out) out[k].dispose?.();
        postMessage({ type: 'warm', id: data.id, ms: Math.round(performance.now() - t0) });
      } else if (data.type === 'g2p') {
        await needEnglish(data.text);
        postMessage({ type: 'g2p', id: data.id, list: splitText(data.text, MAX_LEN).map(c => { const r = g2p.phonemize(c.text); return { text: c.text, norm: r.norm, ps: r.ps, n: r.ids.length - 2 }; }) });
      }
    } catch (e) {
      postMessage({ type: 'error', id: data.id ?? 'init', message: (e && e.message) || String(e) });
    }
  });
};
