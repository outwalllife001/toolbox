import * as core from './core.js';
import SignaturePad from '../vendor/signature_pad/signature_pad.min.js';

const $ = id => document.getElementById(id);
const DPR = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
const KEY = 'sign.saved.v1';
const st = {
  bytes: null, name: '', doc: null, pages: [], spots: [], items: [], sel: null, pending: null,
  color: '#111827', wk: 1.15, out: null, urls: {}, busy: false, seq: 0,
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const fmtSize = n => n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))}KB` : `${(n / 1048576).toFixed(1)}MB`;
function setStatus(text, cls = '') { const s = $('status'); s.textContent = text; s.className = 'status ' + cls; }
function blobUrl(key, blob) { if (st.urls[key]) URL.revokeObjectURL(st.urls[key]); return st.urls[key] = URL.createObjectURL(blob); }

// ---------- 打开文件 ----------
$('file').addEventListener('change', async e => {
  const files = [...e.target.files]; e.target.value = '';
  if (!files.length) return;
  const pdf = files.find(f => /pdf/i.test(f.type) || /\.pdf$/i.test(f.name));
  setStatus(pdf ? '正在打开 PDF…' : '正在把照片排成 PDF…');
  try {
    const bytes = pdf ? new Uint8Array(await pdf.arrayBuffer()) : await core.imagesToPdf(files.filter(f => /^image\//.test(f.type)));
    await openDoc(bytes, (pdf || files[0]).name.replace(/\.\w+$/, ''), !pdf);
  } catch (err) {
    console.error(err);
    setStatus(/password|密码/i.test(err.name + err.message) ? '没输入正确的密码，打不开这个 PDF' : '这个文件打不开：' + err.message, 'err');
  }
});

async function openDoc(bytes, name, fromPhotos) {
  core.closeDoc(st.doc);
  const { doc, pages } = await core.openPdf(bytes, reason =>
    window.prompt(reason === 2 ? '密码不对，请再输一次：' : '这个 PDF 有打开密码，请输入：'));
  Object.assign(st, { bytes, name, doc, pages, fromPhotos, items: [], sel: null, pending: null, out: null, spots: [] });
  const dpr = pages.length > 12 ? Math.min(DPR, 2) : DPR;
  const box = $('doc'); box.innerHTML = '';
  for (const p of pages) {
    const el = document.createElement('div');
    el.className = 'pg'; el.style.aspectRatio = `${p.w} / ${p.h}`;
    el.innerHTML = `<canvas></canvas><div class="layer"></div>${pages.length > 1 ? `<span class="pno">${p.n} / ${pages.length}</span>` : ''}`;
    Object.assign(p, { el, cv: el.querySelector('canvas'), layer: el.querySelector('.layer'), shown: false });
    el.addEventListener('click', ev => onPageTap(p, ev));
    box.appendChild(el);
  }
  // 只渲染快滚到的页（几十页的合同也不卡）
  const io = new IntersectionObserver(es => es.forEach(en => {
    const p = pages.find(q => q.el === en.target);
    if (en.isIntersecting && !p.shown) { p.shown = true; io.unobserve(p.el); core.renderPage(p, p.cv, p.el.clientWidth, dpr).catch(console.error); }
  }), { rootMargin: '800px 0px' });
  pages.forEach(p => io.observe(p.el));
  $('dropEmpty').hidden = true; $('docInfo').hidden = false; $('dock').hidden = false;
  document.body.classList.add('has-doc');
  $('docMeta').textContent = `${name} · ${pages.length} 页${fromPhotos ? '（照片已排成 PDF）' : ''}`;
  setStatus('');
  window.scrollTo({ top: 0 });
  // 找签字处
  for (const p of pages) st.spots.push(...await core.findSpots(p).catch(() => []));
  labelDates();
  const ns = st.spots.filter(s => s.kind === 'sign').length, nd = st.spots.length - ns;
  $('found').hidden = false;
  $('found').innerHTML = ns || nd
    ? `🔍 找到 <b>${ns}</b> 处签字${nd ? `、<b>${nd}</b> 处日期` : ''}，点「写签名」开始`
    : '没找到「签字」字样（照片、扫描件找不到文字）：写好签名后，点页面上要签的地方就行';
}

// 「日期」前面加上它上方最近的签字人，比如「乙方 日期」，两栏的合同才分得清
function labelDates() {
  for (const d of st.spots.filter(s => s.kind === 'date')) {
    const up = st.spots.filter(s => s.kind === 'sign' && s.page === d.page && s.y < d.y && Math.abs(s.x0 - d.x0) < 0.15)
      .sort((a, b) => b.y - a.y)[0];
    if (up) d.label = up.label.replace(/[（(].*$/, '').slice(0, 6) + ' 日期';
  }
  // 同一行后面还有别的签字处：签名不能盖过去
  for (const s of st.spots) {
    const next = st.spots.filter(t => t.page === s.page && Math.abs(t.y - s.y) < 0.01 && t.x0 > s.x).sort((a, b) => a.x0 - b.x0)[0];
    s.room = (next ? next.x0 : 0.96) - s.x;
  }
}

// ---------- 放签名 / 日期 ----------
// 默认大小：签名高约 3.4 个字、日期 1.5 个字（按签字处那行的字号；不知道就按 10.5 磅），宽不超过页面的 30% 和旁边的空位
function sizeFor(kind, ar, p, spot) {
  const fs = spot ? spot.fs * p.h : 10.5;
  let h = kind === 'sign' ? fs * 3.4 : fs * 1.45, w = h * ar;
  const maxW = p.w * Math.min(kind === 'sign' ? 0.3 : 0.32, spot ? Math.max(0.12, spot.room - 0.01) : 1);
  if (w > maxW) { w = maxW; h = w / ar; }
  return { w: w / p.w, h: h / p.h };
}

function startPlacing(kind, src, ar) {
  st.pending = { kind, src, ar };
  select(null);
  const spots = st.spots.filter(s => s.kind === kind), open = spots.filter(s => !s.taken && !filled(s));
  // 只剩一个空位置：直接飞过去
  if (open.length === 1) { placeAtSpot(open[0]); return; }
  $('placeTip').textContent = spots.length ? `${kind === 'sign' ? '签' : '日期放'}在哪？点下面的位置，或者直接点页面` : `点一下页面上要${kind === 'sign' ? '签字' : '写日期'}的位置`;
  $('spots').innerHTML = spots.map((s, i) => `<button class="spot${s.taken || filled(s) ? ' done' : ''}" data-i="${i}">📍 ${esc(s.label)}${st.pages.length > 1 ? `<small>第 ${s.page} 页</small>` : ''}</button>`).join('');
  $('spots').hidden = !spots.length;
  $('spots').onclick = e => { const b = e.target.closest('.spot'); if (b) placeAtSpot(spots[+b.dataset.i]); };
  $('place').hidden = false; $('dock').hidden = true;
}
function endPlacing() { st.pending = null; $('place').hidden = true; $('dock').hidden = !st.pages.length; }
$('placeCancel').addEventListener('click', endPlacing);
const filled = s => st.items.some(it => it.page === s.page && Math.abs(it.x - s.x) < 0.05 && Math.abs(it.y + it.h / 2 - s.y) < 0.04);

async function placeAtSpot(s) {
  const { kind, src, ar } = st.pending, p = st.pages[s.page - 1];
  endPlacing();
  const { w, h } = sizeFor(kind, ar, p, s);
  // 签名底部稍微压过横线（手写签名一般这样）；日期整个写在横线上面，不让线穿过字
  const x = clamp(s.x + 0.008, 0, 1 - w), y = clamp(kind === 'sign' ? s.base - h * 0.8 : s.base - h - s.fs * 0.15, 0, 1 - h);
  const top = p.el.getBoundingClientRect().top + scrollY + (y + h / 2) * p.el.clientHeight - innerHeight * 0.42;
  window.scrollTo({ top, behavior: 'smooth' });
  await sleep(Math.abs(top - scrollY) > 20 ? 520 : 60);
  addItem({ page: p.n, x, y, w, h, src, ar, kind }, true);
}

function onPageTap(p, e) {
  if (e.target.closest('.it')) return;
  if (!st.pending) { select(null); return; }
  const r = p.el.getBoundingClientRect(), { kind, src, ar } = st.pending;
  const { w, h } = sizeFor(kind, ar, p, null);
  const fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
  endPlacing();
  addItem({ page: p.n, x: clamp(fx - w / 2, 0, 1 - w), y: clamp(fy - h / 2, 0, 1 - h), w, h, src, ar, kind }, false);
}

function addItem(o, fly) {
  const it = { id: ++st.seq, ...o };
  st.items.push(it);
  const el = it.el = document.createElement('div');
  el.className = 'it';
  el.innerHTML = `<img src="${it.src}" alt="" draggable="false"><b class="del" aria-label="删除">×</b><i class="rz"></i>`;
  st.pages[it.page - 1].layer.appendChild(el);
  pos(it); bindItem(it); select(it);
  if (fly) {
    // 从屏幕下方（签名板的位置）飞到签字处
    const r = el.getBoundingClientRect();
    const dx = innerWidth / 2 - (r.left + r.width / 2), dy = innerHeight * 0.8 - (r.top + r.height / 2);
    el.style.transition = 'none'; el.style.transform = `translate(${dx}px, ${dy}px) scale(1.8)`; el.style.opacity = '.4';
    void el.offsetWidth;
    el.style.transition = 'transform .7s cubic-bezier(.2,.8,.25,1), opacity .3s'; el.style.transform = ''; el.style.opacity = '';
  } else el.classList.add('pop');
  updateExport();
  return it;
}
function pos(it) {
  Object.assign(it.el.style, { left: it.x * 100 + '%', top: it.y * 100 + '%', width: it.w * 100 + '%', height: it.h * 100 + '%' });
}
function select(it) {
  st.sel = it;
  st.items.forEach(i => i.el.classList.toggle('sel', i === it));
}
function removeItem(it) {
  it.el.remove(); st.items = st.items.filter(i => i !== it); if (st.sel === it) st.sel = null; updateExport();
}
// 拖动：按住签名移动，拖右下角圆点改大小（保持比例），点 × 删除
function bindItem(it) {
  let drag = null;
  it.el.addEventListener('pointerdown', e => {
    e.stopPropagation(); e.preventDefault();
    if (e.target.classList.contains('del')) { removeItem(it); return; }
    select(it);
    const r = it.el.parentNode.getBoundingClientRect();
    drag = { mode: e.target.classList.contains('rz') ? 'rz' : 'mv', x: e.clientX, y: e.clientY, W: r.width, H: r.height, o: { x: it.x, y: it.y, w: it.w, h: it.h } };
    try { it.el.setPointerCapture(e.pointerId); } catch { /* 合成的事件没有活动指针 */ }
    it.el.classList.add('drag');
  });
  it.el.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = (e.clientX - drag.x) / drag.W, dy = (e.clientY - drag.y) / drag.H, o = drag.o;
    if (drag.mode === 'mv') { it.x = clamp(o.x + dx, 0, 1 - it.w); it.y = clamp(o.y + dy, 0, 1 - it.h); }
    else {
      const w = clamp(o.w + dx, 0.04, 1 - o.x);
      it.w = w; it.h = w * drag.W / it.ar / drag.H;
      if (o.y + it.h > 1) { it.h = 1 - o.y; it.w = it.h * drag.H * it.ar / drag.W; }
    }
    pos(it);
  });
  const end = () => { if (drag) { drag = null; it.el.classList.remove('drag'); } };
  it.el.addEventListener('pointerup', end); it.el.addEventListener('pointercancel', end);
}
document.addEventListener('pointerdown', e => { if (!e.target.closest('.it, .sheet, .dock, .place')) select(null); });

// ---------- 签名板 ----------
const padCv = $('padCanvas');
const pad = new SignaturePad(padCv, { penColor: st.color, minWidth: 1.0 * st.wk, maxWidth: 3.8 * st.wk, minDistance: 2, velocityFilterWeight: 0.6 });
pad.addEventListener('beginStroke', () => { $('padTip').hidden = true; });
function sizePad() {
  const r = Math.max(2, DPR), data = pad.toData();
  padCv.width = padCv.offsetWidth * r; padCv.height = padCv.offsetHeight * r;
  padCv.getContext('2d').scale(r, r);
  pad.clear(); pad.fromData(data);
}
function restyle() {
  pad.penColor = st.color; pad.minWidth = 1.0 * st.wk; pad.maxWidth = 3.8 * st.wk;
  const data = pad.toData();
  data.forEach(g => Object.assign(g, { penColor: st.color, minWidth: pad.minWidth, maxWidth: pad.maxWidth }));
  pad.clear(); pad.fromData(data);
}
function openSheet() {
  if (!st.pages.length) return;
  endPlacing(); select(null);
  $('sheet').hidden = false; document.body.classList.add('lock');
  sizePad(); $('padTip').hidden = !pad.isEmpty();
  renderSaved();
}
function closeSheet() { $('sheet').hidden = true; document.body.classList.remove('lock'); }
$('btnSign').addEventListener('click', openSheet);
$('sheetClose').addEventListener('click', closeSheet);
$('sheet').addEventListener('click', e => { if (e.target === $('sheet')) closeSheet(); });
$('colors').addEventListener('click', e => {
  const b = e.target.closest('.c'); if (!b) return;
  st.color = b.dataset.c; document.querySelectorAll('#colors .c').forEach(x => x.classList.toggle('on', x === b)); restyle();
});
$('widths').addEventListener('click', e => {
  const b = e.target.closest('.w'); if (!b) return;
  st.wk = +b.dataset.w; document.querySelectorAll('#widths .w').forEach(x => x.classList.toggle('on', x === b)); restyle();
});
$('undo').addEventListener('click', () => { const d = pad.toData(); d.pop(); pad.clear(); pad.fromData(d); $('padTip').hidden = !!d.length; });
$('clear').addEventListener('click', () => { pad.clear(); $('padTip').hidden = false; });

function padImage() {
  if (pad.isEmpty()) { $('padTip').hidden = false; $('pad').classList.remove('shake'); void $('pad').offsetWidth; $('pad').classList.add('shake'); return null; }
  return core.trim(padCv, 8);
}
$('useSig').addEventListener('click', () => {
  const c = padImage(); if (!c) return;
  const src = c.toDataURL('image/png');
  saveSig(src); closeSheet();
  startPlacing('sign', src, c.width / c.height);
});
$('savePng').addEventListener('click', async () => {
  const c = padImage(); if (!c) return;
  download(blobUrl('png', await core.toBlob(c)), '我的签名_透明背景.png');
});
$('inkFile').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const c = core.extractInk(await createImageBitmap(f), st.color);
    if (!c || c.width < 12 || c.height < 8) { alert('没认出签名：在白纸上用黑笔写大一点，光线均匀再拍'); return; }
    const src = c.toDataURL('image/png');
    saveSig(src); closeSheet(); startPlacing('sign', src, c.width / c.height);
  } catch (err) { alert('这张照片打不开：' + err.message); }
});

// 常用签名：存在本机 localStorage，最多 5 个
const loadSaved = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } };
function saveSig(src) {
  const a = [src, ...loadSaved().filter(s => s !== src)].slice(0, 5);
  try { localStorage.setItem(KEY, JSON.stringify(a)); } catch { /* 隐私模式存不了，不影响使用 */ }
}
function renderSaved() {
  const a = loadSaved();
  $('savedWrap').hidden = !a.length;
  $('saved').innerHTML = a.map((s, i) => `<div class="sv" data-i="${i}"><img src="${s}" alt="常用签名"><b class="del" data-i="${i}">×</b></div>`).join('');
}
$('saved').addEventListener('click', async e => {
  const a = loadSaved(), del = e.target.closest('.del'), sv = e.target.closest('.sv');
  if (del) { a.splice(+del.dataset.i, 1); localStorage.setItem(KEY, JSON.stringify(a)); renderSaved(); return; }
  if (!sv) return;
  const src = a[+sv.dataset.i], im = new Image(); im.src = src; await im.decode();
  closeSheet(); startPlacing('sign', src, im.naturalWidth / im.naturalHeight);
});

// ---------- 日期 ----------
$('btnDate').addEventListener('click', () => {
  const d = new Date(), c = core.dateImage(`${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`, st.color);
  startPlacing('date', c.toDataURL('image/png'), c.width / c.height);
});

// ---------- 导出 ----------
function updateExport() { $('btnExport').classList.toggle('ready', st.items.length > 0); }
$('btnExport').addEventListener('click', async () => {
  if (st.busy) return;
  if (!st.items.length) { setStatus('先点「写签名」，把签名放到页面上', 'err'); $('status').scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
  st.busy = true; select(null);
  $('btnExport').textContent = '正在生成…';
  try {
    const t0 = performance.now();
    const r = await core.exportPdf(st.bytes, st.pages, st.items);
    const ms = performance.now() - t0;
    const blob = new Blob([r.bytes], { type: 'application/pdf' });
    st.out = r;
    const a = $('dlPdf'); a.href = blobUrl('pdf', blob); a.download = `${st.name}_已签字.pdf`;
    const signed = [...new Set(st.items.map(i => i.page))].sort((a, b) => a - b);
    $('outTitle').textContent = '✓ 签好了';
    $('outMeta').textContent = `${st.name}_已签字.pdf · ${st.pages.length} 页 · ${fmtSize(blob.size)}` +
      (r.mode === 'raster' ? (r.why === 'encrypted' ? ' · 原文件有加密保护，已按图片重新合成' : ' · 原文件格式特殊，已按图片重新合成') : st.fromPhotos ? '' : ' · 原文字不变');
    $('dlImg').textContent = signed.length > 1 ? `存成图片（签字的 ${signed.length} 页）` : '存成图片（签字的那页）';
    $('outSheet').hidden = false; document.body.classList.add('lock');
    window.__sign.exportMs = ms;
    // 预览：打开刚导出的 PDF（不是页面截图），看到的就是对方收到的
    const pv = $('outPrev'), n = signed[signed.length - 1];
    await core.previewPage(r.bytes, n, pv, pv.parentNode.clientWidth, DPR);
    // 预览框只有半屏高：滚到签名那一块
    const its = st.items.filter(i => i.page === n), mid = its.reduce((a, i) => a + i.y + i.h / 2, 0) / its.length;
    pv.parentNode.scrollTop = Math.max(0, mid * pv.clientHeight - pv.parentNode.clientHeight / 2);
  } catch (err) { console.error(err); setStatus('生成失败：' + err.message, 'err'); }
  finally { st.busy = false; $('btnExport').textContent = '导出签好的 PDF'; }
});
$('outClose').addEventListener('click', () => { $('outSheet').hidden = true; document.body.classList.remove('lock'); });
$('dlImg').addEventListener('click', async () => {
  const signed = [...new Set(st.items.map(i => i.page))].sort((a, b) => a - b);
  for (const n of signed) {
    const blob = await core.pageImage(st.pages[n - 1], st.items, 2);
    download(blobUrl('img' + n, blob), `${st.name}_第${n}页_已签字.jpg`);
    await sleep(400);
  }
});
function download(url, name) { const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); }
const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// 代做入口：site/config.js 里配置了才显示；service.tools.sign 可以单独设置这一页的价格和说明
const svc = window.SITE_CONFIG && window.SITE_CONFIG.service;
if (svc) {
  const s = Object.assign({}, svc, svc.tools && svc.tools.sign);
  $('service').innerHTML = `<h2>找我代做 <b>${esc(s.price)}</b></h2><p>${esc(s.text)}</p><p class="contact">${esc(s.contact)}</p>${s.qr ? `<img src="../${esc(s.qr)}" alt="联系方式二维码">` : ''}`;
  $('service').hidden = false;
}

// 给测试脚本 / 录视频用
window.__sign = { st, pad, openSheet, startPlacing, exportMs: 0 };
