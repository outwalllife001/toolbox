// PDF 合并 · 压缩：界面（本目录的代码以 AGPL-3.0 发布，见 LICENSE.md）
import * as core from './core.js';

const $ = id => document.getElementById(id);
const DPR = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
const FREE_FILES = 10;          // 启用会员后：一次合并超过 10 个文件要会员
const COLORS = ['#2f6bff', '#f79009', '#12b76a', '#e5484d', '#7a5af8', '#0ba5ec', '#ee46bc', '#669f2a'];
const HOLD = new URLSearchParams(location.search).has('hold');
const st = { files: [], pages: [], level: 'std', target: 2000000, busy: false, seq: 0, out: null, url: null, warm: null };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const base = n => n.replace(/\.[a-z0-9]{2,5}$/i, '');
function setStatus(text, cls = '') { const s = $('status'); s.textContent = text; s.className = 'status ' + cls; }
function setBar(v) { $('bar').hidden = v == null; if (v != null) $('barIn').style.width = Math.round(v * 100) + '%'; }

// ---------- 添加文件 ----------
$('file').addEventListener('change', e => { const fs = [...e.target.files]; e.target.value = ''; addFiles(fs); });
async function addFiles(list) {
  if (!list.length || st.busy) return;
  const bad = [];
  setStatus(`正在打开 ${list.length} 个文件…`);
  const added = [];
  for (const f of list) {
    try {
      const fo = { id: ++st.seq, name: f.name, size: f.size, file: f, color: COLORS[st.files.length % COLORS.length] };
      if (core.isPdf(f)) {
        fo.kind = 'pdf';
        fo.bytes = new Uint8Array(await f.arrayBuffer());
        const r = await core.openPdf(fo.bytes, reason => window.prompt(`${f.name}\n${reason === 2 ? '密码不对，请再输一次：' : '这个 PDF 有打开密码，请输入：'}`));
        Object.assign(fo, { doc: r.doc, pgs: r.pages, password: r.password });
      } else if (core.isImage(f)) {
        fo.kind = 'img';
        fo.img = await core.openImage(f);
        fo.pgs = [{ w: fo.img.w, h: fo.img.h }];
      } else { bad.push(f.name); continue; }
      st.files.push(fo);
      fo.pgs.forEach((pg, idx) => { const p = { id: ++st.seq, file: fo, idx, pg, rot: 0, turn: 0 }; st.pages.push(p); added.push(p); });
    } catch (err) {
      console.error(err);
      bad.push(f.name + (/password/i.test(err.name + err.message) ? '（没输入正确的密码）' : /HEIF|HEIC/i.test(f.name) ? '（这个浏览器打不开 HEIC，请在相册里选「兼容性最佳」或截图后再传）' : ''));
    }
  }
  render(added);
  setStatus(bad.length ? `有 ${bad.length} 个文件打不开：${bad.join('、')}` : '', bad.length ? 'err' : '');
  if (st.pages.length && st.level !== 'none') warm();
}
function warm() { st.warm ||= core.warmup().catch(err => { st.warm = null; console.warn(err); }); }

// ---------- 缩略图 ----------
const grid = $('grid');
let io = null;
function render(added = []) {
  const has = st.pages.length > 0;
  $('dropEmpty').hidden = has; $('pagesWrap').hidden = !has; $('opts').hidden = !has;
  if (!has) { grid.innerHTML = ''; return; }
  io ||= new IntersectionObserver(es => es.forEach(en => { if (en.isIntersecting) { io.unobserve(en.target); draw(en.target.__p); } }), { rootMargin: '400px 0px' });
  for (const p of st.pages) {
    if (p.el) continue;
    const el = p.el = document.createElement('div');
    el.className = 'th'; el.__p = p; el.dataset.id = p.id;
    el.innerHTML = `<i class="fc" style="--c:${p.file.color}"></i><div class="box"><canvas></canvas></div><span class="no"><b></b>${esc(base(p.file.name))}</span><button class="rot" aria-label="转方向">↻</button><button class="del" aria-label="删掉这页">✕</button>`;
    p.cv = el.querySelector('canvas');
    el.addEventListener('animationend', () => el.classList.remove('in'));
  }
  // 按 st.pages 的顺序摆，「+ 添加」放最后
  const frag = document.createDocumentFragment();
  st.pages.forEach(p => frag.appendChild(p.el));
  let add = grid.querySelector('.add');
  if (!add) { add = document.createElement('label'); add.className = 'add'; add.htmlFor = 'file'; add.innerHTML = '<b>+</b>继续添加'; }
  frag.appendChild(add);
  grid.appendChild(frag);
  for (const p of added) { p.el.classList.add('in'); io.observe(p.el); }
  layoutAll(); renumber(); meta();
}
async function draw(p) {
  if (p.drawn) return; p.drawn = true;
  const box = p.el.querySelector('.box'), cssW = Math.max(60, box.clientWidth) * 1.15;
  try {
    if (p.file.kind === 'pdf') await core.renderPdfThumb(p.pg, p.cv, cssW, DPR);
    else core.renderImageThumb(p.file.img, p.cv, cssW, DPR);
  } catch (err) { console.error(err); }
  p.ready = true;
}
// 缩略图按「转过之后」的形状放进格子里：canvas 本身不转，CSS 转
function layout(p) {
  const box = p.el.querySelector('.box'), bw = box.clientWidth, bh = box.clientHeight;
  if (!bw) return;
  const odd = p.rot % 180 !== 0, w = p.pg.w, h = p.pg.h;
  const s = Math.min(bw / (odd ? h : w), bh / (odd ? w : h));
  p.cv.style.width = (w * s).toFixed(1) + 'px'; p.cv.style.height = (h * s).toFixed(1) + 'px';
  p.cv.style.setProperty('--r', p.turn + 'deg');
}
function layoutAll() { st.pages.forEach(layout); }
addEventListener('resize', layoutAll);
function renumber() { st.pages.forEach((p, i) => { p.el.querySelector('.no b').textContent = i + 1; }); }
function usedFiles() { return st.files.filter(f => st.pages.some(p => p.file === f)); }
function meta() {
  const fs = usedFiles(), total = fs.reduce((a, f) => a + f.size, 0);
  $('docMeta').innerHTML = `${fs.length} 个文件 · ${st.pages.length} 页 <small>· 共 ${core.fmtSize(total)}</small>`;
  const single = fs.length === 1;
  $('go').textContent = st.level === 'none'
    ? (single && fs[0].kind === 'pdf' ? '保存 PDF' : single ? '生成 PDF' : '合并成一个 PDF')
    : single && fs[0].kind === 'pdf' ? '压缩 PDF' : single ? '生成 PDF 并压缩' : '合并成一个 PDF';
}

grid.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b || st.busy) return;
  const p = b.closest('.th').__p;
  if (b.classList.contains('rot')) { p.rot = (p.rot + 90) % 360; p.turn += 90; layout(p); }
  else if (b.classList.contains('del')) removePage(p);
});
function removePage(p) {
  const i = st.pages.indexOf(p); if (i < 0) return;
  st.pages.splice(i, 1);
  const before = rects();
  p.el.classList.add('out');
  setTimeout(() => {
    p.el.remove(); io && io.unobserve(p.el);
    flip(before);
    // 文件的页全删了：关掉它
    const f = p.file;
    if (!st.pages.some(q => q.file === f)) { st.files.splice(st.files.indexOf(f), 1); if (f.doc) core.closeDoc(f.doc); f.img?.bmp?.close?.(); }
    renumber(); meta(); render();
  }, 230);
}

// ---------- 拖动排序 ----------
// 鼠标：按住一动就拖；手指：长按 0.3 秒再拖（不然没法上下滑动页面）
const ghost = $('ghost');
let drag = null;
grid.addEventListener('pointerdown', e => {
  if (st.busy || e.button > 0) return;
  const th = e.target.closest('.th'); if (!th || e.target.closest('button')) return;
  const d = drag = { th, pid: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, on: false, mouse: e.pointerType === 'mouse' };
  if (!d.mouse) d.timer = setTimeout(() => drag === d && begin(d), 300);
});
addEventListener('pointermove', e => {
  const d = drag; if (!d || e.pointerId !== d.pid) return;
  d.x = e.clientX; d.y = e.clientY;
  if (!d.on) {
    const moved = Math.hypot(d.x - d.x0, d.y - d.y0);
    if (d.mouse && moved > 4) begin(d);
    else if (!d.mouse && moved > 10) { clearTimeout(d.timer); drag = null; }
    if (!d.on) return;
  }
  move(d);
});
addEventListener('pointerup', e => end(e), true);
addEventListener('pointercancel', e => end(e), true);
document.addEventListener('touchmove', e => { if (drag && drag.on) e.preventDefault(); }, { passive: false });
document.addEventListener('contextmenu', e => { if (e.target.closest && e.target.closest('.th')) e.preventDefault(); });

function begin(d) {
  d.on = true;
  const r = d.th.getBoundingClientRect();
  d.ox = d.x0 - r.left; d.oy = d.y0 - r.top;
  ghost.innerHTML = ''; ghost.style.width = r.width + 'px'; ghost.style.height = r.height + 'px';
  const c = d.th.cloneNode(true); c.classList.remove('in', 'hole'); c.style.margin = '0'; c.style.width = '100%'; c.style.height = '100%';
  const src = d.th.querySelector('canvas'), dst = c.querySelector('canvas');
  dst.width = src.width; dst.height = src.height; dst.getContext('2d').drawImage(src, 0, 0);
  ghost.appendChild(c); ghost.hidden = false;
  ghost.animate([{ scale: '1' }, { scale: '1.08' }], { duration: 160, fill: 'forwards' });
  d.th.classList.add('hole'); document.body.classList.add('dragging');
  navigator.vibrate?.(12);
  move(d);
}
function move(d) {
  ghost.style.transform = `translate(${d.x - d.ox}px, ${d.y - d.oy}px) rotate(-2deg)`;
  const over = document.elementFromPoint(d.x, d.y)?.closest?.('.th');
  // 刚换过位置、还在做位移动画的不算：它看上去还在手指下面，其实已经移走了（不然会来回换）
  if (over && over !== d.th && grid.contains(over) && !over.classList.contains('out') && !over.getAnimations().length) {
    const els = [...grid.querySelectorAll('.th')], a = els.indexOf(d.th), b = els.indexOf(over);
    const before = rects();
    if (a < b) over.after(d.th); else over.before(d.th);
    flip(before);
  }
  // 拖到屏幕最边上才自动滚（区域太宽的话，在第一排里横着拖也会滚走）；越贴边滚得越快
  const edge = 36;
  if (d.y < edge && d.y < d.y0 - 10) scrollBy(0, -Math.ceil(14 * (1 - d.y / edge)));
  else if (d.y > innerHeight - edge && d.y > d.y0 + 10) scrollBy(0, Math.ceil(14 * (1 - (innerHeight - d.y) / edge)));
}
async function end(e) {
  const d = drag; if (!d || e.pointerId !== d.pid) return;
  drag = null; clearTimeout(d.timer);
  if (!d.on) return;
  const r = d.th.getBoundingClientRect();
  ghost.style.transition = 'transform .18s ease';
  ghost.style.transform = `translate(${r.left}px, ${r.top}px)`;
  ghost.getAnimations().forEach(a => a.cancel());
  await sleep(180);
  ghost.style.transition = ''; ghost.hidden = true; ghost.innerHTML = '';
  d.th.classList.remove('hole'); document.body.classList.remove('dragging');
  // 按界面上的顺序重排
  st.pages = [...grid.querySelectorAll('.th')].map(el => el.__p).filter(Boolean);
  renumber();
}
function rects() { const m = new Map(); grid.querySelectorAll('.th').forEach(el => m.set(el, el.getBoundingClientRect())); return m; }
function flip(before) {
  grid.querySelectorAll('.th').forEach(el => {
    const a = before.get(el); if (!a) return;
    const b = el.getBoundingClientRect(), dx = a.left - b.left, dy = a.top - b.top;
    if (dx || dy) el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 220, easing: 'ease-out' });
  });
}

// ---------- 选项 ----------
$('levels').addEventListener('click', e => {
  const b = e.target.closest('.chip'); if (!b) return;
  $('levels').querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c === b));
  st.level = b.dataset.l;
  $('targetBox').hidden = st.level !== 'target';
  if (st.level !== 'none') warm();
  meta();
});
$('targets').addEventListener('click', e => {
  const b = e.target.closest('.chip'); if (!b) return;
  $('targets').querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c === b));
  $('customBox').hidden = b.dataset.t !== 'custom';
  if (b.dataset.t !== 'custom') st.target = +b.dataset.t; else readCustom();
});
function readCustom() { const v = parseFloat($('customVal').value); st.target = v > 0 ? Math.round(v * +$('customUnit').value) : 0; }
$('customVal').addEventListener('input', readCustom); $('customUnit').addEventListener('change', readCustom);
const targetText = n => n >= 1e6 ? `${+(n / 1e6).toFixed(2)}MB` : `${Math.round(n / 1e3)}KB`;

// ---------- 合并 / 压缩 ----------
$('go').addEventListener('click', run);
async function run() {
  if (st.busy || !st.pages.length) return;
  const fs = usedFiles();
  if (window.Member?.enabled && fs.length > FREE_FILES && !(await Member.active())) {
    const r = await Member.gate({ title: `一次合并 ${fs.length} 个文件`, text: `免费版一次最多合并 ${FREE_FILES} 个文件（压缩、删页、转方向不限次数）；开通工具箱会员可以一次合并更多。` });
    if (r !== 'member') return;
  }
  if (st.level === 'target' && !(st.target >= 20000)) { setStatus('请填一个大小（至少 20KB）', 'err'); return; }
  st.busy = true; $('go').disabled = true; document.body.classList.add('busy');
  const t0 = performance.now();
  const T = window.__pdf.timing = { t0 };
  try {
    // 1. 有密码 / 禁止编辑的 PDF 先解密（pdf-lib 拷不了加密的页）
    for (const f of fs) {
      if (f.kind !== 'pdf' || f.checked) continue;
      if (await core.isEncrypted(f.bytes)) {
        setStatus(`正在解除「${base(f.name)}」的密码…`); setBar(0.05);
        const r = await core.decrypt(f.bytes, f.password);
        if (await core.isEncrypted(r.data)) throw new Error(`「${f.name}」有加密保护，解不开`);
        f.plain = r.data;
      }
      f.checked = true;
    }
    // 2. 合并（只有一个 PDF、页没动过：直接用原文件，书签、链接都保留）
    const one = fs.length === 1 && fs[0].kind === 'pdf' && st.pages.length === fs[0].pgs.length && st.pages.every((p, i) => p.idx === i && !p.rot);
    let bytes;
    if (one) bytes = fs[0].plain || fs[0].bytes;
    else {
      setStatus(fs.length > 1 ? '正在合并…' : '正在生成 PDF…'); setBar(0.08);
      bytes = await core.buildPdf(st.pages, (n, N) => setBar(0.08 + 0.12 * n / N));
    }
    T.merged = performance.now() - t0; T.mergedSize = bytes.length;
    const before = fs.reduce((a, f) => a + f.size, 0);
    // 3. 压缩
    let out = bytes, r = null;
    if (st.level !== 'none') {
      setStatus('正在压缩…'); setBar(0.22);
      if (!st.warm) warm();
      const level = st.level === 'target' ? { target: st.target } : st.level;
      r = await core.compress(bytes, level, m => {
        setBar(0.22 + 0.74 * (m.i - 0.5) / m.n);
        if (st.level === 'target' && m.i > 1) setStatus(`正在压缩…第 ${m.i} 次尝试（找放得下的最清晰的一档）`);
      });
      out = r.data;
      T.compress = r.ms; T.tries = r.tries;
    }
    T.total = performance.now() - t0;
    setBar(1);
    await showResult({ out, before, inSize: bytes.length, r, merged: fs.length > 1 });
    setStatus('');
  } catch (err) {
    console.error(err);
    setStatus((/memory|内存|allocation/i.test(err.message) ? '手机内存不够：少放几页，或者分两次做。' : '没做成：') + err.message, 'err');
  } finally {
    st.busy = false; $('go').disabled = false; setBar(null); document.body.classList.remove('busy');
  }
}

async function showResult({ out, before, inSize, r, merged }) {
  const blob = new Blob([out], { type: 'application/pdf' });
  if (st.url) URL.revokeObjectURL(st.url);
  st.url = URL.createObjectURL(blob); st.out = out;
  const fs = usedFiles(), name = base(fs[0].name) + (merged ? '_合并' : '') + (st.level !== 'none' ? '_压缩' : '') + '.pdf';
  const a = $('dlPdf'); a.href = st.url; a.download = name;
  const comp = st.level !== 'none';
  $('outTitle').textContent = merged ? (comp ? '✓ 合并、压缩好了' : '✓ 合并好了') : comp ? '✓ 压缩好了' : '✓ 生成好了';
  let tag = '';
  if (st.level === 'target') tag = r.metTarget ? `<span class="ok">≤ ${targetText(st.target)} ✓</span>` : `<span class="no">最小只能到这么大</span>`;
  $('outSizes').innerHTML = comp ? `<s>${core.fmtSize(before)}</s><span class="arr">→</span><b>${core.fmtSize(out.length)}</b>${tag}` : `<b>${core.fmtSize(out.length)}</b>`;
  const notes = [`${name}`, `${st.pages.length} 页`];
  if (r?.untouched) notes.push('本来就比目标小，没再压');
  else if (comp && r && out.length >= inSize) notes.push('原文件已经很精简，压不下去了');
  if (st.level === 'target' && r && !r.metTarget) notes.push(`已经是最低画质。可以删掉几页，或者分成两个文件`);
  $('outMeta').textContent = notes.join(' · ');
  // 预览：打开刚生成的 PDF（不是页面截图），看到的就是对方收到的。先画好再弹出面板
  const box = $('outPrevBox'); box.innerHTML = '';
  const cssW = Math.min(480, innerWidth) - 28, n = Math.min(st.pages.length, 6);
  for (let i = 1; i <= n; i++) {
    const cv = document.createElement('canvas'); box.appendChild(cv);
    await core.previewPage(out, i, cv, cssW, Math.min(DPR, 2)).catch(console.error);
  }
  // 录视频用（?hold）：算好了先不弹出，等分镜在台词处调用 window.releaseResult()
  if (HOLD) await new Promise(r => { window.releaseResult = r; window.__pdf.held = true; });
  $('outSheet').hidden = false; document.body.classList.add('lock'); box.scrollTop = 0;
  window.__pdf.result = { size: out.length, before, pages: st.pages.length, metTarget: r?.metTarget ?? null, rung: r?.rung, tries: r?.tries, name };
}
$('outClose').addEventListener('click', () => { $('outSheet').hidden = true; document.body.classList.remove('lock'); });

// 代做入口：site/config.js 里配置了才显示；service.tools.pdf 可以单独设置这一页的价格和说明
const svc = window.SITE_CONFIG && window.SITE_CONFIG.service;
if (svc) {
  const s = Object.assign({}, svc, svc.tools && svc.tools.pdf);
  $('service').innerHTML = `<h2>找我代做 <b>${esc(s.price)}</b></h2><p>${esc(s.text)}</p><p class="contact">${esc(s.contact)}</p>${s.qr ? `<img src="../${esc(s.qr)}" alt="联系方式二维码">` : ''}`;
  $('service').hidden = false;
}

// 给测试脚本 / 录视频用：按住第 a 页拖到第 b 页的位置（发真实的 pointer 事件，走和用户一样的代码）
async function demoDrag(a, b, ms = 900) {
  await Promise.all(grid.getAnimations({ subtree: true }).map(x => x.finished.catch(() => {})));   // 删页、排序的动画放完再量位置
  const els = [...grid.querySelectorAll('.th')];
  const ra = els[a].getBoundingClientRect(), rb = els[b].getBoundingClientRect();
  const x0 = ra.left + ra.width / 2, y0 = ra.top + ra.height * 0.45, x1 = rb.left + rb.width / 2, y1 = rb.top + rb.height * 0.45;
  const ev = (type, x, y) => {
    const t = type === 'pointerdown' ? document.elementFromPoint(x, y) : window;
    t.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'mouse', isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: y }));
  };
  ev('pointerdown', x0, y0);
  await new Promise(r => requestAnimationFrame(r));
  const t0 = performance.now();
  for (;;) {
    const k = Math.min(1, (performance.now() - t0) / ms), e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
    ev('pointermove', x0 + (x1 - x0) * e, y0 + (y1 - y0) * e - Math.sin(Math.PI * k) * 10);
    if (k >= 1) break;
    await new Promise(r => requestAnimationFrame(r));
  }
  await sleep(160);
  ev('pointerup', x1, y1);
  await sleep(220);
}
window.__pdf = { st, addFiles, run, demoDrag, removePage, timing: null, result: null };
