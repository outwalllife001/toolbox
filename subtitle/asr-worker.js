// 识别放在 Worker 里跑：推理要占满一个 CPU 核，放主线程会让预览、进度条卡住
//   → {type:'load'}                               开始下载 / 加载模型（已经缓存过的话页面一打开就自动加载）
//   → {type:'run', samples: Float32Array(16k), lang}
//   → {type:'cancel'}
//   ← {type:'cached', yes} / {type:'progress', p} / {type:'ready'} / {type:'error', msg}
//   ← {type:'segs', segs: [[开始秒, 结束秒]...]} / {type:'part', i, tokens, t} / {type:'done', t} / {type:'canceled'}
import * as asr from './asr.js';

let loading = null, job = 0;
const load = () => (loading ||= asr.loadModel(p => postMessage({ type: 'progress', p })).then(
  () => postMessage({ type: 'ready' }),
  e => { loading = null; postMessage({ type: 'error', msg: '模型加载失败：' + (e.message || e) + '，请刷新重试' }); throw e; }));

// 模型分片都在 Cache Storage 里 → 直接加载；不在就等页面说开始（首次要下载约 160MB，不在打开页面时就偷偷下）
(async () => {
  let yes = false;
  try {
    const man = await (await fetch(asr.MODEL_DIR + 'manifest.json')).json(), c = await caches.open('toolbox-models-v1');
    yes = (await Promise.all(man.parts.map(p => c.match(asr.MODEL_DIR + p.name)))).every(Boolean);
  } catch {}
  postMessage({ type: 'cached', yes });
  if (yes) load().catch(() => {});
})();

onmessage = async ({ data }) => {
  if (data.type === 'load') return load().catch(() => {});
  if (data.type === 'cancel') { job++; return; }
  if (data.type !== 'run') return;
  const my = ++job, t0 = performance.now(), x = data.samples;
  try {
    await load();
    const segs = asr.segments(x);
    postMessage({ type: 'segs', segs: segs.map(s => [s.start / asr.SR, s.end / asr.SR]), dur: x.length / asr.SR });
    for (let i = 0; i < segs.length; i++) {
      if (my !== job) return postMessage({ type: 'canceled' });
      const s = segs[i], r = await asr.recognize(x.subarray(s.start, s.end), data.lang);
      const off = s.start / asr.SR;
      postMessage({ type: 'part', i, tokens: r.tokens.map(k => ({ s: k.s, t: +(k.t + off).toFixed(3) })), t: (performance.now() - t0) / 1000 });
    }
    postMessage({ type: 'done', t: (performance.now() - t0) / 1000 });
  } catch (e) {
    postMessage({ type: 'error', msg: '识别失败：' + (e.message || e) });
  }
};
