import * as core from './core.js';

const $ = id => document.getElementById(id);
// queue：还没确认边框的照片；cur：正在确认的那张；pages：已扫描的页
const st = { queue: [], cur: null, pages: [], sel: -1, mode: 'scan', pdfKB: 0, urls: {} };
let ready = null;

function setStatus(el, text, cls = '') { el.textContent = text; el.className = 'status ' + cls; }

ready = core.load(p => setStatus($('status0'), `正在加载扫描引擎 ${Math.round(p * 100)}%（首次约 3MB，只需加载一次）`, 'busy'))
  .then(() => setStatus($('status0'), ''))
  .catch(e => { setStatus($('status0'), '扫描引擎加载失败：' + e.message + '，请刷新重试'); throw e; });

$('file').addEventListener('change', e => {
  st.queue.push(...e.target.files);
  e.target.value = '';
  if (!st.cur) loadNext();
});

async function loadNext() {
  const f = st.queue.shift();
  if (!f) { st.cur = null; $('editor').hidden = true; return; }
  $('step-upload').hidden = true;
  $('editor').hidden = false;
  $('go').disabled = true;
  $('edTitle').textContent = `第 ${st.pages.length + 1} 页 · 确认纸张边框`;
  setStatus($('status'), '正在找纸张边框…', 'busy');
  const url = URL.createObjectURL(f), im = new Image();
  im.src = url;
  try { await im.decode(); } catch { URL.revokeObjectURL(url); setStatus($('status'), '这张图片打不开，换一张试试'); st.cur = null; return loadNext(); }
  await ready;
  const canvas = core.toCanvas(im);
  URL.revokeObjectURL(url);
  const d = core.detect(canvas);
  st.cur = { canvas, corners: d.corners };
  drawEditor(true);
  $('edHint').textContent = d.found ? '已自动找到纸张四角，不准的话拖动圆点' : '没认出纸张边框，请拖动四个圆点对准纸的四个角';
  setStatus($('status'), '');
  $('go').disabled = false;
  if (st.pages.length) requestAnimationFrame(() => $('editor').scrollIntoView({ behavior: 'smooth', block: 'start' }));
}

// ---- 确认边框：画照片，叠一个可拖动的四边形 ----
function drawEditor(animate) {
  const { canvas } = st.cur, c = $('cropCanvas');
  const k = Math.min(1, 900 / Math.max(canvas.width, canvas.height));   // 预览用的小图
  c.width = Math.round(canvas.width * k); c.height = Math.round(canvas.height * k);
  c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height);
  st.cur.k = k;
  const svg = $('cropSvg');
  svg.setAttribute('viewBox', `0 0 ${c.width} ${c.height}`);
  svg.querySelectorAll('.handle').forEach(h => h.remove());
  for (let i = 0; i < 4; i++) {
    const h = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    h.setAttribute('class', 'handle'); h.dataset.i = i;
    svg.appendChild(h);
  }
  requestAnimationFrame(() => {
    placeSvg(); drawQuad();
    if (animate) { const q = $('quad'); q.classList.remove('draw'); void q.getBoundingClientRect(); q.classList.add('draw'); }
  });
}

function placeSvg() {
  const c = $('cropCanvas'), svg = $('cropSvg');
  Object.assign(svg.style, { left: c.offsetLeft + 'px', top: c.offsetTop + 'px', width: c.offsetWidth + 'px', height: c.offsetHeight + 'px' });
}

function drawQuad() {
  const { corners, k } = st.cur, c = $('cropCanvas');
  const r = 11 * c.width / (c.offsetWidth || c.width);   // 圆点在屏幕上约 22 像素
  $('quad').setAttribute('points', corners.map(p => `${p.x * k},${p.y * k}`).join(' '));
  $('cropSvg').querySelectorAll('.handle').forEach(h => {
    const p = corners[+h.dataset.i];
    h.setAttribute('cx', p.x * k); h.setAttribute('cy', p.y * k); h.setAttribute('r', r);
  });
}

let drag = null;
$('cropSvg').addEventListener('pointerdown', e => {
  if (!e.target.classList.contains('handle')) return;
  drag = +e.target.dataset.i;
  e.target.setPointerCapture(e.pointerId);
  e.preventDefault();
});
$('cropSvg').addEventListener('pointermove', e => {
  if (drag === null) return;
  const c = $('cropCanvas'), b = c.getBoundingClientRect(), { canvas, k } = st.cur;
  const x = (e.clientX - b.left) / b.width * c.width / k, y = (e.clientY - b.top) / b.height * c.height / k;
  st.cur.corners[drag] = { x: Math.max(0, Math.min(canvas.width, x)), y: Math.max(0, Math.min(canvas.height, y)) };
  drawQuad();
});
['pointerup', 'pointercancel'].forEach(t => $('cropSvg').addEventListener(t, () => { drag = null; }));
addEventListener('resize', () => { if (st.cur) { placeSvg(); drawQuad(); } });

// ---- 生成 ----
const toBlob = (c, q = 0.92) => new Promise(r => c.toBlob(r, 'image/jpeg', q));
function blobUrl(name, blob) {
  if (st.urls[name]) URL.revokeObjectURL(st.urls[name]);
  return (st.urls[name] = URL.createObjectURL(blob));
}

$('go').addEventListener('click', async () => {
  if (!st.cur) return;
  $('go').disabled = true;
  setStatus($('status'), '拉正、去阴影…', 'busy');
  await new Promise(r => setTimeout(r, 30));   // 让转圈先画出来
  const t0 = performance.now();
  const warped = core.warp(st.cur.canvas, st.cur.corners);
  const page = { warped, mode: st.mode, rot: 0 };
  renderPage(page);
  const sec = ((performance.now() - t0) / 1000).toFixed(1);
  st.pages.push(page);
  st.cur.canvas.width = 0;   // 及时释放手机内存
  st.cur = null;
  setStatus($('status'), '');
  await select(st.pages.length - 1);   // 先换好预览图再显示，免得闪一下上一页
  $('result').hidden = false;
  $('pdfOut').hidden = true;
  $('result').dataset.sec = sec;
  if (st.queue.length) loadNext();
  else {
    $('editor').hidden = true;
    requestAnimationFrame(() => $('result').scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }
});

function renderPage(p) {
  const out = core.enhance(p.warped, p.mode);
  if (p.canvas) p.canvas.width = 0;
  p.canvas = p.rot ? core.rotate(out, p.rot) : out;
  if (p.rot) out.width = 0;
  const t = document.createElement('canvas');
  t.width = 116; t.height = Math.round(116 * p.canvas.height / p.canvas.width);
  t.getContext('2d').drawImage(p.canvas, 0, 0, t.width, t.height);
  p.thumb = t.toDataURL('image/jpeg', 0.8);
}

async function select(i) {
  st.sel = i;
  const p = st.pages[i];
  document.querySelectorAll('#modes .chip[data-m]').forEach(b => b.classList.toggle('on', b.dataset.m === p.mode));
  // 预览用缩小图（屏幕上最高 330 像素，三倍屏也只要 1000 像素），保存用原图
  const k = Math.min(1, 1000 / p.canvas.height), pv = document.createElement('canvas');
  pv.width = Math.round(p.canvas.width * k); pv.height = Math.round(p.canvas.height * k);
  pv.getContext('2d').drawImage(p.canvas, 0, 0, pv.width, pv.height);
  $('out').src = blobUrl('preview', await toBlob(pv, 0.9));
  pv.width = 0;
  $('dlPage').href = blobUrl('page', await toBlob(p.canvas));
  $('dlPage').download = `扫描件_第${i + 1}页.jpg`;
  renderThumbs();
}

function renderThumbs() {
  $('pagesTitle').textContent = `已扫描 ${st.pages.length} 页`;
  $('mkPdf').textContent = `导出 PDF（${st.pages.length} 页）`;
  $('thumbs').innerHTML = st.pages.map((p, i) =>
    `<button class="thumb${i === st.sel ? ' on' : ''}" data-i="${i}"><img src="${p.thumb}" alt=""><b>${i + 1}</b><i data-del="${i}">×</i></button>`).join('') +
    '<label class="thumb add" id="addPage" for="file"><span>＋</span>加一页</label>';
}

$('thumbs').addEventListener('click', e => {
  const del = e.target.closest('[data-del]');
  if (del) {
    const i = +del.dataset.del, [p] = st.pages.splice(i, 1);
    p.canvas.width = 0; p.warped.width = 0;
    $('pdfOut').hidden = true;
    if (!st.pages.length) { $('result').hidden = true; $('step-upload').hidden = false; return; }
    return select(Math.min(st.sel, st.pages.length - 1));
  }
  const b = e.target.closest('.thumb');
  if (b) select(+b.dataset.i);
});

$('modes').addEventListener('click', e => {
  const b = e.target.closest('.chip'); if (!b || st.sel < 0) return;
  const p = st.pages[st.sel];
  if (b.id === 'rotate') p.rot = (p.rot + 90) % 360;
  else { if (p.mode === b.dataset.m) return; p.mode = st.mode = b.dataset.m; }
  renderPage(p);
  select(st.sel);
  $('out').classList.remove('flash'); void $('out').offsetWidth; $('out').classList.add('flash');
  $('pdfOut').hidden = true;
});

$('pdfSizes').addEventListener('click', e => {
  const b = e.target.closest('.chip'); if (!b) return;
  document.querySelectorAll('#pdfSizes .chip').forEach(x => x.classList.toggle('on', x === b));
  st.pdfKB = +b.dataset.kb;
  $('pdfOut').hidden = true;
});

const fmtSize = n => n >= 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB';
$('mkPdf').addEventListener('click', async () => {
  if (!st.pages.length) return;
  $('mkPdf').disabled = true;
  $('pdfOut').hidden = false; $('pdfOut').textContent = '正在生成 PDF…';
  try {
    const pdf = await core.makePdf(st.pages.map(p => p.canvas), st.pdfKB);
    const url = blobUrl('pdf', pdf), name = `扫描件_${st.pages.length}页.pdf`;
    const over = st.pdfKB && pdf.size > st.pdfKB * 1024;
    $('pdfOut').innerHTML = `已生成 PDF：${st.pages.length} 页 · ${fmtSize(pdf.size)}${over ? '（页数太多，压不到要求以内）' : ' ✓'}<a href="${url}" download="${name}">保存</a>`;
  } catch (e) {
    $('pdfOut').textContent = '生成失败：' + e.message;
  } finally { $('mkPdf').disabled = false; }
});

// 代做入口：site/config.js 里配置了才显示；service.tools.scan 可以单独设置这一页的价格和说明
const svc = window.SITE_CONFIG && window.SITE_CONFIG.service;
if (svc) {
  const s = Object.assign({}, svc, svc.tools && svc.tools.scan);
  const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  $('service').innerHTML = `<h2>找我代做 <b>${esc(s.price)}</b></h2><p>${esc(s.text)}</p><p class="contact">${esc(s.contact)}</p>${s.qr ? `<img src="../${esc(s.qr)}" alt="联系方式二维码">` : ''}`;
  $('service').hidden = false;
}
