import * as core from './core.js';

const $ = id => document.getElementById(id);
const st = { file: null, info: null, base: '', tab: 'zip', key: 'std', gDur: 3, gW: 320, busy: false, out: null, url: null, ms: 0 };
const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function setStatus(text, cls = '') { const s = $('status'); s.textContent = text; s.className = 'status ' + cls; }
function bar(f) { $('bar').hidden = f == null; if (f != null) $('barIn').style.width = (Math.max(0, Math.min(1, f)) * 100).toFixed(1) + '%'; }

// ---------- 打开视频 ----------
$('file').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f || st.busy) return;
  if (typeof VideoDecoder === 'undefined') {
    showLoaded(false);
    return setStatus('这个浏览器不支持在网页里处理视频（没有 WebCodecs）。请用手机自带浏览器、Safari 或电脑 Chrome 打开；在微信里点右上角「…」→「在浏览器打开」', 'err');
  }
  setStatus('正在读取视频…'); bar(null);
  try {
    const info = await core.probe(f);
    Object.assign(st, { file: f, info, base: f.name.replace(/\.\w+$/, '') || '视频', out: null });
    if (st.url) URL.revokeObjectURL(st.url);
    st.url = URL.createObjectURL(f);
    $('prev').removeAttribute('poster');
    $('prev').src = st.url + '#t=0.1';
    await Promise.race([setPoster(f), new Promise(r => setTimeout(r, 1500))]);   // 先有封面帧再显示，不闪黑框
    showLoaded(true);
    $('meta').innerHTML = `${esc(f.name)} · <b>${core.fmtMB(f.size)}</b> · ${core.fmtDur(info.duration)} · ${info.w}×${info.h} · ${Math.round(info.fps)} 帧`;
    $('result').hidden = true;
    renderOpts(); renderGif(); renderAud();
    setStatus(info.canDecode ? '' : '⚠️ 这个浏览器可能解不开这个视频的编码（常见于 iPhone 拍的 HEVC 视频），压缩失败的话换手机自带浏览器或电脑 Chrome', info.canDecode ? '' : 'err');
  } catch (err) {
    console.error(err);
    setStatus('这个文件打不开：' + err.message, 'err');
  }
});
// 封面帧用 Mediabunny 解出来：<video> 自己解不开的编码（比如部分安卓上的 iPhone HEVC 视频）也能先看到画面
let posterUrl = null;
async function setPoster(f) {
  try {
    const cv = await core.frameAt(f, Math.min(0.5, st.info.duration / 2), 540);
    if (!cv || st.file !== f) return;
    const blob = await new Promise(r => cv.toBlob ? cv.toBlob(r, 'image/jpeg', 0.85) : r(null));
    if (!blob) return;
    if (posterUrl) URL.revokeObjectURL(posterUrl);
    $('prev').poster = posterUrl = URL.createObjectURL(blob);
  } catch (err) { console.warn('封面帧取不到', err); }
}
function showLoaded(on) { $('dropEmpty').hidden = on; $('loaded').hidden = !on; }

// ---------- 切换功能 ----------
$('tabs').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b || st.busy) return;
  st.tab = b.dataset.t;
  for (const x of $('tabs').children) x.classList.toggle('on', x === b);
  $('pZip').hidden = st.tab !== 'zip'; $('pGif').hidden = st.tab !== 'gif'; $('pAud').hidden = st.tab !== 'aud';
  setStatus('');
});

// ---------- 压缩 ----------
const targetMB = () => { const v = parseFloat($('targetMB').value); return v > 0 ? Math.max(0.5, v) : 0; };
function curPlan() { return core.plan(st.info, st.key, targetMB()); }
function renderOpts() {
  const info = st.info, keys = ['hd', 'std', 'small'];
  // 「指定大小」默认填原视频的 1/5、取整
  if (!$('targetMB').dataset.touched) $('targetMB').value = Math.max(1, Math.round(info.size / core.MB / 5));
  $('opts').innerHTML = keys.map(k => {
    const p = core.plan(info, k), short = Math.min(p.w, p.h);
    return `<button class="opt${st.key === k ? ' on' : ''}" data-k="${k}">${k === 'std' ? '<i class="rec">推荐</i>' : ''}<b>${core.PRESETS[k].name}</b><span>${core.fmtMB(p.est)}</span><small>${short}P · ${k === 'hd' ? '细节最多' : k === 'std' ? '手机上看几乎一样' : '发得最快'}</small></button>`;
  }).join('') + `<button class="opt${st.key === 'target' ? ' on' : ''}" data-k="target"><b>指定大小</b><span>${st.key === 'target' && targetMB() ? targetMB() + 'MB' : '自己填'}</span><small>上传有大小限制时用</small></button>`;
  $('targetRow').hidden = st.key !== 'target';
  $('go').disabled = st.key === 'target' && !targetMB();
  if ($('go').disabled) { $('planTxt').textContent = '填一个大小（单位 MB），比如报名系统要求的上限'; $('planTxt').className = 'plan'; return; }
  const p = curPlan();
  const pct = Math.round(p.est / info.size * 100);
  const notes = [`输出 MP4 · ${p.w}×${p.h}`, `${Math.round(p.fps)} 帧${info.fps > 31 ? `（原来 ${Math.round(info.fps)} 帧）` : ''}`, `预计 ${core.fmtMB(p.est)}，是原来的 ${pct}%`];
  $('planTxt').textContent = notes.join(' · ');
  $('planTxt').className = 'plan';
  if (p.tooLow) { $('planTxt').textContent += '。⚠️ 目标太小，画面会比较糊'; $('planTxt').className = 'plan warn'; }
  else if (pct >= 85) { $('planTxt').textContent += '。这个视频本来就压得很小了'; $('planTxt').className = 'plan warn'; }
}
$('opts').addEventListener('click', e => {
  const b = e.target.closest('.opt'); if (!b || st.busy) return;
  st.key = b.dataset.k; renderOpts();
  if (st.key === 'target') $('targetMB').focus();
});
$('targetMB').addEventListener('input', () => { $('targetMB').dataset.touched = 1; renderOpts(); });

let tick = null;
function startBusy(label) {
  st.busy = true; document.body.classList.add('busy');
  for (const b of document.querySelectorAll('.panel .primary')) b.disabled = true;
  const t0 = performance.now(); let f = 0;
  bar(0);
  const show = () => setStatus(`${label} ${Math.round(f * 100)}% · 已用 ${Math.round((performance.now() - t0) / 1000)} 秒`);
  show();
  // 进度只用进度条和文字（每 0.25 秒刷新一次），不放转圈动画：转圈会和视频编码抢资源
  tick = setInterval(show, 250);
  return { t0, set: x => { f = x; bar(x); } };
}
function endBusy() {
  clearInterval(tick); st.busy = false; document.body.classList.remove('busy');
  for (const b of document.querySelectorAll('.panel .primary')) b.disabled = false;
  if (st.info) { renderOpts(); renderAud(); }   // 「指定大小」没填、视频没声音时按钮仍然是灰的
}

$('go').addEventListener('click', async () => {
  if (!st.file || st.busy || (st.key === 'target' && !targetMB())) return;
  const p = curPlan();
  if (!await core.canCompress(p)) return setStatus('这个浏览器不支持导出 MP4（H.264）。换手机自带浏览器、Safari 或电脑 Chrome 试试', 'err');
  const b = startBusy('正在压缩');
  try {
    const blob = await core.compress(st.file, p, (x, pass) => b.set(x), st.key === 'target' ? targetMB() : 0);
    st.ms = performance.now() - b.t0;
    endBusy(); bar(1);
    setStatus(`压缩好了 · 用时 ${(st.ms / 1000).toFixed(1)} 秒`, 'done');
    await showVideo(blob);
  } catch (err) {
    console.error(err); endBusy(); bar(null);
    setStatus('压缩失败：' + err.message, 'err');
  }
});

async function showVideo(blob) {
  const info = st.info, save = 1 - blob.size / info.size;
  st.out = blob;
  resetResult();
  $('sizes').innerHTML = `<span class="from">${core.fmtMB(info.size)}</span><svg viewBox="0 0 26 20"><path d="M2 10h20M15 3l7 7-7 7"/></svg><span class="to">${core.fmtMB(blob.size)}</span>`;
  $('sizes').insertAdjacentHTML('afterend', `<p class="saved" id="savedTxt">${save > 0 ? `小了 <b>${Math.round(save * 100)}%</b>` : '没有变小（原视频已经压得很小了）'}</p>`);
  setDl(blob, `${st.base}_压缩.mp4`, '保存视频');
  $('result').hidden = false;
  // 对比同一帧：取 40% 处（开头常常是黑场或者还没对好焦）
  try {
    const t = info.duration * 0.4;
    const [a, b] = await Promise.all([core.frameAt(st.file, t), core.frameAt(blob, t)]);
    if (a && b) {
      for (const [cv, src] of [[$('cA'), a], [$('cB'), b]]) { cv.width = a.width; cv.height = a.height; cv.getContext('2d').drawImage(src, 0, 0, a.width, a.height); }
      const cmp = $('cmp');
      cmp.style.aspectRatio = `${a.width} / ${a.height}`;
      cmp.style.width = `min(100%, calc(46vh * ${(a.width / a.height).toFixed(4)}))`;
      setSplit(0.5);
      cmp.hidden = false; $('cmpTip').hidden = false;
    }
  } catch (err) { console.warn('对比帧取不到', err); }
  $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function resetResult() {
  $('savedTxt')?.remove();
  $('sizes').innerHTML = ''; $('cmp').hidden = true; $('cmpTip').hidden = true;
  $('gifOut').hidden = true; $('audOut').hidden = true; $('audOut').removeAttribute('src');
}
let dlUrl = null;
function setDl(blob, name, label) {
  if (dlUrl) URL.revokeObjectURL(dlUrl);
  dlUrl = URL.createObjectURL(blob);
  $('dl').href = dlUrl; $('dl').download = name; $('dl').textContent = label;
  return dlUrl;
}

// 对比图：拖动分隔线（左边原视频，右边压缩后）
function setSplit(x) {
  x = Math.max(0, Math.min(1, x));
  $('cmpA').style.clipPath = `inset(0 ${((1 - x) * 100).toFixed(2)}% 0 0)`;
  $('cmpLine').style.left = (x * 100).toFixed(2) + '%';
}
let dragging = false;
$('cmp').addEventListener('pointerdown', e => { dragging = true; try { $('cmp').setPointerCapture(e.pointerId); } catch {} move(e); });
$('cmp').addEventListener('pointermove', e => { if (dragging) move(e); });
for (const ev of ['pointerup', 'pointercancel']) $('cmp').addEventListener(ev, () => { dragging = false; });
function move(e) { const r = $('cmp').getBoundingClientRect(); setSplit((e.clientX - r.left) / r.width); }

// ---------- 转 GIF ----------
function renderGif() {
  const d = st.info.duration, max = Math.max(0, d - Math.min(st.gDur, d));
  $('gStart').max = max.toFixed(1);
  if (+$('gStart').value > max) $('gStart').value = max.toFixed(1);
  const s = +$('gStart').value, len = Math.min(st.gDur, d);
  $('gStartTxt').textContent = `${s.toFixed(1)} 秒（到 ${(s + len).toFixed(1)} 秒）`;
  const w = Math.min(st.gW, st.info.w), h = Math.round(w * st.info.h / st.info.w / 2) * 2;
  $('gPlan').textContent = `${w}×${h} · ${len.toFixed(len % 1 ? 1 : 0)} 秒 · 每秒 10 帧 · 循环播放`;
}
$('gStart').addEventListener('input', () => { renderGif(); $('prev').currentTime = +$('gStart').value; });
for (const [id, k] of [['gDur', 'gDur'], ['gW', 'gW']]) $(id).addEventListener('click', e => {
  const b = e.target.closest('.chip'); if (!b || st.busy) return;
  st[k] = +b.dataset.v;
  for (const x of $(id).children) x.classList.toggle('on', x === b);
  renderGif();
});
$('goGif').addEventListener('click', async () => {
  if (!st.file || st.busy) return;
  const b = startBusy('正在生成 GIF');
  try {
    const r = await core.toGif(st.file, { start: +$('gStart').value, dur: Math.min(st.gDur, st.info.duration), width: st.gW, fps: 10 }, b.set);
    st.ms = performance.now() - b.t0;
    endBusy(); bar(1);
    setStatus(`GIF 做好了 · 用时 ${(st.ms / 1000).toFixed(1)} 秒`, 'done');
    resetResult();
    $('sizes').innerHTML = `<span class="to">${core.fmtMB(r.blob.size)}</span>`;
    $('sizes').insertAdjacentHTML('afterend', `<p class="saved" id="savedTxt">GIF · ${r.w}×${r.h} · ${r.frames} 帧</p>`);
    $('gifOut').src = setDl(r.blob, `${st.base}.gif`, '保存 GIF'); $('gifOut').hidden = false;
    $('result').hidden = false;
    $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) { console.error(err); endBusy(); bar(null); setStatus('生成失败：' + err.message, 'err'); }
});

// ---------- 提取声音 ----------
function renderAud() {
  const i = st.info;
  $('aPlan').textContent = !i.acodec ? '这个视频没有声音' : i.acodec === 'aac'
    ? `原声是 AAC${i.abr ? ' ' + core.fmtRate(i.abr) : ''}，直接拷出来存成 M4A，不重新编码、音质不变`
    : `原声是 ${i.acodec.toUpperCase()}，转成 AAC 160kbps 的 M4A（苹果、安卓、电脑都能播）`;
  $('goAud').disabled = !i.acodec;
}
$('goAud').addEventListener('click', async () => {
  if (!st.file || st.busy) return;
  const b = startBusy('正在提取声音');
  try {
    const r = await core.extractAudio(st.file, st.info, b.set);
    st.ms = performance.now() - b.t0;
    endBusy(); bar(1);
    setStatus(`提取好了 · 用时 ${(st.ms / 1000).toFixed(1)} 秒`, 'done');
    resetResult();
    $('sizes').innerHTML = `<span class="to">${core.fmtMB(r.blob.size)}</span>`;
    $('sizes').insertAdjacentHTML('afterend', `<p class="saved" id="savedTxt">M4A · ${core.fmtDur(st.info.duration)}${r.copied ? ' · 原声无损拷贝' : ''}</p>`);
    $('audOut').src = setDl(r.blob, `${st.base}.m4a`, '保存声音'); $('audOut').hidden = false;
    $('result').hidden = false;
    $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) { console.error(err); endBusy(); bar(null); setStatus('提取失败：' + err.message, 'err'); }
});

// 代做入口：site/config.js 里配置了才显示；service.tools['video-compress'] 可以单独设置这一页的价格和说明
const svc = window.SITE_CONFIG && window.SITE_CONFIG.service;
if (svc) {
  const s = Object.assign({}, svc, svc.tools && svc.tools['video-compress']);
  $('service').innerHTML = `<h2>找我代做 <b>${esc(s.price)}</b></h2><p>${esc(s.text)}</p><p class="contact">${esc(s.contact)}</p>${s.qr ? `<img src="../${esc(s.qr)}" alt="联系方式二维码">` : ''}`;
  $('service').hidden = false;
}

// 给测试脚本 / 录视频用
window.__vc = { st, setSplit };
