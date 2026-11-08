import * as core from './core.js';

const $ = id => document.getElementById(id);
const Q = new URLSearchParams(location.search);
// ?reveal=hold 只给录视频用（days/*/scenes.mjs）：算完后分隔线先不滑，等分镜调用 window.reveal()，和配音对齐
const HOLD = Q.get('reveal') === 'hold';
const BE_LABEL = { webgpu: 'GPU 加速', wasm: 'CPU 模式' };
// 第 10 个是肤色（涂脸、手用）
const COLORS = ['#ff5a5a', '#ff9a3c', '#ffd93b', '#7ed957', '#2fbf71', '#4fc3f7', '#2f6bff', '#a66bff', '#ff8ac2', '#f6c8a4', '#c8854a', '#8d99ae', '#141a26'];
const st = {
  img: null, name: '', url: '', ready: false, be: '', busy: false, done: false,
  detail: 'mid', bg: 'keep', level: 3, lines: {}, mask: null, soft: null, W: 0, H: 0, ms: 0,
  x: 1, sw: 0, sh: 0, bx: 0, by: 0, painter: null, painting: false, color: COLORS[0], brush: 20, eraser: false, book: [],
};
const cmp = $('cmp'), stage = $('stage'), after = $('after'), paintC = $('paint');
cmp.classList.add('empty');

function setStatus(text, cls = '') { const s = $('status'); s.textContent = text; s.className = 'status ' + cls; }
function setStatus2(text, cls = '') { const s = $('status2'); s.textContent = text; s.className = 'status ' + cls; }
function refreshGo() { $('go').disabled = !(st.img && st.ready) || st.busy; }
const sec = ms => (ms / 1000).toFixed(ms < 10000 ? 1 : 0);
const raf2 = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 30)));

// ---------- 模型 ----------
const want = Q.get('backend') || await core.pickBackend();
const CPU_HINT = Q.get('backend') ? '' : '这台设备不支持 GPU 加速，用 CPU 算会慢一些';
core.load(want, p => { if (p < 1) setStatus(`正在加载 AI 模型 ${Math.round(p * 100)}%（只需加载一次）`); })
  .then(be => {
    st.be = be; st.ready = true;
    setStatus(st.img ? (be === 'wasm' ? CPU_HINT : '') : '先上传一张照片');
    refreshGo();
  })
  .catch(e => setStatus('模型加载失败：' + e.message + '，请刷新重试'));

// ---------- 上传 ----------
$('file').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  e.target.value = '';
  await openImage(URL.createObjectURL(f), f.name.replace(/\.\w+$/, ''));
});
$('sample').addEventListener('click', () => openImage(new URL('sample.jpg', import.meta.url).href, '示例'));

async function openImage(url, name) {
  const im = new Image();
  im.src = url;
  try { await im.decode(); } catch { setStatus('这张图片打不开，换一张试试'); return; }
  if (st.url.startsWith('blob:')) URL.revokeObjectURL(st.url);
  leavePaint();
  Object.assign(st, { img: im, url, name, lines: {}, mask: null, soft: null, painter: null, detail: 'mid', bg: 'keep', level: 3 });
  $('thick').value = 3;
  setSeg('details', 'd', 'mid'); setSeg('bgs', 'b', 'keep');
  $('before').src = url;
  cmp.classList.remove('empty'); $('dropEmpty').hidden = true; stage.hidden = false;
  after.classList.remove('show');
  showDone(false);
  st.x = 1; layout();
  if (st.ready) setStatus(st.be === 'wasm' ? CPU_HINT : '');
  refreshGo();
}
function setSeg(id, key, val) { document.querySelectorAll(`#${id} button`).forEach(b => b.classList.toggle('on', b.dataset[key] === val)); }

// ---------- 进度：模型只有一步，拿不到真实进度，按预估时间走（到不了头，算完直接满）----------
let barTimer = 0;
function barStart(expectMs) {
  $('bar').hidden = false; $('barIn').style.width = '0%';
  const t0 = performance.now(); clearInterval(barTimer);
  barTimer = setInterval(() => { $('barIn').style.width = (95 * (1 - Math.exp(-1.6 * (performance.now() - t0) / expectMs))).toFixed(1) + '%'; }, 100);
}
function barStop() { clearInterval(barTimer); $('barIn').style.width = '100%'; $('bar').hidden = true; }
// 预估：Mac 单线程 WASM 768×576 约 5 秒、GPU 约 0.3 秒；手机按再慢 2 倍估
const expectMs = (w, h) => (st.be === 'webgpu' ? 800 : 12000 * (w * h) / (768 * 576) / Math.pow(core.threads(), 0.85));

// ---------- 主流程 ----------
$('go').addEventListener('click', run);
async function run() {
  if (!st.img || !st.ready || st.busy) return;
  st.busy = true; refreshGo();
  try {
    setStatus(st.be === 'wasm' ? 'AI 正在画线稿（CPU 模式，慢一点）…' : 'AI 正在画线稿…');
    await rebuild();
    setStatus('✓ 画好了，拖动中间的线可以对比', 'done');
    showDone(true);
    // 分隔线从右滑到左：照片变成涂色画
    const reveal = () => { $('split').hidden = false; showLabels(true); animSplit(1, 0, 1100); };
    if (HOLD) window.reveal = reveal; else reveal();
  } catch (e) {
    console.error(e);
    setStatus('处理失败：' + (e.message || e) + '。可以关掉其他页面、换一张图再试');
  } finally { barStop(); st.busy = false; refreshGo(); }
}

// 需要的话跑模型 / 蒙版，再按当前选项重新出图
async function rebuild() {
  const side = core.SIDES[st.detail], { w, h } = core.modelSize(st.img.naturalWidth, st.img.naturalHeight, side);
  if (!st.lines[st.detail]) {
    barStart(expectMs(w, h));
    await raf2();
    st.lines[st.detail] = await core.lineart(st.img, side);
  }
  if (st.bg === 'cut' && !st.mask) {
    setStatus2('正在去背景（第一次要下载约 40MB 模型）…');
    barStart(4000);
    st.mask = await core.subjectMask(st.img, p => { if (p < 1) setStatus2(`正在下载去背景模型 ${Math.round(p * 100)}%（只需下载一次）`); });
    setStatus2('');
  }
  const L = st.lines[st.detail], { W, H } = core.workSize(st.img.naturalWidth, st.img.naturalHeight);
  st.W = W; st.H = H; st.ms = L.ms;
  await raf2();
  st.soft = core.soften(L, st.bg === 'cut' ? st.mask : null, W, H);
  draw();
  after.classList.add('show');
  $('meta').textContent = `线稿 ${L.w}×${L.h} · 用时 ${sec(L.ms)} 秒 · ${BE_LABEL[st.be]}${st.be === 'wasm' && core.threads() > 1 ? ` ${core.threads()} 线程` : ''}`;
  barStop();
}
function draw() {
  core.drawLines(after, st.soft, st.W, st.H, st.level);
  if (st.painter) st.painter.setLines(st.soft, st.W, st.H, st.level);
}

// 线条粗细：不重算，只换阈值。每帧最多画一次
let thickPending = false;
$('thick').addEventListener('input', e => {
  st.level = +e.target.value;
  if (thickPending || !st.soft) return;
  thickPending = true;
  requestAnimationFrame(() => { thickPending = false; draw(); });
});

$('details').addEventListener('click', e => changeOpt(e, 'details', 'd', v => { st.detail = v; }));
$('bgs').addEventListener('click', e => changeOpt(e, 'bgs', 'b', v => { st.bg = v; }));
async function changeOpt(e, id, key, apply) {
  const b = e.target.closest('button'); if (!b || st.busy || b.classList.contains('on')) return;
  const prev = { detail: st.detail, bg: st.bg };
  apply(b.dataset[key]); setSeg(id, key, b.dataset[key]);
  st.busy = true;
  const btns = document.querySelectorAll('#details button, #bgs button'); btns.forEach(x => { x.disabled = true; });
  try {
    setStatus2(st.lines[st.detail] ? '' : 'AI 正在重新画…');
    await rebuild();
    setStatus2('');
    if (st.x > 0) animSplit(st.x, 0, 300);
  } catch (err) {
    console.error(err);
    Object.assign(st, prev); setSeg('details', 'd', st.detail); setSeg('bgs', 'b', st.bg);
    setStatus2('没做成：' + (err.message || err) + '。可以关掉其他页面再试');
  } finally { barStop(); btns.forEach(x => { x.disabled = false; }); st.busy = false; }
}

function showDone(on) {
  st.done = on;
  $('done').hidden = !on; $('go').hidden = on; $('sample').hidden = on;
  if (!on) { $('split').hidden = true; showLabels(false); $('status').hidden = false; }
  else { $('status').hidden = true; $('status').textContent = '✓ 画好了'; }
}
function showLabels(on) { $('lblL').hidden = $('lblR').hidden = !on; }

// ---------- 对比视图 ----------
function layout() {
  if (!st.img) return;
  const cw = cmp.clientWidth, ch = cmp.clientHeight, a = st.img.naturalWidth / st.img.naturalHeight;
  st.sw = Math.min(cw, ch * a); st.sh = st.sw / a;
  st.bx = (cw - st.sw) / 2; st.by = (ch - st.sh) / 2;
  stage.style.cssText = `width:${st.sw}px;height:${st.sh}px;transform:translate(${st.bx}px,${st.by}px)`;
  apply();
}
function apply() {
  const cw = cmp.clientWidth, X = st.x * cw;
  $('split').style.left = X + 'px';
  const local = st.painting ? 0 : Math.max(0, Math.min(st.sw, X - st.bx));
  after.style.clipPath = `inset(0 0 0 ${local.toFixed(2)}px)`;
  const L = st.bx, R = cw - (st.bx + st.sw);
  $('lblL').style.left = Math.max(8, L + 8) + 'px'; $('lblR').style.right = Math.max(8, R + 8) + 'px';
  $('lblL').style.top = $('lblR').style.top = Math.max(8, st.by + 8) + 'px';
}
function setSplit(x) { st.x = Math.max(0, Math.min(1, x)); apply(); }
function animSplit(from, to, ms) {
  const t0 = performance.now();
  const step = now => {
    const t = Math.min(1, (now - t0) / ms), e = t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    setSplit(from + (to - from) * e);
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
window.__color = { split: (x, ms = 0) => (ms ? animSplit(st.x, x, ms) : setSplit(x)) };   // 录视频用
addEventListener('resize', layout);

// 拖动分隔线（竖着滑是滚动页面，touch-action: pan-y）
let drag = null;
cmp.addEventListener('pointerdown', e => {
  if (!st.done) return;
  if (st.painting) return strokeStart(e);
  if (!after.classList.contains('show')) return;
  e.preventDefault(); try { cmp.setPointerCapture(e.pointerId); } catch {}
  drag = { r: cmp.getBoundingClientRect() };
  setSplit((e.clientX - drag.r.left) / drag.r.width);
});
cmp.addEventListener('pointermove', e => {
  if (st.painting) return strokeMove(e);
  if (drag) setSplit((e.clientX - drag.r.left) / drag.r.width);
});
for (const ev of ['pointerup', 'pointercancel']) cmp.addEventListener(ev, e => { drag = null; if (st.painting) strokeEnd(e); });

// ---------- 手指涂色 ----------
COLORS.forEach((c, i) => {
  const b = document.createElement('button'); b.style.background = c; b.dataset.c = c; b.setAttribute('aria-label', '颜色 ' + (i + 1));
  if (!i) b.className = 'on';
  $('palette').appendChild(b);
});
$('palette').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  st.color = b.dataset.c; st.eraser = false; $('eraser').classList.remove('on');
  document.querySelectorAll('#palette button').forEach(x => x.classList.toggle('on', x === b));
});
$('brushes').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; st.brush = +b.dataset.r; setSeg('brushes', 'r', b.dataset.r); });
$('eraser').addEventListener('click', () => { st.eraser = !st.eraser; $('eraser').classList.toggle('on', st.eraser); });
$('undo').addEventListener('click', () => { st.painter && st.painter.undo(); });
$('clearPaint').addEventListener('click', () => { st.painter && st.painter.clear(); });

function enterPaint() {
  st.painting = true;
  cmp.classList.add('painting');
  $('adjust').hidden = true; $('painter').hidden = false;
  $('split').hidden = true; showLabels(false); $('before').hidden = true; paintC.hidden = false;
  if (!st.painter) st.painter = new core.Painter(st.soft, st.W, st.H, st.level, paintC);
  apply();
}
function leavePaint() {
  st.painting = false;
  cmp.classList.remove('painting');
  $('adjust').hidden = false; $('painter').hidden = true; paintC.hidden = true; $('before').hidden = false;
  if (st.done) { $('split').hidden = false; showLabels(true); }
  apply();
}
$('paintBtn').addEventListener('click', () => { enterPaint(); cmp.scrollIntoView({ block: 'start', behavior: 'smooth' }); });
$('backAdjust').addEventListener('click', leavePaint);

let stroke = null;
const rgb = hex => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
function posOf(e) {
  const r = paintC.getBoundingClientRect(), k = st.painter.w / r.width;
  return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k, k };
}
function dabAt(p) { st.painter.dab(p.x, p.y, st.brush * p.k, st.eraser ? null : rgb(st.color)); }
function strokeStart(e) {
  e.preventDefault(); try { cmp.setPointerCapture(e.pointerId); } catch {}
  st.painter.begin();
  const p = posOf(e); stroke = { p }; dabAt(p);
}
function strokeMove(e) {
  if (!stroke) return;
  const list = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
  for (const ev of list.length ? list : [e]) {
    const p = posOf(ev), d = Math.hypot(p.x - stroke.p.x, p.y - stroke.p.y), step = Math.max(1, st.brush * p.k / 3), n = Math.ceil(d / step);
    for (let i = 1; i <= n; i++) dabAt({ x: stroke.p.x + (p.x - stroke.p.x) * i / n, y: stroke.p.y + (p.y - stroke.p.y) * i / n, k: p.k });
    stroke.p = p;
  }
}
function strokeEnd() { if (stroke) { st.painter.end(); stroke = null; } }

// ---------- 导出 ----------
const fname = ext => `${st.name || '照片'}_涂色画.${ext}`;
function saveBlob(blob, name) {
  const a = document.createElement('a'), url = URL.createObjectURL(blob);
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
async function busyBtn(btn, text, fn) {
  const old = btn.textContent; btn.disabled = true; btn.textContent = text;
  await raf2();
  try { await fn(); } catch (e) { console.error(e); alert('导出失败：' + (e.message || e)); } finally { btn.disabled = false; btn.textContent = old; }
}
const pageBlob = () => core.toBlob(after, 'image/png');
const paintedCanvas = () => st.painter.flatten(after);
$('pdf').addEventListener('click', e => busyBtn(e.currentTarget, '正在生成 PDF…', async () => {
  const bytes = await core.makePdf([await pageBlob()], fname('pdf').replace('.pdf', ''));
  window.__lastPdf = bytes; saveBlob(new Blob([bytes], { type: 'application/pdf' }), fname('pdf'));
}));
$('png').addEventListener('click', e => busyBtn(e.currentTarget, '正在保存…', async () => saveBlob(await pageBlob(), fname('png'))));
$('savePaint').addEventListener('click', e => busyBtn(e.currentTarget, '正在保存…', async () => saveBlob(await core.toBlob(paintedCanvas(), 'image/png'), `${st.name || '照片'}_涂好了.png`)));
$('paintPdf').addEventListener('click', e => busyBtn(e.currentTarget, '正在生成…', async () => {
  const bytes = await core.makePdf([await core.toBlob(paintedCanvas(), 'image/png')]);
  window.__lastPdf = bytes; saveBlob(new Blob([bytes], { type: 'application/pdf' }), `${st.name || '照片'}_涂好了.pdf`);
}));
$('again').addEventListener('click', () => { window.scrollTo({ top: 0, behavior: 'smooth' }); $('file').click(); });

// ---------- 涂色书：几张合成一个 PDF。启用会员后，免费版一本最多 3 页 ----------
const FREE_PAGES = 3;
$('addBook').addEventListener('click', e => busyBtn(e.currentTarget, '正在加入…', async () => {
  if (window.Member?.enabled && st.book.length >= FREE_PAGES && !(await Member.active())) {
    const r = await Member.gate({ title: '做一整本涂色书', text: `免费版一本涂色书最多 ${FREE_PAGES} 页（单张下载不限次数）；开通工具箱会员可以合成更多页。` });
    if (r !== 'member') return;
  }
  const blob = await pageBlob();
  st.book.push({ blob, url: URL.createObjectURL(blob) });
  renderBook();
}));
function renderBook() {
  $('book').hidden = !st.book.length;
  $('bookPdf').textContent = `合成一本 PDF（${st.book.length} 页）`;
  $('addBook').textContent = st.book.length ? `＋ 加入涂色书（已 ${st.book.length} 页）` : '＋ 加入涂色书';
  $('thumbs').innerHTML = '';
  st.book.forEach((p, i) => {
    const f = document.createElement('figure');
    f.innerHTML = `<img alt="第 ${i + 1} 页" src="${p.url}"><button aria-label="删除第 ${i + 1} 页">×</button>`;
    f.querySelector('button').onclick = () => { URL.revokeObjectURL(p.url); st.book.splice(i, 1); renderBook(); };
    $('thumbs').appendChild(f);
  });
}
$('bookPdf').addEventListener('click', e => {
  if (!st.book.length) return;
  busyBtn(e.currentTarget, '正在生成…', async () => {
    const bytes = await core.makePdf(st.book.map(p => p.blob), '我家的涂色书');
    window.__lastPdf = bytes; saveBlob(new Blob([bytes], { type: 'application/pdf' }), `我家的涂色书_${st.book.length}页.pdf`);
    // busyBtn 收尾时会把按钮字改回去，这里不用再改
  });
});

// 代做入口：site/config.js 里配置了才显示；service.tools.coloring 可以单独设置这一页的价格和说明
const svc = window.SITE_CONFIG && window.SITE_CONFIG.service;
if (svc) {
  const s = Object.assign({}, svc, svc.tools && svc.tools.coloring);
  const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  $('service').innerHTML = `<h2>找我代做 <b>${esc(s.price)}</b></h2><p>${esc(s.text)}</p><p class="contact">${esc(s.contact)}</p>${s.qr ? `<img src="../${esc(s.qr)}" alt="联系方式二维码">` : ''}`;
  $('service').hidden = false;
}
window.__coloring = st;
