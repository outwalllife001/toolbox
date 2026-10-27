import { paginate, drawPage, drawChar, gridCell, makePdf, PAGE } from './sheet.js';

const $ = id => document.getElementById(id);
const HW = window.HanziWriter, PY = window.pinyinPro;
const MAX = 60;
// 比对《现代汉语通用字笔顺规范》时有疑问、又没找到可靠依据的字（见 vendor/hanzi-writer-data/NOTICE.md）
const WARN = new Set(['兜', '虐', '翰', '髓']);
const qs = new URLSearchParams(location.search);
const SPEED = +qs.get('speed') || 1;
const st = {
  items: [], sel: -1, mode: 'anim', writers: [], big: null, pages: [[]], page: 0,
  opt: { grid: 'tian', trace: 4, rows: 1, pinyin: true, order: true, title: '生字练习' },
};

function setStatus(text, cls = '') { const el = $('status'); el.textContent = text; el.className = 'status ' + cls; }

// ---- 笔画数据：每个字一个 JSON，文件名是码位 ----
const cache = new Map();
function loadChar(ch) {
  if (!cache.has(ch)) {
    const p = fetch(`../vendor/hanzi-writer-data/${ch.codePointAt(0).toString(16)}.json`)
      .then(r => { if (!r.ok) throw new Error('没有这个字的数据'); return r.json(); });
    p.catch(() => cache.delete(ch));
    cache.set(ch, p);
  }
  return cache.get(ch);
}

// ---- 输入 → 字表（去重、按上下文定拼音）----
function parse(text) {
  const seen = new Set(), list = [], other = new Set();
  for (const x of PY.pinyin(text, { type: 'all' })) {
    const ch = x.origin;
    if (!/\p{Script=Han}/u.test(ch)) { if (/[\p{L}\p{N}]/u.test(ch)) other.add(ch); continue; }
    if (seen.has(ch)) continue;
    seen.add(ch);
    const readings = [...new Set([x.pinyin, ...(x.polyphonic || [])].filter(Boolean))];
    list.push({ ch, pinyin: x.pinyin, readings });
  }
  return { list, other: [...other] };
}

async function generate() {
  const text = $('text').value.trim();
  if (!text) { setStatus('先输入要练的字'); $('text').focus(); return; }
  const { list, other } = parse(text);
  if (!list.length) { setStatus('没有找到汉字，换几个字试试'); return; }
  const use = list.slice(0, MAX);
  $('go').disabled = true;
  setStatus('正在加载笔画数据…');
  const got = await Promise.all(use.map(it => loadChar(it.ch).then(d => { it.data = d; return true; }, () => false)));
  $('go').disabled = false;
  st.items = use.filter((_, i) => got[i]);
  const missing = use.filter((_, i) => !got[i]).map(it => it.ch);
  const notes = [];
  if (missing.length) notes.push(`没有笔画数据，已跳过：${missing.join(' ')}`);
  if (other.length) notes.push(`不是汉字，已跳过：${other.slice(0, 10).join(' ')}`);
  if (list.length > MAX) notes.push(`一次最多 ${MAX} 个字，后面的 ${list.length - MAX} 个没加`);
  $('skipped').hidden = !notes.length; $('skipped').textContent = notes.join('；');
  if (!st.items.length) { setStatus('这些字都没有笔画数据'); return; }
  $('strokes').hidden = $('detail').hidden = $('sheet').hidden = false;
  buildCards();
  select(0);
  st.page = 0;
  renderSheet();
}

// ---- 笔顺动画卡片：所有字一起写 ----
function buildCards() {
  st.writers.forEach(w => w && w.cancelQuiz && w.cancelQuiz());
  const box = $('cards');
  box.innerHTML = '';
  st.writers = st.items.map((it, i) => {
    const c = document.createElement('div');
    c.className = 'c'; c.dataset.i = i;
    c.innerHTML = `<div class="w tian"></div><div class="meta"><button class="py${it.readings.length > 1 ? ' multi' : ''}"></button><small>${it.data.strokes.length}画</small></div>${WARN.has(it.ch) ? '<i>⚠️</i>' : ''}`;
    c.querySelector('.py').textContent = it.pinyin;
    box.appendChild(c);
    return c;
  });
  // 卡片用 canvas 渲染（几十个字一起写时比 SVG 省很多：SVG 每帧要重画所有带裁剪的笔画）。
  // hanzi-writer 的 canvas 不管 devicePixelRatio，这里按物理像素建画布、CSS 缩回去，手机上才清楚
  requestAnimationFrame(() => {
    const size = Math.floor(box.querySelector('.w').clientWidth), px = Math.round(size * Math.min(3, window.devicePixelRatio || 1));
    st.writers = st.writers.map((c, i) => {
      const it = st.items[i], cv = document.createElement('canvas');
      c.querySelector('.w').appendChild(cv);
      return HW.create(cv, it.ch, {
        renderer: 'canvas', width: px, height: px, padding: Math.round(px * 0.05), showCharacter: false, showOutline: true,
        strokeColor: '#141a26', outlineColor: '#e9ebef',
        strokeAnimationSpeed: 1.1 * SPEED, delayBetweenStrokes: 160 / SPEED,
        charDataLoader: (ch, ok) => ok(it.data),
      });
    });
    playAll();
  });
}
function playAll() { st.writers.forEach(w => w.animateCharacter && w.animateCharacter()); }

$('cards').addEventListener('click', e => {
  const c = e.target.closest('.c'); if (!c) return;
  const i = +c.dataset.i;
  if (e.target.classList.contains('py')) { cycleReading(i); return; }
  select(i);
  st.writers[i].animateCharacter();
  if (window.innerWidth < 700) $('detail').scrollIntoView({ behavior: 'smooth', block: 'center' });
});
$('replay').addEventListener('click', playAll);

function cycleReading(i) {
  const it = st.items[i];
  if (it.readings.length < 2) return;
  it.pinyin = it.readings[(it.readings.indexOf(it.pinyin) + 1) % it.readings.length];
  $('cards').querySelector(`.c[data-i="${i}"] .py`).textContent = it.pinyin;
  if (i === st.sel) $('bigPy').textContent = it.pinyin;
  renderSheet();
}

// ---- 放大看 / 描一描 ----
function select(i) {
  st.sel = i;
  const it = st.items[i];
  document.querySelectorAll('#cards .c').forEach(c => c.classList.toggle('on', +c.dataset.i === i));
  $('bigChar').textContent = it.ch;
  $('bigPy').textContent = it.pinyin;
  $('bigPy').className = 'py' + (it.readings.length > 1 ? ' multi' : '');
  $('bigCount').textContent = `共 ${it.data.strokes.length} 画`;
  $('warn').hidden = !WARN.has(it.ch);
  const opts = {
    width: 200, height: 200, padding: 10, showCharacter: false, showOutline: true,
    strokeColor: '#141a26', outlineColor: '#e3e6eb', highlightColor: '#e5484d', drawingColor: '#2f6bff', drawingWidth: 6,
    strokeAnimationSpeed: 0.9 * SPEED, delayBetweenStrokes: 260 / SPEED, showHintAfterMisses: 2,
    charDataLoader: (ch, ok) => ok(it.data),
  };
  if (st.big) { st.big.cancelQuiz(); $('big').innerHTML = ''; }
  st.big = HW.create($('big'), it.ch, opts);
  drawStrip(it);
  setMode(st.mode);
}
$('bigPy').addEventListener('click', () => cycleReading(st.sel));

function setMode(m) {
  st.mode = m;
  document.querySelectorAll('#modes .chip').forEach(b => b.classList.toggle('on', b.dataset.m === m));
  const w = st.big, it = st.items[st.sel];
  if (m === 'anim') {
    w.cancelQuiz();
    w.animateCharacter();
    $('modeHint').textContent = '下面是笔顺分解，红色是新写的一笔';
  } else {
    $('modeHint').textContent = '用手指按笔顺在格子里写，写错了不算，连错两次会提示';
    w.hideCharacter();
    w.quiz({
      highlightOnComplete: true,
      onCorrectStroke: d => { $('modeHint').textContent = `第 ${d.strokeNum + 1} 笔对了，还剩 ${d.strokesRemaining} 笔`; },
      onMistake: d => { $('modeHint').textContent = d.mistakesOnStroke >= 2 ? '看提示，从红色那一笔写起' : '这一笔不对，再试试'; },
      onComplete: () => { $('modeHint').textContent = `写完了「${it.ch}」，真棒！`; },
    });
  }
}
$('modes').addEventListener('click', e => { const b = e.target.closest('.chip'); if (b && st.big) setMode(b.dataset.m); });

// 笔顺分解：第 k 格画前 k 笔，新的一笔标红
function drawStrip(it) {
  const c = $('strip'), n = it.data.strokes.length;
  const W = c.clientWidth || 300, cols = Math.max(6, Math.floor(W / 31)), cell = W / cols, rows = Math.ceil(n / cols);
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  c.width = Math.round(W * dpr); c.height = Math.round(rows * cell * dpr);
  c.style.height = rows * cell + 'px';
  const g = c.getContext('2d');
  g.scale(dpr, dpr);
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, rows * cell);
  for (let k = 0; k < n; k++) {
    const x = (k % cols) * cell, y = Math.floor(k / cols) * cell;
    gridCell(g, x + 1, y + 1, cell - 2, 'tian', 2.5, true);
    drawChar(g, it.data, x + 1, y + 1, cell - 2, i => i < k ? '#141a26' : i === k ? '#e5484d' : null);
  }
}

// ---- 字帖：设置 → 预览 ----
const chipGroup = (id, set) => $(id).addEventListener('click', e => {
  const b = e.target.closest('.chip'); if (!b) return;
  set(b, $(id));
  renderSheet();
});
const single = key => (b, box) => { box.querySelectorAll('.chip').forEach(x => x.classList.toggle('on', x === b)); st.opt[key] = isNaN(+b.dataset.v) ? b.dataset.v : +b.dataset.v; };
chipGroup('grid', single('grid'));
chipGroup('trace', single('trace'));
chipGroup('rows', single('rows'));
chipGroup('show', b => { b.classList.toggle('on'); st.opt[b.dataset.v] = b.classList.contains('on'); });
let titleT = 0;
$('title').addEventListener('input', () => { clearTimeout(titleT); titleT = setTimeout(() => { st.opt.title = $('title').value.trim(); renderSheet(); }, 250); });

function renderSheet() {
  if (!st.items.length) return;
  st.pages = paginate(st.items, st.opt);
  st.page = Math.min(st.page, st.pages.length - 1);
  const c = $('preview'), W = c.clientWidth || 320, dpr = Math.min(3, window.devicePixelRatio || 1);
  c.width = Math.round(W * dpr); c.height = Math.round(W * dpr * PAGE.h / PAGE.w);
  drawPage(c.getContext('2d'), st.pages[st.page], st.opt, c.width / PAGE.w, st.page + 1, st.pages.length);
  $('pager').hidden = st.pages.length < 2;
  $('pageNo').textContent = `第 ${st.page + 1} / ${st.pages.length} 页`;
  $('pdf').textContent = `下载 PDF（A4 直接打印${st.pages.length > 1 ? ` · ${st.pages.length} 页` : ''}）`;
  $('pdfOut').hidden = true;
  setStatus(`${st.items.length} 个字 · 字帖 ${st.pages.length} 页`, 'done');
  c.classList.remove('flash'); void c.offsetWidth; c.classList.add('flash');
}
$('prev').addEventListener('click', () => { if (st.page > 0) { st.page--; renderSheet(); } });
$('next').addEventListener('click', () => { if (st.page < st.pages.length - 1) { st.page++; renderSheet(); } });

// ---- 导出 ----
const urls = {};
const blobUrl = (k, b) => { if (urls[k]) URL.revokeObjectURL(urls[k]); return (urls[k] = URL.createObjectURL(b)); };
const fmtSize = n => n > 1048576 ? (n / 1048576).toFixed(1) + 'MB' : Math.max(1, Math.round(n / 1024)) + 'KB';
const fileBase = () => `字帖_${(st.opt.title || '生字练习').replace(/[\\/:*?"<>|]/g, '')}_${st.items.length}字`;

$('pdf').addEventListener('click', async () => {
  const out = $('pdfOut');
  out.hidden = false;
  out.innerHTML = '正在生成 PDF…<span class="bar"><b></b></span>';
  $('pdf').disabled = true;
  try {
    const t0 = performance.now();
    const pdf = await makePdf(st.pages, st.opt, p => { const b = out.querySelector('.bar b'); if (b) b.style.width = Math.round(p * 100) + '%'; });
    const url = blobUrl('pdf', pdf), n = st.pages.length;
    out.innerHTML = `已生成 PDF：${n} 页 · ${fmtSize(pdf.size)} ✓<a id="pdfLink" href="${url}" download="${fileBase()}.pdf">保存</a>`;
    out.dataset.ms = Math.round(performance.now() - t0);
  } catch (e) {
    out.textContent = '生成失败：' + e.message;
  }
  $('pdf').disabled = false;
});

$('png').addEventListener('click', async e => {
  if ($('png').dataset.ready) { delete $('png').dataset.ready; return; }
  e.preventDefault();
  const mm = 200 / 25.4, c = document.createElement('canvas');
  c.width = Math.round(PAGE.w * mm); c.height = Math.round(PAGE.h * mm);
  drawPage(c.getContext('2d'), st.pages[st.page], st.opt, mm, st.page + 1, st.pages.length);
  const b = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.92));
  const a = $('png');
  a.href = blobUrl('png', b);
  a.download = `${fileBase()}${st.pages.length > 1 ? `_第${st.page + 1}页` : ''}.jpg`;
  a.dataset.ready = 1;
  a.click();
});

// ---- 输入 ----
$('go').addEventListener('click', generate);
$('text').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); generate(); } });
$('examples').addEventListener('click', e => {
  const b = e.target.closest('[data-t]'); if (!b) return;
  $('text').value = b.dataset.t;
  generate();
});
let resizeT = 0;
window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => { if (st.items.length) { renderSheet(); drawStrip(st.items[st.sel]); } }, 200); });
if (qs.get('t')) { $('text').value = qs.get('t'); generate(); }

// 代做入口：site/config.js 里配置了才显示；service.tools.zitie 可以单独设置这一页的价格和说明
const svc = window.SITE_CONFIG && window.SITE_CONFIG.service;
if (svc) {
  const s = Object.assign({}, svc, svc.tools && svc.tools.zitie);
  const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  $('service').innerHTML = `<h2>找我代做 <b>${esc(s.price)}</b></h2><p>${esc(s.text)}</p><p class="contact">${esc(s.contact)}</p>${s.qr ? `<img src="../${esc(s.qr)}" alt="联系方式二维码">` : ''}`;
  $('service').hidden = false;
}
