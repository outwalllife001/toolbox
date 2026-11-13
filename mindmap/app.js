// 笔记一键变思维导图：提纲文字 → core.js 拆层级 → simple-mind-map 画图 → 导出图片 / PDF / XMind
import MindMap from '../vendor/simple-mind-map/simple-mind-map.min.mjs';
import { parseOutline, toOutline, plain, countNodes, PALETTES, LAYOUTS, themeConfigOf } from './core.js';
import { SAMPLES } from './samples.js';

const $ = id => document.getElementById(id);
const esc = t => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const Q = new URLSearchParams(location.search);
const KEY = 'toolbox-mindmap-docs';
const FREE_DOCS = 3;
const st = { mm: null, pal: 'rainbow', layout: 'logicalStructure', docId: null, saveOff: false, editNode: null, timing: {} };
window.__mm = st;   // 测试 / 录视频用

PALETTES.forEach(p => MindMap.defineTheme('tb_' + p.id, themeConfigOf(p)));
const pal = () => PALETTES.find(p => p.id === st.pal) || PALETTES[0];
$('ver').textContent = `用的是 ${MindMap.version} 版`;

// ---------- 示例 ----------
$('samples').insertAdjacentHTML('beforeend', SAMPLES.map((s, i) => `<button data-i="${i}">${esc(s.name)}</button>`).join(''));
$('samples').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  $('src').value = SAMPLES[+b.dataset.i].text;
  document.querySelectorAll('#samples button').forEach(x => x.classList.toggle('on', x === b));
});

// ---------- 结构、配色按钮 ----------
$('layouts').innerHTML = LAYOUTS.map(l => `<button data-l="${l.id}">${l.name}</button>`).join('');
$('pals').innerHTML = PALETTES.map(p => `<button class="pal" data-p="${p.id}"><i>${[p.root[0], ...p.branches.slice(0, 3)].map(c => `<b style="background:${c}"></b>`).join('')}</i>${p.name}</button>`).join('');
function markButtons() {
  document.querySelectorAll('#layouts button').forEach(b => b.classList.toggle('on', b.dataset.l === st.layout));
  document.querySelectorAll('#pals .pal').forEach(b => b.classList.toggle('on', b.dataset.p === st.pal));
}
$('layouts').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b || !st.mm || b.dataset.l === st.layout) return;
  st.layout = b.dataset.l; markButtons();
  fitAfterRender();
  st.mm.setLayout(st.layout);
  save();
});
$('pals').addEventListener('click', e => {
  const b = e.target.closest('.pal'); if (!b || !st.mm || b.dataset.p === st.pal) return;
  st.pal = b.dataset.p; markButtons();
  applyPalette();
  save();
});

// 二级主题按分支轮流上色（写进节点数据），连线用彩虹线插件按分支同色
function paintBranches() {
  const p = pal(), tree = st.mm && st.mm.renderer.renderTree;
  if (!tree) return false;
  let changed = false;
  (tree.children || []).forEach((c, i) => {
    const col = p.branches[i % p.branches.length];
    if (c.data.fillColor !== col || c.data.color !== p.second) { c.data.fillColor = col; c.data.color = p.second; changed = true; }
  });
  return changed;
}
function applyPalette() {
  const p = pal();
  $('wrap').style.background = p.bg;
  paintBranches();
  st.mm.opt.rainbowLinesConfig = { open: true, colorsList: p.branches };
  st.mm.setTheme('tb_' + p.id);   // 带 CHANGE_THEME 重画，已有节点的字色、字号才会跟着换
}

// ---------- 画布 ----------
let renderWaiters = [];
function fitAfterRender() {
  return new Promise(r => renderWaiters.push(r));
}
function fitNow() {
  if (!st.mm) return;
  st.mm.getElRectInfo();
  st.mm.view.fit(undefined, false, 18);
}

function makeMap(root) {
  const p = pal();
  $('wrap').style.background = p.bg;
  st.mm = new MindMap({
    el: $('map'), data: root, layout: st.layout, theme: 'tb_' + p.id,
    textAutoWrapWidth: 220,
    rainbowLinesConfig: { open: true, colorsList: p.branches },
    exportPaddingX: 36, exportPaddingY: 36,
    fitPadding: 18,
    initRootNodePosition: ['center', 'center'],
    defaultInsertSecondLevelNodeText: '新主题',
    defaultInsertBelowSecondLevelNodeText: '新内容',
    isShowCreateChildBtnIcon: false,
    enableShortcutOnlyWhenMouseInSvg: true,
    mousewheelAction: 'zoom',
    minTouchZoomScale: 10, maxTouchZoomScale: 400,
    maxHistoryCount: 200,
    addHistoryOnInit: true,
  });
  const mm = st.mm;
  mm.on('node_tree_render_end', () => {
    st.timing.renderEnd = performance.now();
    if (paintBranches()) { mm.render(); return; }
    const w = renderWaiters; renderWaiters = [];
    if (w.length) { fitNow(); w.forEach(r => r()); }
    window.dispatchEvent(new Event('mm-rendered'));
  });
  mm.on('node_active', (node, list) => showNodebar(list));
  mm.on('data_change', () => { updateCount(); save(); });
  mm.on('back_forward', (index, len) => { $('undo').disabled = index <= 0; $('redo').disabled = index >= len - 1; });
  bindTouch();
}

function setMap(root, { layout, pal: p } = {}) {
  if (layout) st.layout = layout;
  if (p && PALETTES.some(x => x.id === p)) st.pal = p;
  $('mapCard').hidden = false;
  markButtons();
  const done = fitAfterRender();
  if (!st.mm) makeMap(root);
  else {
    if (st.mm.getLayout() !== st.layout) st.mm.setLayout(st.layout, true);
    st.mm.setTheme('tb_' + st.pal, true);
    st.mm.opt.rainbowLinesConfig = { open: true, colorsList: pal().branches };
    $('wrap').style.background = pal().bg;
    st.mm.setData(root);
  }
  showNodebar([]);
  updateCount();
  return done;
}

function updateCount() {
  if (!st.mm) return;
  const root = st.mm.getData(false);
  $('cnt').textContent = `${countNodes(root)} 个主题`;
  $('mapTitle').textContent = plain(root.data.text) || '思维导图';
  $('mapTitle').title = $('mapTitle').textContent;
}

// ---------- 选中节点：加、删、改 ----------
function showNodebar(list) {
  const n = list && list[0];
  $('nodebar').hidden = !n;
  $('maphint').hidden = !!n;
  if (n) { $('addSib').disabled = n.isRoot; $('del').disabled = n.isRoot; }
}
const active = () => st.mm && st.mm.renderer.activeNodeList[0];
$('addChild').addEventListener('click', () => { const n = active(); if (!n) return; st.mm.execCommand('INSERT_CHILD_NODE', false, [], { text: n.isRoot ? '新主题' : '新内容' }); editNewSoon(); });
$('addSib').addEventListener('click', () => { const n = active(); if (!n || n.isRoot) return; st.mm.execCommand('INSERT_NODE', false, [], { text: n.layerIndex === 1 ? '新主题' : '新内容' }); editNewSoon(); });
$('del').addEventListener('click', () => { const n = active(); if (!n || n.isRoot) return; st.mm.execCommand('REMOVE_NODE'); showNodebar([]); });
$('edit').addEventListener('click', () => { const n = active(); if (n) openEdit(n); });
// 新加的主题会被选中：渲染完打开改字框
function editNewSoon() {
  const h = () => {
    window.removeEventListener('mm-rendered', h);
    const n = active(); if (!n) return;
    // 新主题跑到画布外面了，就挪到中间
    const a = n.group.node.getBoundingClientRect(), b = st.mm.el.getBoundingClientRect();
    if (a.left < b.left || a.right > b.right || a.top < b.top || a.bottom > b.bottom - 60) { st.mm.getElRectInfo(); st.mm.renderer.moveNodeToCenter(n, false); }
    openEdit(n, true);
  };
  window.addEventListener('mm-rendered', h);
}
function openEdit(node, isNew = false) {
  st.editNode = node;
  $('editText').value = plain(node.getData('text'));
  $('editSheet').hidden = false;
  const t = $('editText'); t.focus(); if (isNew) t.select();
}
function closeEdit() { $('editSheet').hidden = true; st.editNode = null; }
$('editCancel').addEventListener('click', closeEdit);
$('editSheet').addEventListener('click', e => { if (e.target === $('editSheet')) closeEdit(); });
$('editOk').addEventListener('click', () => {
  const n = st.editNode, t = $('editText').value.replace(/\s*\n\s*/g, ' ').trim();
  if (n && t) st.mm.execCommand('SET_NODE_TEXT', n, t);
  closeEdit();
});
$('editText').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('editOk').click(); } });

$('undo').addEventListener('click', () => st.mm && st.mm.execCommand('BACK'));
$('redo').addEventListener('click', () => st.mm && st.mm.execCommand('FORWARD'));
$('fit').addEventListener('click', fitNow);
$('full').addEventListener('click', () => {
  const on = !$('wrap').classList.contains('full');
  $('wrap').classList.toggle('full', on); document.body.classList.toggle('lock', on);
  $('full').textContent = on ? '✕ 退出' : '⛶ 全屏';
  requestAnimationFrame(() => { st.mm.resize(); fitNow(); });
});

// 手机手势：单指拖动、两指缩放（只在画布上，不影响页面滚动）
function bindTouch() {
  const el = $('map');
  let last = null, pinch = null, moved = false;
  const dist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  el.addEventListener('touchstart', e => {
    st.mm.getElRectInfo();
    moved = false;
    if (e.touches.length === 1) { last = { x: e.touches[0].clientX, y: e.touches[0].clientY }; pinch = null; }
    else if (e.touches.length === 2) {
      const [a, b] = e.touches;
      pinch = { d: dist(a, b), s: st.mm.view.scale }; last = null;
    }
  }, { passive: true });
  el.addEventListener('touchmove', e => {
    e.preventDefault();
    if (e.touches.length === 1 && last) {
      const t = e.touches[0], dx = t.clientX - last.x, dy = t.clientY - last.y;
      if (!moved && Math.hypot(dx, dy) < 4) return;
      moved = true;
      st.mm.view.translateXY(dx, dy); last = { x: t.clientX, y: t.clientY };
    } else if (e.touches.length === 2 && pinch) {
      moved = true;
      const [a, b] = e.touches;
      const s = Math.min(4, Math.max(0.15, pinch.s * dist(a, b) / pinch.d));
      const c = st.mm.toPos((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
      st.mm.view.setScale(s, c.x, c.y);
    }
  }, { passive: false });
  el.addEventListener('touchend', e => {
    if (e.touches.length === 0) { last = null; pinch = null; }
    if (moved) e.preventDefault();   // 拖动后不再当成点击
  }, { passive: false });
}

// ---------- 生成 ----------
$('go').addEventListener('click', async () => {
  const text = $('src').value;
  if (!text.trim()) { $('src').focus(); status('先把笔记或提纲粘贴进来', true); return; }
  const t0 = performance.now();
  const r = parseOutline(text);
  // 改了提纲再生成（大标题没变）就更新这张；换了一份笔记（大标题变了）、或者这张是打开的文件，就另存一张新的，旧的留在「我的导图」里
  const firstLine = t => (String(t).split('\n').find(l => l.trim()) || '').trim();
  const isNew = !st.docId || !st.src || firstLine(st.src) !== firstLine(text);
  if (isNew && !(await canNewDoc())) return;   // 关掉会员窗：当前这张保持不变
  if (isNew) st.docId = null;
  st.timing = { parse: performance.now() - t0, start: t0 };
  if (!st.docId) st.docId = 'd' + Date.now().toString(36);
  st.src = text;
  await setMap(r.root);
  st.timing.total = performance.now() - t0;
  status(`拆出 ${r.count} 个主题${r.rootGuessed ? '，中间的「中心主题」点一下可以改名' : ''}`);
  save(true);
  window.dispatchEvent(new CustomEvent('mm-generated', { detail: { count: r.count, ms: st.timing.total } }));
  if (!Q.has('noscroll')) $('mapCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

function status(t, bad = false) { $('status').textContent = t; $('status').classList.toggle('bad', bad); }

// ---------- 打开文件 ----------
$('open').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', async () => {
  const f = $('file').files[0]; $('file').value = '';
  if (!f) return;
  try {
    const name = f.name.toLowerCase();
    if (name.endsWith('.xmind')) {
      const data = await MindMap.xmind.parseXmindFile(f);
      await openNew(data && data.root ? data.root : data, f.name);
    } else if (name.endsWith('.smm') || name.endsWith('.json')) {
      const j = JSON.parse(await f.text());
      const root = j.root || j;
      if (!root || !root.data) throw new Error('不是思维导图文件');
      await openNew(root, f.name, j.layout);
    } else {
      if (!(await canNewDoc())) return;
      st.docId = null; st.src = '';
      $('src').value = await f.text();
      $('go').click();
    }
  } catch (e) {
    console.error(e);
    status('这个文件打不开：' + (e.message || e), true);
  }
});
async function openNew(root, fname, layout) {
  if (!(await canNewDoc())) return;
  st.docId = 'd' + Date.now().toString(36);
  st.src = '';
  await setMap(root, { layout: LAYOUTS.some(l => l.id === layout) ? layout : undefined });
  status(`打开了 ${fname}`);
  save(true);
  $('mapCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------- 我的导图（存在本机） ----------
const loadDocs = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } };
let saveTimer = 0;
function save(now = false) {
  if (!st.mm || !st.docId || st.saveOff) return;
  clearTimeout(saveTimer);
  const go = () => {
    const docs = loadDocs().filter(d => d.id !== st.docId);
    const root = st.mm.getData(false);
    docs.unshift({ id: st.docId, title: plain(root.data.text) || '思维导图', t: Date.now(), layout: st.layout, pal: st.pal, src: st.src || '', root });
    try { localStorage.setItem(KEY, JSON.stringify(docs)); } catch { status('手机存储满了，这张没存上，记得导出', true); }
    renderDocs();
  };
  if (now) go(); else saveTimer = setTimeout(go, 500);
}
function renderDocs() {
  const docs = loadDocs();
  $('docsCard').hidden = !docs.length;
  $('docs').innerHTML = docs.map(d => `<div class="doc${d.id === st.docId ? ' on' : ''}"><button class="open" data-id="${d.id}"><b>${esc(d.title)}</b><small>${new Date(d.t).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · ${countNodes(d.root)} 个主题</small></button><button class="x" data-del="${d.id}">删除</button></div>`).join('');
}
$('docs').addEventListener('click', async e => {
  const o = e.target.closest('[data-id]'), x = e.target.closest('[data-del]');
  if (o) {
    const d = loadDocs().find(d => d.id === o.dataset.id); if (!d) return;
    st.docId = d.id; st.src = d.src || '';
    $('src').value = d.src || '';
    await setMap(d.root, { layout: d.layout, pal: d.pal });
    renderDocs();
    $('mapCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else if (x) {
    const d = loadDocs().find(d => d.id === x.dataset.del);
    if (!d || !confirm(`删除「${d.title}」？删了找不回来`)) return;
    localStorage.setItem(KEY, JSON.stringify(loadDocs().filter(v => v.id !== d.id)));
    if (st.docId === d.id) { st.docId = null; $('mapCard').hidden = true; }
    renderDocs();
  }
});
$('newDoc').addEventListener('click', async () => {
  if (!(await canNewDoc())) return;
  st.docId = null; st.src = '';
  $('src').value = ''; $('mapCard').hidden = true;
  document.querySelectorAll('#samples button').forEach(x => x.classList.remove('on'));
  renderDocs();
  $('inCard').scrollIntoView({ behavior: 'smooth', block: 'start' }); $('src').focus();
});
// 免费版在本机存 3 张；开了会员不限
async function canNewDoc() {
  if (loadDocs().length < FREE_DOCS || !window.Member || !Member.enabled || (await Member.active())) return true;
  const r = await Member.gate({ title: '保存更多导图', text: `免费版能在这台手机上存 ${FREE_DOCS} 张导图（画图、导出都不限次数）；开通工具箱会员不限张数。`, free: '删掉一张旧的' });
  if (r === 'member') return true;
  if (r === 'free') { $('docsCard').scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  return false;
}

// ---------- 导出 ----------
const fname = () => (plain(st.mm.getData(false).data.text) || '思维导图').replace(/[\\/:*?"<>|《》]/g, '').slice(0, 40) || '思维导图';
// 手机浏览器的 canvas 太大会画不出来：按面积限制在 1600 万像素以内
function limitCanvas() {
  const b = st.mm.draw.bbox();
  const w = b.width + 72, h = b.height + 72;
  const dpr = Math.max(window.devicePixelRatio || 1, 2);
  const s = Math.min(dpr, Math.sqrt(16e6 / (w * h)));
  st.mm.opt.maxCanvasSize = Math.max(1024, Math.floor(Math.max(w, h) * s));
  return { w, h };
}
async function pngUrl() {
  st.mm.execCommand('CLEAR_ACTIVE_NODE');
  st.mm.getElRectInfo();
  limitCanvas();
  return st.mm.doExport.png(fname(), false);
}
function download(url, name) {
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
}
async function busy(btn, fn) {
  const t = btn.textContent; btn.disabled = true; btn.textContent = '正在导出…';
  try { await fn(); } catch (e) { console.error(e); status('导出失败：' + (e.message || e), true); } finally { btn.disabled = false; btn.textContent = t; }
}
$('exPng').addEventListener('click', () => busy($('exPng'), async () => {
  const t0 = performance.now();
  const url = await pngUrl();
  const img = $('vImg');
  await new Promise((ok, bad) => { img.onload = ok; img.onerror = bad; img.src = url; });
  st.timing.png = performance.now() - t0;
  const blobUrl = URL.createObjectURL(await (await fetch(url)).blob());
  $('vDown').href = blobUrl; $('vDown').download = fname() + '.png';
  $('vInfo').textContent = `${img.naturalWidth} × ${img.naturalHeight} 像素`;
  $('viewer').hidden = false; document.body.classList.add('lock');
  status('图片做好了');
  window.dispatchEvent(new CustomEvent('mm-exported', { detail: { w: img.naturalWidth, h: img.naturalHeight, ms: st.timing.png } }));
}));
$('vClose').addEventListener('click', () => { $('viewer').hidden = true; document.body.classList.remove('lock'); });

let pdfLib = null;
function loadPdfLib() {
  return pdfLib ||= new Promise((ok, bad) => {
    const s = document.createElement('script'); s.src = '../vendor/pdf-lib/pdf-lib.min.js';
    s.onload = () => ok(window.PDFLib); s.onerror = () => { pdfLib = null; bad(new Error('PDF 组件没加载出来，检查网络')); };
    document.head.appendChild(s);
  });
}
$('exPdf').addEventListener('click', () => busy($('exPdf'), async () => {
  const [lib, url] = await Promise.all([loadPdfLib(), pngUrl()]);
  const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
  const doc = await lib.PDFDocument.create();
  const png = await doc.embedPng(bytes);
  const land = png.width > png.height;
  const [W, H] = land ? [841.89, 595.28] : [595.28, 841.89], m = 28;
  const k = Math.min((W - 2 * m) / png.width, (H - 2 * m) / png.height);
  const page = doc.addPage([W, H]);
  page.drawImage(png, { x: (W - png.width * k) / 2, y: (H - png.height * k) / 2, width: png.width * k, height: png.height * k });
  doc.setTitle(fname()); doc.setCreator('开源宝藏工具箱 · simple-mind-map');
  const out = await doc.save();
  download(URL.createObjectURL(new Blob([out], { type: 'application/pdf' })), fname() + '.pdf');
  status(`PDF 做好了（A4 ${land ? '横版' : '竖版'}，${(out.length / 1024 / 1024).toFixed(1)}MB）；微信里下载不了就用浏览器打开`);
}));
$('exXmind').addEventListener('click', () => busy($('exXmind'), async () => {
  st.mm.getElRectInfo();
  const url = await st.mm.doExport.xmind(fname());
  download(url, fname() + '.xmind');
  status('XMind 文件做好了，用 XMind 能打开继续改');
}));
$('exText').addEventListener('click', async () => {
  const text = toOutline(st.mm.getData(false));
  try { await navigator.clipboard.writeText(text); status('大纲已复制，可以粘贴到备忘录、Word'); }
  catch { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); status(ok ? '大纲已复制' : '复制失败', !ok); }
});

// ---------- 代做入口 ----------
const svc = window.SITE_CONFIG && window.SITE_CONFIG.service;
if (svc) {
  const s = { ...svc, ...(svc.tools && svc.tools.mindmap) };
  $('service').innerHTML = `<h2>找我代做 <b>${esc(s.price)}</b></h2><p>${esc(s.text)}</p><p class="contact">${esc(s.contact)}</p>${s.qr ? `<img src="../${esc(s.qr)}" alt="联系方式二维码">` : ''}`;
  $('service').hidden = false;
}

// ---------- 启动：打开上次那张 ----------
renderDocs();
const last = !Q.has('new') && loadDocs()[0];
if (last) {
  st.docId = last.id; st.src = last.src || ''; $('src').value = last.src || '';
  setMap(last.root, { layout: last.layout, pal: last.pal }).then(() => renderDocs());
}
window.addEventListener('resize', () => { if (st.mm && !$('mapCard').hidden) st.mm.resize(); });
// 库里缓存了画布在窗口里的位置（elRect），导出、适应画布、手势都靠它：页面一滚动就得更新，不然导出的图是空白、看全图会跑偏
window.addEventListener('scroll', () => { if (st.mm && !$('mapCard').hidden) st.mm.getElRectInfo(); }, { passive: true });
window.__mmReady = true;
