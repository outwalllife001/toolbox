import * as core from './core.js';

const $ = id => document.getElementById(id);
const Q = new URLSearchParams(location.search);
// ?reveal=hold 只给录视频用（days/*/scenes.mjs）：算完后分隔线先不滑，等分镜调用 window.reveal()，和配音对齐
// ?preload 打开页面就下载模型（平时：以前下过才在打开时加载，没下过的等选了照片再下，省流量）
const HOLD = Q.get('reveal') === 'hold';
const BE_LABEL = { webgpu: 'GPU 加速', wasm: 'CPU 模式' };
const FREE_BATCH = 3;      // 启用会员后，免费版一次最多放几张
const st = { items: [], cur: -1, ready: false, be: '', busy: false, loading: false, loadP: 0, pending: false, mark: true, x: 1, sw: 0, sh: 0, bx: 0, by: 0, allBlobs: null };
const cmp = $('cmp'), stage = $('stage'), after = $('after');
cmp.classList.add('empty');

const cur = () => st.items[st.cur] || null;
const base = it => it.hd || it.img;                       // 亮度从哪张图取：变高清后用放大过的
const baseSize = it => (it.hd ? { w: it.hd.width, h: it.hd.height } : { w: it.w0, h: it.h0 });
function setStatus(text, cls = '') { const s = $('status'); s.textContent = text; s.className = 'status ' + cls; }
function setStatus2(text, cls = '') { const s = $('status2'); s.textContent = text; s.className = 'status ' + cls; }
const sec = ms => (ms / 1000).toFixed(ms < 10000 ? 1 : 0);
const raf2 = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 30)));
const pendingItems = () => st.items.filter(it => !it.ab);
function refreshGo() {
  const n = pendingItems().length;
  $('go').disabled = !st.items.length || st.busy;
  $('go').textContent = n > 1 ? `全部上色（${n} 张）` : '一键上色';
}

// ---------- 模型 ----------
const want = Q.get('backend') || await core.pickBackend();
if (+Q.get('side')) core.setSide(+Q.get('side'));      // 测试用：?side=256
function ensureModel() {
  if (st.loading || st.ready) return;
  st.loading = true;
  core.load(want, p => { st.loadP = p; if (p < 1) modelStatus(); })
    .then(be => {
      st.be = be; st.ready = true; st.loading = false;
      // 手机上没有 GPU 加速：输入从 384 降到 256，内存少约 250MB、快一倍（颜色稍微粗一点）
      if (be === 'wasm' && !+Q.get('side') && matchMedia('(pointer: coarse)').matches) core.setSide(256);
      if (st.pending) { st.pending = false; run(); }
      else setStatus(st.items.length ? '模型准备好了，点上面的按钮开始' : '先上传一张照片');
    })
    .catch(e => { st.loading = false; st.pending = false; barStop(); setStatus('模型加载失败：' + e.message + '，请检查网络后再点一次'); refreshGo(); });
}
function modelStatus() {
  const pct = Math.round(st.loadP * 100);
  setStatus(st.pending ? `正在下载 AI 模型 ${pct}%（约 57MB，只下一次），下完自动开始上色` : `正在下载 AI 模型 ${pct}%（约 57MB，只下一次）`);
  if (st.pending) { $('bar').hidden = false; $('barIn').style.width = pct + '%'; }
}
if (Q.has('preload') || await core.isCached()) { setStatus('正在准备 AI 模型…'); ensureModel(); }

// ---------- 上传 ----------
$('file').addEventListener('change', async e => {
  const files = [...e.target.files];
  e.target.value = '';
  if (files.length) await addFiles(files.map(f => ({ url: URL.createObjectURL(f), name: f.name.replace(/\.\w+$/, '') })));
});
$('sample').addEventListener('click', () => addFiles([{ url: new URL('sample.jpg', import.meta.url).href, name: '示例老照片' }]));
$('more').addEventListener('click', () => $('file').click());

async function addFiles(list) {
  if (st.busy) return;
  // 会员：一次放很多张（整本相册）。免费版最多 FREE_BATCH 张，一张张来不限次数
  if (window.Member?.enabled && st.items.length + list.length > FREE_BATCH && !(await Member.active())) {
    const r = await Member.gate({ title: '整本相册一起上色', text: `免费版一次最多放 ${FREE_BATCH} 张（上完保存、再换下一批，不限次数）；开通工具箱会员可以一次放更多张。` });
    if (r !== 'member') list = list.slice(0, Math.max(0, FREE_BATCH - st.items.length));
    if (!list.length) return;
  }
  let first = -1, bad = 0;
  for (const f of list) {
    const im = new Image(); im.src = f.url;
    try { await im.decode(); } catch { bad++; continue; }
    st.items.push({ name: f.name, url: f.url, img: im, w0: im.naturalWidth, h0: im.naturalHeight, an: null, fade: false, sat: 1, ab: null, ms: 0, hd: null });
    if (first < 0) first = st.items.length - 1;
  }
  if (first < 0) { setStatus('这张图片打不开，换一张试试'); return; }
  st.allBlobs = null;
  select(first);
  if (bad) setStatus(`有 ${bad} 张图片打不开，已跳过`);
  if (!st.ready) { ensureModel(); if (!bad) modelStatus(); }
}

function select(i) {
  st.cur = i;
  const it = cur();
  $('before').src = it.url;
  cmp.classList.remove('empty'); $('dropEmpty').hidden = true; stage.hidden = false;
  layout();
  if (it.ab) { paint(); after.classList.add('show'); showDone(true); $('split').hidden = false; showLabels(true); setSplit(0.5); syncOpts(); }
  else {
    after.classList.remove('show'); showDone(false); setSplit(1);
    if (st.ready && !st.busy) setStatus(st.be === 'wasm' && !Q.get('backend') ? '这台设备不支持 GPU 加速，用 CPU 算会慢一些' : '');
  }
  renderThumbs(); refreshGo();
}
function syncOpts() {
  const it = cur();
  $('sat').value = it.sat; $('fade').checked = it.fade; $('mark').checked = st.mark;
  $('hd').textContent = it.hd ? '↩ 还原清晰度' : '✨ 顺手变高清';
  const { w, h } = baseSize(it), o = core.outSize(w, h);
  $('meta').textContent = `${o.W}×${o.H} · 上色用时 ${sec(it.ms)} 秒 · ${BE_LABEL[st.be]}${st.be === 'wasm' && core.threads() > 1 ? ` ${core.threads()} 线程` : ''}${it.hd ? ' · 已变高清' : ''}`;
  const n = st.items.filter(x => x.ab).length;
  $('saveAll').hidden = n < 2; if (!st.allBlobs) $('saveAll').textContent = `全部保存（${n} 张）`;
  setStatus2(it.color < core.MIN_COLOR ? '这张 AI 没怎么猜出颜色（太糊、太暗或颗粒太重的照片会这样），可以把「色彩」往右拖一点试试' : '');
}

// 多张时的缩略图条：点一下切换，× 删除
function renderThumbs() {
  const box = $('thumbs');
  box.hidden = st.items.length < 2;
  box.innerHTML = '';
  st.items.forEach((it, i) => {
    const f = document.createElement('figure');
    if (i === st.cur) f.className = 'on';
    if (it.ab) { const c = core.canvas(1, 1); core.render(c, it.img, 116, Math.max(1, Math.round(116 * it.h0 / it.w0)), { ab: it.ab, lv: it.fade ? it.an : null, sat: it.sat }); f.appendChild(c); f.insertAdjacentHTML('beforeend', '<b>✓</b>'); }
    else { const im = document.createElement('img'); im.src = it.url; im.alt = it.name; f.appendChild(im); }
    const x = document.createElement('button'); x.textContent = '×'; x.setAttribute('aria-label', '删除这张');
    x.onclick = e => { e.stopPropagation(); if (st.busy) return; removeItem(i); };
    f.appendChild(x);
    f.onclick = () => { if (!st.busy && i !== st.cur) select(i); };
    box.appendChild(f);
  });
  const add = document.createElement('button'); add.className = 'add'; add.textContent = '＋'; add.setAttribute('aria-label', '再加几张'); add.onclick = () => $('file').click();
  box.appendChild(add);
}
function removeItem(i) {
  const [it] = st.items.splice(i, 1);
  if (it.url.startsWith('blob:')) URL.revokeObjectURL(it.url);
  st.allBlobs = null;
  select(Math.max(0, Math.min(st.cur > i ? st.cur - 1 : st.cur, st.items.length - 1)));
}

// ---------- 进度：模型只有一步，拿不到真实进度，按预估时间走（到不了头，算完直接满）----------
let barTimer = 0;
function barStart(expectMs, bar = 'bar') {
  $(bar).hidden = false; $(bar + 'In').style.width = '0%';
  const t0 = performance.now(); clearInterval(barTimer);
  barTimer = setInterval(() => { $(bar + 'In').style.width = (95 * (1 - Math.exp(-1.6 * (performance.now() - t0) / expectMs))).toFixed(1) + '%'; }, 100);
}
function barStop() { clearInterval(barTimer); $('bar').hidden = true; $('bar2').hidden = true; }
// 预估：Mac 上 GPU 约 0.2 秒、CPU 单线程约 2.2 秒；手机按再慢 3 倍估
const expectMs = () => (st.be === 'webgpu' ? 700 : 6500 / Math.pow(core.threads(), 0.85));

// ---------- 上色 ----------
$('go').addEventListener('click', run);
async function colorOne(it) {
  it.an ||= core.analyze(it.img);
  if (it.ab === null && it.an.faded) it.fade = true;      // 第一次：褪色明显的自动修复
  const r = await core.colorize(it.an.L, it.fade ? it.an : null);
  it.ab = r.ab; it.ms = r.ms; it.color = r.color; it.speckle = r.speckle; it.tries = r.tries;
}
async function run() {
  if (!st.items.length || st.busy) return;
  if (!st.ready) { st.pending = true; ensureModel(); modelStatus(); return; }
  const todo = pendingItems();
  if (!todo.length) return;
  // 当前这张排最前面
  const me = cur(); if (todo.includes(me)) { todo.splice(todo.indexOf(me), 1); todo.unshift(me); }
  st.busy = true; refreshGo();
  try {
    for (let k = 0; k < todo.length; k++) {
      const it = todo[k];
      if (cur() !== it) select(st.items.indexOf(it));
      setStatus(`AI 正在上色${todo.length > 1 ? ` ${k + 1}/${todo.length}` : ''}${st.be === 'wasm' ? '（CPU 模式，慢一点）' : ''}…`);
      barStart(expectMs());
      await raf2();
      await colorOne(it);
      barStop();
      paint(); after.classList.add('show');
      if (k < todo.length - 1) { setSplit(0.5); await new Promise(r => setTimeout(r, 500)); }
    }
    st.allBlobs = null;
    showDone(true); syncOpts(); renderThumbs();
    // 分隔线从右滑到中间：左边黑白、右边彩色
    const reveal = () => { $('split').hidden = false; showLabels(true); animSplit(1, 0.5, 900); };
    if (HOLD) { setSplit(1); window.reveal = reveal; } else reveal();
  } catch (e) {
    console.error(e);
    setStatus('处理失败：' + (e.message || e) + '。可以关掉其他页面、刷新后再试');
  } finally { barStop(); st.busy = false; refreshGo(); }
}

function paint() {
  const it = cur(); if (!it || !it.ab) return;
  const { w, h } = baseSize(it), { W, H } = core.previewSize(w, h);
  core.render(after, base(it), W, H, { ab: it.ab, lv: it.fade ? it.an : null, sat: it.sat, label: st.mark });
}
let paintPending = false;
function paintSoon() {
  if (paintPending) return;
  paintPending = true;
  requestAnimationFrame(() => { paintPending = false; paint(); });
}
$('sat').addEventListener('input', e => { const it = cur(); if (!it) return; it.sat = +e.target.value; st.allBlobs = null; paintSoon(); });
$('sat').addEventListener('change', () => { renderThumbs(); syncAll(); });
$('mark').addEventListener('change', e => { st.mark = e.target.checked; st.allBlobs = null; paint(); syncAll(); });
function syncAll() { const n = st.items.filter(x => x.ab).length; $('saveAll').textContent = `全部保存（${n} 张）`; }
// 修复褪色：亮度拉开后模型看到的图也变了，要重新上色
$('fade').addEventListener('change', async e => {
  const it = cur(); if (!it || st.busy) { e.target.checked = !e.target.checked; return; }
  it.fade = e.target.checked;
  st.busy = true; $('fade').disabled = true;
  try {
    setStatus2('AI 正在重新上色…'); barStart(expectMs(), 'bar2');
    await raf2();
    await colorOne(it);
    st.allBlobs = null;
    paint(); renderThumbs(); syncOpts();
  } catch (err) { console.error(err); it.fade = !it.fade; e.target.checked = it.fade; setStatus2('没做成：' + (err.message || err)); }
  finally { barStop(); st.busy = false; $('fade').disabled = false; }
});

function showDone(on) {
  $('done').hidden = !on; $('setup').hidden = on;
  if (!on) { $('split').hidden = true; showLabels(false); }
}
function showLabels(on) { $('lblL').hidden = $('lblR').hidden = !on; }

// ---------- 顺手变高清：复用「模糊照片变高清」那一页的 Real-ESRGAN（先放大原照片，再合上颜色）----------
let up = null;
$('hd').addEventListener('click', async () => {
  const it = cur(); if (!it || st.busy) return;
  if (it.hd) { it.hd = null; st.allBlobs = null; paint(); syncOpts(); return; }
  st.busy = true; $('hd').disabled = true;
  try {
    setStatus2('正在准备高清模型（约 2MB）…');
    up ||= await import('../upscale/core.js');
    let be = 'wasm';
    if (st.be === 'webgpu') { try { be = (await navigator.gpu.requestAdapter()).features.has('shader-f16') ? 'webgpu16' : 'webgpu'; } catch {} }
    be = await up.load(be);
    const p = up.plan(it.w0, it.h0, 4, be), { src } = up.toWorkCanvas(it.img, p), big = core.canvas(p.w * 4, p.h * 4);
    up.prefill(big, src);
    $('bar2').hidden = false; $('bar2In').style.width = '0%';
    const label = be === 'wasm' ? '正在变高清（CPU 模式，比较慢）' : '正在变高清';
    setStatus2(label + '…');
    await raf2();
    await up.upscale4(src, big, t => {
      $('bar2In').style.width = (t.n / t.total * 100).toFixed(1) + '%';
      const left = t.n < t.total && t.n >= 1 ? t.ms / t.n * (t.total - t.n) : 0;
      setStatus2(`${label}… ${t.n}/${t.total}${left > 3000 ? `，大约还要 ${Math.ceil(left / 1000)} 秒` : ''}`);
    });
    it.hd = big; st.allBlobs = null;
    paint(); syncOpts();
    setStatus2(`✓ 已变高清：${it.w0}×${it.h0} → ${big.width}×${big.height}${p.shrunk ? '（原图较大，先缩小再放大，主要是去噪、变锐）' : ''}`, 'done');
  } catch (e) { console.error(e); setStatus2('变高清没做成：' + (e.message || e) + '。上色结果不受影响'); }
  finally { $('bar2').hidden = true; st.busy = false; $('hd').disabled = false; }
});

// ---------- 保存 ----------
function saveBlob(blob, name) {
  const a = document.createElement('a'), url = URL.createObjectURL(blob);
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
async function fullJpeg(it) {
  const { w, h } = baseSize(it), { W, H } = core.outSize(w, h), c = core.canvas(1, 1);
  core.render(c, base(it), W, H, { ab: it.ab, lv: it.fade ? it.an : null, sat: it.sat, label: st.mark });
  const blob = await core.toJpeg(c);
  c.width = c.height = 1;      // 尽快还掉大画布的内存（iPhone 上画布总量有限）
  return blob;
}
const fname = it => `${it.name || '老照片'}_上色.jpg`;
$('save').addEventListener('click', async e => {
  const it = cur(), btn = e.currentTarget; if (!it || !it.ab) return;
  btn.disabled = true; const old = btn.textContent; btn.textContent = '正在保存…';
  await raf2();
  try { const blob = await fullJpeg(it); window.__lastSave = { size: blob.size, name: fname(it) }; saveBlob(blob, fname(it)); }
  catch (err) { console.error(err); alert('保存失败：' + (err.message || err)); }
  finally { btn.disabled = false; btn.textContent = old; }
});
// 全部保存分两步：先把每张按原尺寸做好（可能要几秒），再点一次才真正保存 —— 手机上「分享 / 存到相册」必须紧跟着一次点击
$('saveAll').addEventListener('click', async e => {
  const btn = e.currentTarget, list = st.items.filter(x => x.ab);
  if (st.allBlobs) {
    const files = st.allBlobs.map((b, i) => new File([b], fname(list[i]), { type: 'image/jpeg' }));
    // 手机上用系统的分享面板（能一次存进相册）；电脑上直接逐个下载
    if (matchMedia('(pointer: coarse)').matches && navigator.canShare && navigator.canShare({ files })) {
      try { await navigator.share({ files }); return; } catch (err) { if (err.name === 'AbortError') return; }
    }
    for (let i = 0; i < files.length; i++) { saveBlob(st.allBlobs[i], files[i].name); await new Promise(r => setTimeout(r, 400)); }
    return;
  }
  btn.disabled = true;
  try {
    const blobs = [];
    for (let i = 0; i < list.length; i++) { btn.textContent = `正在准备 ${i + 1}/${list.length}…`; await raf2(); blobs.push(await fullJpeg(list[i])); }
    st.allBlobs = blobs;
    btn.textContent = `准备好了，再点一次保存 ${blobs.length} 张`;
  } catch (err) { console.error(err); alert('保存失败：' + (err.message || err)); btn.textContent = `全部保存（${list.length} 张）`; }
  finally { btn.disabled = false; }
});

// ---------- 对比视图：stage 按图片比例放进 cmp；st.x 是分隔线在 cmp 里的位置（0–1），线右边是上色后 ----------
function layout() {
  const it = cur(); if (!it) return;
  const cw = cmp.clientWidth, ch = cmp.clientHeight, a = it.w0 / it.h0;
  st.sw = Math.min(cw, ch * a); st.sh = st.sw / a;
  st.bx = (cw - st.sw) / 2; st.by = (ch - st.sh) / 2;
  stage.style.cssText = `width:${st.sw}px;height:${st.sh}px;transform:translate(${st.bx}px,${st.by}px)`;
  apply();
}
function apply() {
  const cw = cmp.clientWidth, X = st.x * cw;
  $('split').style.left = X + 'px';
  after.style.clipPath = `inset(0 0 0 ${Math.max(0, Math.min(st.sw, X - st.bx)).toFixed(2)}px)`;
  const L = st.bx, R = cw - (st.bx + st.sw);
  $('lblL').style.left = Math.max(8, L + 8) + 'px'; $('lblR').style.right = Math.max(8, R + 8) + 'px';
  $('lblL').style.top = $('lblR').style.top = Math.max(8, st.by + 8) + 'px';
}
// 分隔线留在图片范围内（竖照片两边有空白）
function setSplit(x) {
  const cw = cmp.clientWidth || 1, lo = st.bx / cw, hi = (st.bx + st.sw) / cw;
  st.x = Math.max(lo, Math.min(hi, x)); apply();
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
addEventListener('resize', layout);
let drag = null;
cmp.addEventListener('pointerdown', e => {
  const it = cur(); if (!it || !it.ab || $('split').hidden) return;
  e.preventDefault(); try { cmp.setPointerCapture(e.pointerId); } catch {}
  drag = { r: cmp.getBoundingClientRect() };
  setSplit((e.clientX - drag.r.left) / drag.r.width);
});
cmp.addEventListener('pointermove', e => { if (drag) setSplit((e.clientX - drag.r.left) / drag.r.width); });
for (const ev of ['pointerup', 'pointercancel']) cmp.addEventListener(ev, () => { drag = null; });

// 录视频 / 测试用
window.__old = { st, split: (x, ms = 0) => (ms ? animSplit(st.x, x, ms) : setSplit(x)), core };

// 代做入口：site/config.js 里配置了才显示；service.tools.oldphoto 可以单独设置这一页的价格和说明
const svc = window.SITE_CONFIG && window.SITE_CONFIG.service;
if (svc) {
  const s = Object.assign({}, svc, svc.tools && svc.tools.oldphoto);
  const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  $('service').innerHTML = `<h2>找我代做 <b>${esc(s.price)}</b></h2><p>${esc(s.text)}</p><p class="contact">${esc(s.contact)}</p>${s.qr ? `<img src="../${esc(s.qr)}" alt="联系方式二维码">` : ''}`;
  $('service').hidden = false;
}
