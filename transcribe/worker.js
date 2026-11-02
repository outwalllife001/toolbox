// 识别 Worker：复用第 4 期字幕页的语音识别核心（../subtitle/asr.js：SenseVoice + sherpa-onnx 的推理流程），模型文件和缓存也是同一份，
// 用过字幕页的不用再下载。网站根目录的 coi-sw.js 给这一页补上跨源隔离的响应头，这里才能开多线程
//   → {type:'load'} / {type:'run', samples: Float32Array(16k), lang} / {type:'cancel'}
//   ← {type:'cached', yes, threads} / {type:'progress', p} / {type:'ready'} / {type:'error', msg}
//   ← {type:'segs', segs, dur} / {type:'part', i, tokens, t} / {type:'done', t} / {type:'canceled'}
import * as asr from '../subtitle/asr.js';

const THREADS = self.crossOriginIsolated ? Math.min(+new URLSearchParams(self.location.search).get('threads') || 4, navigator.hardwareConcurrency || 2) : 1;
let loading = null, job = 0;
const load = () => (loading ||= asr.loadModel(p => postMessage({ type: 'progress', p })).then(
  () => postMessage({ type: 'ready' }),
  e => { loading = null; postMessage({ type: 'error', msg: '模型加载失败：' + (e.message || e) + '，请刷新重试' }); throw e; }));

(async () => {
  let yes = false;
  try {
    const man = await (await fetch(asr.MODEL_DIR + 'manifest.json')).json(), c = await caches.open('toolbox-models-v1');
    yes = (await Promise.all(man.parts.map(p => c.match(asr.MODEL_DIR + p.name)))).every(Boolean);
  } catch {}
  postMessage({ type: 'cached', yes, threads: THREADS });
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
