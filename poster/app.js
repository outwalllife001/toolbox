// 店铺海报：手机上的界面。画布、选中控制点、对齐辅助线、撤销重做、图层、居中用的是 vue-fabric-editor（快图设计）的编辑器内核 + fabric.js，
// 这里只做：模板列表、底部工具条、改字 / 配色 / 字体 / 尺寸面板、换照片和抠图、导出、本机草稿。
import { SIZES, sizeOf, PALETTES, paletteOf, FONTS, fontOf, TEMPLATES, CATS, templateOf, STICKERS, buildTemplate, buildSticker, newText, resizeJson, burst } from './templates.js';

const $ = id => document.getElementById(id);
const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const Q = new URLSearchParams(location.search);
// ?dpr=3：录视频用（舞台页把网页放大 3 倍，画布要跟着用 3 倍像素才清楚）
const DPR = +Q.get('dpr') || 0;
// ?edh=420：录视频用，编辑器只占屏幕上面这么高（抖音会盖住视频最下面一截，工具条要落在看得见的地方）
const EDH = +Q.get('edh') || 0;
const MOBILE = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
const FREE_SAVED = 3;
const here = p => new URL(p, import.meta.url).href;
const frame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
function toast(t, ms = 2200) { const e = $('toast'); e.textContent = t; e.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { e.hidden = true; }, ms); }
function busy(text, p) {
  $('edBusy').hidden = !text;
  if (text) { $('busyText').textContent = text; $('busyBar').parentElement.hidden = p == null; if (p != null) $('busyBar').style.width = Math.round(p * 100) + '%'; }
}

// ---------- 状态 ----------
const st = { tpl: null, palette: 'orange', size: 'p34', draftId: null };
let K = null, fabric = null, canvas = null, editor = null, sel = null, sheetKind = null, loading = false;
const photos = new Map();   // blob: 地址 → Blob（存草稿时一起存）
const uid = () => 'o' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const ext = o => (o && o.extension) || {};
const kindOf = o => !o ? null : ext(o).kind === 'slot' ? 'slot' : o.type === 'image' ? 'photo' : o.type === 'textbox' ? 'text' : o.type === 'group' ? 'badge' : 'shape';
const textsOf = o => !o ? [] : o.type === 'textbox' ? [o] : (o._objects || []).filter(k => k.type === 'textbox');
const workspace = () => canvas.getObjects().find(o => o.id === 'workspace');

// ---------- 首页：模板 ----------
let cat = '全部';
function drawHome() {
  $('cats').innerHTML = CATS.map(c => `<button class="${c === cat ? 'on' : ''}" data-c="${c}">${c}</button>`).join('');
  $('tpls').innerHTML = TEMPLATES.filter(t => cat === '全部' || t.cat === cat).map(t =>
    `<button class="tpl" data-id="${t.id}"><img src="thumbs/${t.id}.jpg" alt="${t.name}海报模板" width="310" height="414" loading="lazy"><b>${t.name}</b><span>${t.photo ? '能放商品照片' : '纯文字，不用照片'}</span></button>`).join('');
}
$('cats').onclick = e => { const b = e.target.closest('button'); if (!b) return; cat = b.dataset.c; drawHome(); };
$('tpls').onclick = e => { const b = e.target.closest('.tpl'); if (b) openTemplate(b.dataset.id); };

// ---------- 字体 ----------
const fontJobs = new Map();
function loadFont(id) {
  if (!fontJobs.has(id)) {
    const f = fontOf(id);
    const face = new FontFace(f.family, `url("${here(f.url)}")`, { weight: String(f.weight), display: 'block' });
    fontJobs.set(id, face.load().then(ff => { document.fonts.add(ff); if (fabric) fabric.util.clearFabricFontCache(f.family); return true; })
      .catch(e => { fontJobs.delete(id); throw new Error(`字体「${f.label}」没下载下来，先用手机自带的字体顶着`); }));
  }
  return fontJobs.get(id);
}
function fontsIn(json) {
  const ids = new Set();
  const walk = o => { const e = o.extension || {}; if (o.type === 'textbox') ids.add(e.font || 'hei'); (o.objects || []).forEach(walk); };
  json.objects.forEach(walk);
  return [...ids];
}
async function loadFonts(ids) {
  const need = ids.filter(id => !fontJobs.has(id));
  if (need.length) busy(`正在下载字体（约 ${need.reduce((a, id) => a + fontOf(id).mb, 0).toFixed(1)}MB，只下一次）`);
  const r = await Promise.allSettled(ids.map(loadFont));
  const bad = r.find(x => x.status === 'rejected');
  if (bad) toast(bad.reason.message, 3200);
}
let nameFonts = false;
function loadNameFonts() {
  if (nameFonts) return; nameFonts = true;
  for (const f of FONTS) if (f.url.startsWith('fonts/')) new FontFace(f.family + ' Name', `url("${here(f.url.replace('.woff2', '-name.woff2'))}")`).load().then(ff => document.fonts.add(ff)).catch(() => { });
}

// 单行文字放不下时缩小字号（不折行）。base 是设计字号，永远不会比它大
function fitSize(text, base, width, o) {
  const probe = new fabric.Text(text || ' ', { fontSize: base, fontFamily: o.fontFamily, fontWeight: o.fontWeight, charSpacing: o.charSpacing || 0, lineHeight: o.lineHeight || 1.16 });
  const k = Math.min(1, (width * 0.985) / Math.max(1, probe.width));
  return Math.max(base * 0.25, Math.floor(base * k * 10) / 10);
}
function fitText(t) {
  const e = ext(t);
  if (!e.fit) return;
  t.set('fontSize', fitSize(t.text, e.base || t.fontSize, t.width, t));
}
function prefit(json) {
  const walk = o => { const e = o.extension || {}; if (o.type === 'textbox' && e.fit) o.fontSize = fitSize(o.text, e.base || o.fontSize, o.width, o); (o.objects || []).forEach(walk); };
  json.objects.forEach(walk);
}

// ---------- 编辑器 ----------
function engine() { return engine.p ||= import('../vendor/kuaitu-core/kuaitu-core.min.mjs'); }
function fix(o) {
  if (!o || o.id === 'workspace') return;
  if (ext(o).lock) { o.set({ selectable: false, evented: false, hasControls: false }); return; }
  o.set({ selectable: true, evented: true, hasControls: true, lockScalingFlip: true, lockSkewingX: true, lockSkewingY: true, padding: 6 });
  o.setControlsVisibility({ mt: false, mb: false, ml: o.type === 'textbox', mr: o.type === 'textbox' });
}
const fixAll = () => { canvas.getObjects().forEach(fix); const w = workspace(); if (w) w.set({ selectable: false, evented: false, hasControls: false, hoverCursor: 'default' }); };
// 接到内核的导入流程上：每次载入一张海报后，把锁定的装饰、控制点整理好
class PosterPlugin {
  static pluginName = 'PosterPlugin';
  constructor(c, e) { this.canvas = c; this.editor = e; }
  hookImportAfter() { fixAll(); return Promise.resolve(); }
}
function initEditor() {
  return initEditor.p ||= (async () => {
    K = await engine(); fabric = K.fabric;
    if (DPR) fabric.devicePixelRatio = DPR;
    // fabric 5.3 画字前把 textBaseline 设成了不存在的 'alphabetical'（浏览器忽略它，但每画一次就在控制台告警一次）。这里换成正确的写法，没用到沿路径排字
    fabric.Text.prototype._setTextStyles = function (ctx, charStyle, forMeasuring) { ctx.textBaseline = 'alphabetic'; ctx.font = this._getFontDeclaration(charStyle, forMeasuring); };
    // 导出 A4（2480×3508）时，大色块和带圆角的照片要用自己的缓存画布，默认上限 2 百万像素会把它们画糊
    fabric.perfLimitSizeTotal = 16e6; fabric.maxCacheSideLimit = 8192;
    // 内核的历史插件会在离开页面时弹「确认离开」；这里每一步都自动存在本机，不需要再拦
    addEventListener('beforeunload', e => e.stopImmediatePropagation(), true);
    canvas = new fabric.Canvas('cv', { preserveObjectStacking: true, selection: false, stopContextMenu: true, controlsAboveOverlay: true });
    editor = new K.Editor(); editor.init(canvas);
    editor.use(K.WorkspacePlugin).use(K.ControlsPlugin).use(K.AlignGuidLinePlugin).use(K.HistoryPlugin).use(K.LayerPlugin)
      .use(K.CenterAlignPlugin).use(K.DeleteHotKeyPlugin).use(K.MoveHotKeyPlugin).use(PosterPlugin);
    editor.getPlugin('WorkspacePlugin').zoomRatio = 0.95;
    // 文本框沿用内核的角点、旋转图标（fabric 给文本框单独留了一份控制点）；手指点得中：触摸时控制点按 40 像素算
    const oc = fabric.Object.prototype.controls, tc = fabric.Textbox.prototype.controls;
    if (tc !== oc) { for (const k of ['tl', 'tr', 'bl', 'br', 'mtr']) tc[k] = oc[k]; tc.ml.render = oc.ml.render; tc.mr.render = oc.mr.render; }
    fabric.Object.prototype.touchCornerSize = 40;
    canvas.on('object:added', e => fix(e.target));
    canvas.on('history:undo', afterHistory); canvas.on('history:redo', afterHistory);
    editor.on('selectOne', a => { if (loading) return; setSel(a[0]); });
    editor.on('selectMultiple', () => setSel(null));
    editor.on('selectCancel', () => setSel(null));
    editor.on('historyUpdate', (u, r) => { $('undo').disabled = !(u > 0); $('redo').disabled = !(r > 0); if (!loading) autosaveSoon(); });
    // 连点两下文字 = 改文字。两下都得是「点」（按下到抬起没挪动）：点一下马上开始拖不算，否则面板弹出来画布一缩，手里的东西就跳走了
    let last = { t: 0, o: null };
    canvas.on('mouse:up', e => {
      if (!e.isClick) { last = { t: 0, o: null }; return; }
      const now = Date.now(), o = e.target;
      if (o && o === last.o && now - last.t < 420 && textsOf(o).length && kindOf(o) !== 'slot') { last = { t: 0, o: null }; return openSheet('text'); }
      last = { t: now, o };
    });
    pinch();
    window.__poster.canvas = canvas; window.__poster.editor = editor; window.__poster.fabric = fabric;
  })();
}
function afterHistory() { fixAll(); setSel(null); canvas.requestRenderAll(); }
function setSel(o) {
  if (o === sel) return;
  if (sheetKind && sheetKind !== 'pal' && sheetKind !== 'size' && sheetKind !== 'sticker') closeSheet();
  sel = o || null; drawBar();
}
const commit = () => { editor.saveState(); };
const touch = o => { if (o && o.group) o.group.set('dirty', true); if (o) { o.set('dirty', true); o.setCoords(); } canvas.requestRenderAll(); };

async function openJson(json, meta = {}) {
  loading = true;
  try {
    await initEditor();
    await loadFonts(fontsIn(json));
    prefit(json);
    delete json.clipPath;
    const wj = json.objects.find(o => o.id === 'workspace'), e = wj.extension || {};
    st.palette = meta.palette || e.palette || st.palette; st.tpl = meta.tpl || e.tpl || st.tpl;
    st.size = (SIZES.find(s => s.w === wj.width && s.h === wj.height) || SIZES[0]).id;
    wj.extension = { ...e, role: 'bg', palette: st.palette, tpl: st.tpl };
    busy('正在打开…');
    await new Promise(r => editor.loadJSON(json, r));
    sel = null; canvas.discardActiveObject(); closeSheet(); drawBar();
    $('sizeBtn').textContent = sizeOf(st.size).ratio;
    canvas.requestRenderAll();
  } finally { loading = false; busy(null); }
  window.__poster.opened = (window.__poster.opened || 0) + 1;
}
function showEditor() {
  $('ed').hidden = false; document.body.classList.add('lock');
  if (!(history.state && history.state.ed)) history.pushState({ ed: 1 }, '');
  vvFit();
}
async function hideEditor() {
  if ($('ed').hidden) return;
  closeSheet();
  const job = flushAutosave();
  $('ed').hidden = true; document.body.classList.remove('lock');
  await job; drawDrafts();
}
$('edBack').onclick = () => { if (history.state && history.state.ed) history.back(); else hideEditor(); };
addEventListener('popstate', () => { $('out').hidden = true; hideEditor(); });
async function openTemplate(id, palette, size = 'p34') {
  const t = templateOf(id); if (!t) return;
  showEditor();
  try {
    await initEditor();
    st.draftId = null;
    await openJson(buildTemplate(id, palette || t.palette, size), { tpl: id, palette: palette || t.palette });
    autosaveSoon();
  } catch (e) { console.error(e); busy(null); toast('打开失败：' + (e.message || e), 4000); }
}
// 手机键盘弹出来时，把编辑器缩到键盘上面
function vvFit() {
  if (EDH) { $('ed').style.paddingBottom = Math.max(0, innerHeight - EDH) + 'px'; return; }
  const vv = window.visualViewport; if (!vv || $('ed').hidden) return;
  $('ed').style.height = vv.height + 'px'; $('ed').style.top = vv.offsetTop + 'px';
}
if (window.visualViewport) { visualViewport.addEventListener('resize', vvFit); visualViewport.addEventListener('scroll', vvFit); }
$('undo').onclick = () => editor && editor.undo();
$('redo').onclick = () => editor && editor.redo();

// ---------- 底部工具条 ----------
const IC = {
  pal: '<circle cx="12" cy="12" r="8.5"/><circle cx="8.6" cy="10" r="1.2" fill="currentColor"/><circle cx="12" cy="7.8" r="1.2" fill="currentColor"/><circle cx="15.4" cy="10" r="1.2" fill="currentColor"/>',
  font: '<path d="M5 19 12 5l7 14M8 14h8"/>',
  addText: '<path d="M4 6h12M10 6v13M17 13v7M13.5 16.5h7"/>',
  photo: '<rect x="3.5" y="5.5" width="17" height="13" rx="2.5"/><path d="m4 16 5-5 4 4 2.5-2.5L20 17"/><circle cx="15.5" cy="9.5" r="1.4"/>',
  sticker: '<path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.7l5.9-.8z"/>',
  edit: '<path d="M4 20l1-4.5L16 4.5l3.5 3.5L8.5 19z"/>',
  cut: '<path d="M4.5 19.5 14 10M15 3v3.6M13.2 4.8h3.6M19.2 8.4V12M17.4 10.2H21M19.6 3.2v1.6M18.8 4h1.6"/>',
  flip: '<path d="M12 3.5v17M9 7l-5 5 5 5zM15 7l5 5-5 5z"/>',
  copy: '<rect x="8" y="8" width="11.5" height="11.5" rx="2"/><path d="M5 15.5V6.5a2 2 0 0 1 2-2h9"/>',
  up: '<path d="M12 19.5V5M6 11l6-6 6 6"/>',
  down: '<path d="M12 4.5V19M6 13l6 6 6-6"/>',
  del: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/>',
  color: '<path d="M12 3.5C8 9 6 12 6 15a6 6 0 0 0 12 0c0-3-2-6-6-11.5z"/>',
  center: '<path d="M12 3.5v17M6 8.5h12M8.5 15.5h7"/>',
  minus: '<path d="M4 18 9 6l5 12M6 14h6M16 12h5"/>',
  plus: '<path d="M4 18 9 6l5 12M6 14h6M16 12h5M18.5 9.5v5"/>',
};
const btn = (act, ic, label, cls = '') => `<button data-act="${act}" class="${cls}"><i><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${IC[ic]}</svg></i>${label}</button>`;
function drawBar() {
  const k = kindOf(sel), b = [];
  if (!k) b.push(btn('pal', 'pal', '配色'), btn('font', 'font', '字体'), btn('addText', 'addText', '加文字'), btn('addPhoto', 'photo', '加照片'), btn('sticker', 'sticker', '贴纸'));
  else {
    if (k === 'slot') b.push(btn('photo', 'photo', '换成我的照片', 'pri'));
    if (k === 'photo') b.push(btn('photo', 'photo', '换一张'), btn('cut', 'cut', ext(sel).cut ? '已抠图' : '一键抠图', ext(sel).cut ? '' : 'pri'), btn('flip', 'flip', '翻转'));
    if (textsOf(sel).length && k !== 'slot') b.push(btn('text', 'edit', '改文字', 'pri'), btn('font', 'font', '字体'));
    if (k !== 'slot' && k !== 'photo') b.push(btn('color', 'color', '颜色'));
    if (k !== 'slot') b.push(btn('minus', 'minus', '小一点'), btn('plus', 'plus', '大一点'), btn('center', 'center', '居中'), btn('copy', 'copy', '复制'), btn('up', 'up', '上移一层'), btn('down', 'down', '下移一层'));
    b.push(btn('del', 'del', '删除', 'warn'));
  }
  $('bar').innerHTML = b.join(''); $('bar').scrollLeft = 0;
}
$('bar').onclick = e => {
  const b = e.target.closest('button'); if (!b || !canvas) return;
  const a = b.dataset.act;
  if (['pal', 'font', 'text', 'color', 'sticker'].includes(a)) return openSheet(a);
  if (a === 'addText') return addJson(newText(st.palette), true);
  if (a === 'addPhoto') { pendingTarget = null; return $('pickPhoto').click(); }
  if (a === 'photo') { pendingTarget = sel; return $('pickPhoto').click(); }
  if (!sel) return;
  if (a === 'cut') return ext(sel).cut ? toast('这张已经抠过了') : cutout(sel);
  if (a === 'flip') { sel.set('flipX', !sel.flipX); touch(sel); return commit(); }
  if (a === 'minus' || a === 'plus') { const k = a === 'plus' ? 1.1 : 1 / 1.1; sel.set({ scaleX: sel.scaleX * k, scaleY: sel.scaleY * k }); touch(sel); return commit(); }
  if (a === 'center') { editor.position('centerH'); sel.setCoords(); return commit(); }
  if (a === 'up') { editor.up(); return commit(); }
  if (a === 'down') {
    // 不让它掉到底色下面去：已经是最下面一层就不动
    const objs = canvas.getObjects(); if (objs.indexOf(sel) <= 1) return toast('已经在最下面了');
    editor.down(); return commit();
  }
  if (a === 'copy') return sel.clone(c => { c.set({ left: sel.left + 36, top: sel.top + 36, id: uid() }); canvas.add(c); canvas.setActiveObject(c); canvas.requestRenderAll(); commit(); }, editor.getExtensionKey());
  if (a === 'del') { editor.del(); }
};
function addJson(j, edit) {
  const w = workspace(), s = Math.min(w.width / 1242, w.height / 1656);
  j.left = w.width / 2; j.top = w.height / 2; j.scaleX = (j.scaleX || 1) * s; j.scaleY = (j.scaleY || 1) * s; j.id = uid();
  return new Promise(res => fabric.util.enlivenObjects([j], async ([o]) => {
    await loadFonts(fontsIn({ objects: [j] })); busy(null);
    textsOf(o).forEach(t => { fitText(t); t.initDimensions(); });
    canvas.add(o); canvas.setActiveObject(o); touch(o); commit();
    if (edit) openSheet('text');
    res(o);
  }));
}

// ---------- 面板 ----------
function setText(t, v) { t.set('text', v); fitText(t); t.initDimensions(); touch(t); }
function closeSheet() {
  if (!sheetKind) return;
  const was = sheetKind; sheetKind = null;
  $('sheet').hidden = true; $('sheet').innerHTML = ''; $('bar').hidden = false;
  if (was === 'text' && closeSheet.dirty) { closeSheet.dirty = false; commit(); }
  drawBar();
}
const head = (t, tip = '') => `<div class="sheet-h"><b>${t}${tip ? `<small>${tip}</small>` : ''}</b><button data-x="1">完成</button></div>`;
function openSheet(kind) {
  if (sheetKind) closeSheet();
  const el = $('sheet'); let h = '';
  if (kind === 'text') {
    const ts = textsOf(sel); if (!ts.length) return;
    h = head('改文字', ts.length === 1 ? '字多了自动缩小，回车换行' : '') + (ts.length === 1
      ? `<textarea id="txt0" rows="2" enterkeyhint="done" autocomplete="off">${esc(ts[0].text)}</textarea>`
      : ts.map((t, i) => `<input type="text" id="txt${i}" value="${esc(t.text)}" autocomplete="off">`).join(''));
  } else if (kind === 'pal') {
    h = head('配色', '整张一起换，往左滑还有') + `<div class="pals">${PALETTES.map(p => `<button class="pal ${p.id === st.palette ? 'on' : ''}" data-p="${p.id}"><i><u style="background:${p.bg}"></u><u style="background:${p.brand}"></u><u style="background:${p.title}"></u><u style="background:${p.panel}"></u></i><b>${p.name}</b></button>`).join('')}</div>`;
  } else if (kind === 'font') {
    loadNameFonts();
    const cur = sel ? ext(textsOf(sel)[0]).font : null;
    h = head(sel ? '这段字的字体' : '全部文字的字体', '开源字体，可商用') + `<div class="fontlist">${FONTS.map(f => `<button class="fontopt ${f.id === cur ? 'on' : ''}" data-f="${f.id}"><b style="font-family:'${f.family} Name','${f.family}',sans-serif;${f.id === 'hei' ? 'font-weight:700' : ''}">${f.label}</b><span>源自 ${f.from} · ${f.mb}MB</span></button>`).join('')}</div>`;
  } else if (kind === 'color') {
    const p = paletteOf(st.palette), base = ['#FFFFFF', '#111111', '#E03131', '#FF7A1A', '#FFD43B', '#2FA35B', '#228BE6', '#7048E8', '#F06595', '#8D6E63'];
    const list = [...new Set([p.title, p.brand, p.accent, p.text, p.panel, p.onBrand, ...base].map(c => c.toUpperCase()))];
    h = head(kindOf(sel) === 'text' ? '文字颜色' : '颜色') + `<div class="swatches">${list.map(c => `<button data-c="${c}" style="background:${c}" aria-label="${c}"></button>`).join('')}<label aria-label="自己选颜色"><input type="color" id="anyColor" value="#ff7a1a"></label></div>`;
  } else if (kind === 'size') {
    h = head('换尺寸', '内容按比例重新摆') + `<div class="sizelist">${SIZES.map(s => `<button class="sizeopt ${s.id === st.size ? 'on' : ''}" data-s="${s.id}"><b>${s.name}<em>${s.ratio}</em></b><span>${s.w * s.mult}×${s.h * s.mult} · ${s.use}</span></button>`).join('')}</div>`;
  } else if (kind === 'sticker') {
    h = head('贴纸和形状', '点一下加到中间') + `<div class="stickers">${STICKERS.map(s => `<button class="stk" data-k="${s.id}">${stkIcon(s.id)}${s.name}</button>`).join('')}</div>`;
  }
  el.innerHTML = h; el.hidden = false; sheetKind = kind; $('bar').hidden = true;   // 面板开着时收起工具条，把地方让给海报
  if (kind === 'text') {
    const ts = textsOf(sel);
    ts.forEach((t, i) => { $('txt' + i).oninput = ev => { setText(t, ev.target.value); closeSheet.dirty = true; }; });
    if (!Q.has('nofocus')) { const a = $('txt0'); a.focus(); try { a.setSelectionRange(a.value.length, a.value.length); } catch { } }
  }
}
function stkIcon(id) {
  const P = pts => pts.map(p => p.map(v => v.toFixed(1)).join(',')).join(' ');
  const g = {
    price: `<polygon points="${P(burst(14, 16, 13))}" fill="#ff7a1a"/>`, round: '<circle r="15" fill="#ff7a1a"/><circle r="12" fill="none" stroke="#fff" stroke-dasharray="2 2"/>',
    ribbon: '<polygon points="-20,-7 20,-7 15,0 20,7 -20,7 -15,0" fill="#ff7a1a"/>', pill: '<rect x="-19" y="-7" width="38" height="14" rx="7" fill="#ff7a1a"/>',
    pill2: '<rect x="-19" y="-7" width="38" height="14" rx="7" fill="#fff" stroke="#c9ced8"/>', tag: '<polygon points="-18,-9 18,-9 18,9 -18,9 -12,0" fill="#ffc53d"/>',
    star: `<polygon points="${P(burst(5, 15, 6.5))}" fill="#ffc53d"/>`, spark: `<polygon points="${P(burst(4, 15, 4))}" fill="#ffc53d"/>`, dot: '<circle r="13" fill="#ff7a1a"/>',
    box: '<rect x="-18" y="-12" width="36" height="24" rx="5" fill="#fff" stroke="#c9ced8"/>', line: '<rect x="-19" y="-1.5" width="38" height="3" rx="1.5" fill="#ff7a1a"/>',
    heart: '<path d="M0 12C-12 3-17-2-17-8a8 8 0 0 1 17-2 8 8 0 0 1 17 2c0 6-5 11-17 20z" fill="#f06595" transform="scale(.8) translate(0,-4)"/>',
  }[id] || '';
  return `<svg viewBox="-22 -17 44 34">${g}</svg>`;
}
$('sheet').onclick = async e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.x) return closeSheet();
  if (b.dataset.p) return applyPalette(b.dataset.p);
  if (b.dataset.f) return applyFont(b.dataset.f);
  if (b.dataset.c) return applyColor(b.dataset.c);
  if (b.dataset.s) return setSize(b.dataset.s);
  if (b.dataset.k) { closeSheet(); return addJson(buildSticker(b.dataset.k, st.palette)); }
};
$('sheet').addEventListener('input', e => { if (e.target.id === 'anyColor') applyColor(e.target.value, true); });
$('sheet').addEventListener('change', e => { if (e.target.id === 'anyColor') commit(); });
$('sheet').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') closeSheet(); });
$('sizeBtn').onclick = () => (sheetKind === 'size' ? closeSheet() : openSheet('size'));

function applyPalette(id) {
  const p = paletteOf(id);
  const walk = o => {
    const e = ext(o);
    if (e.role && p[e.role]) o.set('fill', p[e.role]);
    if (e.sRole && p[e.sRole]) o.set('stroke', p[e.sRole]);
    if (o._objects) { o._objects.forEach(walk); o.set('dirty', true); }
  };
  canvas.getObjects().forEach(walk);
  st.palette = id; const w = workspace(); w.extension = { ...ext(w), palette: id };
  canvas.requestRenderAll(); commit();
  for (const x of $('sheet').querySelectorAll('.pal')) x.classList.toggle('on', x.dataset.p === id);
}
async function applyFont(id) {
  const f = fontOf(id);
  try { await loadFonts([id]); } finally { busy(null); }
  const targets = sel ? textsOf(sel) : canvas.getObjects().flatMap(textsOf);
  for (const t of targets) {
    t.set({ fontFamily: f.family, fontWeight: f.weight }); t.extension = { ...ext(t), font: id };
    fitText(t); t.initDimensions(); touch(t);
  }
  canvas.requestRenderAll(); commit();
  for (const x of $('sheet').querySelectorAll('.fontopt')) x.classList.toggle('on', x.dataset.f === id);
}
function applyColor(c, live) {
  if (!sel) return;
  const k = kindOf(sel);
  // 文字：改字色；标签 / 贴纸：改底下那块形状的颜色；手动改过的不再跟着配色变
  const t = k === 'badge' ? (sel._objects.find(o => o.type !== 'textbox' && o.fill) || sel._objects[0]) : sel;
  t.set('fill', c); const e = { ...ext(t) }; delete e.role; t.extension = e;
  touch(t); if (k === 'badge') sel.set('dirty', true);
  canvas.requestRenderAll(); if (!live) commit();
}
async function setSize(id, quiet) {
  if (id === st.size) return closeSheet();
  const s = sizeOf(id), json = editor.getJson();
  delete json.clipPath; resizeJson(json, s.w, s.h);
  closeSheet();
  await openJson(json);
  autosaveSoon(); if (!quiet) toast(`已换成${s.name}（${s.w * s.mult}×${s.h * s.mult}）`);
}

// ---------- 照片 ----------
let pendingTarget = null;
$('pickPhoto').onchange = async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try { await placePhoto(f, pendingTarget); } catch (err) { console.error(err); busy(null); toast(err.message || '这张照片打不开', 3500); }
};
const toBlob = (c, type = 'image/png', q) => new Promise(r => c.toBlob(r, type, q));
async function shrink(file, max = 1600) {
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { throw new Error('这张照片打不开（苹果的 HEIC 格式请先在相册里存成 JPG）'); }
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(bmp, 0, 0, c.width, c.height); bmp.close && bmp.close();
  const png = /png|webp|gif/i.test(file.type);
  return toBlob(c, png ? 'image/png' : 'image/jpeg', 0.9);
}
const imgFrom = url => new Promise((res, rej) => fabric.Image.fromURL(url, (img, err) => (err || !img.width ? rej(new Error('这张照片打不开')) : res(img))));
// 目标位置：图片位（虚线框）或已有的照片 → 新照片放进同一个框；没有目标就放在海报中间
function boxOf(target, iw, ih) {
  const w = workspace();
  if (target) {
    const s = ext(target).slot, k = kindOf(target);
    if (k === 'slot') return { cx: target.left, cy: target.top, w: s.w * target.scaleX, h: s.h * target.scaleY, r: s.r * target.scaleX, angle: target.angle };
    if (s) { const f = Math.abs(target.scaleX) / (s.k || Math.abs(target.scaleX)); return { cx: target.left, cy: target.top, w: s.w * f, h: s.h * f, r: s.r * f, angle: target.angle }; }
  }
  const bw = w.width * 0.62, bh = Math.min(w.height * 0.5, bw * ih / iw);
  return { cx: w.width / 2, cy: w.height / 2, w: bh * iw / ih < bw ? bh * iw / ih : bw, h: bh * iw / ih < bw ? bh : bw * ih / iw, r: 28 * Math.min(w.width / 1242, w.height / 1656), angle: 0 };
}
async function placePhoto(file, target, { cut = false, keepBlob = false } = {}) {
  const blob = keepBlob ? file : await shrink(file);
  const url = URL.createObjectURL(blob); photos.set(url, blob);
  const img = await imgFrom(url), iw = img.width, ih = img.height;
  const box = boxOf(target, iw, ih);
  if (cut) {
    // 抠好的图：整个放进框里（不裁），带一点投影
    const k = Math.min(box.w / iw, box.h / ih);
    img.set({ scaleX: k, scaleY: k, shadow: new fabric.Shadow({ color: 'rgba(0,0,0,.28)', blur: 26 / k, offsetX: 0, offsetY: 14 / k }) });
  } else {
    // 普通照片：按框的比例居中裁掉多余的部分，四个角按框的圆角裁
    const ar = box.w / box.h; let cw = iw, ch = iw / ar; if (ch > ih) { ch = ih; cw = ih * ar; }
    const rr = Math.min(cw, ch) / 2 < box.r * cw / box.w ? Math.min(cw, ch) / 2 : box.r * cw / box.w;
    img.set({ cropX: (iw - cw) / 2, cropY: (ih - ch) / 2, width: cw, height: ch, scaleX: box.w / cw, scaleY: box.h / ch });
    img.clipPath = new fabric.Rect({ width: cw, height: ch, rx: rr, ry: rr, originX: 'center', originY: 'center', left: 0, top: 0 });
  }
  img.set({ left: box.cx, top: box.cy, originX: 'center', originY: 'center', angle: box.angle || 0, id: uid() });
  // 换尺寸时怎么摆（pin / anchor）跟着原来那个位置走
  const keep = {}; for (const k of ['pin', 'anchor']) if (target && ext(target)[k]) keep[k] = ext(target)[k];
  img.extension = { kind: 'photo', ...(cut ? { cut: 1 } : {}), ...keep, slot: { w: box.w, h: box.h, r: box.r, k: img.scaleX } };
  const idx = target ? canvas.getObjects().indexOf(target) : -1;
  // 换图是「删掉旧的 + 加上新的」：中间那一步别进撤销记录（内核的历史插件在 isProcessing 时不记）
  const hist = editor.getPlugin('HistoryPlugin');
  hist.isProcessing = true;
  try {
    if (target) canvas.remove(target);
    if (idx >= 0) canvas.insertAt(img, idx, false); else canvas.add(img);
  } finally { hist.isProcessing = false; }
  canvas.setActiveObject(img); setSel(img); drawBar(); canvas.requestRenderAll(); commit();
  return img;
}
// 一键抠图：用本站「AI 抠图」页的同一套代码和模型（rembg 的 isnet-general-use 流程），点了才下载
async function cutout(o) {
  const blob = photos.get(o.getSrc());
  if (!blob) return toast('这张图抠不了，换一张试试');
  try {
    busy('正在准备抠图…', 0);
    const core = await import('../cutout/core.js');
    await core.loadModel(p => busy(p < 1 ? `正在下载抠图模型 ${Math.round(p * 100)}%（约 42MB，只下一次）` : '正在抠图，稍等几秒…', p));
    busy(MOBILE ? '正在抠图，手机上要等一会儿…' : '正在抠图，稍等几秒…', 1);
    await frame(); await frame();
    const t0 = performance.now();
    const bmp = await createImageBitmap(blob);
    const res = await core.removeBackground(bmp, () => { }, +Q.get('cutsize') || (MOBILE ? 768 : 1024));
    const W = res.src.width, H = res.src.height, b = core.bbox(res.alpha, W, H);
    let n = 0; for (let i = 0; i < res.alpha.length; i += 16) if (res.alpha[i] > 128) n++;
    if (n * 16 < W * H * 0.01) { busy(null); return toast('没认出主体，换一张主体清楚的照片试试', 3200); }
    const pad = Math.round(Math.max(b.w, b.h) * 0.02), x = Math.max(0, b.x - pad), y = Math.max(0, b.y - pad), w = Math.min(W - x, b.w + pad * 2), h = Math.min(H - y, b.h + pad * 2);
    const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(res.cut, x, y, w, h, 0, 0, w, h);
    const png = await toBlob(c, 'image/png');
    window.__poster.cutMs = Math.round(performance.now() - t0);
    busy(null);
    await placePhoto(png, o, { cut: true, keepBlob: true });
  } catch (e) { console.error(e); busy(null); toast('抠图失败：' + (e.message || e), 4000); }
}

// ---------- 两指捏合：放大缩小、旋转选中的元素 ----------
function pinch() {
  const el = canvas.upperCanvasEl; let g = null;
  const info = t => ({ d: Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY), a: Math.atan2(t[1].clientY - t[0].clientY, t[1].clientX - t[0].clientX) * 180 / Math.PI });
  el.addEventListener('touchstart', e => {
    const o = canvas.getActiveObject();
    if (e.touches.length !== 2 || !o) return;
    e.preventDefault(); e.stopPropagation();
    canvas._currentTransform = null;      // 第一根手指已经开始的拖动先停掉
    g = { o, ...info(e.touches), sx: o.scaleX, sy: o.scaleY, ang: o.angle };
  }, { capture: true, passive: false });
  el.addEventListener('touchmove', e => {
    if (!g || e.touches.length < 2) return;
    e.preventDefault(); e.stopPropagation();
    const n = info(e.touches), k = Math.max(0.1, n.d / Math.max(1, g.d));
    let ang = g.ang + (n.a - g.a); const snap = Math.round(ang / 90) * 90; if (Math.abs(ang - snap) < 4) ang = snap;
    g.o.set({ scaleX: g.sx * k, scaleY: g.sy * k, angle: ang }); g.o.setCoords(); canvas.requestRenderAll();
  }, { capture: true, passive: false });
  const end = e => { if (!g) return; e.stopPropagation(); if (e.touches.length < 2) { const o = g.o; g = null; canvas.fire('object:modified', { target: o }); } };
  el.addEventListener('touchend', end, { capture: true }); el.addEventListener('touchcancel', end, { capture: true });
}

// ---------- 导出 ----------
function renderOut(mult, { slots = false } = {}) {
  const hide = slots ? [] : canvas.getObjects().filter(o => ext(o).kind === 'slot' && o.visible);
  hide.forEach(o => { o.visible = false; });
  const vpt = canvas.viewportTransform.slice(), w = workspace();
  canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
  const el = canvas.toCanvasElement(mult, { left: w.left, top: w.top, width: w.width, height: w.height });
  hide.forEach(o => { o.visible = true; });
  canvas.setViewportTransform(vpt); canvas.requestRenderAll();
  return el;
}
const titleText = () => { const ts = canvas.getObjects().flatMap(o => kindOf(o) === 'text' ? [o] : []).sort((a, b) => b.fontSize * b.scaleY - a.fontSize * a.scaleY); return ts[0] ? ts[0].text.replace(/\s+/g, '').slice(0, 12) : '海报'; };
const safe = s => (s || '').replace(/[\\/:*?"<>|\s]+/g, '') || '海报';
let outUrls = [];
function setDl(blob, name, label) {
  const u = URL.createObjectURL(blob); outUrls.push(u);
  const a = $('dl'); a.href = u; a.download = name; a.textContent = label;
  const file = new File([blob], name, { type: blob.type });
  $('outShare').hidden = !(navigator.canShare && navigator.canShare({ files: [file] }));
  $('outShare').onclick = () => navigator.share({ files: [file], title: name }).catch(() => { });
  return u;
}
async function doExport(type = 'image/jpeg') {
  if (!canvas) return;
  closeSheet(); canvas.discardActiveObject(); canvas.requestRenderAll();
  busy('正在生成高清图…'); await frame();
  try {
    const t0 = performance.now(), s = sizeOf(st.size);
    const el = renderOut(s.mult), blob = await toBlob(el, type, 0.92);
    const extn = type === 'image/png' ? 'png' : 'jpg', name = `${safe(titleText())}_${safe(s.name)}.${extn}`;
    outUrls.forEach(u => URL.revokeObjectURL(u)); outUrls = [];
    const u = setDl(blob, name, '保存图片');
    const left = canvas.getObjects().filter(o => ext(o).kind === 'slot').length;
    $('outTitle').textContent = '海报做好了'; $('outImg').src = u; $('outImg').hidden = false; $('dl').hidden = false;
    $('outMeta').textContent = `${s.name} · ${el.width}×${el.height} 像素 · ${extn.toUpperCase()} · ${blob.size > 1e6 ? (blob.size / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(blob.size / 1024)) + ' KB'}${left ? ` · 有 ${left} 个图片位没换照片，导出时留空了` : ''}`;
    $('outMore').innerHTML = `<div class="row">${type === 'image/png' ? '<button class="btn" data-o="jpg">换成 JPG（文件小）</button>' : '<button class="btn" data-o="png">换成 PNG（更清晰）</button>'}${s.id === 'a4' ? '<button class="btn" data-o="pdf">存成 PDF 去打印</button>' : '<button class="btn" data-o="a4">要打印？换 A4 尺寸</button>'}</div><button class="btn" data-o="all">一次导出全部 4 种尺寸</button>`;
    $('wxTip').hidden = !/MicroMessenger|aweme|Douyin|QQ\//i.test(navigator.userAgent);
    $('out').hidden = false;
    window.__poster.last = { blob, name, w: el.width, h: el.height, type, ms: Math.round(performance.now() - t0) };
  } catch (e) { console.error(e); toast('导出失败：' + (e.message || e), 4000); }
  finally { busy(null); }
}
$('exportBtn').onclick = () => doExport();
$('outBack').onclick = () => { $('out').hidden = true; };
let pdfLib = null;
const loadPdfLib = () => window.PDFLib ? Promise.resolve(window.PDFLib) : (pdfLib ||= new Promise((ok, bad) => {
  const s = document.createElement('script'); s.src = here('../vendor/pdf-lib/pdf-lib.min.js');
  s.onload = () => ok(window.PDFLib); s.onerror = () => { pdfLib = null; bad(new Error('PDF 组件加载失败，请检查网络后重试')); };
  document.head.appendChild(s);
}));
async function renderSize(s) {
  const json = JSON.parse(JSON.stringify(editor.getJson()));
  delete json.clipPath; resizeJson(json, s.w, s.h);
  json.objects = json.objects.filter(o => (o.extension || {}).kind !== 'slot');
  const sc = new fabric.StaticCanvas(null, { width: s.w, height: s.h, enableRetinaScaling: false, renderOnAddRemove: false });
  await new Promise(r => sc.loadFromJSON(json, r));
  sc.renderAll();
  const el = sc.toCanvasElement(s.mult); sc.dispose();
  return el;
}
$('outMore').onclick = async e => {
  const b = e.target.closest('button'); if (!b) return;
  const o = b.dataset.o;
  if (o === 'png') return doExport('image/png');
  if (o === 'jpg') return doExport('image/jpeg');
  if (o === 'a4') { $('out').hidden = true; await setSize('a4', true); return doExport(); }
  b.disabled = true; const old = b.textContent;
  try {
    if (o === 'pdf') {
      b.textContent = '正在生成 PDF…'; await frame();
      const { PDFDocument } = await loadPdfLib();
      const jpg = await toBlob(renderOut(2), 'image/jpeg', 0.92), doc = await PDFDocument.create();
      doc.setTitle(titleText()); doc.setCreator('开源宝藏工具箱');
      const im = await doc.embedJpg(await jpg.arrayBuffer()), pg = doc.addPage([595.28, 841.89]);
      pg.drawImage(im, { x: 0, y: 0, width: 595.28, height: 841.89 });
      const bytes = await doc.save(), blob = new Blob([bytes], { type: 'application/pdf' }), name = `${safe(titleText())}_A4打印.pdf`;
      setDl(blob, name, '保存 PDF');
      $('outMeta').textContent = `A4 一页 · PDF · ${(blob.size / 1e6).toFixed(1)} MB · 打印时选「实际大小」或「铺满纸张」`;
      window.__poster.last = { blob, name, type: 'application/pdf', bytes };
    } else if (o === 'all') {
      if (window.Member && Member.enabled && !(await Member.active())) {
        const r = await Member.gate({ title: '一次导出全部尺寸', text: '免费版可以一种一种换尺寸导出（不限次数、没有水印）。开通工具箱会员，同一张海报一次出齐竖版、手机全屏、方形主图、A4 打印 4 种尺寸。' });
        if (r !== 'member') return;
      }
      b.textContent = '正在生成 4 种尺寸…'; await frame();
      const items = [];
      for (const s of SIZES) {
        const el = await renderSize(s), blob = await toBlob(el, 'image/jpeg', 0.92), u = URL.createObjectURL(blob); outUrls.push(u);
        items.push({ s, blob, u, w: el.width, h: el.height, name: `${safe(titleText())}_${safe(s.name)}.jpg` });
        await frame();
      }
      $('outImg').hidden = true; $('dl').hidden = true; $('outShare').hidden = true; $('outTitle').textContent = '4 种尺寸都做好了';
      $('outMeta').textContent = '点哪张存哪张';
      $('outMore').innerHTML = `<div class="allsizes">${items.map(i => `<a href="${i.u}" download="${esc(i.name)}"><img src="${i.u}" alt="${i.s.name}"><b>${i.s.name}</b>${i.w}×${i.h} · <span>保存</span></a>`).join('')}</div>`;
      window.__poster.all = items;
      return;
    }
  } catch (err) { console.error(err); toast('没做成：' + (err.message || err), 4000); }
  finally { b.disabled = false; if (b.isConnected) b.textContent = old; }
};

// ---------- 本机草稿（IndexedDB）：自动存一份「上次没做完的」，手动保存的放进「我的海报」（第 4 张起要会员） ----------
const idb = (() => {
  let p;
  const open = () => p ||= new Promise((res, rej) => { const r = indexedDB.open('toolbox-poster', 1); r.onupgradeneeded = () => r.result.createObjectStore('drafts', { keyPath: 'id' }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const tx = async (mode, fn) => { const db = await open(); return new Promise((res, rej) => { const t = db.transaction('drafts', mode), q = fn(t.objectStore('drafts')); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); }); };
  return { all: () => tx('readonly', s => s.getAll()), get: id => tx('readonly', s => s.get(id)), put: v => tx('readwrite', s => s.put(v)), del: id => tx('readwrite', s => s.delete(id)) };
})();
function snapshot() {
  const json = editor.getJson(); delete json.clipPath;
  const used = new Set(), walk = o => { if (o.type === 'image' && o.src) used.add(o.src); (o.objects || []).forEach(walk); };
  json.objects.forEach(walk);
  return {
    json: JSON.stringify(json), photos: [...used].filter(u => photos.has(u)).map(u => ({ url: u, blob: photos.get(u) })),
    thumb: renderOut(Math.min(0.3, 360 / workspace().width), { slots: true }).toDataURL('image/jpeg', 0.72),
    name: titleText(), size: st.size, tpl: st.tpl, palette: st.palette, t: Date.now(),
  };
}
let saveTimer = 0;
function autosaveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(flushAutosave, 1200); }
function flushAutosave() {
  clearTimeout(saveTimer); saveTimer = 0;
  if (!canvas || loading || !workspace()) return Promise.resolve();
  try { return idb.put({ id: 'auto', from: st.draftId, ...snapshot() }).catch(() => { }); } catch (e) { console.warn(e); return Promise.resolve(); }
}
addEventListener('pagehide', () => { if (saveTimer) flushAutosave(); });
async function openDraft(d) {
  showEditor();
  try {
    await initEditor();
    let s = d.json;
    for (const p of d.photos || []) { const u = URL.createObjectURL(p.blob); photos.set(u, p.blob); s = s.split(p.url).join(u); }
    st.draftId = d.id === 'auto' ? (d.from || null) : d.id;
    await openJson(JSON.parse(s), { tpl: d.tpl, palette: d.palette });
  } catch (e) { console.error(e); busy(null); toast('打开失败：' + (e.message || e), 4000); }
}
const ago = t => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? '刚刚' : m < 60 ? `${m} 分钟前` : m < 1440 ? `${Math.round(m / 60)} 小时前` : `${Math.round(m / 1440)} 天前`; };
async function drawDrafts() {
  let all = [];
  try { all = await idb.all(); } catch { }
  const auto = all.find(d => d.id === 'auto'), saved = all.filter(d => d.id !== 'auto').sort((a, b) => b.t - a.t);
  $('resume').hidden = !auto;
  if (auto) { $('resumeImg').src = auto.thumb; $('resumeMeta').textContent = `${auto.name} · ${sizeOf(auto.size).name} · ${ago(auto.t)}`; $('resumeGo').onclick = () => openDraft(auto); }
  $('drafts').innerHTML = saved.map(d => `<div class="draft"><button class="o" data-id="${d.id}"><img src="${d.thumb}" alt=""><b>${esc(d.name)}</b></button><button class="x" data-x="${d.id}" aria-label="删除">✕</button></div>`).join('');
  $('draftsHint').hidden = false;
  window.__poster.drafts = saved.length;
}
$('drafts').onclick = async e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.x) { await idb.del(b.dataset.x); return drawDrafts(); }
  const d = await idb.get(b.dataset.id); if (d) openDraft(d);
};
$('saveBtn').onclick = async () => {
  if (!canvas) return;
  let all = []; try { all = (await idb.all()).filter(d => d.id !== 'auto').sort((a, b) => a.t - b.t); } catch { return toast('这个浏览器存不了（可能开了无痕模式）'); }
  const exists = st.draftId && all.some(d => d.id === st.draftId);
  if (!exists && all.length >= FREE_SAVED && window.Member && Member.enabled && !(await Member.active())) {
    const r = await Member.gate({ title: '多存几张海报', text: `免费版能在这台手机上存 ${FREE_SAVED} 张（做图、导出不限次数，没有水印）；开通工具箱会员可以一直存，每个月的活动海报改改日期就能再用。`, free: '换掉最早存的那张' });
    if (!r) return;
    if (r === 'free') await idb.del(all[0].id);
  }
  if (!exists) st.draftId = 'd' + Date.now().toString(36);
  try { await idb.put({ id: st.draftId, ...snapshot() }); toast(exists ? '已更新到「我的海报」' : '已存到「我的海报」'); }
  catch (e) { toast('没存上：手机空间不够或浏览器不让存'); }
};

// ---------- 代做入口 ----------
const svc = window.SITE_CONFIG && window.SITE_CONFIG.service;
if (svc) {
  const s = { ...svc, ...(svc.tools && svc.tools.poster) };
  $('service').innerHTML = `<h2>找我代做 <b>${esc(s.price)}</b></h2><p>${esc(s.text)}</p><p class="contact">${esc(s.contact)}</p>${s.qr ? `<img src="../${esc(s.qr)}" alt="联系方式二维码">` : ''}`;
  $('service').hidden = false;
}

// 供分镜和测试用
window.__poster = {
  st, photos, openTemplate, openDraft, placePhoto, cutout, doExport, setSize, applyPalette, applyFont, openSheet, closeSheet, renderOut, renderSize, loadFonts, fontsIn, initEditor, flushAutosave, drawDrafts,
  get sel() { return sel; },
  select(o) { canvas.setActiveObject(o); canvas.requestRenderAll(); },
  deselect() { canvas.discardActiveObject(); canvas.requestRenderAll(); },
  setText, textsOf, commit,
  // 某个元素在网页里的位置（中心点和外框），给点击和画框用
  rectOf(o) {
    const r = o.getBoundingRect(), c = canvas.upperCanvasEl.getBoundingClientRect();
    return { x: c.left + r.left, y: c.top + r.top, w: r.width, h: r.height, cx: c.left + r.left + r.width / 2, cy: c.top + r.top + r.height / 2 };
  },
  find: fn => canvas.getObjects().find(fn),
  preloadCutout: async () => { const core = await import('../cutout/core.js'); await core.loadModel(); },
};
drawHome(); drawDrafts(); drawBar();
// 空闲时先把编辑器内核下好，点模板时就不用等
const warm = () => engine().catch(() => { });
if (window.requestIdleCallback) requestIdleCallback(warm, { timeout: 3000 }); else setTimeout(warm, 1500);
if (Q.get('tpl')) openTemplate(Q.get('tpl'), Q.get('palette') || undefined, Q.get('size') || 'p34');
window.__posterReady = true;
