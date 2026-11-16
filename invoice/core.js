// 发票合并打印：打开 OFD / PDF / 图片发票 → 读出发票号码、日期、销售方、金额 → 在 A4 纸上每页排 1 / 2 / 4 张 → 导出 PDF
// OFD 的解析和渲染用 file-viewer 的 OFD 渲染器里的代码（DLTech21/ofd.js，见 ../vendor/ofd/）；PDF 用 PDF.js 看、pdf-lib 拼
// 文件只在浏览器里处理，没有任何上传
import * as pdfjs from '../vendor/pdfjs/pdf.min.mjs';

const V = new URL('../vendor/pdfjs/', import.meta.url).href;
pdfjs.GlobalWorkerOptions.workerSrc = V + 'pdf.worker.min.mjs';
const DOC_OPTS = {
  cMapUrl: V + 'cmaps/', cMapPacked: true, standardFontDataUrl: V + 'standard_fonts/', wasmUrl: V + 'wasm/', iccUrl: V + 'iccs/',
  isEvalSupported: false, enableXfa: false,
};
let pjsWorker = null;
const docOpts = bytes => ({ data: bytes.slice(), ...DOC_OPTS, worker: pjsWorker ||= new pdfjs.PDFWorker() });

export const MM = 72 / 25.4;                    // 1 毫米 = 多少 pt
export const A4 = { w: 210, h: 297 };           // 毫米
const ext = f => (f.name.match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase() || '';
export const isOfd = f => ext(f) === 'ofd';
export const isPdf = f => /pdf/i.test(f.type) || ext(f) === 'pdf';
export const isImage = f => /^image\//.test(f.type) || /^(jpe?g|png|webp|gif|bmp)$/.test(ext(f));
export const isXml = f => ext(f) === 'xml';

// ============ OFD ============
let ofdLib = null;
export const loadOfdLib = () => ofdLib ||= import('../vendor/ofd/ofd.min.mjs').catch(e => { ofdLib = null; throw e; });
const SCALE = 4;                                // 渲染库内部用的「每毫米多少像素」；出来的是矢量 SVG，和清晰度无关
const SVG = 'http://www.w3.org/2000/svg';
const px = v => parseFloat(v) || 0;

// 渲染库给每种字体写的 font-family 只有 Windows 上的名字，这里补上 Mac / iPhone / 安卓上对应的字体，再用通用字体兜底
function fontStack(fam) {
  const f = fam.toLowerCase();
  let extra = 'sans-serif';
  if (/楷|kai/.test(f)) extra = '"Kaiti SC", STKaiti, "AR PL UKai CN", "Noto Serif CJK SC", "Source Han Serif SC", serif';
  else if (/仿宋|fangsong/.test(f)) extra = 'STFangsong, "FangSong SC", "Noto Serif CJK SC", "Source Han Serif SC", serif';
  else if (/宋|simsun|song|ssun|times/.test(f)) extra = '"Songti SC", STSong, "Noto Serif CJK SC", "Source Han Serif SC", serif';
  else if (/courier|mono/.test(f)) extra = '"Courier New", Courier, monospace';
  return fam + ', ' + extra;
}

// 渲染库产出的是一页一个 <div>，里面是绝对定位的 <svg>（文字、线条）、<div><img>（图片、印章）、<canvas>（JBIG2 图）。
// 把它按原来的位置和层叠顺序转成一张独立的 SVG：能当图片显示（缩略图、预览），也能按任意分辨率画到 canvas 上（导出 PDF）。
// 不用 foreignObject（Safari 里画到 canvas 会被当成跨域内容）
// 渲染库没处理 OFD 的 BlendMode：发票监制章、电子印章是「正片叠底」盖在文字上的，原样画会用一块白底把标题挡住。
// 这里给印章、批注（水印）里的图片和黑白 JBIG2 图加上 darken 混合：白底透出下面的内容，和纸上盖章一样
let clipSeq = 0;
const DARKEN = 'mix-blend-mode:darken';
function domToSvg(el, out, nested = false) {
  const kids = [...el.children].map((c, i) => ({ c, i, z: parseInt(c.style.zIndex, 10) || 0 })).sort((a, b) => a.z - b.z || a.i - b.i);
  for (const { c } of kids) {
    const tag = c.tagName.toLowerCase(), s = c.style;
    const x = px(s.left), y = px(s.top), w = px(s.width), h = px(s.height);
    if (tag === 'svg') {
      const n = c.cloneNode(true);
      n.removeAttribute('style');
      n.setAttribute('x', x); n.setAttribute('y', y);
      if (w) n.setAttribute('width', w);
      if (h) n.setAttribute('height', h);
      n.setAttribute('overflow', 'visible');
      for (const t of n.querySelectorAll('text')) {
        if (t.style.fontFamily) t.style.fontFamily = fontStack(t.style.fontFamily);
        if (!/^(\d+|bold|normal)$/.test(t.style.fontWeight)) t.style.removeProperty('font-weight');
      }
      out.appendChild(n);
    } else if (tag === 'canvas') {
      const im = document.createElementNS(SVG, 'image');
      im.setAttribute('href', c.toDataURL('image/png'));
      im.setAttribute('x', x); im.setAttribute('y', y); im.setAttribute('width', w); im.setAttribute('height', h);
      im.setAttribute('preserveAspectRatio', 'none');
      im.setAttribute('style', DARKEN);
      out.appendChild(im);
    } else if (tag === 'img') {                 // 带旋转 / 斜切的图片：单位方块 + 矩阵
      const im = document.createElementNS(SVG, 'image');
      im.setAttribute('href', c.src);
      im.setAttribute('width', c.getAttribute('width') || w); im.setAttribute('height', c.getAttribute('height') || h);
      im.setAttribute('preserveAspectRatio', 'none');
      const m = /matrix\(([^)]+)\)/.exec(s.transform || '');
      if (m) im.setAttribute('transform', `matrix(${m[1]})`);
      if (nested) im.setAttribute('style', DARKEN);
      out.appendChild(im);
    } else {
      // 容器用 <g> 平移，不用带裁剪的嵌套 <svg>：裁剪会让里面的内容单独合成，印章的 darken 混合就碰不到下面的文字了
      let box = document.createElementNS(SVG, 'g');
      if (s.position === 'absolute' && (x || y)) box.setAttribute('transform', `translate(${x} ${y})`);
      out.appendChild(box);
      const clip = /rect\(([^)]+)\)/.exec(s.clip || '');
      if (clip) {
        const [t, r, b, l] = clip[1].split(/[\s,]+/).map(px);
        const id = 'c' + (++clipSeq);
        const cp = document.createElementNS(SVG, 'clipPath'); cp.setAttribute('id', id);
        const rc = document.createElementNS(SVG, 'rect');
        rc.setAttribute('x', l); rc.setAttribute('y', t); rc.setAttribute('width', Math.max(0, r - l)); rc.setAttribute('height', Math.max(0, b - t));
        cp.appendChild(rc); box.appendChild(cp);
        const g = document.createElementNS(SVG, 'g'); g.setAttribute('clip-path', `url(#${id})`); box.appendChild(g); box = g;
      }
      const img = c.children.length === 1 && c.firstElementChild.tagName === 'IMG' ? c.firstElementChild : null;
      if (img) {
        const im = document.createElementNS(SVG, 'image');
        im.setAttribute('href', img.src);
        im.setAttribute('width', w); im.setAttribute('height', h);
        im.setAttribute('preserveAspectRatio', 'none');
        if (nested || c.getAttribute('name') === 'seal_img_div') im.setAttribute('style', DARKEN);
        box.appendChild(im);
      } else domToSvg(c, box, true);
    }
  }
}
function pageDivToSvg(div) {
  const w = px(div.style.width), h = px(div.style.height);
  const root = document.createElementNS(SVG, 'svg');
  root.setAttribute('xmlns', SVG);
  root.setAttribute('width', w); root.setAttribute('height', h); root.setAttribute('viewBox', `0 0 ${w} ${h}`);
  const bg = document.createElementNS(SVG, 'rect');
  bg.setAttribute('width', w); bg.setAttribute('height', h); bg.setAttribute('fill', '#fff');
  root.appendChild(bg);
  domToSvg(div, root);
  return { text: new XMLSerializer().serializeToString(root), w, h };
}

const parseXml = s => new DOMParser().parseFromString(String(s).replace(/^﻿/, ''), 'application/xml');
const byName = (doc, re) => [...doc.getElementsByTagName('*')].filter(e => re.test(e.localName));
const first = (doc, re) => { for (const e of byName(doc, re)) { const t = e.textContent.trim(); if (t && !e.children.length) return t; } return ''; };

// OFD 发票里的结构化信息，按可信程度依次找：
//   ① 附件里的发票数据（original_invoice.xml / 财政部 XBRL）→ ② 自定义标签指向的文字对象 → ③ OFD.xml 里的 CustomData → ④ 版面上的文字
async function ofdInfo(zip, JSZip) {
  const names = Object.keys(zip.files).filter(n => !zip.files[n].dir);
  const find = re => names.filter(n => re.test(n));
  const read = async n => parseXml(await zip.files[n].async('string'));
  const info = { no: '', date: '', seller: '', buyer: '', amount: null, sure: false, src: '' };
  const put = (k, v, src) => { if (v != null && v !== '' && (info[k] == null || info[k] === '')) { info[k] = v; if (k === 'amount') info.src = src; } };
  const texts = [];                             // 版面文字（第一页），备用
  let pageDoc = null;
  try {
    const pages = find(/(^|\/)Pages\/Page_\d+\/Content\.xml$/i).sort((a, b) => parseInt(a.match(/Page_(\d+)/i)[1], 10) - parseInt(b.match(/Page_(\d+)/i)[1], 10));
    if (pages.length) {
      pageDoc = await read(pages[0]);
      for (const t of byName(pageDoc, /^TextCode$/)) texts.push(t.textContent);
    }
  } catch (e) { console.warn('[invoice] page text', e); }
  // ① 附件
  for (const n of find(/(^|\/)Attachs?\/[^/]+\.xml$/i).filter(n => !/Attachments\.xml$/i.test(n))) {
    try {
      const d = await read(n);
      put('amount', money(first(d, /^(TaxInclusiveTotalAmount|TaxIncludedAmountInFigures)$/)), '附件数据');
      put('no', first(d, /^(InvoiceNo|NumberOfInvoice)$/));
      put('date', normDate(first(d, /^(IssueDate|DateOfIssue)$/)));
      put('seller', first(d, /^(SellerName|NameOfSeller)$/));
      put('buyer', first(d, /^(BuyerName|NameOfPurchaser)$/));
    } catch (e) { console.warn('[invoice] attach', n, e); }
  }
  // ② 自定义标签 → 对象 ID → 文字
  if (pageDoc) {
    for (const n of find(/(^|\/)Tags\/[^/]+\.xml$/i).filter(n => !/CustomTags\.xml$/i.test(n))) {
      try {
        const d = await read(n);
        const textOf = re => byName(d, re).map(e => byName(e, /^ObjectRef$/).map(r => {
          const id = r.textContent.trim();
          const o = byName(pageDoc, /^TextObject$/).find(t => t.getAttribute('ID') === id);
          return o ? byName(o, /^TextCode$/).map(t => t.textContent).join('') : '';
        }));
        const amt = textOf(/^TaxInclusiveTotalAmount$/).flat().map(money).filter(v => v != null);
        if (amt.length) put('amount', Math.max(...amt), '发票标签');
        put('no', textOf(/^InvoiceNo$/).flat().join('').trim());
        put('date', normDate(textOf(/^IssueDate$/).flat().join('')));
        put('seller', textOf(/^SellerName$/).map(a => a.join('')).join('').trim());
        put('buyer', textOf(/^BuyerName$/).map(a => a.join('')).join('').trim());
      } catch (e) { console.warn('[invoice] tags', n, e); }
    }
  }
  // ③ OFD.xml 的 CustomData
  try {
    const rootName = names.find(n => /^OFD\.xml$/i.test(n));
    const cd = {};
    for (const e of byName(await read(rootName), /^CustomData$/)) cd[e.getAttribute('Name')] = e.textContent.trim();
    const total = money(cd['价税合计']), a = money(cd['合计金额']), t = money(cd['合计税额']);
    put('amount', total != null ? total : a != null && t != null ? Math.round((a + t) * 100) / 100 : null, '文件属性');
    put('no', cd['发票号码']); put('date', normDate(cd['开票日期'] || '')); put('seller', cd['销售方名称']); put('buyer', cd['购买方名称']);
  } catch (e) { console.warn('[invoice] OFD.xml', e); }
  info.sure = info.amount != null;
  // ④ 版面文字
  const g = guessFromText(texts.join('\n'));
  if (info.amount == null && g.amount != null) { info.amount = g.amount; info.sure = g.sure; info.src = '版面文字'; }
  for (const k of ['no', 'date', 'seller', 'buyer']) put(k, g[k]);
  info.title = g.title;
  return info;
}

export async function openOfd(bytes) {
  const lib = await loadOfdLib();
  const docs = await new Promise((resolve, reject) => lib.parseOfdDocument({ ofd: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), success: resolve, fail: reject }));
  if (!docs || !docs.length || !docs[0].pages?.length) throw new Error('这个 OFD 里没有页面');
  const pages = [];
  for (const doc of docs) {
    lib.setPageScale(SCALE);
    const divs = lib.renderOfdByScale(doc);
    for (const div of divs) {
      const { text, w, h } = pageDivToSvg(div);
      const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
      pages.push({ kind: 'ofd', wmm: w / SCALE, hmm: h / SCALE, svg: text, url });
    }
  }
  let info = { no: '', date: '', seller: '', buyer: '', amount: null, sure: false, src: '' };
  try { info = await ofdInfo(await lib.JSZip.loadAsync(bytes), lib.JSZip); } catch (e) { console.warn('[invoice] info', e); }
  return { kind: 'ofd', pages, info };
}

// SVG → canvas（dpi 可以任意，矢量放大不糊）
export async function svgToCanvas(pg, pxPerMm, maxPixels = 9e6) {
  let k = pxPerMm;
  if (pg.wmm * pg.hmm * k * k > maxPixels) k = Math.sqrt(maxPixels / (pg.wmm * pg.hmm));
  const img = new Image();
  img.decoding = 'async';
  img.src = pg.url;
  await img.decode();
  const cv = document.createElement('canvas');
  cv.width = Math.round(pg.wmm * k); cv.height = Math.round(pg.hmm * k);
  const g = cv.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
  g.drawImage(img, 0, 0, cv.width, cv.height);
  return cv;
}

// ============ PDF / 图片 ============
export async function openPdf(bytes, askPassword) {
  const task = pdfjs.getDocument(docOpts(bytes));
  let password = '';
  task.onPassword = (update, reason) => { const p = askPassword ? askPassword(reason) : null; if (p == null) task.destroy(); else { password = p; update(p); } };
  const doc = await task.promise;
  const pages = [];
  let text = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    pages.push({ kind: 'pdf', page, idx: i - 1, wmm: vp.width / MM, hmm: vp.height / MM, rotate: page.rotate || 0 });
    if (i === 1) {
      try { text = pdfLines((await page.getTextContent()).items); } catch (e) { console.warn('[invoice] pdf text', e); }
    }
  }
  const info = guessFromText(text);
  info.src = info.amount != null ? '版面文字' : '';
  return { kind: 'pdf', pages, info, doc, bytes, password };
}
// PDF 里文字的先后顺序不一定是阅读顺序（税务平台导出的是「先画所有栏目名、再画所有内容」，一行字还会被拆成好几段）。
// 按位置重排：同一行（基线差 2.5pt 内）从左到右，挨得近的拼成一段，一段一行
export function pdfLines(items) {
  const its = items.map(it => ({ s: String(it.str || '').replace(/[\u2E80-\u2FDF]/g, c => c.normalize('NFKC')).replace(/\s+/g, ''), x: it.transform[4], y: it.transform[5], w: it.width || 0, h: Math.abs(it.height || it.transform[3] || 9) }))
    .filter(it => it.s && Math.abs(it.w) >= 0);
  its.sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const it of its) {
    const ln = lines.find(l => Math.abs(l.y - it.y) <= 2.5);
    if (ln) ln.items.push(it); else lines.push({ y: it.y, items: [it] });
  }
  const out = [];
  for (const ln of lines) {
    ln.items.sort((a, b) => a.x - b.x);
    let seg = null;
    for (const it of ln.items) {
      if (seg && it.x - seg.end <= Math.max(it.h, seg.h) * 1.3) { seg.s += it.s; seg.end = Math.max(seg.end, it.x + it.w); }
      else { if (seg) out.push(seg.s); seg = { s: it.s, end: it.x + it.w, h: it.h }; }
    }
    if (seg) out.push(seg.s);
  }
  return out.join('\n');
}
export function closePdf(doc) { if (doc) (doc.loadingTask || doc).destroy?.(); }
export async function renderPdfPage(pg, cv, pxW) {
  const vp1 = pg.page.getViewport({ scale: 1 });
  const vp = pg.page.getViewport({ scale: pxW / vp1.width });
  cv.width = Math.max(1, Math.round(vp.width)); cv.height = Math.max(1, Math.round(vp.height));
  const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
  await pg.page.render({ canvas: cv, canvasContext: g, viewport: vp }).promise;
}
export async function openImage(file) {
  const bmp = await createImageBitmap(file);
  // 照片没有物理尺寸：按一张发票的宽度（210 毫米）算
  const wmm = bmp.width >= bmp.height ? 210 : 140;
  return { kind: 'img', pages: [{ kind: 'img', bmp, file, wmm, hmm: wmm * bmp.height / bmp.width }], info: { no: '', date: '', seller: '', buyer: '', amount: null, sure: false, src: '' } };
}

// ============ 从文字里认发票信息（PDF 发票、没有结构化数据的 OFD） ============
export function money(s) {
  if (s == null) return null;
  const m = String(s).replace(/[,，\s]/g, '').match(/-?\d+(?:\.\d{1,2})?/);
  if (!m) return null;
  const v = Number(m[0]);
  return Number.isFinite(v) ? v : null;
}
export function normDate(s) {
  const m = String(s || '').replace(/\s/g, '').match(/(\d{4})[年\-\/.](\d{1,2})[月\-\/.](\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : '';
}
// 规则：带 ¥ 的两位小数里最大的那个就是价税合计（价税合计 = 金额 + 税额，不会比它们小；单价不带 ¥）。
// 版面上有「价税合计」或「小写」才算有把握，否则标成「请核对」
export function guessFromText(raw) {
  const text = String(raw || '').replace(/[\u2E80-\u2FDF]/g, c => c.normalize('NFKC'));   // 康熙部首 → 常用字
  // 一行（一个文字对象 / 一段）内部去掉空白；行与行之间用 \x01 隔开，免得两行数字连成一个数
  const flat = text.split('\n').map(l => l.replace(/\s+/g, '')).filter(Boolean).join('\x01');
  const flat0 = flat.replace(/\x01/g, '');
  const out = { no: '', date: '', seller: '', buyer: '', amount: null, sure: false, src: '', title: '' };
  const num = m => Number(m.replace(/,/g, ''));
  const amts = [...flat.matchAll(/[¥￥]\x01?(-?\d[\d,]*\.\d{2})(?![\d.])/g)].map(m => num(m[1])).filter(Number.isFinite);
  const small = flat.match(/[（(]小写[）)][:：]?\x01?[¥￥]?\x01?(-?\d[\d,]*\.\d{2})(?![\d.])/);
  if (small) { out.amount = num(small[1]); out.sure = true; }
  else if (amts.length) { out.amount = amts.reduce((a, b) => Math.abs(b) > Math.abs(a) ? b : a); out.sure = /价税合计|小写/.test(flat0); }
  else {
    const fare = flat.match(/票价[:：]?\x01?[¥￥]?\x01?(\d[\d,]*\.\d{2})(?![\d.])/);
    if (fare) { out.amount = num(fare[1]); out.sure = false; }
  }
  const no = flat.match(/发票号码[:：]?\x01?(\d{8,20})(?![\d.])/) || flat.match(/(?<![\d.])(\d{20})(?![\d.])/);
  if (no) out.no = no[1];
  const d = flat0.match(/开票日期[:：]?(\d{4}年\d{1,2}月\d{1,2}日)/) || flat0.match(/(\d{4}年\d{1,2}月\d{1,2}日)/);
  if (d) out.date = normDate(d[1]);
  // 「名称：」出现两次时，第一个是购买方、第二个是销售方（标准版式从左到右）
  const names = [...text.matchAll(/名\s*称\s*[:：]\s*([^\s:：]{2,40})/g)].map(m => m[1]);
  if (names.length >= 2) { out.buyer = names[0]; out.seller = names[1]; }
  const sel = text.match(/销\s*售\s*方[\s\S]{0,12}?名\s*称\s*[:：]\s*([^\s:：]{2,40})/);
  if (sel) out.seller = sel[1];
  const t = flat0.match(/(电子发票[（(][^）)]{2,12}[）)]|[一-龥]{0,8}增值税电子(?:普通|专用)发票|电子发票[（(]铁路电子客票[）)]|铁路电子客票|航空运输电子客票行程单)/);
  if (t) out.title = t[1];
  return out;
}

// ============ 排版 ============
// sheets：[{ wmm, hmm }]；per：每页几张（1 / 2 / 4）；返回 [{ land, cells:[{ i, x, y, w, h }] }]（毫米，原点在左上）
// 竖版的整页文件（行程单、清单）不缩小：单独占一页
export function layout(sheets, per, { margin = 4 } = {}) {
  const pages = [];
  const land = per === 4;
  const PW = land ? A4.h : A4.w, PH = land ? A4.w : A4.h;
  const cols = per === 4 ? 2 : 1, rows = per === 1 ? 1 : 2;
  const cw = PW / cols, ch = PH / rows;
  let cur = null;
  const flush = () => { if (cur && cur.cells.length) pages.push(cur); cur = null; };
  sheets.forEach((s, i) => {
    const tall = s.hmm > s.wmm * 1.15;
    if (tall && per > 1) {
      flush();
      pages.push({ land: false, w: A4.w, h: A4.h, cells: [fit(s, i, 0, 0, A4.w, A4.h, margin, 'center')] });
      return;
    }
    if (!cur) cur = { land, w: PW, h: PH, cells: [] };
    const n = cur.cells.length;
    const cx = (n % cols) * cw, cy = Math.floor(n / cols) * ch;
    // 每页 1 张：横版的发票靠上放（和平时直接打印一样），竖版的居中
    cur.cells.push(fit(s, i, cx, cy, cw, per === 1 ? PH : ch, margin, per === 1 && !tall ? 'top' : 'center'));
    if (cur.cells.length === cols * rows) flush();
  });
  flush();
  return pages;
}
function fit(s, i, cx, cy, cw, ch, margin, align) {
  const k = Math.min((cw - margin * 2) / s.wmm, (ch - margin * 2) / s.hmm, 1);
  const w = s.wmm * k, h = s.hmm * k;
  return { i, x: cx + (cw - w) / 2, y: align === 'top' ? cy + margin : cy + (ch - h) / 2, w, h, k, cx, cy, cw, ch };
}

// ============ 导出 PDF ============
let pdfLibP = null;
function loadPdfLib() {
  return pdfLibP ||= new Promise((resolve, reject) => {
    if (window.PDFLib) return resolve(window.PDFLib);
    const s = document.createElement('script');
    s.src = new URL('../vendor/pdf-lib/pdf-lib.min.js', import.meta.url).href;
    s.onload = () => resolve(window.PDFLib); s.onerror = () => { pdfLibP = null; reject(new Error('pdf-lib 下载失败，请检查网络后重试')); };
    document.head.appendChild(s);
  });
}
const canvasBlob = (cv, type, q) => new Promise(r => cv.toBlob(r, type, q));

// sheets：[{ pg（页面对象）, file（所属文件）}]；opts：{ per, cut（裁剪线）, dpi }
export async function exportPdf(sheets, opts, onProgress = () => {}) {
  const { PDFDocument, rgb, degrees } = await loadPdfLib();
  const out = await PDFDocument.create();
  out.setTitle('发票合并打印'); out.setProducer('开源宝藏工具箱 · pdf-lib'); out.setCreator('开源宝藏工具箱');
  const pagesL = layout(sheets.map(s => s.pg), opts.per);
  const dpi = opts.dpi || 300;
  const srcDocs = new Map();                    // 每个源 PDF 只载入一次
  let done = 0;
  for (const P of pagesL) {
    const page = out.addPage([P.w * MM, P.h * MM]);
    const H = P.h * MM;
    for (const c of P.cells) {
      const { pg, file } = sheets[c.i];
      const x = c.x * MM, w = c.w * MM, h = c.h * MM, y = H - (c.y + c.h) * MM;
      if (pg.kind === 'pdf') {
        // PDF 发票：原样嵌入（文字还是文字，放大不糊）
        let src = srcDocs.get(file);
        if (!src) { src = await PDFDocument.load(file.bytes, { ignoreEncryption: true }); srcDocs.set(file, src); }
        const [emb] = await out.embedPdf(src, [pg.idx]);
        const rot = ((pg.rotate % 360) + 360) % 360;
        if (rot === 0) page.drawPage(emb, { x, y, width: w, height: h });
        else if (rot === 90) page.drawPage(emb, { x, y: y + h, width: h, height: w, rotate: degrees(-90) });
        else if (rot === 180) page.drawPage(emb, { x: x + w, y: y + h, width: w, height: h, rotate: degrees(180) });
        else page.drawPage(emb, { x: x + w, y, width: h, height: w, rotate: degrees(90) });
      } else {
        let cv;
        if (pg.kind === 'ofd') cv = await svgToCanvas(pg, dpi / 25.4);
        else {
          const k = Math.min(1, (c.w / 25.4 * dpi) / pg.bmp.width);
          cv = document.createElement('canvas');
          cv.width = Math.round(pg.bmp.width * k); cv.height = Math.round(pg.bmp.height * k);
          const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
          g.imageSmoothingQuality = 'high'; g.drawImage(pg.bmp, 0, 0, cv.width, cv.height);
        }
        const blob = await canvasBlob(cv, 'image/jpeg', 0.9);
        const jpg = await out.embedJpg(new Uint8Array(await blob.arrayBuffer()));
        page.drawImage(jpg, { x, y, width: w, height: h });
        cv.width = cv.height = 0;
      }
      onProgress(++done / sheets.length);
    }
    if (opts.cut && P.cells.length && (P.cells.length > 1 || opts.per > 1) && P.cells[0].cw) {
      const col = rgb(0.6, 0.6, 0.6), dash = [3, 3];
      const cols = Math.round(P.w / P.cells[0].cw), rows = Math.round(P.h / P.cells[0].ch);
      for (let r = 1; r < rows; r++) page.drawLine({ start: { x: 0, y: H - r * P.cells[0].ch * MM }, end: { x: P.w * MM, y: H - r * P.cells[0].ch * MM }, thickness: 0.4, color: col, dashArray: dash });
      for (let q = 1; q < cols; q++) page.drawLine({ start: { x: q * P.cells[0].cw * MM, y: 0 }, end: { x: q * P.cells[0].cw * MM, y: H }, thickness: 0.4, color: col, dashArray: dash });
    }
  }
  const bytes = await out.save();
  return { bytes, pages: pagesL.length, layout: pagesL };
}

// 单张发票按原尺寸存成 PDF（OFD 转 PDF）：页面大小 = 发票大小
export async function exportOriginal(file, dpi = 300) {
  const { PDFDocument } = await loadPdfLib();
  const out = await PDFDocument.create();
  out.setTitle(file.info?.seller ? `发票 ${file.info.seller}` : '发票'); out.setProducer('开源宝藏工具箱 · pdf-lib'); out.setCreator('开源宝藏工具箱');
  for (const pg of file.pages) {
    const page = out.addPage([pg.wmm * MM, pg.hmm * MM]);
    let cv;
    if (pg.kind === 'ofd') cv = await svgToCanvas(pg, dpi / 25.4);
    else { cv = document.createElement('canvas'); cv.width = pg.bmp.width; cv.height = pg.bmp.height; const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(pg.bmp, 0, 0); }
    const blob = await canvasBlob(cv, 'image/jpeg', 0.9);
    const jpg = await out.embedJpg(new Uint8Array(await blob.arrayBuffer()));
    page.drawImage(jpg, { x: 0, y: 0, width: pg.wmm * MM, height: pg.hmm * MM });
    cv.width = cv.height = 0;
  }
  return out.save();
}

// 预览导出的 PDF 的某一页（看到的就是打印出来的）
export async function previewPdf(bytes, n, cv, pxW) {
  const task = pdfjs.getDocument(docOpts(bytes));
  try {
    const doc = await task.promise;
    const page = await doc.getPage(Math.min(n, doc.numPages));
    const vp1 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: pxW / vp1.width });
    cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
    const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
    await page.render({ canvas: cv, canvasContext: g, viewport: vp }).promise;
    return doc.numPages;
  } finally { task.destroy(); }
}

// ============ 报销清单 ============
export const fmtMoney = v => v == null ? '' : v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export function sum(files) { return Math.round(files.reduce((a, f) => a + (f.info.amount || 0), 0) * 100) / 100; }
export function toCsv(files) {
  const q = v => { v = String(v ?? ''); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  // 发票号码是 20 位数字，Excel 会变成科学计数法 → 前面加制表符当文本
  const rows = [['序号', '发票号码', '开票日期', '销售方', '金额（价税合计）', '文件名']];
  files.forEach((f, i) => rows.push([i + 1, f.info.no ? '\t' + f.info.no : '', f.info.date, f.info.seller, f.info.amount != null ? f.info.amount.toFixed(2) : '', f.name]));
  rows.push(['合计', '', '', `${files.length} 张`, sum(files).toFixed(2), '']);
  return '﻿' + rows.map(r => r.map(q).join(',')).join('\r\n') + '\r\n';
}
