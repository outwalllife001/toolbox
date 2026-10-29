import * as core from './core.js';

const $ = id => document.getElementById(id);
const Q = new URLSearchParams(location.search);
// ?reveal=hold 只给录视频用（days/*/scenes.mjs）：算完后分隔线先不滑出来，等分镜调用 window.reveal()，和配音对齐
const HOLD = Q.get('reveal') === 'hold';
const BE_LABEL = { webgpu16: 'GPU 加速', webgpu: 'GPU 加速', wasm: 'CPU 模式' };
const st = {
  img: null, name: '', url: '', ready: false, be: '', busy: false, scale: 4, p: null, src: null, alpha: false, has4: false,
  x: 0.5, k: 1, tx: 0, ty: 0, bx: 0, by: 0, sw: 0, sh: 0, done: false, ms: 0, dlUrl: '',
};
const cmp = $('cmp'), stage = $('stage'), after = $('after');
cmp.classList.add('empty');

function setStatus(text, cls = '') { const s = $('status'); s.textContent = text; s.className = 'status ' + cls; }
function refreshGo() { $('go').disabled = !(st.img && st.ready) || st.busy; }
const sec = ms => (ms / 1000).toFixed(ms < 10000 ? 1 : 0);

// ---------- 模型 ----------
const want = Q.get('backend') || await core.pickBackend();
// 网址里指定了 ?backend=wasm 就别说「不支持 GPU」（录视频时是故意用 CPU）
const CPU_HINT = Q.get('backend') ? '' : '这台设备不支持 GPU 加速，会用 CPU 慢慢算';
core.load(want, p => { if (p < 1) setStatus(`正在加载 AI 模型 ${Math.round(p * 100)}%（只需加载一次）`); })
  .then(be => {
    st.be = be; st.ready = true;
    setStatus(st.img ? (be === 'wasm' ? CPU_HINT : '') : '先上传一张照片');
    refreshGo(); scaleInfo();
  })
  .catch(e => setStatus('模型加载失败：' + e.message + '，请刷新重试'));

// ---------- 上传 ----------
$('file').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  e.target.value = '';
  const url = URL.createObjectURL(f), im = new Image();
  im.src = url;
  try { await im.decode(); } catch { setStatus('这张图片打不开，换一张试试'); return; }
  if (st.url) URL.revokeObjectURL(st.url);
  Object.assign(st, { img: im, url, name: f.name.replace(/\.\w+$/, ''), has4: false, done: false, k: 1, tx: 0, ty: 0 });
  const w0 = im.naturalWidth, h0 = im.naturalHeight;
  st.scale = Math.max(w0, h0) >= 1200 ? 2 : 4;
  document.querySelectorAll('#scales .chip').forEach(c => c.classList.toggle('on', +c.dataset.s === st.scale));
  $('before').src = url;
  cmp.classList.remove('empty'); $('dropEmpty').hidden = true; stage.hidden = false;
  after.classList.remove('show');
  showDone(false);
  $('srcMeta').hidden = false; $('srcMeta').textContent = `原图 ${w0}×${h0}`;
  layout(); scaleInfo();
  if (st.ready) setStatus(st.be === 'wasm' ? CPU_HINT : '');
  refreshGo();
});

function scaleInfo() {
  if (!st.img) return;
  for (const s of [2, 4]) {
    const p = core.plan(st.img.naturalWidth, st.img.naturalHeight, s, st.be || 'webgpu');
    $('s' + s).textContent = `${p.W}×${p.H}`;
  }
}

$('scales').addEventListener('click', async e => {
  const b = e.target.closest('.chip'); if (!b || st.busy) return;
  st.scale = +b.dataset.s;
  document.querySelectorAll('#scales .chip').forEach(c => c.classList.toggle('on', c === b));
  if (st.has4) await output();   // 已经算过 4 倍：2 倍 / 4 倍只差最后一步缩放，不用重算
});

// ---------- 放大 ----------
$('go').addEventListener('click', () => run());
async function run() {
  if (!st.img || !st.ready || st.busy) return;
  st.busy = true; refreshGo();
  try {
    const p = st.p = core.plan(st.img.naturalWidth, st.img.naturalHeight, st.scale, st.be);
    const { src, alpha } = core.toWorkCanvas(st.img, p);
    st.src = src; st.alpha = alpha;
    after.width = p.w * 4; after.height = p.h * 4;
    core.prefill(after, src);
    // 分块结果一块块盖到图上（底下先铺了普通放大的图），看得到进度
    setSplit(0); showLabels(false);
    after.classList.add('show');
    $('bar').hidden = false; $('barIn').style.width = '0%';
    const label = st.be === 'wasm' ? 'AI 放大中（CPU 模式，比较慢）' : 'AI 放大中';
    setStatus(label + '…');
    // 先让状态画出来再开始
    await new Promise(r => requestAnimationFrame(() => setTimeout(r, 30)));
    const r = await core.upscale4(src, after, t => {
      $('barIn').style.width = (t.n / t.total * 100).toFixed(1) + '%';
      const left = t.n < t.total && t.n >= 1 ? t.ms / t.n * (t.total - t.n) : 0;
      setStatus(`${label}… ${t.n}/${t.total}${left > 3000 ? `，大约还要 ${Math.ceil(left / 1000)} 秒` : ''}`);
    });
    st.ms = r.ms; st.has4 = true;
    await output();
    $('bar').hidden = true;
    showDone(true);
    // 分隔线从左边滑到中间：左边露出原图
    const reveal = () => { $('split').hidden = false; showLabels(true); animSplit(0, 0.5, 800); };
    if (HOLD) window.reveal = reveal; else reveal();
  } catch (e) {
    console.error(e);
    $('bar').hidden = true;
    setStatus('处理失败：' + (e.message || e) + '。可以关掉其他页面、换一张小一点的图再试');
  } finally { st.busy = false; refreshGo(); }
}

const toBlob = (c, type, q) => new Promise(r => c.toBlob(r, type, q));
async function output() {
  const p = st.p = core.plan(st.img.naturalWidth, st.img.naturalHeight, st.scale, st.be);
  const out = core.finish(after, p, st.src, st.alpha);
  const png = st.alpha, blob = await toBlob(out, png ? 'image/png' : 'image/jpeg', 0.92);
  if (st.dlUrl) URL.revokeObjectURL(st.dlUrl);
  st.dlUrl = URL.createObjectURL(blob);
  $('dl').href = st.dlUrl; $('dl').download = `${st.name || '照片'}_高清${st.scale}倍_${p.W}x${p.H}.${png ? 'png' : 'jpg'}`;
  $('meta').textContent = `${p.w0}×${p.h0} → ${p.W}×${p.H}（${st.scale} 倍）· 用时 ${sec(st.ms)} 秒 · ${BE_LABEL[st.be]} · ${(blob.size / 1048576).toFixed(1)}MB`
    + (p.shrunk ? ` · 原图较大，先缩到 ${p.w}×${p.h} 再放大` : '');
  setStatus(`✓ 已放大 ${st.scale} 倍，拖动中间的线对比`, 'done');
}

function showDone(on) {
  st.done = on;
  $('done').hidden = !on; $('go').hidden = on;
  if (!on) { $('split').hidden = true; showLabels(false); setZoom(1); }
}
function showLabels(on) { $('lblL').hidden = $('lblR').hidden = !on; }

// ---------- 对比视图：stage 按图片比例放进 cmp；st.x 是分隔线在 cmp 里的位置（0–1）----------
function layout() {
  if (!st.img) return;
  const cw = cmp.clientWidth, ch = cmp.clientHeight, a = st.img.naturalWidth / st.img.naturalHeight;
  st.sw = Math.min(cw, ch * a); st.sh = st.sw / a;
  st.bx = (cw - st.sw) / 2; st.by = (ch - st.sh) / 2;
  stage.style.width = st.sw + 'px'; stage.style.height = st.sh + 'px';
  clampPan(); apply();
}
function clampPan() {
  const cw = cmp.clientWidth, ch = cmp.clientHeight, W = st.sw * st.k, H = st.sh * st.k;
  const fit = (pos, size, view) => size >= view ? Math.min(0, Math.max(view - size, pos)) : (view - size) / 2;
  st.tx = fit(st.bx + st.tx, W, cw) - st.bx;
  st.ty = fit(st.by + st.ty, H, ch) - st.by;
}
function apply() {
  stage.style.transform = `translate(${st.bx + st.tx}px, ${st.by + st.ty}px) scale(${st.k})`;
  const cw = cmp.clientWidth, X = st.x * cw;
  $('split').style.left = X + 'px';
  const local = Math.max(0, Math.min(st.sw, (X - st.bx - st.tx) / st.k));
  after.style.clipPath = `inset(0 0 0 ${local.toFixed(2)}px)`;
  // 标签贴着图片的左上角 / 右上角（图片比视图小时两边有空白）
  const L = st.bx + st.tx, R = cw - (st.bx + st.tx + st.sw * st.k), T = st.by + st.ty;
  $('lblL').style.left = Math.max(8, L + 8) + 'px'; $('lblR').style.right = Math.max(8, R + 8) + 'px';
  $('lblL').style.top = $('lblR').style.top = Math.max(8, T + 8) + 'px';
}
// 分隔线放在图片范围内（不放大时图片两边可能有空白）
function setSplit(x) {
  const cw = cmp.clientWidth || 1, lo = Math.max(0, (st.bx + st.tx) / cw), hi = Math.min(1, (st.bx + st.tx + st.sw * st.k) / cw);
  st.x = x <= 0 ? 0 : x >= 1 ? 1 : Math.max(lo, Math.min(hi, x));
  apply();
}
function animSplit(from, to, ms) {
  const t0 = performance.now();
  const step = now => {
    const t = Math.min(1, (now - t0) / ms), e = t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    setSplit(from + (to - from) * e);
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
// 放大 k 倍，把图片上 (fx, fy)（0–1）这一点放到视图中间
function setZoom(k, fx = 0.5, fy = 0.5, anim = false) {
  const cw = cmp.clientWidth, ch = cmp.clientHeight;
  st.k = k;
  st.tx = cw / 2 - st.bx - fx * st.sw * k; st.ty = ch / 2 - st.by - fy * st.sh * k;
  clampPan();
  stage.style.transition = anim ? 'transform .45s ease' : '';
  apply();
  if (anim) setTimeout(() => { stage.style.transition = ''; }, 480);
  $('zoom').classList.toggle('on', k > 1); $('zoom').textContent = k > 1 ? '↩ 还原' : '🔍 放大看细节';
  $('zoomTip').hidden = k === 1;
}
$('zoom').addEventListener('click', () => {
  if (st.k > 1) return setZoom(1, 0.5, 0.5, true);
  // 以分隔线所在的位置为中心放大，左右两边都看得到
  const fx = Math.max(0, Math.min(1, (st.x * cmp.clientWidth - st.bx - st.tx) / (st.sw * st.k)));
  setZoom(3, fx, 0.4, true);
});
// 录视频用：分镜里调 window.__up.split(0.2, 600) / window.__up.zoom(3, fx, fy)
window.__up = { split: (x, ms = 0) => (ms ? animSplit(st.x, x, ms) : setSplit(x)), zoom: (k, fx, fy) => setZoom(k, fx, fy, true) };

// 拖动：抓着分隔线（或者没放大时点哪都行）就移动分隔线；放大时拖图片别处是平移
let drag = null;
cmp.addEventListener('pointerdown', e => {
  if (!st.done) return;
  e.preventDefault(); cmp.setPointerCapture(e.pointerId);
  const r = cmp.getBoundingClientRect();
  drag = e.target.closest('.split') || st.k === 1 ? { mode: 'split', r } : { mode: 'pan', r, x: e.clientX, y: e.clientY, tx: st.tx, ty: st.ty };
  if (drag.mode === 'split') setSplit((e.clientX - r.left) / r.width);
});
cmp.addEventListener('pointermove', e => {
  if (!drag) return;
  if (drag.mode === 'split') setSplit((e.clientX - drag.r.left) / drag.r.width);
  else { st.tx = drag.tx + e.clientX - drag.x; st.ty = drag.ty + e.clientY - drag.y; clampPan(); apply(); }
});
for (const ev of ['pointerup', 'pointercancel']) cmp.addEventListener(ev, () => { drag = null; });
// 双击图片：在点的位置放大 / 还原
cmp.addEventListener('dblclick', e => {
  if (!st.done) return;
  if (st.k > 1) return setZoom(1, 0.5, 0.5, true);
  const r = cmp.getBoundingClientRect();
  setZoom(3, (e.clientX - r.left - st.bx - st.tx) / st.sw, (e.clientY - r.top - st.by - st.ty) / st.sh, true);
});
addEventListener('resize', layout);

$('again').addEventListener('click', () => { window.scrollTo({ top: 0, behavior: 'smooth' }); $('file').click(); });

// 代做入口：site/config.js 里配置了才显示；service.tools.upscale 可以单独设置这一页的价格和说明
const svc = window.SITE_CONFIG && window.SITE_CONFIG.service;
if (svc) {
  const s = Object.assign({}, svc, svc.tools && svc.tools.upscale);
  const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  $('service').innerHTML = `<h2>找我代做 <b>${esc(s.price)}</b></h2><p>${esc(s.text)}</p><p class="contact">${esc(s.contact)}</p>${s.qr ? `<img src="../${esc(s.qr)}" alt="联系方式二维码">` : ''}`;
  $('service').hidden = false;
}
