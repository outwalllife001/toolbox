// WiFi 二维码桌牌：二维码内容、卡片绘制、A4 拼版、PDF。没有任何网络请求（导出 PDF 时才加载 pdf-lib）
// 二维码内容格式（WIFI:T:WPA;S:名称;P:密码;H:true;;）和 wifi-card（bndw/wifi-card，MIT）、ZXing 通用格式一致
import qrcode from '../vendor/qrcode-generator/qrcode.mjs';

// 一律按 UTF-8 编码（中文 WiFi 名）
qrcode.stringToBytes = s => Array.from(new TextEncoder().encode(s));

// 特殊字符 \ " ; , : 前面加反斜杠（照 wifi-card 的 escape）
export const esc = v => String(v).replace(/([\\";,:])/g, '\\$1');

// mode: 'WPA'（WPA / WPA2 / WPA3 都选这个）| 'WEP' | 'nopass'
export function wifiPayload({ ssid, pwd, mode = 'WPA', hidden = false }) {
  let s = `WIFI:T:${mode};S:${esc(ssid)};`;
  if (mode !== 'nopass') s += `P:${esc(pwd)};`;
  if (hidden) s += 'H:true;';
  return s + ';';
}

// 纠错 M（能挡住 15% 的污损）；返回 n×n 的布尔矩阵
export function qrModules(text, level = 'M') {
  const q = qrcode(0, level);
  q.addData(text, 'Byte');
  q.make();
  const n = q.getModuleCount();
  const m = [];
  for (let r = 0; r < n; r++) { const row = new Array(n); for (let c = 0; c < n; c++) row[c] = q.isDark(r, c); m.push(row); }
  return m;
}

// ---------- 样式 ----------
export const THEMES = [
  { id: 'orange', name: '奶茶橙', bg: '#fff6ec', band: '#ff7a2f', band2: '#ffa04d', ink: '#3b1e0a', sub: '#9b6a45', chip: '#ffe4cf', qr: '#2a1608' },
  { id: 'coffee', name: '咖啡棕', bg: '#f5eee4', band: '#5e3d27', band2: '#8a5d3b', ink: '#2c1b10', sub: '#86705c', chip: '#eadccb', qr: '#24160d' },
  { id: 'green', name: '清新绿', bg: '#effaf3', band: '#14965a', band2: '#3dc283', ink: '#0d3a24', sub: '#5b8a72', chip: '#d5f2e1', qr: '#0b2a1a' },
  { id: 'blue', name: '海盐蓝', bg: '#eef4ff', band: '#2457e6', band2: '#5c8dff', ink: '#0f2250', sub: '#5d7099', chip: '#d9e5ff', qr: '#0d1b3f' },
  { id: 'pink', name: '樱花粉', bg: '#fff1f5', band: '#f0457c', band2: '#ff86a8', ink: '#4a1226', sub: '#a6657b', chip: '#ffdce6', qr: '#33101c' },
  { id: 'dark', name: '黑金', bg: '#16181d', band: '#262a35', band2: '#363c4d', ink: '#ffffff', sub: '#d3bd86', chip: '#262a35', qr: '#0b0c0f', gold: '#e9c874' },
];

// 打印尺寸：宽（毫米）；高 = 宽 × √2，和 A 系列纸同比例。每页几张是按 A4 减去 8mm 边距算的
export const SIZES = {
  L: { name: '大', w: 190, cols: 1, rows: 1, land: false, desc: '整页 19×27 厘米', per: '一页 1 张' },
  M: { name: '中', w: 135, cols: 2, rows: 1, land: true, desc: '13.5×19 厘米', per: '一页 2 张' },
  S: { name: '小', w: 96, cols: 2, rows: 2, land: false, desc: '9.6×13.6 厘米', per: '一页 4 张' },
  XS: { name: '迷你', w: 62, cols: 3, rows: 3, land: false, desc: '6.2×8.8 厘米', per: '一页 9 张' },
};
export const RATIO = Math.SQRT2;
export const cardMM = id => { const z = SIZES[id]; return { w: z.w, h: +(z.w * RATIO).toFixed(1) }; };

const FONT = '-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "Noto Sans SC", sans-serif';
const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", "Courier New", "PingFang SC", "Microsoft YaHei", monospace';

export const DEFAULTS = { ssid: '', pwd: '', mode: 'WPA', hidden: false, title: '', tag: '', showPwd: true, theme: 'orange', size: 'S' };
export const TITLE0 = '免费 WiFi', TAG0 = '扫一扫，连上就能上网';

// ---------- 画卡片 ----------
const rr = (c, x, y, w, h, r) => { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); };
const circle = (c, x, y, r) => { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); };
// 文字缩到不超过 maxW；返回实际字号
function fit(c, text, maxW, size, min, weight, family) {
  let s = size;
  for (; s > min; s -= 2) { c.font = `${weight} ${s}px ${family}`; if (c.measureText(text).width <= maxW) return s; }
  c.font = `${weight} ${min}px ${family}`; return min;
}
// 按字符数把长密码拆成两行（在中间附近断）
const split2 = t => { const a = Math.ceil(t.length / 2); return [t.slice(0, a), t.slice(a)]; };
function wifiIcon(c, cx, cy, r, color) {
  c.save(); c.strokeStyle = color; c.fillStyle = color; c.lineCap = 'round'; c.lineWidth = r * 0.17;
  for (const k of [0.5, 0.88, 1.26]) { c.beginPath(); c.arc(cx, cy, r * k, Math.PI * 1.22, Math.PI * 1.78); c.stroke(); }
  circle(c, cx, cy, r * 0.13);
  c.restore();
}
function phoneIcon(c, x, y, h, color) {
  c.save(); c.strokeStyle = color; c.lineWidth = h * 0.09; c.lineCap = 'round';
  rr(c, x, y, h * 0.58, h, h * 0.12); c.stroke();
  c.beginPath(); c.moveTo(x + h * 0.2, y + h * 0.82); c.lineTo(x + h * 0.38, y + h * 0.82); c.stroke();
  c.restore();
}

// 在 pxW×pxH 的画布上画一张桌牌（逻辑宽 1000，高随画布比例）
// st：见 DEFAULTS；opt.blurQr：把二维码虚化（录视频用）
export function drawCard(ctx, pxW, pxH, st, opt = {}) {
  const k = pxW / 1000, H = pxH / k, W = 1000;
  const T = THEMES.find(t => t.id === st.theme) || THEMES[0];
  const dark = T.id === 'dark';
  const ssid = (st.ssid || '').trim();
  const empty = !ssid;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = T.bg; ctx.fillRect(0, 0, pxW, pxH);
  ctx.scale(k, k);

  // 顶部色块，下沿是一条弧
  const bh = 340;
  const g = ctx.createLinearGradient(0, 0, W, bh); g.addColorStop(0, T.band); g.addColorStop(1, T.band2);
  ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(W, 0); ctx.lineTo(W, bh - 70); ctx.quadraticCurveTo(W / 2, bh + 70, 0, bh - 70); ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.10)'; circle(ctx, 905, 30, 150); circle(ctx, 70, 250, 100);
  ctx.fillStyle = 'rgba(255,255,255,.07)'; circle(ctx, 560, -80, 130); circle(ctx, 140, 20, 70);
  if (dark) { ctx.strokeStyle = T.gold; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, bh - 70 + 6); ctx.quadraticCurveTo(W / 2, bh + 70 + 6, W, bh - 70 + 6); ctx.stroke(); }

  // 图标 + 标题 + 一句话
  const headInk = dark ? T.gold : '#fff';
  wifiIcon(ctx, W / 2, 128, 56, headInk);
  const title = (st.title || '').trim() || TITLE0, tag = (st.tag || '').trim() || TAG0;
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = headInk;
  fit(ctx, title, 840, 112, 52, 800, FONT); ctx.fillText(title, W / 2, 232);
  ctx.fillStyle = dark ? '#ffffffcc' : 'rgba(255,255,255,.88)';
  fit(ctx, tag, 800, 42, 28, 500, FONT); ctx.fillText(tag, W / 2, 292);

  // 二维码白板
  const PX = 200, PY = 322, PS = 600;
  ctx.save(); ctx.shadowColor = dark ? 'rgba(0,0,0,.55)' : 'rgba(40,30,20,.22)'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 14;
  ctx.fillStyle = '#fff'; rr(ctx, PX, PY, PS, PS, 48); ctx.fill(); ctx.restore();
  const payload = empty ? wifiPayload({ ssid: '示例', pwd: '示例示例', mode: 'WPA' }) : wifiPayload({ ssid, pwd: st.pwd || '', mode: st.mode, hidden: st.hidden });
  const mods = qrModules(payload), n = mods.length;
  // 模块边长取整数设备像素，边缘不发虚；白边至少 4 个模块（标准要求）
  const mpx = Math.max(1, Math.floor(PS * k / (n + 8)));
  const qpx = mpx * n;
  const qx = Math.round((PX + PS / 2) * k - qpx / 2), qy = Math.round((PY + PS / 2) * k - qpx / 2);
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (empty) ctx.globalAlpha = 0.14;
  if (opt.blurQr) {
    // 虚化：每个模块只画 3 个像素的小图、在小图上模糊，再放大贴上去（直接在大画布上用 filter 模糊，每次重画要 100 多毫秒）
    const u = 3, pad = 4, S = (n + pad * 2) * u;
    const a = document.createElement('canvas'); a.width = a.height = S;
    const ac = a.getContext('2d'); ac.fillStyle = T.qr;
    for (let r = 0; r < n; r++) for (let c0 = 0; c0 < n; c0++) if (mods[r][c0]) ac.fillRect((c0 + pad) * u, (r + pad) * u, u, u);
    const b = document.createElement('canvas'); b.width = b.height = S;
    const bc = b.getContext('2d'); bc.filter = `blur(${u * 1.7}px)`; bc.drawImage(a, 0, 0);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(b, qx - pad * mpx, qy - pad * mpx, (n + pad * 2) * mpx, (n + pad * 2) * mpx);
  } else {
    ctx.fillStyle = T.qr;
    for (let r = 0; r < n; r++) {
      for (let c0 = 0; c0 < n;) {
        if (!mods[r][c0]) { c0++; continue; }
        let c1 = c0; while (c1 < n && mods[r][c1]) c1++;
        ctx.fillRect(qx + c0 * mpx, qy + r * mpx, (c1 - c0) * mpx, mpx);
        c0 = c1;
      }
    }
  }
  ctx.restore();
  if (empty) {
    ctx.fillStyle = '#667085'; ctx.textAlign = 'center'; ctx.font = `700 40px ${FONT}`;
    ctx.fillText('填好名称和密码', W / 2, PY + PS / 2 - 6); ctx.fillText('二维码就出来了', W / 2, PY + PS / 2 + 50);
  }

  // 名称、密码
  const y0 = PY + PS + 30;                      // 白板下沿之后
  const nopass = st.mode === 'nopass';
  const showPwd = !nopass && st.showPwd;
  const name = empty ? '你的 WiFi 名称' : ssid;
  const label = (t, y) => { ctx.fillStyle = T.sub; ctx.font = `600 30px ${FONT}`; ctx.fillText(t, W / 2, y); };
  const val = empty ? T.sub : T.ink;
  let y = y0 + 22;
  label('WiFi 名称', y); y += 62;
  ctx.fillStyle = val; fit(ctx, name, 880, 66, 36, 800, FONT); ctx.fillText(name, W / 2, y);
  if (showPwd || nopass) {
    y += 40;
    ctx.strokeStyle = dark ? '#ffffff22' : T.chip; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(300, y); ctx.lineTo(700, y); ctx.stroke();
    y += 46;
    label('密码', y); y += 60;
    ctx.fillStyle = val;
    if (nopass) { ctx.font = `800 56px ${FONT}`; ctx.fillText('无需密码，直接连', W / 2, y); }
    else {
      const p = st.pwd || '';
      const text = empty && !p ? 'your-password' : p;
      const s1 = fit(ctx, text, 880, 62, 34, 700, MONO);
      ctx.font = `700 ${s1}px ${MONO}`;
      if (s1 <= 34 && ctx.measureText(text).width > 880) {
        const [a, b] = split2(text); const s2 = fit(ctx, a.length >= b.length ? a : b, 880, 52, 30, 700, MONO);
        ctx.fillText(a, W / 2, y - 22); ctx.fillText(b, W / 2, y + s2 * 0.95 - 22);
      } else ctx.fillText(text, W / 2, y);
    }
  }
  // 底部提示
  const tip = '打开手机相机，对准二维码，点一下就连上';
  ctx.font = `500 32px ${FONT}`;
  const tw = ctx.measureText(tip).width, ph = 46, gap = 18, total = ph * 0.58 + gap + tw;
  const tx = (W - total) / 2, ty = H - 66;
  ctx.fillStyle = dark ? '#ffffff12' : T.chip; rr(ctx, tx - 34, ty - 52, total + 68, 82, 41); ctx.fill();
  phoneIcon(ctx, tx, ty - 40, ph, dark ? T.gold : T.band);
  ctx.fillStyle = dark ? '#ffffffcc' : T.ink; ctx.textAlign = 'left'; ctx.fillText(tip, tx + ph * 0.58 + gap, ty - 5);
  ctx.restore();
}

export function renderCard(st, pxW, opt = {}) {
  const c = document.createElement('canvas');
  c.width = Math.round(pxW); c.height = Math.round(pxW * RATIO);
  drawCard(c.getContext('2d'), c.width, c.height, st, opt);
  return c;
}
export const toBlob = (canvas, type = 'image/png', q) => new Promise((ok, bad) => canvas.toBlob(b => b ? ok(b) : bad(new Error('图片生成失败')), type, q));

// ---------- A4 拼版 ----------
const MM = 72 / 25.4;
export function sheetOf(sizeId) {
  const z = SIZES[sizeId], { w: cw, h: ch } = cardMM(sizeId);
  const pw = z.land ? 297 : 210, ph = z.land ? 210 : 297;
  const x0 = (pw - cw * z.cols) / 2, y0 = (ph - ch * z.rows) / 2;
  const cells = [];
  for (let r = 0; r < z.rows; r++) for (let c = 0; c < z.cols; c++) cells.push({ x: x0 + c * cw, y: y0 + r * ch, w: cw, h: ch });
  return { pw, ph, cells, guides: cells.length > 1 };
}
// 打印用的像素宽度：300dpi，至少 1500
export const printPx = id => Math.max(1500, Math.round(cardMM(id).w / 25.4 * 300));

// 拼版缩略图：画布宽度 = 页面宽度（像素），整页白底，每格里贴卡片，带裁剪线
export function drawSheet(canvas, cardCanvas, sizeId, widthPx) {
  const sh = sheetOf(sizeId), k = widthPx / sh.pw;
  canvas.width = Math.round(sh.pw * k); canvas.height = Math.round(sh.ph * k);
  const c = canvas.getContext('2d');
  c.fillStyle = '#fff'; c.fillRect(0, 0, canvas.width, canvas.height);
  c.imageSmoothingQuality = 'high';
  for (const q of sh.cells) c.drawImage(cardCanvas, q.x * k, q.y * k, q.w * k, q.h * k);
  if (sh.guides) {
    c.strokeStyle = '#8a8f9a'; c.lineWidth = Math.max(1, k * 0.25); c.setLineDash([k * 1.6, k * 1.2]);
    for (const q of sh.cells) c.strokeRect(q.x * k, q.y * k, q.w * k, q.h * k);
  }
  return canvas;
}

let libP = null;
function loadPdfLib() {
  if (window.PDFLib) return Promise.resolve(window.PDFLib);
  return libP ||= new Promise((ok, bad) => {
    const s = document.createElement('script');
    s.src = new URL('../vendor/pdf-lib/pdf-lib.min.js', import.meta.url).href;
    s.onload = () => ok(window.PDFLib); s.onerror = () => { libP = null; bad(new Error('PDF 组件加载失败，请检查网络后重试')); };
    document.head.appendChild(s);
  });
}
// A4 一页，里面按尺寸拼满同一张桌牌，多张时画裁剪线。返回 { bytes, pages, cards }
export async function makePdf(st, sizeId, title = 'WiFi 桌牌', opt = {}) {
  const { PDFDocument, rgb } = await loadPdfLib();
  const card = renderCard(st, printPx(sizeId), opt);
  const png = new Uint8Array(await (await toBlob(card)).arrayBuffer());
  const doc = await PDFDocument.create();
  doc.setTitle(title); doc.setCreator('开源宝藏工具箱'); doc.setProducer('pdf-lib');
  const sh = sheetOf(sizeId);
  const page = doc.addPage([sh.pw * MM, sh.ph * MM]);
  const img = await doc.embedPng(png);
  for (const q of sh.cells) page.drawImage(img, { x: q.x * MM, y: (sh.ph - q.y - q.h) * MM, width: q.w * MM, height: q.h * MM });
  if (sh.guides) for (const q of sh.cells) page.drawRectangle({ x: q.x * MM, y: (sh.ph - q.y - q.h) * MM, width: q.w * MM, height: q.h * MM, borderColor: rgb(0.55, 0.57, 0.6), borderWidth: 0.4, borderDashArray: [4, 3] });
  return { bytes: await doc.save(), pages: 1, cards: sh.cells.length, pngBytes: png.length };
}
