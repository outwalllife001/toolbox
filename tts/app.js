import { SR, encodeWav, encodeMp3, toSrt, peaks, aigcMeta } from './audio.js';

const $ = id => document.getElementById(id);
const Q = new URLSearchParams(location.search);
const BASE = new URL('../', import.meta.url).href;
// 录视频用的网址参数（days/*/scenes.mjs）：?hold 生成时不自动播放、不自动滚动，由分镜调 window.__tts.play()
const HOLD = Q.has('hold');
// 启用会员后，免费版一次配 1000 字（一条短视频的口播一般两三百字），会员不限；window.__FREE_CHARS 只给自动测试用
const FREE_CHARS = window.__FREE_CHARS || 1000;
const MAX_CHARS = 20000;
const LABEL_TEXT = '以上内容由人工智能合成。';
// 音色：Kokoro v1.1-zh 自带 100 个中文音色，这里挑了 8 个（挑法见 days/day17-tts/README.md：回听错字率 0、音高分档、语速适中）。名字和说明是我们按量出来的音高、语速起的
const VOICES = [
  { id: 'zf_001', name: '女声 1', desc: '高音 · 快', g: 'f' },
  { id: 'zf_036', name: '女声 2', desc: '中低音', g: 'f' },
  { id: 'zf_026', name: '女声 3', desc: '起伏大', g: 'f' },
  { id: 'zf_093', name: '女声 4', desc: '高音', g: 'f' },
  { id: 'zf_017', name: '女声 5', desc: '最高音', g: 'f' },
  { id: 'zm_010', name: '男声 1', desc: '中音 · 快', g: 'm' },
  { id: 'zm_033', name: '男声 2', desc: '低音', g: 'm' },
  { id: 'zm_095', name: '男声 3', desc: '中高音', g: 'm' },
];
const SPEEDS = [['慢', 0.85], ['正常', 1], ['稍快', 1.15], ['快', 1.3]];
const DEMOS = [
  ['带货', '家人们，今天给大家推荐一款我自己回购了3次的保温杯。早上灌的热水，到晚上还是烫的，杯盖一按就开，单手就能喝。关键是价格，不到一杯奶茶钱，喜欢的赶紧去试试！'],
  ['知识', '你知道吗？人的一生，大约有1/3的时间在睡觉。可是睡得久，不等于睡得好。今天教你3个小方法，让你躺下10分钟就能睡着。'],
  ['故事', '很久很久以前，森林里住着一只聪明的小狐狸。它每天最喜欢做的事，就是坐在山坡上，看太阳一点一点落下去。'],
];
const st = {
  voice: 0, speed: 1, threads: 1, cached: null, ready: false, loading: false, busy: false, done: false, job: 0, t0: 0,
  chunks: [],            // {text, para, label, pcm, pk, pause, start, end, ms}
  useLabel: true, total: 0, genVoice: 0, genSpeed: 1, title: '',
};
const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const countChars = t => (t.match(/[一-鿿A-Za-z0-9]/g) || []).length;
const mmss = s => { s = Math.max(0, Math.round(s)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
const human = s => (s >= 60 ? `${Math.floor(s / 60)} 分 ${Math.round(s % 60)} 秒` : `${s < 10 ? s.toFixed(1) : Math.round(s)} 秒`);

// ---------- 选项 ----------
$('voices').innerHTML = VOICES.map((v, i) => `<button class="voice ${v.g}${i === 0 ? ' on' : ''}" data-i="${i}"><i>${v.g === 'f' ? '女' : '男'}</i><b>${esc(v.name)}</b><small>${esc(v.desc)}</small></button>`).join('');
$('speeds').innerHTML = SPEEDS.map(([n], i) => `<button class="chip${i === st.speed ? ' on' : ''}" data-i="${i}">${n}</button>`).join('');
$('demos').innerHTML = DEMOS.map(([n], i) => `<button class="chip" data-i="${i}" style="padding:4px 10px;font-size:13px">${n}</button>`).join('');
const sample = new Audio();
sample.preload = 'none';
const stopSample = () => { sample.pause(); document.querySelectorAll('.voice.playing').forEach(x => x.classList.remove('playing')); };
sample.onended = sample.onerror = stopSample;
$('voices').addEventListener('click', e => {
  const b = e.target.closest('.voice'); if (!b) return;
  const i = +b.dataset.i, was = b.classList.contains('playing');
  st.voice = i;
  document.querySelectorAll('.voice').forEach(x => x.classList.toggle('on', x === b));
  stopSample(); refresh();
  if (was) return;                              // 正在试听时再点一下 = 停
  pause();
  b.classList.add('playing');
  if (HOLD) { setTimeout(() => b.classList.remove('playing'), 2600); return; }      // 录视频时声音由分镜另外混进去
  sample.src = `samples/${VOICES[i].id}.mp3`;
  sample.play().catch(stopSample);
});
$('speeds').addEventListener('click', e => {
  const b = e.target.closest('.chip'); if (!b) return;
  st.speed = +b.dataset.i;
  $('speeds').querySelectorAll('.chip').forEach(x => x.classList.toggle('on', x === b));
  count(); refresh();
});
$('demos').addEventListener('click', e => { const b = e.target.closest('.chip'); if (!b) return; $('text').value = DEMOS[+b.dataset.i][1]; count(); refresh(); });
$('clear').onclick = () => { $('text').value = ''; count(); refresh(); $('text').focus(); };
$('paste').onclick = async () => {
  try { const t = await navigator.clipboard.readText(); if (t) { $('text').value = t; count(); refresh(); return; } } catch { /* 没权限就让用户自己长按粘贴 */ }
  $('text').focus(); setStatus('长按输入框，选「粘贴」');
};
$('text').addEventListener('input', () => { count(); refresh(); });
function count() {
  const n = countChars($('text').value);
  $('count').textContent = n ? `${n} 字 · 约 ${human(n / 4.4 / SPEEDS[st.speed][1])}` : '0 字';
}
function setStatus(text, cls = '') { const s = $('status'); s.textContent = text; s.className = 'status ' + cls; }
function setBar(p) { $('bar').hidden = p == null; if (p != null) $('barIn').style.width = Math.round(p * 100) + '%'; }
const dirty = () => st.done && ($('text').value.trim() !== st.genText || st.voice !== st.genVoice || st.speed !== st.genSpeed);
function refresh() {
  const has = countChars($('text').value) > 0;
  $('go').disabled = !has && !st.busy;
  $('go').textContent = st.busy ? '停止' : st.done && !dirty() ? '重新生成' : '生成配音';
  for (const id of ['mp3', 'wav', 'srt']) $(id).disabled = st.busy || !st.done;
  if (!st.busy && !st.loading) {
    if (!has) setStatus(st.cached === false ? '第一次用要下载约 80MB 的配音模型（只下一次，建议连 Wi-Fi）；试听声音不用等' : '');
    else if (dirty()) setStatus('文案或声音改过了，点「生成配音」重新配');
  }
}

// ---------- 合成 Worker ----------
st.threads = +Q.get('threads') || (self.crossOriginIsolated ? Math.max(1, Math.min(4, navigator.hardwareConcurrency || 2)) : 1);
document.body.dataset.threads = st.threads;
let worker = null, readyP = null;
function ensureWorker() {
  if (readyP) return readyP;
  st.loading = true;
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  readyP = new Promise((ok, no) => {
    worker.onmessage = ({ data: m }) => {
      if (m.type === 'progress') {
        if (m.stage === 'model') { setBar(m.p * 0.92); setStatus(st.cached ? '正在加载配音模型…' : `正在下载配音模型 ${Math.round(m.p * 100)}%（约 80MB，只下载一次）`); }
        else if (m.stage === 'session') { setBar(0.95); setStatus('模型下载好了，正在启动…'); }
      } else if (m.type === 'ready') { st.ready = true; st.loading = false; st.cached = true; document.body.dataset.model = 'ready'; ok(); }
      else if (m.type === 'error' && m.id === 'init') { st.loading = false; readyP = null; worker.terminate(); worker = null; no(new Error(m.message)); }
      else onWorker(m);
    };
    worker.onerror = e => { st.loading = false; readyP = null; no(new Error(e.message || '配音模块加载失败')); };
    worker.postMessage({ type: 'init', base: BASE, threads: st.threads });
  });
  return readyP;
}
(async () => {          // 模型下过没有：只影响提示语
  try { const c = await caches.open('kokoro-zh-v1'); st.cached = !!(await c.match(BASE + 'models/kokoro/kokoro_zh_int8w.onnx.part0')); } catch { st.cached = null; }
  refresh();
  if (Q.get('preload')) ensureWorker().then(refresh, () => {});
})();

// ---------- 生成 ----------
$('go').onclick = async () => {
  if (st.busy) { stop(); return; }
  let text = $('text').value.replace(/\r/g, '').trim();
  if (!countChars(text)) return;
  ensureCtx(); stopSample(); pause();
  if (countChars(text) > MAX_CHARS) { setStatus(`一次最多 ${MAX_CHARS} 字，太长的文案分几次配`, 'bad'); return; }
  if (countChars(text) > FREE_CHARS && window.Member?.enabled) {
    const r = await Member.gate({ title: `这段文案有 ${countChars(text)} 字`, text: `免费版一次配 ${FREE_CHARS} 字（短视频口播一般两三百字）；开通会员不限字数，长文章、有声书一次配完。`, free: `先免费配前 ${FREE_CHARS} 字` });
    if (!r) return;
    if (r === 'free') text = cutTo(text, FREE_CHARS);
  }
  const id = ++st.job;
  Object.assign(st, { busy: true, done: false, chunks: [], total: 0, t0: performance.now(), genText: $('text').value.trim(), genVoice: st.voice, genSpeed: st.speed, title: text.replace(/\s+/g, '').slice(0, 12) });
  play.pos = 0; play.live = !HOLD;
  $('keep').hidden = false; setBar(st.ready ? 0.02 : 0); refresh();
  if (!st.ready) setStatus(st.cached ? '正在加载配音模型…' : '正在下载配音模型…');
  try { await ensureWorker(); } catch (e) { fail(e.message); return; }
  if (id !== st.job) return;
  setStatus('正在分句…');
  worker.postMessage({ type: 'speak', id, text, voice: VOICES[st.voice].id, speed: SPEEDS[st.speed][1], label: LABEL_TEXT });
};
// 截到前 n 个字，尽量停在句子结尾
function cutTo(text, n) {
  let c = 0, i = 0;
  for (; i < text.length && c < n; i++) if (/[一-鿿A-Za-z0-9]/.test(text[i])) c++;
  const head = text.slice(0, i), m = /^[\s\S]*[。！？!?…\n]/.exec(head);
  return m && countChars(m[0]) > n * 0.7 ? m[0] : head;
}
function stop() {
  if (!st.busy) return;
  worker?.postMessage({ type: 'cancel', id: st.job });
  setStatus('正在停止…');
}
function fail(msg) {
  Object.assign(st, { busy: false }); setBar(null); $('keep').hidden = true;
  if (/memory|allocat|out of bounds|OOM/i.test(msg || '')) msg = '内存不够，模型没跑起来：关掉别的网页再试，或者换电脑打开';
  setStatus(msg || '出错了，刷新页面再试', 'bad'); refresh();
}
const g2pWait = new Map();
function onWorker(m) {
  if (m.type === 'g2p' || m.type === 'warm') { g2pWait.get(m.id)?.(m.list ?? m.ms); g2pWait.delete(m.id); return; }
  if (m.type === 'error') { if (m.id === st.job) fail(m.message); return; }
  if (m.id !== st.job) return;
  if (m.type === 'plan') {
    st.chunks = m.chunks.map(c => ({ text: c.text, para: c.para, label: !!c.label, pcm: null, pause: 0, start: 0, end: 0 }));
    $('result').hidden = false;
    renderSents(); layout(); draw();
    $('who').textContent = `${VOICES[st.genVoice].name} · ${SPEEDS[st.genSpeed][0]}速`;
    setStatus(`正在合成第 1 / ${st.chunks.length} 句…`);
    if (!HOLD) $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else if (m.type === 'chunk') {
    const c = st.chunks[m.i]; if (!c) return;
    Object.assign(c, { pcm: m.pcm, pause: m.pause, ms: m.ms, pk: peaks(m.pcm, Math.max(1, Math.ceil(m.pcm.length / SR * 100))) });
    layout(); markSents(); draw();
    const n = st.chunks.filter(x => x.pcm).length;
    setBar(0.02 + 0.98 * n / st.chunks.length);
    if (n < st.chunks.length) setStatus(`正在合成第 ${n + 1} / ${st.chunks.length} 句…${play.live && n === 1 ? '（边合成边播放）' : ''}`);
    $('stat').textContent = `${human(avail())}`;
    if (play.live) feed(m.i);
  } else if (m.type === 'done') {
    const got = st.chunks.filter(x => x.pcm), stopped = got.length < st.chunks.length;
    st.chunks = got;
    if (stopped && st.chunks.length && !st.chunks.some(c => c.label)) st.chunks[st.chunks.length - 1].pause = 0.12;
    Object.assign(st, { busy: false, done: st.chunks.some(c => !c.label) });
    renderSents(); layout(); markSents(); draw(); hilite(position());
    setBar(null); $('keep').hidden = true;
    const sec = (performance.now() - st.t0) / 1000;
    if (st.done) { setStatus(`${stopped ? '已停止，前面的句子可以用' : '配好了'} · ${human(st.total)}的配音，用时 ${human(sec)}`, 'done'); $('stat').textContent = `${human(st.total)} · ${st.chunks.filter(c => !c.label).length} 句`; }
    else { setStatus(''); $('result').hidden = true; }
    document.body.dataset.done = String(st.job);
    refresh();
  }
}

// ---------- 时间轴 ----------
const used = () => st.chunks.filter(c => c.pcm && (st.useLabel || !c.label));
function layout() {
  let t = 0;
  const list = st.chunks.filter(c => st.useLabel || !c.label);
  list.forEach((c, i) => {
    c.start = t;
    if (!c.pcm) { c.end = t; return; }
    c.end = t + c.pcm.length / SR;
    const last = i === list.length - 1 || !list[i + 1];
    t = c.end + (last && !st.busy ? 0.12 : c.pause);
  });
  st.total = t;
}
// 已经合成出来、可以连着播的部分有多长
function avail() { let t = 0; for (const c of st.chunks) { if (!st.useLabel && c.label) continue; if (!c.pcm) break; t = c.end + c.pause; } return st.busy ? t : Math.min(t, st.total) || st.total; }
// 还没合成完时，按字数估一下总长（画波形用）
function estTotal() {
  if (!st.busy) return st.total;
  let doneChars = 0, allChars = 0, t = 0;
  for (const c of st.chunks) { const n = countChars(c.text) + 2; allChars += n; if (c.pcm) { doneChars += n; t = c.end + c.pause; } }
  return doneChars ? Math.max(t, t * allChars / doneChars) : 1;
}
function fullPcm() {
  const list = used(), out = new Float32Array(Math.ceil(st.total * SR) + 1);
  for (const c of list) out.set(c.pcm, Math.round(c.start * SR));
  return out.subarray(0, Math.round(st.total * SR));
}

// ---------- 句子列表 ----------
function renderSents() {
  $('sents').innerHTML = st.chunks.map((c, i) => `<div class="sent wait${c.label ? ' label' : ''}" data-i="${i}"${c.label && !st.useLabel ? ' hidden' : ''}><span class="t">…</span><span class="x">${esc(c.text)}${c.label ? '（AI 合成提示）' : ''}</span></div>`).join('');
  curSent = -1;          // 列表重画了，高亮要重新标
}
function markSents() {
  const els = $('sents').children;
  st.chunks.forEach((c, i) => {
    const el = els[i]; if (!el) return;
    el.hidden = c.label && !st.useLabel;
    el.classList.toggle('wait', !c.pcm);
    el.firstChild.textContent = c.pcm ? mmss(c.start) : '…';
  });
}
$('sents').addEventListener('click', e => {
  const el = e.target.closest('.sent'); if (!el) return;
  const c = st.chunks[+el.dataset.i];
  if (c && c.pcm) { ensureCtx(); play.live = st.busy; playFrom(c.start + 0.001); }
});
let curSent = -1;
function hilite(pos) {
  let k = -1;
  for (let i = 0; i < st.chunks.length; i++) { const c = st.chunks[i]; if (!c.pcm || (c.label && !st.useLabel)) continue; if (pos >= c.start - 0.02) k = i; }
  if (!play.on && pos <= 0.001) k = -1;
  if (k === curSent) return;
  const els = $('sents').children;
  if (els[curSent]) els[curSent].classList.remove('on');
  curSent = k;
  const el = els[k];
  if (el) {
    el.classList.add('on');
    const box = $('sents'), top = el.offsetTop - box.offsetTop;
    if (top < box.scrollTop || top + el.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = Math.max(0, top - box.clientHeight / 3);
  }
}

// ---------- 波形 ----------
const cv = $('cv'), g2d = cv.getContext('2d');
function draw() {
  const dpr = Math.min(3, window.devicePixelRatio || 1), W = Math.round(cv.clientWidth * dpr), H = Math.round(72 * dpr);
  if (!W) return;
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  g2d.clearRect(0, 0, W, H);
  const total = estTotal() || 1, bw = 3 * dpr, n = Math.floor(W / bw), pos = position(), list = st.chunks.filter(c => c.pcm && (st.useLabel || !c.label));
  let ci = 0;
  for (let b = 0; b < n; b++) {
    const t0 = b / n * total, t1 = (b + 1) / n * total;
    while (ci < list.length - 1 && list[ci].end < t0) ci++;
    let m = 0;
    for (let k = ci; k < list.length && list[k].start < t1; k++) {
      const c = list[k], a = Math.max(0, Math.floor((t0 - c.start) * 100)), z = Math.min(c.pk.length, Math.ceil((t1 - c.start) * 100));
      for (let j = a; j < z; j++) if (c.pk[j] > m) m = c.pk[j];
    }
    const h = Math.max(2 * dpr, Math.min(1, m * 2.2) * (H - 4 * dpr));
    g2d.fillStyle = t1 <= pos ? '#6b9bff' : t0 > avail() + 0.01 && st.busy ? 'rgba(255,255,255,.10)' : 'rgba(255,255,255,.42)';
    g2d.fillRect(b * bw, (H - h) / 2, bw - dpr, h);
  }
  if (pos > 0 && pos < total) { g2d.fillStyle = '#ffd84d'; g2d.fillRect(Math.round(pos / total * W) - dpr, 0, 2 * dpr, H); }
  $('time').textContent = `${mmss(pos)} / ${mmss(st.busy ? avail() : st.total)}`;
}
cv.addEventListener('click', e => {
  if (!used().length) return;
  const r = cv.getBoundingClientRect(), t = Math.min(avail() - 0.05, Math.max(0, (e.clientX - r.left) / r.width * (estTotal() || 1)));
  ensureCtx(); play.live = st.busy;
  if (play.on) playFrom(t); else { play.pos = t; draw(); hilite(t); }
});
window.addEventListener('resize', draw);

// ---------- 播放（Web Audio：每句一个音频块，按时间轴排好；没有声音设备时只走画面） ----------
let ctx = null;
function ensureCtx() {
  try {
    if (!ctx) { const AC = window.AudioContext || window.webkitAudioContext; if (AC) ctx = new AC(); }
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
  } catch { ctx = null; }
}
const play = { on: false, live: false, pos: 0, t0: 0, audible: false, nodes: [], raf: 0, stalled: false, next: 0 };
const clock = () => (play.audible ? ctx.currentTime : performance.now() / 1000);
function position() { return play.on ? Math.max(0, Math.min(play.stalled ? play.pos : clock() - play.t0, avail())) : play.pos; }
function schedule(c, pos, at) {            // 把一句排到 at 时刻（时间轴上从 pos 开始）
  if (!play.audible || !c.pcm.length) return;
  const buf = ctx.createBuffer(1, c.pcm.length, SR);
  buf.getChannelData(0).set(c.pcm);
  const src = ctx.createBufferSource();
  src.buffer = buf; src.connect(ctx.destination);
  const off = Math.max(0, pos - c.start);
  if (off >= buf.duration) return;
  src.start(Math.max(ctx.currentTime, at + Math.max(0, c.start - pos)), off);
  play.nodes.push(src);
}
function killNodes() { for (const n of play.nodes) { try { n.onended = null; n.stop(); n.disconnect(); } catch { /* 还没开始的节点 stop 会抛 */ } } play.nodes = []; }
function playFrom(pos) {
  killNodes(); stopSample();
  const list = used();
  if (!list.length) return;
  if (pos >= avail() - 0.03) pos = 0;
  play.audible = !!ctx && ctx.state === 'running';
  const at = clock() + 0.04;
  play.t0 = at - pos; play.pos = pos; play.on = true; play.stalled = false;
  play.next = 0;
  st.chunks.forEach((c, i) => { if (c.pcm && (st.useLabel || !c.label) && c.end > pos) schedule(c, pos, at); if (c.pcm) play.next = i + 1; });
  $('wave').classList.add('playing');
  cancelAnimationFrame(play.raf); play.raf = requestAnimationFrame(tick);
}
// 边合成边播：新的一句到了
function feed(i) {
  const c = st.chunks[i];
  if (c.label && !st.useLabel) return;
  if (!play.on) { if (i === 0 || play.stalled) playFrom(play.stalled ? c.start : 0); return; }
  if (play.stalled) {           // 播得比合成快，上一句播完在等：从这一句接着播
    play.audible = !!ctx && ctx.state === 'running';
    const at = clock() + 0.03;
    play.t0 = at - c.start; play.pos = c.start; play.stalled = false;
    schedule(c, c.start, at);
  } else schedule(c, position(), clock());
}
function tick() {
  if (!play.on) return;
  const end = avail(), raw = play.stalled ? play.pos : clock() - play.t0;
  if (raw >= end - 0.005) {
    if (st.busy && play.live) { play.stalled = true; play.pos = end; }          // 等下一句
    else { pause(); play.pos = 0; draw(); hilite(0); return; }
  }
  const pos = position();
  draw(); hilite(pos);
  play.raf = requestAnimationFrame(tick);
}
function pause() {
  if (!play.on) return;
  play.pos = position(); play.on = false; play.stalled = false; play.live = false;
  killNodes(); cancelAnimationFrame(play.raf);
  $('wave').classList.remove('playing');
  draw();
}
$('pp').onclick = () => { ensureCtx(); if (play.on) pause(); else { play.live = st.busy; playFrom(play.pos); } };

// ---------- AI 合成提示 ----------
$('aiLabel').onchange = () => {
  st.useLabel = $('aiLabel').checked;
  $('aiNote').textContent = st.useLabel ? '按规定，AI 合成的声音要让听的人知道是 AI 合成的。' : '已去掉语音提示。发布时请在平台上勾选「内容由 AI 生成」，标明这是 AI 配音；文件里的标识信息还在。';
  const was = play.on; pause();
  layout(); markSents();
  if (play.pos > st.total) play.pos = 0;
  draw(); hilite(play.pos);
  if (st.done) $('stat').textContent = `${human(st.total)} · ${st.chunks.filter(c => !c.label).length} 句`;
  if (was) playFrom(play.pos);
};

// ---------- 下载 ----------
function save(data, name, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  window.__lastSave = { name, size: data.size ?? data.length, data };
}
const fileBase = () => `配音_${(st.title || 'AI').replace(/[\\/:*?"<>|.，。！？、；：\s]/g, '').slice(0, 10) || 'AI'}_${VOICES[st.genVoice].name.replace(/\s/g, '')}`;
const meta = () => ({ title: st.title, aigc: aigcMeta(Date.now().toString(36)) });
let mp3Enc = null;
function loadMp3() {
  return (mp3Enc ||= new Promise((ok, no) => {
    const s = document.createElement('script');
    s.src = BASE + 'vendor/wme/WasmMediaEncoder.min.js';
    s.onload = () => window.WasmMediaEncoder.createEncoder('audio/mpeg', BASE + 'vendor/wme/mp3.wasm').then(ok, no);
    s.onerror = () => no(new Error('MP3 编码模块没加载出来，检查网络后再点一次；或者先下载 WAV'));
    document.head.appendChild(s);
  }).catch(e => { mp3Enc = null; throw e; }));
}
$('mp3').onclick = async () => {
  if (!st.done) return;
  try {
    setStatus('正在转成 MP3…');
    const enc = await loadMp3();
    save(encodeMp3(fullPcm(), enc, meta()), fileBase() + '.mp3', 'audio/mpeg');
    setStatus('MP3 已保存 · ' + human(st.total), 'done');
  } catch (e) { setStatus(e.message || 'MP3 没转成功，先下载 WAV', 'bad'); }
};
$('wav').onclick = () => { if (!st.done) return; save(encodeWav(fullPcm(), meta()), fileBase() + '.wav', 'audio/wav'); setStatus('WAV 已保存 · ' + human(st.total), 'done'); };
$('srt').onclick = async () => {
  if (!st.done) return;
  const r = window.Member ? await Member.gate({ title: '字幕文件是会员功能', text: '配音、下载 MP3 / WAV 都免费；导出和配音对好时间的字幕文件（SRT，剪映能直接导入）需要工具箱会员。' }) : 'member';
  if (r !== 'member') return;
  const items = used().filter(c => !c.label).map(c => ({ text: c.text, start: c.start, end: c.end }));
  save('﻿' + toSrt(items), fileBase() + '.srt', 'text/plain;charset=utf-8');
  setStatus('字幕文件已保存 · ' + items.length + ' 条', 'done');
};

// ---------- 代做入口：site/config.js 里配置了才显示；service.tools.tts 可以单独设置这一页的价格和说明 ----------
const svc = window.SITE_CONFIG && window.SITE_CONFIG.service;
if (svc) {
  const s = { ...svc, ...((svc.tools || {}).tts || {}) };
  $('service').innerHTML = `<h2>找我代做 <b>${esc(s.price)}</b></h2><p>${esc(s.text)}</p><p class="contact">${esc(s.contact)}</p>${s.qr ? `<img src="../${esc(s.qr)}" alt="联系方式二维码">` : ''}`;
  $('service').hidden = false;
}
if (window.Member?.enabled) $('faqLimit').textContent = `不用登录，不按字数计费。免费版一次配 ${FREE_CHARS} 字（一条短视频的口播一般两三百字，可以分几次配），下载 MP3 / WAV 不限；一次配更长的文章、导出字幕文件需要工具箱会员。`;
if (st.threads < 2) $('vnote').textContent = '';
count(); refresh();
// 测试和录视频用
window.__tts = { st, play, VOICES, warm: async i => { await ensureWorker(); const id = 'w' + Math.random(); return new Promise(ok => { g2pWait.set(id, ok); worker.postMessage({ type: 'warm', id, voice: VOICES[i].id }); }); }, g2p: async text => { await ensureWorker(); const id = 'g' + Math.random(); return new Promise(ok => { g2pWait.set(id, ok); worker.postMessage({ type: 'g2p', id, text }); }); }, playFrom: (p, live = false) => { ensureCtx(); playFrom(p || 0); play.live = live && st.busy; }, pause, position, fullPcm, used, avail, toSrt: () => toSrt(used().filter(c => !c.label).map(c => ({ text: c.text, start: c.start, end: c.end }))), wav: () => encodeWav(fullPcm(), meta()) };
