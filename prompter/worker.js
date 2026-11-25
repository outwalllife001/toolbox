// 识别放在 Worker 里跑，页面上滚字不被卡住
// 进：{type:'load'} ｜ {type:'start', rate} 开一条新的流 ｜ {type:'audio', data: Float32Array} ｜ {type:'stop'}
// 出：{type:'progress', p} ｜ {type:'ready'} ｜ {type:'chars', list:[{ch,t}], sec, blanks, lag} ｜ {type:'error', message}
import { loadModel, Stream, Resampler } from './asr.js';

let stream = null, rs = null, queue = [], busy = false, loading = null, gen = 0, peak = 0;

self.onmessage = async ({ data: m }) => {
  try {
    if (m.type === 'load') {
      loading ||= loadModel(p => self.postMessage({ type: 'progress', p }));
      await loading;
      self.postMessage({ type: 'ready' });
    } else if (m.type === 'start') {
      await (loading ||= loadModel(p => self.postMessage({ type: 'progress', p })));
      gen++; queue = []; stream = new Stream(); rs = new Resampler(m.rate);
      self.postMessage({ type: 'started' });
    } else if (m.type === 'audio') {
      if (!stream) return;
      queue.push({ x: m.data, at: performance.now() });
      pump();
    } else if (m.type === 'stop') {
      gen++; stream = null; queue = [];
    }
  } catch (e) {
    loading = null;
    self.postMessage({ type: 'error', message: e && e.message || String(e) });
  }
};

async function pump() {
  if (busy) return;
  busy = true;
  const g = gen;
  try {
    while (queue.length && stream && g === gen) {
      const { x, at } = queue.shift();
      const list = await stream.accept(rs.push(x));
      if (g !== gen || !stream) break;
      // lag：一块声音从收到到认完用了多久（毫秒，取最近的峰值）；一直涨说明这台设备算不过来
      peak = Math.max(performance.now() - at, peak * 0.97);
      self.postMessage({ type: 'chars', list, sec: stream.seconds, blanks: stream.blanks, lag: Math.round(peak) });
    }
  } catch (e) {
    self.postMessage({ type: 'error', message: e && e.message || String(e) });
  }
  busy = false;
  if (queue.length && stream) pump();
}
