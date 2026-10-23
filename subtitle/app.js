import { toCues, toSrt, append } from './cues.js';
import { STYLES, SIZES, POSITIONS, drawCue, cueAt } from './render.js';

const $ = id => document.getElementById(id);
const Q = new URLSearchParams(location.search);
const MOBILE = /Android|iPhone|iPad|iPod|Mobile|HarmonyOS/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
// 下面两个网址参数只给录视频用（days/*/scenes.mjs）：
//   ?reveal=hold  识别完不自动播放，等分镜调用 window.reveal()（全屏播放）/ window.unreveal()
//   ?preload=1    打开页面就加载模型（平时没缓存过要等用户选了视频才下载，免得白白耗流量）
const HOLD = Q.get('reveal') === 'hold';
const LANGS = [['自动', 'auto'], ['普通话', 'zh'], ['粤语', 'yue'], ['英语', 'en']];
const st = {
  file: null, name: '', audioOnly: false, W: 1280, H: 720, dur: 0, url: null,
  cached: null, loading: false, ready: false, busy: false, pending: null, exporting: false,
  cues: [], segs: [], lang: 0, style: 0, size: 1, pos: 0, dl: null,
};
const video = $('video'), ov = $('overlay'), player = $('player');
const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = s => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
const frame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 30)));
let media = null;
const loadMedia = () => (media ||= import('./media.js'));

// ---------- 选项 ----------
const chips = (el, items, cur) => { el.innerHTML = items.map(([n], i) => `<button class="chip${i === cur ? ' on' : ''}" data-i="${i}">${n}</button>`).join(''); };
chips($('langs'), LANGS, 0); chips($('sizes'), SIZES, st.size); chips($('poss'), POSITIONS, st.pos);
$('styles').innerHTML = STYLES.map(([n, s], i) => {
  const look = s.box ? `background:${s.box.replace(/[\d.]+\)$/, '1)')};color:${s.fill}`
    : `background:#8a94a6;color:${s.fill};text-shadow:0 0 2px ${s.stroke},0 0 2px ${s.stroke},0 0 1px ${s.stroke}`;
  return `<button class="chip${i ? '' : ' on'}" data-i="${i}" style="${look}">${n}</button>`;
}).join('');
function pick(el, key, after) {
  el.addEventListener('click', e => {
    const b = e.target.closest('.chip'); if (!b) return;
    el.querySelectorAll('.chip').forEach(x => x.classList.toggle('on', x === b));
    st[key] = +b.dataset.i; after && after();
  });
}
pick($('langs'), 'lang');
for (const [el, k] of [[$('styles'), 'style'], [$('sizes'), 'size'], [$('poss'), 'pos']]) pick(el, k, () => { changed(); draw(true); });

function setStatus(text, cls = '') { const s = $('status'); s.textContent = text; s.className = 'status ' + cls; }
function setE(text, cls = '') { const s = $('estatus'); s.textContent = text; s.className = 'status ' + cls; }
function refresh() {
  $('go').disabled = !st.file || st.busy;
  $('go').textContent = st.busy ? '识别中…' : st.cues.length ? '重新识别' : '自动识别字幕';
  $('export').disabled = st.busy || st.exporting || !st.cues.some(c => c.text.trim());
  $('export').hidden = st.audioOnly;
}
function idle() {
  if (st.busy) return;
  if (!st.file) setStatus(st.ready ? '' : st.cached === false ? '首次使用要下载约 160MB 的 AI 模型（只下载一次），选好视频后自动开始' : st.loading ? '正在加载 AI 模型…' : '');
  else if (st.ready) setStatus(st.cues.length ? '' : '点「自动识别字幕」，AI 会把视频里说的话听写成字幕');
}

// ---------- 识别 Worker ----------
const wurl = new URL('./asr-worker.js', import.meta.url);
if (Q.get('threads')) wurl.searchParams.set('threads', Q.get('threads'));
const worker = new Worker(wurl, { type: 'module' });
const bar = { el: $('barIn'), done: 0, total: 1, rate: MOBILE ? 0.6 : 0.2, t: 0, next: 0, raf: 0 };
worker.onmessage = ({ data: m }) => {
  if (m.type === 'cached') { st.cached = m.yes; if (!m.yes && Q.get('preload')) load(); idle(); }
  else if (m.type === 'progress') {
    st.loading = true;
    if (!st.busy || st.pending) setStatus(st.cached ? '正在加载 AI 模型…' : `正在下载 AI 模型 ${Math.round(m.p * 100)}%（约 160MB，只下载一次，建议连 Wi-Fi）`, 'busy');
  } else if (m.type === 'ready') {
    st.ready = true; st.loading = false; document.body.dataset.model = 'ready';
    if (st.pending) { const x = st.pending; st.pending = null; run(x); } else idle();
  } else if (m.type === 'error') {
    st.loading = false; st.pending = null; stopBar();
    if (st.busy) { st.busy = false; refresh(); }
    setStatus(m.msg);
  } else if (m.type === 'segs') {
    st.segs = m.segs;
    bar.total = m.segs.reduce((a, [s, e]) => a + e - s, 0) || 1; bar.done = 0; bar.t = performance.now(); bar.next = m.segs[0] ? m.segs[0][1] - m.segs[0][0] : 0;
    if (!m.segs.length) finish(0);
  } else if (m.type === 'part') {
    const [s, e] = st.segs[m.i], more = toCues(m.tokens, { total: e });
    const first = st.cues.length;
    append(st.cues, more);
    addRows(first);
    bar.done += e - s; bar.rate = m.t / bar.done; bar.t = performance.now();
    bar.next = st.segs[m.i + 1] ? st.segs[m.i + 1][1] - st.segs[m.i + 1][0] : 0;
    setStatus(`AI 正在听写… ${Math.round(bar.done / bar.total * 100)}%`, 'busy');
  } else if (m.type === 'done') finish(m.t);
};
function load() { if (!st.ready && !st.loading) { st.loading = true; worker.postMessage({ type: 'load' }); } }

function tickBar() {
  const est = bar.done + Math.min(bar.next * 0.95, (performance.now() - bar.t) / 1000 / bar.rate);
  bar.el.style.width = Math.min(99, est / bar.total * 100).toFixed(1) + '%';
  bar.raf = requestAnimationFrame(tickBar);
}
function stopBar() { cancelAnimationFrame(bar.raf); $('bar').hidden = true; }

// ---------- 选文件 ----------
$('file').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) openFile(f); });
$('change').addEventListener('click', () => $('file').click());
$('drop').addEventListener('dragover', e => e.preventDefault());
$('drop').addEventListener('drop', e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) openFile(f); });

async function openFile(f) {
  if (st.busy) { worker.postMessage({ type: 'cancel' }); st.busy = false; st.pending = null; stopBar(); }
  if (st.url) URL.revokeObjectURL(st.url);
  st.file = f; st.name = f.name.replace(/\.\w+$/, '') || '视频'; st.cues = []; st.url = URL.createObjectURL(f);
  changed(); renderRows(); $('result').hidden = true; exitFull();
  video.src = st.url + '#t=0.001';
  const ok = await new Promise(r => {
    const done = v => { video.removeEventListener('loadedmetadata', y); video.removeEventListener('error', n); r(v); };
    const y = () => done(true), n = () => done(false);
    video.addEventListener('loadedmetadata', y); video.addEventListener('error', n);
  });
  if (!ok) { setStatus('这个文件打不开，换一个试试（支持 MP4、MOV、MP3、M4A 等常见格式）'); st.file = null; refresh(); return; }
  st.audioOnly = !video.videoWidth;
  st.W = video.videoWidth || 1280; st.H = video.videoHeight || 720; st.dur = video.duration || 0;
  $('drop').hidden = true; player.hidden = false; $('fileRow').hidden = false;
  player.classList.toggle('audio', st.audioOnly);
  $('fileInfo').textContent = `${f.name} · ${isFinite(st.dur) ? fmt(st.dur) : ''} · ${(f.size / 1048576).toFixed(1)}MB`;
  layout();
  load();   // 选了视频才开始下载模型
  if (st.ready) idle();
  if (MOBILE && st.dur > 300) setStatus(`视频有 ${Math.round(st.dur / 60)} 分钟，手机上要识别好几分钟，内存也可能不够，建议用电脑`);
  refresh();
}

// 读出 16k 单声道：小文件直接让浏览器解码；大文件（或解码失败）用 Mediabunny 只读音轨，不把整个视频读进内存
async function decodeAudio(f) {
  const viaBrowser = async () => {
    const AC = window.OfflineAudioContext || window.webkitOfflineAudioContext, ctx = new AC(1, 16000, 16000);
    const buf = await f.arrayBuffer();
    const ab = await new Promise((res, rej) => { const p = ctx.decodeAudioData(buf, res, rej); if (p && p.then) p.then(res, rej); });
    const x = new Float32Array(ab.length), C = ab.numberOfChannels;
    for (let c = 0; c < C; c++) { const d = ab.getChannelData(c); for (let i = 0; i < x.length; i++) x[i] += d[i] / C; }
    return x;
  };
  const viaMedia = async () => (await loadMedia()).audioOf(f);
  const big = f.size > 200 * 1048576 && typeof AudioDecoder !== 'undefined';
  try { return await (big ? viaMedia : viaBrowser)(); } catch (e) { console.warn(e); return (big ? viaBrowser : viaMedia)(); }
}

// ---------- 识别 ----------
$('go').addEventListener('click', async () => {
  if (!st.file || st.busy) return;
  st.busy = true; st.cues = []; changed(); renderRows(); refresh(); video.pause();
  setStatus('正在提取声音…', 'busy');
  await frame();
  let x;
  try { x = await decodeAudio(st.file); } catch (e) {
    console.error(e); st.busy = false; refresh();
    setStatus('读不出这个文件里的声音，换一个试试（支持 MP4、MOV、MP3、M4A 等常见格式）'); return;
  }
  if (!st.ready) { st.pending = x; load(); setStatus('AI 模型还在下载，下载完自动开始识别…', 'busy'); return; }
  run(x);
});

function run(x) {
  $('result').hidden = false;
  $('cues').innerHTML = '<li class="empty">AI 正在听写，字幕会一句句出现在这里…</li>';
  bar.el.style.width = '0%'; $('bar').hidden = false; bar.t = performance.now(); bar.done = 0; bar.total = x.length / 16000; bar.next = Math.min(8, bar.total);
  cancelAnimationFrame(bar.raf); tickBar();
  setStatus('AI 正在听写…', 'busy');
  worker.postMessage({ type: 'run', samples: x, lang: LANGS[st.lang][1] }, [x.buffer]);
}

function finish(t) {
  if (!st.busy) return;
  st.busy = false; stopBar(); refresh();
  const n = st.cues.length;
  if (!n) { setStatus('没听到说话声。是不是视频没有声音，或者只有背景音乐？'); renderRows(); return; }
  setStatus(`识别完成 ✓ 共 ${n} 条字幕 · 用时 ${t.toFixed(1)} 秒`, 'done');
  $('cueCount').textContent = `${n} 条`;
  if (HOLD) { window.reveal = reveal; window.unreveal = () => { video.pause(); exitFull(); }; return; }
  video.currentTime = 0; video.play().catch(() => {});
}
function reveal(t = 0, play = true) { enterFull(); player.classList.toggle('still', !play); video.currentTime = t; video.muted = true; if (play) video.play().catch(() => {}); else video.pause(); }

// ---------- 字幕列表 ----------
const row = (c, i, cls = '', delay = 0) => `<li class="${cls}" data-i="${i}" style="animation-delay:${delay}ms"><button class="t">${fmt(c.start)}</button><input value="${esc(c.text)}" enterkeyhint="done" aria-label="第 ${i + 1} 条字幕"></li>`;
function renderRows() {
  $('cues').innerHTML = st.cues.length ? st.cues.map((c, i) => row(c, i)).join('') : '';
  $('cueCount').textContent = st.cues.length ? `${st.cues.length} 条` : '';
}
function addRows(from) {
  const ol = $('cues');
  ol.querySelector('.empty')?.remove();
  // 上一段的最后一条可能被截短了，时间标签不用改（只显示开始时间）；新的一条条依次弹出来
  ol.insertAdjacentHTML('beforeend', st.cues.slice(from).map((c, k) => row(c, from + k, 'new', k * 90)).join(''));
  ol.scrollTop = ol.scrollHeight;
  $('cueCount').textContent = `${st.cues.length} 条`;
  refresh(); draw(true);
}
$('cues').addEventListener('click', e => {
  const b = e.target.closest('.t'); if (!b) return;
  const c = st.cues[+b.parentNode.dataset.i];
  video.currentTime = c.start + 0.01; video.play().catch(() => {});
});
$('cues').addEventListener('input', e => {
  const li = e.target.closest('li'); if (!li) return;
  st.cues[+li.dataset.i].text = e.target.value; changed(); refresh(); draw(true);
});
$('cues').addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); });
// 编辑某一句时，把画面停在这句上，方便边看边改
$('cues').addEventListener('focusin', e => {
  const li = e.target.closest('li'); if (!li || e.target.tagName !== 'INPUT') return;
  const c = st.cues[+li.dataset.i]; video.pause(); video.currentTime = c.start + Math.min(0.3, (c.end - c.start) / 2);
});

// ---------- 播放器 + 字幕预览 ----------
function layout() {
  if (player.hidden) return;
  const full = player.classList.contains('full');
  const bw = full ? innerWidth : player.parentNode.clientWidth - 28, bh = full ? innerHeight : Math.min(innerHeight * 0.56, 460);
  const k = Math.min(bw / st.W, bh / st.H), w = Math.round(st.W * k), h = Math.round(st.H * k);
  Object.assign($('playerIn').style, { width: w + 'px', height: h + 'px' });
  player.style.height = full ? '' : h + 'px';
  const dpr = Math.min(2, devicePixelRatio || 1);
  ov.width = Math.round(w * dpr); ov.height = Math.round(h * dpr);
  draw(true);
}
addEventListener('resize', layout);
let lastKey = null, onIdx = -1;
function draw(force) {
  const t = video.currentTime || 0, c = cueAt(st.cues, t);
  $('seekIn').style.width = (st.dur ? t / st.dur * 100 : 0) + '%';
  const key = `${c ? c.text : ''}|${st.style}${st.size}${st.pos}|${ov.width}x${ov.height}`;
  if (force || key !== lastKey) {
    lastKey = key;
    const g = ov.getContext('2d'); g.clearRect(0, 0, ov.width, ov.height);
    if (c) drawCue(g, c.text, ov.width, ov.height, st);
  }
  const i = c ? st.cues.indexOf(c) : -1;
  if (i !== onIdx) {
    $('cues').querySelector('li.on')?.classList.remove('on');
    const li = $('cues').querySelector(`li[data-i="${i}"]`);
    if (li) { li.classList.add('on'); if (!video.paused) { const ol = $('cues'); ol.scrollTop = Math.max(0, li.offsetTop - ol.clientHeight / 2); } }
    onIdx = i;
  }
}
const loop = () => { draw(); if (!video.paused) requestAnimationFrame(loop); };
video.addEventListener('play', () => { player.classList.add('playing'); loop(); });
video.addEventListener('pause', () => { player.classList.remove('playing'); draw(); });
for (const ev of ['seeked', 'loadeddata', 'timeupdate']) video.addEventListener(ev, () => draw());
$('playerIn').addEventListener('click', () => { if (video.paused) video.play().catch(() => {}); else video.pause(); });
function enterFull() { player.classList.add('full'); document.body.style.overflow = 'hidden'; layout(); }
function exitFull() { player.classList.remove('still'); if (!player.classList.contains('full')) return; player.classList.remove('full'); document.body.style.overflow = ''; layout(); }
$('fullBtn').addEventListener('click', () => { enterFull(); if (video.paused) video.play().catch(() => {}); });
$('closeFull').addEventListener('click', e => { e.stopPropagation(); exitFull(); });

// ---------- 导出 ----------
const live = () => st.cues.filter(c => c.text.trim()).map(c => ({ ...c, text: c.text.trim() }));
function changed() { $('dl').hidden = true; if (st.dl) { URL.revokeObjectURL(st.dl); st.dl = null; } setE(''); }
function save(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}
$('srt').addEventListener('click', () => { if (st.cues.length) save(new Blob(['﻿' + toSrt(live())], { type: 'text/plain' }), `${st.name}.srt`); });
$('copy').addEventListener('click', async () => {
  const text = live().map(c => c.text).join('\n'); if (!text) return;
  try { await navigator.clipboard.writeText(text); } catch {
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
  }
  $('copy').textContent = '已复制 ✓'; setTimeout(() => { $('copy').textContent = '复制全部文字'; }, 1500);
});
$('export').addEventListener('click', async () => {
  if (st.exporting || !st.file) return;
  const m = await loadMedia();
  if (!(await m.canBurn(st.W, st.H))) { setE('这个浏览器导出不了视频。换手机自带的浏览器或电脑 Chrome 试试，也可以下载 SRT 字幕导入剪辑软件。'); return; }
  video.pause(); exitFull(); changed();
  st.exporting = true; refresh();
  $('ebar').hidden = false; $('ebarIn').style.width = '0%';
  setE('正在导出… 0%');   // 不加转圈：录屏（软件渲染）时无限循环的 CSS 动画会把 WebCodecs 取帧饿死，有进度条就够了
  const t0 = performance.now();
  try {
    let shown = 0;   // 进度每 0.25 秒刷新一次就够了（逐帧刷新会和编码抢渲染）
    const blob = await m.burn(st.file, live(), st, p => {
      const now = performance.now(); if (now - shown < 250) return; shown = now;
      $('ebarIn').style.width = (p * 100).toFixed(1) + '%'; setE(`正在导出… ${Math.round(p * 100)}%`);
    });
    st.dl = URL.createObjectURL(blob);
    $('dl').href = st.dl; $('dl').download = `${st.name}_字幕.mp4`; $('dl').hidden = false;
    setE(`导出好了 ✓ ${(blob.size / 1048576).toFixed(1)}MB · 用时 ${((performance.now() - t0) / 1000).toFixed(1)} 秒`, 'done');
  } catch (e) {
    console.error(e);
    setE('导出失败：' + (e.message || e) + (MOBILE ? '。视频太长时手机内存可能不够，可以先下载 SRT 字幕' : ''));
  } finally { st.exporting = false; $('ebar').hidden = true; refresh(); }
});

// ---------- 代做入口：site/config.js 里配置了才显示；service.tools.subtitle 可以单独设置这一页的价格和说明 ----------
const svc = window.SITE_CONFIG && window.SITE_CONFIG.service;
if (svc) {
  const s = Object.assign({}, svc, svc.tools && svc.tools.subtitle);
  $('service').innerHTML = `<h2>找我代做 <b>${esc(s.price)}</b></h2><p>${esc(s.text)}</p><p class="contact">${esc(s.contact)}</p>${s.qr ? `<img src="../${esc(s.qr)}" alt="联系方式二维码">` : ''}`;
  $('service').hidden = false;
}
idle(); refresh();
