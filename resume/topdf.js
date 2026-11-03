// 把预览里的简历页面原样画成「文字版」PDF：浏览器负责排版，这里逐字量出位置，用同一份字体画进 PDF。
//   - 文字：用 pdf-lib 嵌入思源黑体子集（只嵌用到的字，几十 KB），文字能选中、复制、被招聘系统读出来
//   - 色块、边线：读 computed style 画矩形（圆角用贝塞尔曲线）；照片：JPEG 原样嵌入，圆角用裁剪路径
//   - 分页：页面高度按 A4 算，跨页的色块（侧栏底色）每页各画一段
// 依赖：../vendor/pdf-lib/pdf-lib.min.js（window.PDFLib）、../vendor/fontkit/fontkit.umd.min.js（window.fontkit），用到时才加载
import { PAGE_W, PAGE_H } from './templates.js';

const A4 = [595.28, 841.89];
const loadScript = src => new Promise((ok, bad) => {
  const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => bad(new Error('加载失败：' + src));
  document.head.appendChild(s);
});
let libs = null;
export function loadLibs() {
  return libs ||= (async () => {
    if (!window.PDFLib) await loadScript(new URL('../vendor/pdf-lib/pdf-lib.min.js', import.meta.url).href);
    if (!window.fontkit) await loadScript(new URL('../vendor/fontkit/fontkit.umd.min.js', import.meta.url).href);
  })().catch(e => { libs = null; throw e; });
}
const fontCache = {};
function fontBytes(name) {
  return fontCache[name] ||= fetch(new URL(`fonts/${name}.ttf`, import.meta.url)).then(r => {
    if (!r.ok) throw new Error('字体下载失败 ' + r.status);
    return r.arrayBuffer();
  }).catch(e => { delete fontCache[name]; throw e; });
}

function parseColor(c) {
  const m = c && c.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
  const a = p.length > 3 ? p[3] : 1;
  if (!(a > 0.01)) return null;
  return { r: p[0] / 255, g: p[1] / 255, b: p[2] / 255, a };
}

export async function toPdf(el, { title = '简历', onStep } = {}) {
  await loadLibs();
  await document.fonts.ready;
  const { PDFDocument, rgb, pushGraphicsState, popGraphicsState, moveTo, lineTo, appendBezierCurve, closePath, clip, endPath } = window.PDFLib;
  const fk = window.fontkit;

  const R0 = el.getBoundingClientRect();
  const k = R0.width / PAGE_W;                 // 预览缩放（手机上缩小显示）
  const PT = A4[0] / PAGE_W;                   // CSS px → pt
  const pages = Math.max(1, Math.round(el.offsetHeight / PAGE_H));
  const pos = r => ({ x: (r.left - R0.left) / k, y: (r.top - R0.top) / k, w: r.width / k, h: r.height / k });

  // ---------- 1. 收集文字：逐字量位置，同一行、同字体、同样式、挨着的字并成一段 ----------
  const runs = [];
  const used = new Set();
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode: n => (n.nodeValue.trim() && !n.parentElement.closest('[data-nopdf]')) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
  });
  const range = document.createRange();
  for (let n; (n = walker.nextNode());) {
    const cs = getComputedStyle(n.parentElement);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    const color = parseColor(cs.color);
    if (!color) continue;
    const size = parseFloat(cs.fontSize) * PT;
    const bold = (parseInt(cs.fontWeight) || 400) >= 600;
    const ls = parseFloat(cs.letterSpacing) || 0;
    const s = n.nodeValue;
    let cur = null;
    for (let i = 0; i < s.length;) {
      const cp = s.codePointAt(i), len = cp > 0xffff ? 2 : 1;
      range.setStart(n, i); range.setEnd(n, i + len);
      i += len;
      const rs = range.getClientRects();
      if (!rs.length) { cur = null; continue; }
      const r = pos(rs[0]);
      if (r.w < .01) { cur = null; continue; }
      const ch = String.fromCodePoint(cp);
      if (/\s/.test(ch)) { if (cur) { cur.text += ' '; cur.end = r.x + r.w; } continue; }
      used.add(cp);
      const line = r.y;
      if (cur && Math.abs(cur.y - line) < .5 && Math.abs(r.x - cur.end) < 1.2 && !ls) { cur.text += ch; cur.end = r.x + r.w; cur.cps.push(cp); }
      else { cur = { text: ch, x: r.x, y: r.y, h: r.h, end: r.x + r.w, size, bold, color, cps: [cp], ls }; runs.push(cur); }
    }
  }
  for (const r of runs) r.text = r.text.replace(/\s+$/, '');

  // 色块、边线、图片：和文字在同一帧里量完（中间有 await 的话，页面滚动、重排会让位置错开）
  const shapes = [];
  for (const e of [el, ...el.querySelectorAll('*')]) {
    if (e.closest('[data-nopdf]')) continue;
    const cs = getComputedStyle(e);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const b = pos(e.getBoundingClientRect());
    if (b.w < .01 || b.h < .01) continue;
    const rad = parseFloat(cs.borderTopLeftRadius) || 0;
    const bg = parseColor(cs.backgroundColor);
    if (bg && e !== el) shapes.push({ kind: 'bg', b, rad, c: bg });
    for (const [side, bx, by, bw, bh] of [['Top', 0, 0, 1, 0], ['Bottom', 0, 1, 1, 0], ['Left', 0, 0, 0, 1], ['Right', 1, 0, 0, 1]]) {
      const wpx = parseFloat(cs[`border${side}Width`]) || 0;
      if (wpx < .1 || cs[`border${side}Style`] === 'none') continue;
      const c = parseColor(cs[`border${side}Color`]);
      if (!c) continue;
      const wd = wpx / k;
      shapes.push({ kind: 'line', c, b: { x: b.x + bx * (b.w - wd), y: b.y + by * (b.h - wd), w: bw ? b.w : wd, h: bh ? b.h : wd } });
    }
    if (e.tagName === 'IMG' && e.complete && e.naturalWidth) shapes.push({ kind: 'img', b, rad, src: e.currentSrc || e.src });
  }


  // ---------- 2. 字体：常用字子集；有生僻字再加载扩展字体 ----------
  onStep?.('字体');
  const doc = await PDFDocument.create();
  doc.registerFontkit(fk);
  doc.setTitle(title); doc.setCreator('开源宝藏工具箱 · 免费简历生成器'); doc.setProducer('pdf-lib');
  const F = {};
  // 常用字表里有没有，用字符表判断（两个字重的字表一样）
  const coreFk = fk.create(new Uint8Array(await fontBytes('sc-400')));
  const missingCore = [...used].filter(cp => !coreFk.hasGlyphForCodePoint(cp));
  let extFk = null;
  if (missingCore.length) {
    // 生僻字只在粗体里出现（比如名字）就只下粗体的扩展字体
    const miss = new Set(missingCore);
    const boldOnly = runs.every(r => r.bold || !r.cps.some(c => miss.has(c)));
    extFk = fk.create(new Uint8Array(await fontBytes(boldOnly ? 'sc-ext-700' : 'sc-ext-400')));
  }
  const missing = missingCore.filter(cp => !(extFk && extFk.hasGlyphForCodePoint(cp)));
  const pick = cp => coreFk.hasGlyphForCodePoint(cp) ? 'c' : (extFk && extFk.hasGlyphForCodePoint(cp)) ? 'e' : 'm';
  async function font(kind, bold) {
    const key = kind + (bold ? 'b' : 'r');
    if (!F[key]) {
      const name = (kind === 'e' ? 'sc-ext-' : 'sc-') + (bold ? '700' : '400');
      F[key] = doc.embedFont(await fontBytes(name), { subset: true });
    }
    return F[key];
  }

  // ---------- 3. 画 ----------
  onStep?.('排版');
  const pg = [];
  for (let p = 0; p < pages; p++) pg.push(doc.addPage(A4));
  const H = A4[1];
  // 一个矩形可能跨页：每页画相交的一段
  function eachPage(y, h, fn) {
    const p0 = Math.max(0, Math.floor(y / PAGE_H)), p1 = Math.min(pages - 1, Math.floor((y + h - .01) / PAGE_H));
    for (let p = p0; p <= p1; p++) {
      const top = Math.max(y, p * PAGE_H), bot = Math.min(y + h, (p + 1) * PAGE_H);
      if (bot - top > .01) fn(pg[p], top - p * PAGE_H, bot - top, p);
    }
  }
  const col = c => rgb(c.r, c.g, c.b);
  function roundRectOps(x, y, w, h, rad) {   // pt，PDF 坐标（y 向上，y 是底边）
    const r = Math.min(rad, w / 2, h / 2), c = r * 0.5523;
    return [
      moveTo(x + r, y), lineTo(x + w - r, y), appendBezierCurve(x + w - r + c, y, x + w, y + r - c, x + w, y + r),
      lineTo(x + w, y + h - r), appendBezierCurve(x + w, y + h - r + c, x + w - r + c, y + h, x + w - r, y + h),
      lineTo(x + r, y + h), appendBezierCurve(x + r - c, y + h, x, y + h - r + c, x, y + h - r),
      lineTo(x, y + r), appendBezierCurve(x, y + r - c, x + r - c, y, x + r, y), closePath(),
    ];
  }

  for (const sh of shapes) {
    const { b, c, rad } = sh;
    if (sh.kind === 'bg') {
      eachPage(b.y, b.h, (page, top, h) => {
        const x = b.x * PT, y = H - (top + h) * PT, w = b.w * PT, hh = h * PT;
        if (rad > .5) page.drawSvgPath(svgRound(0, 0, w, hh, rad * PT), { x, y: y + hh, color: col(c), opacity: c.a, borderWidth: 0 });
        else page.drawRectangle({ x, y, width: w, height: hh, color: col(c), opacity: c.a });
      });
    } else if (sh.kind === 'line') {
      eachPage(b.y, b.h, (page, top, h) => page.drawRectangle({ x: b.x * PT, y: H - (top + h) * PT, width: b.w * PT, height: h * PT, color: col(c), opacity: c.a }));
    } else if (sh.kind === 'img') {
      const img = await embedImg(doc, sh.src);
      // 照片不会跨页：画在它开头那一页
      const p = Math.min(pages - 1, Math.floor(b.y / PAGE_H)), page = pg[p];
      const x = b.x * PT, y = H - (b.y - p * PAGE_H + b.h) * PT, w = b.w * PT, hh = b.h * PT;
      if (rad > .5) {
        page.pushOperators(pushGraphicsState(), ...roundRectOps(x, y, w, hh, rad * PT), clip(), endPath());
        page.drawImage(img, { x, y, width: w, height: hh });
        page.pushOperators(popGraphicsState());
      } else page.drawImage(img, { x, y, width: w, height: hh });
    }
  }

  // 文字最后画（压在色块上面）。一段里混了生僻字就按字体拆开
  for (const r of runs) {
    const p = Math.min(pages - 1, Math.max(0, Math.floor((r.y + r.h / 2) / PAGE_H)));
    const page = pg[p];
    // 基线：字框（ascent + descent）里 ascent 占的比例。思源黑体 hhea：1160 / (1160 + 288)
    const base = (r.y - p * PAGE_H) + r.h * (1160 / 1448);
    let segs = [], cur = null;
    for (const ch of r.text) {
      const kind = ch === ' ' ? (cur ? cur.kind : 'c') : pick(ch.codePointAt(0));
      if (!cur || cur.kind !== kind) { cur = { kind, text: '' }; segs.push(cur); }
      cur.text += ch;
    }
    let x = r.x * PT;
    for (const sg of segs) {
      if (sg.kind === 'm') { x += r.size * [...sg.text].length; continue; }
      const f = await font(sg.kind, r.bold);
      page.drawText(sg.text, { x, y: H - base * PT, size: r.size, font: f, color: col(r.color), opacity: r.color.a });
      x += f.widthOfTextAtSize(sg.text, r.size);
    }
  }
  onStep?.('保存');
  const bytes = await doc.save();
  return { bytes, pages, missing: missing.map(c => String.fromCodePoint(c)), runs: runs.length };
}

function svgRound(x, y, w, h, r) {   // drawSvgPath 用 SVG 坐标（y 向下，原点在左上）
  r = Math.min(r, w / 2, h / 2);
  return `M${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h - r} Q${x + w},${y + h} ${x + w - r},${y + h} H${x + r} Q${x},${y + h} ${x},${y + h - r} V${y + r} Q${x},${y} ${x + r},${y} Z`;
}

const imgCache = new Map();
async function embedImg(doc, src) {
  if (imgCache.has(doc) && imgCache.get(doc)[src]) return imgCache.get(doc)[src];
  const bytes = new Uint8Array(await (await fetch(src)).arrayBuffer());
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
  const out = isPng ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
  if (!imgCache.has(doc)) imgCache.set(doc, {});
  imgCache.get(doc)[src] = out;
  return out;
}
