import { DEFAULTS, THEMES, SIZES, TITLE0, TAG0, wifiPayload, renderCard, drawCard, drawSheet, toBlob, makePdf, sheetOf, printPx, cardMM } from './core.js';

const $ = id => document.getElementById(id);
const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const Q = new URLSearchParams(location.search);
// ?blur：录视频用，把二维码虚化（预览、拼版、导出结果都虚化；下载的文件也是虚化的，别用在正式页面上）
const BLUR = Q.has('blur');
// ?cw=270：预览宽度（像素），录视频用
if (Q.get('cw')) document.documentElement.style.setProperty('--cw', (+Q.get('cw') || 300) + 'px');
const DPR = +Q.get('dpr') || Math.min(3, window.devicePixelRatio || 1);
const KEY = 'toolbox-wifi-state', SAVED = 'toolbox-wifi-saved', FREE_SAVED = 1;
const sizeKeys = Object.keys(SIZES);

const st = { ...DEFAULTS };
try { Object.assign(st, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { }
if (!THEMES.some(t => t.id === st.theme)) st.theme = DEFAULTS.theme;
if (!SIZES[st.size]) st.size = DEFAULTS.size;
if (!['WPA', 'WEP', 'nopass'].includes(st.mode)) st.mode = 'WPA';

function persist() { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch { } }
function toast(t, ms = 2200) { const e = $('toast'); e.textContent = t; e.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { e.hidden = true; }, ms); }
const utf8len = s => new TextEncoder().encode(s).length;

// ---------- 表单 ----------
const inputs = { ssid: $('ssid'), pwd: $('pwd'), title: $('title'), tag: $('tag') };
function syncForm() {
  for (const [k, el] of Object.entries(inputs)) if (el.value !== st[k]) el.value = st[k];
  $('hidden').checked = st.hidden; $('showPwd').checked = st.showPwd;
  for (const b of $('mode').children) b.classList.toggle('on', b.dataset.v === st.mode);
  $('pwdBox').hidden = st.mode === 'nopass';
  $('showPwd').closest('.chk').hidden = st.mode === 'nopass';
  for (const b of $('themes').children) b.classList.toggle('on', b.dataset.id === st.theme);
  for (const b of $('sizes').children) b.classList.toggle('on', b.dataset.id === st.size);
}
for (const [k, el] of Object.entries(inputs)) el.addEventListener('input', () => { st[k] = el.value; changed(); });
$('hidden').onchange = e => { st.hidden = e.target.checked; changed(); };
$('showPwd').onchange = e => { st.showPwd = e.target.checked; changed(); };
$('mode').onclick = e => { const b = e.target.closest('button'); if (!b) return; st.mode = b.dataset.v; syncForm(); changed(); };

$('themes').innerHTML = THEMES.map(t => `<button class="theme" data-id="${t.id}" aria-label="${t.name}"><i style="background:${t.bg};--b:${t.band}"></i><b>${t.name}</b></button>`).join('');
$('themes').onclick = e => { const b = e.target.closest('.theme'); if (!b) return; st.theme = b.dataset.id; syncForm(); changed(); };
$('sizes').innerHTML = sizeKeys.map(k => { const z = SIZES[k]; return `<button class="size" data-id="${k}"><b>${z.name}</b><span>${z.desc}<br><em>${z.per}</em></span></button>`; }).join('');
$('sizes').onclick = e => { const b = e.target.closest('.size'); if (!b) return; st.size = b.dataset.id; syncForm(); changed(); };

$('clear').onclick = () => { Object.assign(st, DEFAULTS); syncForm(); changed(); toast('已清空'); };

// ---------- 画 ----------
let raf = 0;
function changed() { persist(); cancelAnimationFrame(raf); raf = requestAnimationFrame(draw); warn(); }
function warn() {
  let w = '';
  const pwd = st.pwd;
  if (st.ssid && utf8len(st.ssid) > 32) w = 'WiFi 名称最长 32 个字节（约 10 个汉字），再长手机连不上';
  else if (st.mode === 'WPA' && pwd && pwd.length < 8) w = '这种 WiFi 的密码至少 8 位，少于 8 位的手机连不上';
  else if (st.mode === 'WEP' && pwd && ![5, 10, 13, 26].includes(pwd.length)) w = 'WEP 密码一般是 5 或 13 个字符，或者 10 / 26 位十六进制';
  $('warn').hidden = !w; $('warn').textContent = w;
}
let cardCache = null;
function draw() {
  const cv = $('cv'), cssW = Math.round(cv.getBoundingClientRect().width) || 300;
  cv.width = Math.round(cssW * DPR); cv.height = Math.round(cv.width * Math.SQRT2);
  drawCard(cv.getContext('2d'), cv.width, cv.height, st, { blurQr: BLUR });
  // 拼版缩略图：用小一点的卡片图贴进去
  const sc = $('sheet'), wrap = sc.parentElement;
  const sh = sheetOf(st.size);
  const maxW = Math.min(300, (wrap.clientWidth || 320) - 24);
  const cssSW = sh.pw > sh.ph ? maxW : Math.round(maxW * 0.82);
  const cardW = Math.max(300, Math.round(cssSW * DPR * SIZES[st.size].w / sh.pw));
  const small = renderCard(st, cardW, { blurQr: BLUR });
  drawSheet(sc, small, st.size, Math.round(cssSW * DPR));
  sc.style.width = cssSW + 'px';
  const z = SIZES[st.size], c = cardMM(st.size);
  $('sheetHint').textContent = `A4 纸${sh.pw > sh.ph ? '横放' : '竖放'}，${z.per}（每张 ${(c.w / 10).toFixed(1)}×${(c.h / 10).toFixed(1)} 厘米）${sh.guides ? '，虚线是裁剪线' : ''}`;
  $('goPdf').textContent = `导出 PDF，${z.per}直接打印`;
  window.__wifi && (window.__wifi.drawn = (window.__wifi.drawn || 0) + 1);
}

// ---------- 导出 ----------
const safe = s => (s || '').replace(/[\\/:*?"<>|\s]+/g, '') || 'WiFi';
function check() {
  if (!st.ssid.trim()) { toast('先填上 WiFi 名称'); inputs.ssid.focus(); return false; }
  if (st.mode !== 'nopass' && !st.pwd) { toast('还没填密码；没设密码的选「没有密码」'); inputs.pwd.focus(); return false; }
  if (utf8len(st.ssid) > 32) { toast('WiFi 名称太长了（最长 32 个字节）'); inputs.ssid.focus(); return false; }
  return true;
}
let lastUrl = null;
async function showOut({ title, blob, name, meta, imgUrl, canShare }) {
  if (lastUrl) URL.revokeObjectURL(lastUrl);
  lastUrl = URL.createObjectURL(blob);
  $('outTitle').textContent = title; $('outMeta').textContent = meta;
  $('outImg').src = imgUrl;
  const a = $('dl'); a.href = lastUrl; a.download = name; a.textContent = `保存${title.includes('PDF') ? ' PDF' : '图片'}`;
  const file = new File([blob], name, { type: blob.type });
  $('outShare').hidden = !(navigator.canShare && navigator.canShare({ files: [file] }));
  $('outShare').onclick = () => navigator.share({ files: [file], title: name }).catch(() => { });
  $('wxTip').hidden = !/MicroMessenger|aweme|Douyin|QQ\//i.test(navigator.userAgent);
  $('out').hidden = false; document.body.classList.add('lock');
}
$('outBack').onclick = () => { $('out').hidden = true; document.body.classList.remove('lock'); };
async function busy(btn, text, fn) {
  const old = btn.textContent; btn.disabled = true; btn.classList.add('busy'); btn.textContent = text;
  try { await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0))); await fn(); }
  catch (e) { console.error(e); toast('生成失败：' + (e.message || e), 4000); }
  finally { btn.disabled = false; btn.classList.remove('busy'); btn.textContent = old; if (btn === $('goPdf')) draw(); }
}
$('goPng').onclick = e => { if (!check()) return; busy(e.currentTarget, '正在生成…', async () => {
  const t0 = performance.now();
  const px = Math.max(1500, printPx(st.size));
  const c = renderCard(st, px, { blurQr: BLUR }), blob = await toBlob(c);
  const name = `${safe(st.title || st.ssid)}_WiFi桌牌.png`;
  window.__wifi.last = { kind: 'png', blob, name, w: c.width, h: c.height, ms: Math.round(performance.now() - t0) };
  await showOut({ title: '桌牌图片', blob, name, imgUrl: URL.createObjectURL(blob), meta: `${c.width}×${c.height} 像素 · ${Math.max(1, Math.round(blob.size / 1024))} KB · 按「${SIZES[st.size].name}」尺寸 300dpi，可以直接发给打印店` });
}); };
$('goPdf').onclick = e => { if (!check()) return; busy(e.currentTarget, '正在生成 PDF…', async () => {
  const t0 = performance.now();
  const out = await makePdf({ ...st }, st.size, `${st.title || st.ssid} WiFi 桌牌`, { blurQr: BLUR });
  const blob = new Blob([out.bytes], { type: 'application/pdf' });
  const name = `${safe(st.title || st.ssid)}_WiFi桌牌_A4一页${out.cards}张.pdf`;
  const sc = $('sheet'), prev = await toBlob(sc, 'image/jpeg', 0.9);
  window.__wifi.last = { kind: 'pdf', blob, name, bytes: out.bytes, cards: out.cards, ms: Math.round(performance.now() - t0) };
  await showOut({ title: 'PDF 拼版', blob, name, imgUrl: URL.createObjectURL(prev), meta: `A4 · ${SIZES[st.size].per} · ${Math.max(1, Math.round(blob.size / 1024))} KB · 打印时选「实际大小」（别选「适合页面」）` });
}); };

// ---------- 我的桌牌（本机保存，第 2 套起要会员） ----------
const loadSaved = () => { try { return JSON.parse(localStorage.getItem(SAVED) || '[]'); } catch { return []; } };
const putSaved = l => { try { localStorage.setItem(SAVED, JSON.stringify(l)); } catch { } };
function drawSaved() {
  const l = loadSaved();
  $('saved').innerHTML = l.map((s, i) => `<span class="chip"><button data-i="${i}">${esc(s.title || s.ssid)}</button><button class="x" data-x="${i}" aria-label="删除">✕</button></span>`).join('');
  $('savedHint').hidden = l.length > 0 && false;
}
$('saved').onclick = e => {
  const l = loadSaved(), b = e.target.closest('button'); if (!b) return;
  if (b.dataset.x != null) { l.splice(+b.dataset.x, 1); putSaved(l); drawSaved(); return; }
  Object.assign(st, DEFAULTS, l[+b.dataset.i]); syncForm(); changed(); toast('已调出');
};
$('saveIt').onclick = async () => {
  if (!st.ssid.trim()) { toast('先填上 WiFi 名称'); return; }
  let l = loadSaved();
  const same = l.findIndex(s => s.ssid === st.ssid);
  const rec = { ...st };
  if (same >= 0) { l[same] = rec; putSaved(l); drawSaved(); toast('已更新'); return; }
  if (l.length >= FREE_SAVED && window.Member && Member.enabled && !(await Member.active())) {
    const r = await Member.gate({ title: '多存几套桌牌', text: `免费版能在这台手机上存 ${FREE_SAVED} 套（做图、导出、打印都不限次数）；开通工具箱会员可以存多套，前台、包间、员工网各一张，随时调出来改。`, free: '换掉已存的那套' });
    if (!r) return;
    if (r === 'free') l = [];
  }
  l.push(rec); putSaved(l); drawSaved(); toast('已保存');
};

// ---------- 代做入口 ----------
const svc = window.SITE_CONFIG && window.SITE_CONFIG.service;
if (svc) {
  const s = { ...svc, ...(svc.tools && svc.tools.wifi) };
  $('service').innerHTML = `<h2>找我代做 <b>${esc(s.price)}</b></h2><p>${esc(s.text)}</p><p class="contact">${esc(s.contact)}</p>${s.qr ? `<img src="../${esc(s.qr)}" alt="联系方式二维码">` : ''}`;
  $('service').hidden = false;
}

// 供分镜和测试用
window.__wifi = { st, draw, syncForm, changed, wifiPayload, DPR, BLUR, set(p) { Object.assign(st, p); syncForm(); changed(); } };
syncForm(); warn(); drawSaved();
draw();
addEventListener('resize', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(draw); });
window.__wifiReady = true;
