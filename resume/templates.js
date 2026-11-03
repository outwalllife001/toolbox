// 简历模板：数据 → A4 页面的 HTML（样式在 tpl.css，单位用 pt，和 PDF 一致）
// 4 套版式移植自 Reactive Resume（MIT，https://github.com/reactive-resume/reactive-resume）的
// Onyx / Gengar / Pikachu / Kakuna 模板（packages/pdf/src/templates/*）：页眉、侧栏、标题线、主色和浅色底的用法照原版，
// 改成了中文简历的习惯：一寸照片（5:7）、联系方式一行竖线隔开、经历描述每行一个圆点。
// 每个「块」（.blk）在分页时不会被拆开；data-f 对应表单里的字段，编辑时预览自动滚到那里。

export const TEMPLATES = [
  { id: 'onyx', name: '简约', from: 'Onyx' },
  { id: 'gengar', name: '左栏', from: 'Gengar' },
  { id: 'pikachu', name: '商务', from: 'Pikachu' },
  { id: 'kakuna', name: '居中', from: 'Kakuna' },
];
export const COLORS = ['#1f4e8c', '#2563eb', '#0f766e', '#9f1239', '#b45309', '#334155'];
// 放在侧栏的模块（左栏 / 商务模板）
const SIDE = new Set(['skills', 'awards']);

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const lines = t => String(t || '').split(/\n+/).map(s => s.replace(/^\s*[•·\-–—*●○◆■▪]\s*/, '').trim()).filter(Boolean);
const has = it => it && ['org', 'role', 'start', 'end', 'desc', 'text'].some(k => String(it[k] || '').trim());

export function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`;
}

function contacts(b) {
  const out = [];
  if (b.phone) out.push(['电话', b.phone, 'phone']);
  if (b.email) out.push(['邮箱', b.email, 'email']);
  if (b.city) out.push(['城市', b.city, 'city']);
  if (b.age) out.push(['年龄', b.age, 'age']);
  if (b.politics) out.push(['政治面貌', b.politics, 'politics']);
  if (b.wechat) out.push(['微信', b.wechat, 'wechat']);
  return out;
}
const contactRow = b => contacts(b).map(([, v, k], i) => `${i ? '<i class="sep">|</i>' : ''}<span data-f="b.${k}">${esc(v)}</span>`).join('');
const contactList = b => contacts(b).map(([l, v, k]) => `<p class="cl blk" data-f="b.${k}"><small>${l}</small>${esc(v)}</p>`).join('');
const photo = b => (b.photo && b.showPhoto !== false) ? `<img class="ph" src="${b.photo}" alt="">` : '';
const name = b => b.name ? `<h1 class="nm" data-f="b.name">${esc(b.name)}</h1>` : `<h1 class="nm ph-txt" data-nopdf data-f="b.name">你的名字</h1>`;
const title = b => b.title ? `<p class="ti" data-f="b.title">求职意向：${esc(b.title)}</p>` : '';

function entry(s, it, i) {
  const date = [it.start, it.end].filter(Boolean).join(' – ');
  const ds = lines(it.desc);
  const body = ds.length > 1 ? `<ul class="ds">${ds.map(l => `<li><span class="bu">•</span><span>${esc(l)}</span></li>`).join('')}</ul>`
    : ds.length ? `<p class="dp">${esc(ds[0])}</p>` : '';
  return `<div class="it blk" data-f="${s.id}.${i}">
    <div class="ih"><b class="io">${esc(it.org)}</b>${date ? `<span class="idt">${esc(date)}</span>` : ''}</div>
    ${it.role ? `<p class="ir">${esc(it.role)}</p>` : ''}${body}</div>`;
}
function textSec(s, side) {
  const ls = lines(s.items[0]?.text);
  if (!ls.length) return '';
  if (side) return ls.map((l, j) => `<p class="tl blk" data-f="${s.id}.0">${esc(l)}</p>`).join('');
  if (ls.length === 1) return `<p class="tp blk" data-f="${s.id}.0">${esc(ls[0])}</p>`;
  return `<ul class="ds tx">${ls.map(l => `<li class="blk" data-f="${s.id}.0"><span class="bu">•</span><span>${esc(l)}</span></li>`).join('')}</ul>`;
}
function section(s, side = false) {
  if (s.hidden) return '';
  const items = s.items.filter(has);
  if (!items.length) return '';
  const body = s.type === 'text' ? textSec(s, side) : s.items.map((it, i) => has(it) ? entry(s, it, i) : '').join('');
  if (!body) return '';
  return `<section class="sec" data-s="${s.id}"><h2 class="sh blk keep" data-f="${s.id}.t"><span>${esc(s.title)}</span></h2>${body}</section>`;
}
function split(d, sideOn) {
  const main = [], side = [];
  for (const s of d.sections) (sideOn && SIDE.has(s.type === 'text' ? s.id : '') ? side : main).push(s);
  return [main.map(s => section(s)).join(''), side.map(s => section(s, true)).join('')];
}

const R = {
  // Onyx：照片在左、名字和联系方式在右，页眉下一条主色线；单栏
  onyx(d) {
    const b = d.basics;
    return `<header class="hd blk">${photo(b)}<div class="hd-t">${name(b)}${title(b)}<p class="ct">${contactRow(b)}</p></div></header>
      <div class="col">${split(d, false)[0]}</div>`;
  },
  // Gengar：左侧浅色底侧栏，顶上一块主色（照片、名字、联系方式），技能、奖项放侧栏
  gengar(d) {
    const b = d.basics; const [main, side] = split(d, true);
    return `<aside class="side col"><div class="hd blk">${photo(b)}${name(b)}${title(b)}</div><div class="cls">${contactList(b)}</div>${side}</aside>
      <div class="main col">${main}</div>`;
  },
  // Pikachu：左窄栏放照片和技能，右边页眉是一块圆角主色底
  pikachu(d) {
    const b = d.basics; const [main, side] = split(d, true);
    return `<aside class="side col">${photo(b) ? `<div class="phw blk">${photo(b)}</div>` : ''}${side}</aside>
      <div class="main col"><header class="hd blk">${name(b)}${title(b)}<p class="ct">${contactRow(b)}</p></header>${main}</div>`;
  },
  // Kakuna：照片、名字、联系方式都居中，模块标题居中加下划线
  kakuna(d) {
    const b = d.basics;
    return `<header class="hd blk">${photo(b)}${name(b)}${title(b)}<p class="ct">${contactRow(b)}</p></header>
      <div class="col">${split(d, false)[0]}</div>`;
  },
};

export const DENSITY = [ // 「压成一页」逐级收紧：字号 / 行距 / 间距
  { fs: 10, lh: 1.55, g: 1 }, { fs: 10, lh: 1.45, g: .82 }, { fs: 9.5, lh: 1.45, g: .72 },
  { fs: 9.5, lh: 1.38, g: .62 }, { fs: 9, lh: 1.38, g: .55 }, { fs: 9, lh: 1.32, g: .45 },
];

export function render(el, d) {
  const t = R[d.tpl] ? d.tpl : 'onyx';
  const den = DENSITY[d.density | 0] || DENSITY[0];
  el.className = `rs t-${t}`;
  el.style.cssText = `--c:${d.color};--ct:${hexA(d.color, .14)};--cl:${hexA(d.color, .35)};--fs:${den.fs}pt;--lh:${den.lh};--g:${den.g}`;
  const empty = !d.basics.name && !d.sections.some(s => s.items.some(has));
  el.innerHTML = R[t](d) + (empty ? '<p class="rs-empty" data-nopdf>在下面填写，这里实时排好简历</p>' : '');
}

// 分页：A4 一页 297mm。一个块跨过页底就整块挪到下一页（插一段空白），标题跟着下一块走。返回页数
export const PAGE_W = 793.7, PAGE_H = 1122.52;  // CSS px（96dpi）
export function paginate(el) {
  el.querySelectorAll('.pgsp,.pgcut').forEach(x => x.remove());
  el.style.minHeight = '';
  const r0 = el.getBoundingClientRect(), k = r0.width / PAGE_W;
  const top = x => (x.getBoundingClientRect().top - el.getBoundingClientRect().top) / k;
  const padY = parseFloat(getComputedStyle(el).getPropertyValue('--py')) || 34;
  const blocks = [...el.querySelectorAll('.blk')];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const r = b.getBoundingClientRect(), t = top(b), h = r.height / k;
    if (h < 1) continue;
    const p = Math.floor(t / PAGE_H), limit = (p + 1) * PAGE_H - padY;
    if (t + h <= limit + .5 || h > PAGE_H - 2 * padY) continue;
    // 前一个块是标题（keep），就从标题开始挪
    let mv = b; const prev = blocks[i - 1];
    if (prev && prev.classList.contains('keep') && prev.closest('.col') === b.closest('.col') && Math.floor(top(prev) / PAGE_H) === p) mv = prev;
    const want = (p + 1) * PAGE_H + padY;
    const sp = document.createElement('div'); sp.className = 'pgsp';
    sp.style.height = Math.max(0, want - top(mv)) + 'px';
    mv.parentNode.insertBefore(sp, mv);
    // flex 的 gap 会多出一截：量一次再补齐
    const off = top(mv) - want;
    if (Math.abs(off) > .5) sp.style.height = Math.max(0, parseFloat(sp.style.height) - off) + 'px';
  }
  const h = el.scrollHeight;
  const pages = Math.max(1, Math.ceil((h - 2) / PAGE_H));
  el.style.minHeight = pages * PAGE_H + 'px';
  for (let p = 1; p < pages; p++) el.insertAdjacentHTML('beforeend', `<div class="pgcut" data-nopdf style="top:${p * PAGE_H}px"><span>第 ${p + 1} 页</span></div>`);
  return pages;
}
