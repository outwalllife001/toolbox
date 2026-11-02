import { paragraphs, toText, clock, countChars } from './para.js';

const $ = id => document.getElementById(id);
const Q = new URLSearchParams(location.search);
const MOBILE = /Android|iPhone|iPad|iPod|Mobile|HarmonyOS/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
// 录视频用的网址参数（days/*/scenes.mjs）：?preload=1 打开就加载模型；?reveal=hold 转完不自动滚回顶部
const HOLD = Q.get('reveal') === 'hold';
// 启用会员后，免费版每个录音转前 60 分钟（一般的会、一节课都够），会员不限时长。window.__FREE_MIN 只给自动测试用
const FREE_MIN = window.__FREE_MIN || 60;
const LANGS = [['自动', 'auto'], ['普通话', 'zh'], ['粤语', 'yue'], ['英语', 'en']];
const st = {
  file: null, name: '', dur: 0, url: null, cached: null, loading: false, ready: false, busy: false, pending: null,
  toks: [], paras: [], segs: [], lang: 0, times: 0, threads: 1, done: false, limit: 0, lastEdit: 0,
};
const audio = new Audio();
audio.preload = 'metadata';
const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const frame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 30)));
const mmss = s => clock(s);
const human = s => s >= 3600 ? `${Math.floor(s / 3600)} 小时 ${Math.round(s % 3600 / 60)} 分钟` : s >= 60 ? `${Math.floor(s / 60)} 分 ${Math.round(s % 60)} 秒` : `${Math.round(s)} 秒`;
let aud = null;
const loadAudio = () => (aud ||= import('./audio.js'));

// ---------- 选项 ----------
const chips = (el, items, cur) => { el.innerHTML = items.map(([n], i) => `<button class="chip${i === cur ? ' on' : ''}" data-i="${i}">${n}</button>`).join(''); };
chips($('langs'), LANGS, 0); chips($('timesOpt'), [['带时间'], ['不带时间']], 0);
function pick(el, key) {
  el.addEventListener('click', e => {
    const b = e.target.closest('.chip'); if (!b) return;
    el.querySelectorAll('.chip').forEach(x => x.classList.toggle('on', x === b));
    st[key] = +b.dataset.i;
  });
}
pick($('langs'), 'lang'); pick($('timesOpt'), 'times');

function setStatus(text, cls = '') { const s = $('status'); s.textContent = text; s.className = 'status ' + cls; }
function refresh() {
  $('go').disabled = !st.file || st.busy;
  $('go').textContent = st.busy ? '转写中…' : st.done ? '重新转写' : '开始转写';
  for (const id of ['word', 'copy', 'txt', 'repGo']) $(id).disabled = st.busy || !st.paras.length;
}
function idle() {
  if (st.busy) return;
  if (!st.file) setStatus(st.ready ? '' : st.cached === false ? '首次使用要下载约 160MB 的 AI 模型（只下载一次），选好录音后自动开始' : st.loading ? '正在加载 AI 模型…' : '');
  else if (st.ready && !st.done) setStatus('点「开始转写」，AI 会把录音里说的话听写成文字');
}

// ---------- 识别 Worker（复用字幕页的语音识别核心） ----------
const wurl = new URL('./worker.js', import.meta.url);
if (Q.get('threads')) wurl.searchParams.set('threads', Q.get('threads'));
const worker = new Worker(wurl, { type: 'module' });
const bar = { el: $('barIn'), done: 0, total: 1, rate: MOBILE ? 0.5 : 0.08, t: 0, next: 0, raf: 0, t0: 0 };
worker.onmessage = ({ data: m }) => {
  if (m.type === 'cached') { st.cached = m.yes; st.threads = m.threads; document.body.dataset.threads = m.threads; if (!m.yes && Q.get('preload')) load(); idle(); }
  else if (m.type === 'progress') {
    st.loading = true;
    if (!st.busy || st.pending) setStatus(st.cached ? '正在加载 AI 模型…' : `正在下载 AI 模型 ${Math.round(m.p * 100)}%（约 160MB，只下载一次，建议连 Wi-Fi）`, 'busy');
  } else if (m.type === 'ready') {
    st.ready = true; st.loading = false; document.body.dataset.model = 'ready';
    if (st.pending) { const x = st.pending; st.pending = null; run(x); } else idle();
  } else if (m.type === 'error') {
    st.loading = false; st.pending = null; stopBar();
    if (st.busy) { st.busy = false; wake(false); refresh(); }
    setStatus(m.msg);
  } else if (m.type === 'segs') {
    st.segs = m.segs;
    bar.total = m.segs.reduce((a, [s, e]) => a + e - s, 0) || 1; bar.done = 0; bar.t = performance.now();
    bar.next = m.segs[0] ? m.segs[0][1] - m.segs[0][0] : 0;
    if (!m.segs.length) finish(0);
  } else if (m.type === 'part') {
    const [s, e] = st.segs[m.i];
    st.toks.push(...m.tokens);
    update();
    bar.done += e - s; bar.rate = m.t / bar.done; bar.t = performance.now();
    bar.next = st.segs[m.i + 1] ? st.segs[m.i + 1][1] - st.segs[m.i + 1][0] : 0;
    const left = (bar.total - bar.done) * bar.rate, at = st.segs[m.i][1];
    setStatus(`AI 正在听写… 已转到 ${mmss(at)} / ${mmss(st.limit || st.dur)}` + (left > 20 ? ` · 还要约 ${left > 90 ? Math.ceil(left / 60) + ' 分钟' : Math.round(left / 10) * 10 + ' 秒'}` : ''), 'busy');
  } else if (m.type === 'done') finish(m.t);
};
function load() { if (!st.ready && !st.loading) { st.loading = true; worker.postMessage({ type: 'load' }); } }

function tickBar() {
  const est = bar.done + Math.min(bar.next * 0.95, (performance.now() - bar.t) / 1000 / bar.rate);
  bar.el.style.width = Math.min(99, est / bar.total * 100).toFixed(1) + '%';
  bar.raf = requestAnimationFrame(tickBar);
}
function stopBar() { cancelAnimationFrame(bar.raf); $('bar').hidden = true; $('keep').hidden = true; }

// 转写时不让屏幕自动锁上（锁屏后手机浏览器会把识别停掉）
let lock = null;
async function wake(on) {
  try {
    if (on && !lock && navigator.wakeLock) { lock = await navigator.wakeLock.request('screen'); lock.addEventListener('release', () => { lock = null; }); }
    if (!on && lock) { await lock.release(); lock = null; }
  } catch { lock = null; }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && st.busy) wake(true); });

// ---------- 选文件 ----------
$('file').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) openFile(f); });
$('change').addEventListener('click', () => $('file').click());
$('drop').addEventListener('dragover', e => e.preventDefault());
$('drop').addEventListener('drop', e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) openFile(f); });

async function openFile(f) {
  if (st.busy) { worker.postMessage({ type: 'cancel' }); st.busy = false; st.pending = null; stopBar(); wake(false); }
  if (st.url) URL.revokeObjectURL(st.url);
  audio.pause();
  Object.assign(st, { file: f, name: f.name.replace(/\.\w+$/, '') || '录音', toks: [], paras: [], done: false, url: URL.createObjectURL(f), dur: 0, limit: 0 });
  $('result').hidden = true; $('upsell')?.remove();
  $('drop').hidden = true; $('fileBox').hidden = false;
  $('fileName').textContent = f.name;
  $('fileInfo').textContent = `${(f.size / 1048576).toFixed(1)}MB`;
  if (/\.(amr|silk|slk)$/i.test(f.name)) { setStatus('AMR / 微信语音格式暂时打不开，先用录音机 App 导出成 M4A 或 MP3 再试'); st.file = null; refresh(); return; }
  // 时长：先让浏览器读一下文件头；读不出来（有的浏览器放不了这种编码）就等解码完再说
  audio.src = st.url;
  st.dur = await new Promise(r => {
    const done = v => { audio.removeEventListener('loadedmetadata', y); audio.removeEventListener('error', n); clearTimeout(to); r(v); };
    const y = () => done(isFinite(audio.duration) ? audio.duration : 0), n = () => done(0), to = setTimeout(() => done(0), 4000);
    audio.addEventListener('loadedmetadata', y); audio.addEventListener('error', n);
  });
  $('fileInfo').textContent = (st.dur ? human(st.dur) + ' · ' : '') + `${(f.size / 1048576).toFixed(1)}MB`;
  load();   // 选了录音才开始下载模型
  if (st.ready) idle();
  if (st.dur > FREE_MIN * 60 && window.Member?.enabled && !(await Member.active())) upsell();
  else if (MOBILE && st.dur > 1200) setStatus(`录音有 ${Math.round(st.dur / 60)} 分钟，手机上要转好一阵，建议用电脑；用手机的话转写时别锁屏`);
  refresh();
}
function upsell() {
  $('upsell')?.remove();
  $('status').insertAdjacentHTML('afterend', `<p class="upsell" id="upsell">录音有 ${Math.round(st.dur / 60)} 分钟：免费版转前 ${FREE_MIN} 分钟，<button>会员不限时长</button></p>`);
  $('upsell').querySelector('button').onclick = async () => { if ((await Member.open()) === 'member') $('upsell').remove(); };
}

// 读出 16k 单声道：短录音用浏览器自带解码；20 分钟以上（或文件很大）用 Mediabunny 边解边降采样，省内存；失败就换另一种
async function decodeAudio(f) {
  const a = await loadAudio();
  const long = (st.dur > 1200 || f.size > 150 * 1048576) && typeof AudioDecoder !== 'undefined';
  const viaMedia = () => a.viaMedia(f, p => setStatus(`正在读取录音… ${Math.round(p * 100)}%`, 'busy'));
  try { return await (long ? viaMedia() : a.viaBrowser(f)); } catch (e) { console.warn(e); return long ? a.viaBrowser(f) : viaMedia(); }
}

// ---------- 转写 ----------
$('go').addEventListener('click', async () => {
  if (!st.file || st.busy) return;
  st.limit = 0;
  if (st.dur > FREE_MIN * 60) {
    const r = await (window.Member ? Member.gate({ title: `这段录音有 ${Math.round(st.dur / 60)} 分钟`, text: `免费版每个录音转前 ${FREE_MIN} 分钟；开通会员不限时长。`, free: `先免费转前 ${FREE_MIN} 分钟` }) : 'member');
    if (!r) return;
    if (r === 'free') st.limit = FREE_MIN * 60; else $('upsell')?.remove();
  }
  st.busy = true; st.done = false; st.toks = []; st.paras = []; refresh(); audio.pause();
  setStatus('正在读取录音…', 'busy');
  await frame();
  let x;
  try { x = await decodeAudio(st.file); } catch (e) {
    console.error(e); st.busy = false; refresh();
    setStatus('读不出这个文件里的声音，换一个试试（支持 M4A、MP3、WAV、MP4 等常见格式）'); return;
  }
  if (!st.dur) { st.dur = x.length / 16000; $('fileInfo').textContent = human(st.dur) + ' · ' + `${(st.file.size / 1048576).toFixed(1)}MB`; }
  if (st.limit && x.length > st.limit * 16000) x = x.slice(0, st.limit * 16000);
  if (!st.ready) { st.pending = x; load(); setStatus('AI 模型还在下载，下载完自动开始转写…', 'busy'); return; }
  run(x);
});

function run(x) {
  $('result').hidden = false;
  $('paras').innerHTML = '<p class="empty">AI 正在听写，文字会一段段出现在这里…</p>';
  $('stat').textContent = '';
  bar.el.style.width = '0%'; $('bar').hidden = false; $('keep').hidden = !MOBILE && x.length < 16000 * 600;
  bar.t = bar.t0 = performance.now(); bar.done = 0; bar.total = x.length / 16000; bar.next = Math.min(8, bar.total);
  cancelAnimationFrame(bar.raf); tickBar();
  setStatus('AI 正在听写…', 'busy');
  wake(true);
  worker.postMessage({ type: 'run', samples: x, lang: LANGS[st.lang][1] }, [x.buffer]);
}

function finish(t) {
  if (!st.busy) return;
  st.busy = false; st.done = true; stopBar(); wake(false);
  update(true); refresh();
  const n = countChars(st.paras);
  if (!n) { setStatus('没听到说话声。是不是录音没有声音，或者只有音乐？'); $('paras').innerHTML = '<p class="empty">没有识别到文字</p>'; return; }
  const len = st.limit || st.dur;
  setStatus(`转写完成 ✓ ${human(len)}的录音 · 用时 ${t < 60 ? t.toFixed(1) + ' 秒' : human(t)}`, 'done');
  if (st.limit) { $('upsell')?.remove(); $('status').insertAdjacentHTML('afterend', `<p class="upsell" id="upsell">已转前 ${FREE_MIN} 分钟。<button>开通会员</button>，整段一次转完</p>`); $('upsell').querySelector('button').onclick = async () => { if ((await Member.open()) === 'member') { $('upsell').remove(); $('go').click(); } }; }
  if (!HOLD) $('paras').scrollTop = 0;
}

// ---------- 文字稿：转写中一段段追加（只重画最后一段），转完可以直接改 ----------
const EDIT = (() => { const d = document.createElement('div'); d.contentEditable = 'plaintext-only'; return d.contentEditable === 'plaintext-only' ? 'plaintext-only' : 'true'; })();
const paraHTML = (p, i, cls = '') => `<div class="para ${cls}" data-i="${i}"><button class="t">${mmss(p.start)}</button><div class="x"${st.busy ? '' : ` contenteditable="${EDIT}"`} spellcheck="false">${esc(p.text)}</div></div>`;
function update(final = false) {
  const box = $('paras'), old = st.paras.length;
  st.paras = paragraphs(st.toks);
  box.querySelector('.empty')?.remove();
  // 最后一段可能还在长，从它开始重画；之前的段落不会再变
  const keep = final ? 0 : Math.max(0, Math.min(old, st.paras.length) - 1);
  [...box.querySelectorAll('.para')].slice(keep).forEach(el => el.remove());
  box.insertAdjacentHTML('beforeend', st.paras.slice(keep).map((p, k) => paraHTML(p, keep + k, final || keep + k < old ? '' : 'new')).join(''));
  if (!final) box.scrollTop = box.scrollHeight;
  $('stat').textContent = st.paras.length ? `${countChars(st.paras)} 字 · ${st.paras.length} 段` : '';
}
$('paras').addEventListener('input', e => {
  const el = e.target.closest('.para'); if (!el) return;
  st.paras[+el.dataset.i].text = e.target.innerText.replace(/\n+/g, ' ');
  $('stat').textContent = `${countChars(st.paras)} 字 · ${st.paras.length} 段`;
});
$('paras').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } });
$('paras').addEventListener('click', e => {
  const b = e.target.closest('.t'); if (!b) return;
  const p = st.paras[+b.parentNode.dataset.i];
  seek(p.start); audio.play().catch(() => {});
});

// ---------- 回听 ----------
function seek(t) { try { audio.currentTime = t; } catch {} tick(); }
$('pp').addEventListener('click', () => { if (audio.paused) audio.play().catch(() => {}); else audio.pause(); });
$('track').addEventListener('click', e => { const r = $('track').getBoundingClientRect(), d = audio.duration || st.dur; if (d) seek((e.clientX - r.left) / r.width * d); });
let onIdx = -1;
function tick() {
  const t = audio.currentTime || 0, d = audio.duration || st.dur || 1;
  $('trackIn').style.width = Math.min(100, t / d * 100) + '%';
  $('time').textContent = `${mmss(t)} / ${mmss(d)}`;
  let i = -1; for (let k = 0; k < st.paras.length; k++) { if (st.paras[k].start <= t + 0.05) i = k; else break; }
  if (i !== onIdx) {
    $('paras').querySelector('.para.on')?.classList.remove('on');
    const el = $('paras').querySelector(`.para[data-i="${i}"]`);
    if (el) { el.classList.add('on'); if (!audio.paused && !$('paras').contains(document.activeElement)) { const box = $('paras'); box.scrollTop = Math.max(0, el.offsetTop - box.offsetTop - 12); } }
    onIdx = i;
  }
}
const loop = () => { tick(); if (!audio.paused) requestAnimationFrame(loop); };
audio.addEventListener('play', () => { $('player').classList.add('playing'); loop(); });
audio.addEventListener('pause', () => { $('player').classList.remove('playing'); tick(); });
for (const ev of ['seeked', 'loadedmetadata', 'timeupdate', 'ended']) audio.addEventListener(ev, tick);

// ---------- 查找替换 ----------
$('repGo').addEventListener('click', () => {
  const a = $('repFrom').value, b = $('repTo').value;
  if (!a) { $('repMsg').textContent = '先填要找的字'; return; }
  let n = 0;
  for (const p of st.paras) { const parts = p.text.split(a); n += parts.length - 1; p.text = parts.join(b); }
  if (n) {
    // 换过的地方标黄（改字时自然消失），滚到第一处
    const box = $('paras'), hl = t => b ? esc(t).split(esc(b)).join(`<mark>${esc(b)}</mark>`) : esc(t);
    box.innerHTML = st.paras.map((p, i) => paraHTML(p, i).replace(`>${esc(p.text)}</div></div>`, `>${hl(p.text)}</div></div>`)).join('');
    onIdx = -1; tick();
    const m = box.querySelector('mark'); if (m) box.scrollTop = Math.max(0, m.closest('.para').offsetTop - box.offsetTop - 40);
  }
  $('repMsg').textContent = n ? `替换了 ${n} 处 ✓` : `没找到「${a}」`;
  $('repMsg').className = 'status' + (n ? ' done' : '');
});

// ---------- 导出 ----------
const live = () => st.paras.filter(p => p.text.trim());
function save(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}
const today = () => { const d = new Date(), p = v => String(v).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
$('word').addEventListener('click', async () => {
  if (!st.paras.length) return;
  const { docx } = await import('./docx.js');
  const times = st.times === 0;
  const blob = docx({
    title: st.name,
    meta: `录音时长 ${mmss(st.limit || st.dur)} · ${today()} 转写 · ${countChars(st.paras)} 字 · AI 自动转写，可能有错字，请核对`,
    items: live().map(p => ({ time: times ? mmss(p.start) : null, text: p.text.trim() })),
  });
  save(blob, `${st.name}_文字稿.docx`);
  flash($('word'), '已下载 ✓', '下载 Word 文档');
});
$('txt').addEventListener('click', () => { if (st.paras.length) { save(new Blob(['﻿' + toText(live(), { times: st.times === 0 })], { type: 'text/plain' }), `${st.name}_文字稿.txt`); flash($('txt'), '已下载 ✓', '下载 TXT'); } });
$('copy').addEventListener('click', async () => {
  const text = toText(live(), { times: st.times === 0 }); if (!st.paras.length) return;
  try { await navigator.clipboard.writeText(text); } catch {
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
  }
  flash($('copy'), '已复制 ✓', '复制全文');
});
function flash(b, a, z) { b.textContent = a; setTimeout(() => { b.textContent = z; }, 1500); }

// ---------- 代做入口：site/config.js 里配置了才显示；service.tools.transcribe 可以单独设置这一页的价格和说明 ----------
const svc = window.SITE_CONFIG && window.SITE_CONFIG.service;
if (svc) {
  const s = Object.assign({}, svc, svc.tools && svc.tools.transcribe);
  $('service').innerHTML = `<h2>找我代做 <b>${esc(s.price)}</b></h2><p>${esc(s.text)}</p><p class="contact">${esc(s.contact)}</p>${s.qr ? `<img src="../${esc(s.qr)}" alt="联系方式二维码">` : ''}`;
  $('service').hidden = false;
}
if (window.Member?.enabled) $('faqMember').hidden = false;
idle(); refresh();
