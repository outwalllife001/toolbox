import * as core from './core.js';

const $ = id => document.getElementById(id);
// 手机上模型输入用 768（Mac 单线程 3.7 秒、内存峰值约 0.9GB），电脑用原版的 1024（6.4 秒、约 1.5GB），见 days/day03-cutout/README.md
const MOBILE = /Android|iPhone|iPad|iPod|Mobile|HarmonyOS/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
const BGS = [['透明', null], ['白色', '#ffffff'], ['浅灰', '#eef0f3'], ['米色', '#f4ece1'], ['淡蓝', '#e3eefc'], ['黑色', '#111111']];
const LAYOUTS = [['原图大小', 'orig', '不裁剪'], ['正方形', [800, 800], '800×800'], ['高清方图', [1200, 1200], '1200×1200'], ['竖图 3:4', [750, 1000], '750×1000']];
// 网址里 ?size= 可以强制模型输入边长（64 的倍数，320–1024）
function modelSize() {
  const q = +new URLSearchParams(location.search).get('size');
  return q ? Math.min(1024, Math.max(320, Math.round(q / 64) * 64)) : MOBILE ? 768 : 1024;
}
const st = { img: null, name: '', ready: false, res: null, bg: null, bgName: '透明', layout: 'orig', shadow: false, size: modelSize(), urls: {}, busy: false };

$('bgs').innerHTML = BGS.map(([n, c], i) =>
  `<button class="sw${c ? '' : ' clear'}${i ? '' : ' on'}" data-i="${i}" style="${c ? `background:${c}` : ''}" aria-label="${n}"><span>${n}</span></button>`).join('')
  + `<label class="sw pick" aria-label="自选颜色"><input type="color" id="pick" value="#ffd84d"><span>自选</span></label>`;
$('layouts').innerHTML = LAYOUTS.map(([n, , sub], i) => `<button class="chip${i ? '' : ' on'}" data-i="${i}">${n}<small>${sub}</small></button>`).join('');

function setStatus(text, cls = '') { const s = $('status'); s.textContent = text; s.className = 'status ' + cls; }
function refreshGo() { $('go').disabled = !(st.img && st.ready) || st.busy; }

core.loadModel(p => { if (p < 1) setStatus(`正在加载 AI 模型 ${Math.round(p * 100)}%（只需加载一次，建议连 Wi-Fi）`, 'busy'); })
  .then(() => { st.ready = true; setStatus(st.img ? '' : '先上传一张照片'); refreshGo(); })
  .catch(e => setStatus('模型加载失败：' + e.message + '，请刷新重试'));

$('file').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  e.target.value = '';
  const url = URL.createObjectURL(f), im = new Image();
  im.src = url;
  try { await im.decode(); } catch { setStatus('这张图片打不开，换一张试试'); return; }
  if (st.urls.src) URL.revokeObjectURL(st.urls.src);
  st.urls.src = url; st.img = im; st.res = null; st.name = f.name.replace(/\.\w+$/, '');
  $('srcPreview').src = url; $('srcPreview').hidden = false; $('dropEmpty').hidden = true; $('drop').classList.add('has');
  $('result').hidden = true; exitEdit(false);
  if (st.ready) setStatus('');
  refreshGo();
});

$('go').addEventListener('click', () => run());
$('fine').addEventListener('click', () => { st.size = 1024; $('fine').hidden = true; run(); });

async function run() {
  if (!st.img || !st.ready || st.busy) return;
  st.busy = true; refreshGo();
  const label = { matting: MOBILE && st.size < 1024 ? 'AI 抠图中…手机上要等一会儿' : 'AI 抠图中…', refine: '处理边缘…' };
  try {
    // 先让状态文字画出来，再开始占满 CPU 的推理
    setStatus(label.matting, 'busy');
    await new Promise(r => requestAnimationFrame(() => setTimeout(r, 30)));
    const res = await core.removeBackground(st.img, s => setStatus(label[s], 'busy'), st.size);
    res.box = core.bbox(res.alpha, res.src.width, res.src.height);
    st.res = res;
    const first = $('result').hidden;
    $('result').hidden = false;
    $('fine').hidden = !(MOBILE && st.size < 1024);
    await render();
    setStatus('抠好了 ✓', 'done');
    // 第一次出结果先滚到结果区，滚完再播揭幕动画
    if (first) requestAnimationFrame(() => $('result').scrollIntoView({ behavior: 'smooth', block: 'start' }));
    if (st.layout === 'orig') sweep(first ? 480 : 0);
  } catch (e) {
    console.error(e);
    setStatus('处理失败：' + (e.message || e) + (MOBILE ? '。手机内存不够时可以关掉其他页面再试' : ''));
  } finally { st.busy = false; refreshGo(); }
}

// 揭幕动画：原图先盖在结果上（滚动期间看不到结果），然后一条亮线从左往右把原图扫掉
// ?reveal=hold 只给录视频用（days/*/scenes.mjs）：等分镜调用 window.reveal() 再扫，和配音对齐
const HOLD_REVEAL = new URLSearchParams(location.search).get('reveal') === 'hold';
function sweep(delay = 0, ms = 900) {
  const o = $('orig'), line = $('sweep');
  o.src = st.urls.src; o.style.clipPath = 'inset(0 0 0 0)'; o.hidden = false;
  line.style.left = '0%'; line.hidden = false;
  const go = () => {
    const t0 = performance.now();
    const step = now => {
      const t = Math.min(1, (now - t0) / ms), e = t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2, p = (e * 100).toFixed(2);
      o.style.clipPath = `inset(0 0 0 ${p}%)`; line.style.left = p + '%';
      if (t < 1) requestAnimationFrame(step); else { o.hidden = true; line.hidden = true; o.style.clipPath = ''; }
    };
    requestAnimationFrame(step);
  };
  if (HOLD_REVEAL) window.reveal = go; else setTimeout(go, delay);
}

function blobUrl(name, blob) {
  if (st.urls[name]) URL.revokeObjectURL(st.urls[name]);
  return (st.urls[name] = URL.createObjectURL(blob));
}
const toBlob = (c, type, q) => new Promise(r => c.toBlob(r, type, q));

async function render(flash) {
  const { canvas } = core.compose(st.res.cut, st.res.box, { bg: st.bg, layout: st.layout, shadow: st.shadow });
  const png = !st.bg, blob = await toBlob(canvas, png ? 'image/png' : 'image/jpeg', 0.92);
  const url = blobUrl('out', blob);
  $('out').src = url; $('out').classList.toggle('clear', png);
  if (flash) { $('out').classList.remove('flash'); void $('out').offsetWidth; $('out').classList.add('flash'); }
  const ext = png ? 'png' : 'jpg';
  $('dl').href = url; $('dl').download = `${st.name || '抠图'}_${st.bgName}_${canvas.width}x${canvas.height}.${ext}`;
  $('meta').textContent = `${canvas.width}×${canvas.height} · ${png ? 'PNG 透明背景' : 'JPG ' + st.bgName + '背景'}${st.shadow ? ' · 带投影' : ''} · ${(blob.size / 1024 / 1024).toFixed(blob.size > 1048576 ? 1 : 2)}MB`;
}

$('bgs').addEventListener('click', e => {
  const b = e.target.closest('.sw[data-i]'); if (!b || !st.res) return;
  const [n, c] = BGS[+b.dataset.i];
  pickBg(n, c, b);
});
$('pick').addEventListener('input', e => pickBg('自选', e.target.value, e.target.parentNode));
function pickBg(n, c, el) {
  st.bg = c; st.bgName = n;
  document.querySelectorAll('#bgs .sw').forEach(x => x.classList.toggle('on', x === el));
  if (st.res) render(true);
}
$('layouts').addEventListener('click', e => {
  const b = e.target.closest('.chip'); if (!b || !st.res) return;
  document.querySelectorAll('#layouts .chip').forEach(x => x.classList.toggle('on', x === b));
  st.layout = LAYOUTS[+b.dataset.i][1];
  render(true);
});
$('shadow').addEventListener('click', () => {
  st.shadow = !st.shadow; $('shadow').classList.toggle('on', st.shadow);
  if (st.res) render(true);
});
$('again').addEventListener('click', () => { window.scrollTo({ top: 0, behavior: 'smooth' }); $('file').click(); });

// 按住看原图
const hold = on => {
  if (!st.res || !$('edit').hidden) return;
  $('hold').classList.toggle('on', on);
  $('out').src = on ? st.urls.src : st.urls.out;
  $('out').classList.toggle('clear', on || !st.bg);
};
$('hold').addEventListener('pointerdown', e => { e.preventDefault(); hold(true); });
for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) $('hold').addEventListener(ev, () => hold(false));
$('hold').addEventListener('contextmenu', e => e.preventDefault());

// ---------- 手动修边 ----------
const ed = { mode: 'erase', undo: [], drawing: false, cutData: null, srcData: null, last: null };
const bc = $('brushCanvas');
$('editBtn').addEventListener('click', () => ($('edit').hidden ? enterEdit() : exitEdit(true)));
$('editDone').addEventListener('click', () => exitEdit(true));
document.querySelectorAll('#edit [data-mode]').forEach(b => b.addEventListener('click', () => {
  ed.mode = b.dataset.mode;
  document.querySelectorAll('#edit [data-mode]').forEach(x => x.classList.toggle('on', x === b));
}));
$('undo').addEventListener('click', () => {
  const a = ed.undo.pop(); if (!a) return;
  st.res.alpha.set(a); refreshCut(); drawEdit();
});

function enterEdit() {
  if (!st.res) return;
  const { src, cut } = st.res;
  bc.width = src.width; bc.height = src.height;
  ed.srcData = src.getContext('2d').getImageData(0, 0, src.width, src.height);
  ed.cutData = cut.getContext('2d').getImageData(0, 0, cut.width, cut.height);
  ed.undo = [];
  $('out').hidden = true; bc.hidden = false; $('edit').hidden = false; $('opts').hidden = true;
  $('editBtn').classList.add('on'); $('editBtn').textContent = '✎ 修边中';
  drawEdit();
}
function exitEdit(apply) {
  if ($('edit').hidden) return;
  $('out').hidden = false; bc.hidden = true; $('edit').hidden = true; $('opts').hidden = false;
  $('editBtn').classList.remove('on'); $('editBtn').textContent = '✎ 修边';
  if (apply && st.res) { st.res.box = core.bbox(st.res.alpha, st.res.src.width, st.res.src.height); render(true); }
}
function drawEdit() {
  const g = bc.getContext('2d');
  g.clearRect(0, 0, bc.width, bc.height);
  g.globalAlpha = 0.28; g.drawImage(st.res.src, 0, 0);
  g.globalAlpha = 1; g.drawImage(st.res.cut, 0, 0);
}
// 画完一笔再整体重算边缘去色（比较慢，不放在每次移动里）
function refreshCut() {
  st.res.cut = core.recut(st.res.src, st.res.alpha);
  ed.cutData = st.res.cut.getContext('2d').getImageData(0, 0, bc.width, bc.height);
}
function dab(x, y, r) {
  const W = bc.width, H = bc.height, A = st.res.alpha, cd = ed.cutData.data, sd = ed.srcData.data;
  const x0 = Math.max(0, Math.floor(x - r)), x1 = Math.min(W - 1, Math.ceil(x + r));
  const y0 = Math.max(0, Math.floor(y - r)), y1 = Math.min(H - 1, Math.ceil(y + r));
  if (x1 < x0 || y1 < y0) return;
  const feather = Math.max(1.5, r * 0.25);
  for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) {
    const d = Math.hypot(xx - x, yy - y), f = Math.min(1, Math.max(0, (r - d) / feather));
    if (f <= 0) continue;
    const i = yy * W + xx, j = i * 4;
    if (ed.mode === 'erase') A[i] = A[i] * (1 - f);
    else if (255 * f > A[i]) { A[i] = 255 * f; cd[j] = sd[j]; cd[j + 1] = sd[j + 1]; cd[j + 2] = sd[j + 2]; }
    cd[j + 3] = A[i];
  }
  st.res.cut.getContext('2d').putImageData(ed.cutData, 0, 0, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
}
function toCanvas(e) {
  const r = bc.getBoundingClientRect(), k = bc.width / r.width;
  return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k, r: +$('brushSize').value / 2 * k };
}
bc.addEventListener('pointerdown', e => {
  e.preventDefault(); bc.setPointerCapture(e.pointerId);
  ed.undo.push(st.res.alpha.slice()); if (ed.undo.length > 12) ed.undo.shift();
  ed.drawing = true; const p = toCanvas(e); ed.last = p; dab(p.x, p.y, p.r); drawEdit();
});
bc.addEventListener('pointermove', e => {
  if (!ed.drawing) return;
  const p = toCanvas(e), l = ed.last, n = Math.max(1, Math.ceil(Math.hypot(p.x - l.x, p.y - l.y) / (p.r * 0.4)));
  for (let i = 1; i <= n; i++) dab(l.x + (p.x - l.x) * i / n, l.y + (p.y - l.y) * i / n, p.r);
  ed.last = p; drawEdit();
});
for (const ev of ['pointerup', 'pointercancel']) bc.addEventListener(ev, () => {
  if (!ed.drawing) return;
  ed.drawing = false; refreshCut(); drawEdit();
});

// 代做入口：site/config.js 里配置了才显示；service.tools.cutout 可以单独设置这一页的价格和说明
const svc = window.SITE_CONFIG && window.SITE_CONFIG.service;
if (svc) {
  const s = Object.assign({}, svc, svc.tools && svc.tools.cutout);
  const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  $('service').innerHTML = `<h2>找我代做 <b>${esc(s.price)}</b></h2><p>${esc(s.text)}</p><p class="contact">${esc(s.contact)}</p>${s.qr ? `<img src="../${esc(s.qr)}" alt="联系方式二维码">` : ''}`;
  $('service').hidden = false;
}
