// 笔记 / 提纲文字 → 思维导图数据（simple-mind-map 的节点树 {data:{text}, children:[]}）
// 不依赖浏览器，node 里也能跑（days/day14-mindmap/test_core.mjs）
//
// 分层规则（常见的笔记写法都认）：
//   缩进（空格、Tab、全角空格）越深越靠下一级
//   Markdown 标题 # / ## / ###，列表 - * + • ·
//   编号：第一章 / 一、/（一）/ 1. 1、/ 1.1 / 1.1.1 /（1）/ 1) / ① / a.
//   同一缩进下，第一次出现的编号样式算下一级，再出现同样的编号就回到那一级（「一、」下面的「1.」是子项，下一个「二、」回到上一级）
//   没有编号的普通文字跟在有编号的行后面，算它的子项
// 第一行没有编号、后面还有内容时，第一行当中心主题；否则中心主题叫「中心主题」，点一下可以改

const NUM_CN = '一二三四五六七八九十百零〇两';
const MARKERS = [
  // [样式, 正则, 是否保留编号文字]
  ['chap', new RegExp(`^第[0-9${NUM_CN}]+[章节部分单元课篇回讲周天]`), true],
  ['cn', new RegExp(`^[${NUM_CN}]+\\s*[、．.]\\s*`)],
  ['pcn', new RegExp(`^[（(]\\s*[${NUM_CN}]+\\s*[)）]\\s*[、．.]?\\s*`)],
  ['dec', /^\d+(?:[.．]\d+)+(?![\d])[.．、]?\s*/],
  ['num', /^\d+\s*[、．.](?![\d])\s*/],
  ['pnum', /^[（(]\s*\d+\s*[)）]\s*[、．.]?\s*/],
  ['nump', /^\d+\s*[)）]\s*/],
  ['numsp', /^\d{1,2}\s+(?=\S)/],   // 「1 绪论」：全文至少两行这样写才算编号（见 parseOutline）
  ['circ', /^[①-⑳㉑-㉟㊱-㊿❶-❿]\s*/],
  ['lat', /^[a-zA-Z]\s*[.)）、]\s+/],
  ['bul', /^(?:[-*+•·▪◦●○■□◆◇➢►▶✓√]|\d+\s*[:：](?=\s))\s+/],
];

// 一行开头的空白宽度：Tab 算 4，全角空格算 2
function indentOf(line) {
  let w = 0;
  for (const ch of line) {
    if (ch === ' ' || ch === ' ') w += 1;
    else if (ch === '\t') w += 4;
    else if (ch === '　') w += 2;
    else break;
  }
  return w;
}

// 去掉 Markdown 的加粗、行内代码、链接、待办框
function cleanText(t) {
  return t
    .replace(/^\[[ xX]\]\s+/, '')
    .replace(/\*\*(.+?)\*\*|__(.+?)__/g, (_, a, b) => a || b)
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

// 把一行分成 {indent, type, text}。ctx.dec / ctx.numsp：全文里这种写法够多才当编号（不然「3.5 小时」「3 个苹果」会被拆掉数字）
export function classify(raw, ctx = { dec: true, numsp: true }) {
  const indent = indentOf(raw);
  let s = raw.trim();
  const h = s.match(/^(#{1,6})\s+/);
  if (h) return { indent, type: 'h' + h[1].length, text: cleanText(s.slice(h[0].length)) };
  // Markdown 的有序 / 无序列表也可能带 1. 编号，统一走下面
  for (const [type, re, keep] of MARKERS) {
    if ((type === 'dec' && !ctx.dec) || (type === 'numsp' && !ctx.numsp)) continue;
    const m = s.match(re);
    if (!m) continue;
    let t = keep ? s : s.slice(m[0].length);
    // 1.1 / 1.1.1 按点的个数分级
    const ty = type === 'dec' ? 'dec' + (m[0].match(/[.．]\d/g) || []).length : type;
    if (!cleanText(t)) continue;   // 只有编号没有字（比如一行「1.」）当普通文字
    return { indent, type: ty, text: cleanText(t) };
  }
  return { indent, type: 'plain', text: cleanText(s) };
}

const MAX_NODES = 3000, MAX_LEN = 300;

// 主函数：返回 {root, count, rootGuessed}
export function parseOutline(text, opts = {}) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n')
    .filter(l => l.trim() && !/^\s*(?:[-*_]\s*){3,}$/.test(l) && !/^\s*```/.test(l));
  const ctx = {
    // 1.1 这种：至少两行，或者一行但全文还有「1.」「2.」这样的编号（「2. 午饭 / 2.1 米饭」）
    dec: (n => n >= 2 || (n === 1 && lines.filter(l => /^\s*\d+\s*[、．.](?![\d])/.test(l)).length >= 2))(lines.filter(l => /^\s*\d+(?:[.．]\d+)+(?![\d])[.．、]?\s*\S/.test(l)).length),
    numsp: new Set(lines.map(l => (l.match(/^\s*(\d{1,2})\s+\S/) || [])[1]).filter(Boolean)).size >= 2,
  };
  const items = lines.map(l => classify(l, ctx)).filter(it => it.text);
  if (!items.length) return { root: node(opts.rootText || '中心主题'), count: 1, rootGuessed: true };

  const first = items[0];
  // 第一行没编号（或者是全文唯一的一级标题 / 唯一的「第X章」）就当中心主题；一列没编号的清单，第一行也是标题（「购物清单 / 牛奶 / 鸡蛋」）
  const firstIsTitle = items.length > 1 && (
    first.type === 'plain'
    || (/^h[12]$/.test(first.type) && !items.slice(1).some(it => it.type === first.type))
    || (first.type === 'chap' && !items.slice(1).some(it => it.type === 'chap'))
  );
  let root, rest, rootGuessed = false;
  if (firstIsTitle) { root = node(first.text); rest = items.slice(1); }
  else if (items.length === 1) { root = node(first.text); rest = []; }
  else { root = node(opts.rootText || '中心主题'); rest = items; rootGuessed = true; }

  const stack = [{ indent: -1, type: 'root', n: root }];
  let count = 1;
  for (const it of rest) {
    if (count >= MAX_NODES) break;
    while (stack.length > 1 && stack[stack.length - 1].indent > it.indent) stack.pop();
    if (stack.length > 1 && stack[stack.length - 1].indent === it.indent) {
      // 同一缩进：往回找同样编号样式的一级，找到就和它并列
      let k = -1;
      for (let i = stack.length - 1; i >= 1 && stack[i].indent === it.indent; i--) if (stack[i].type === it.type) { k = i; break; }
      if (k >= 1) stack.length = k;
      // 找不到：新的编号样式（或者普通文字跟在编号行后面）算下一级
    }
    const n = node(it.text);
    stack[stack.length - 1].n.children.push(n);
    stack.push({ indent: it.indent, type: it.type, n });
    count++;
  }
  tidy(root);
  return { root, count, rootGuessed };
}

function node(text) {
  return { data: { text: text.length > MAX_LEN ? text.slice(0, MAX_LEN) + '…' : text }, children: [] };
}

// 有子项的标题去掉末尾的冒号（「主要人物：」→「主要人物」）
function tidy(n) {
  if (n.children.length) {
    n.data.text = n.data.text.replace(/\s*[:：]\s*$/, '') || n.data.text;
    n.children.forEach(tidy);
  }
}

// 节点树 → 缩进文字（复制大纲用）
export function toOutline(root, indent = '  ') {
  const out = [];
  const walk = (n, d) => {
    out.push(indent.repeat(d) + (d ? '- ' : '') + plain(n.data.text));
    (n.children || []).forEach(c => walk(c, d + 1));
  };
  walk(root, 0);
  return out.join('\n');
}

// 节点文字里可能有富文本标签（导入的文件），取纯文字
export function plain(t) {
  return String(t ?? '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();
}

export function countNodes(n) {
  return 1 + (n.children || []).reduce((s, c) => s + countNodes(c), 0);
}

export function depthOf(n) {
  return 1 + Math.max(0, ...(n.children || []).map(depthOf));
}

// ---------- 配色 ----------
// 每套：背景、中心主题（底色, 字色）、二级主题的底色（按分支轮流用，同时是连线颜色）、二级字色、其余文字色
export const FONT = '-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
export const PALETTES = [
  { id: 'rainbow', name: '彩虹', bg: '#ffffff', root: ['#26303f', '#ffffff'], branches: ['#ff6b6b', '#ff9f43', '#20bf6b', '#3d8bfd', '#8854d0', '#f368e0', '#0fb9b1'], second: '#ffffff', text: '#2d3440' },
  { id: 'mint', name: '清新', bg: '#f2faf7', root: ['#0b8f76', '#ffffff'], branches: ['#14b38f'], second: '#ffffff', text: '#24403a' },
  { id: 'sky', name: '天蓝', bg: '#f1f6ff', root: ['#1d4ed8', '#ffffff'], branches: ['#3b82f6', '#0ea5e9'], second: '#ffffff', text: '#1e2a44' },
  { id: 'peach', name: '蜜桃', bg: '#fff6f3', root: ['#e8590c', '#ffffff'], branches: ['#ff8a5c', '#f06595'], second: '#ffffff', text: '#4a2a22' },
  { id: 'paper', name: '手账', bg: '#fbf6ea', root: ['#6d4c41', '#fffaf0'], branches: ['#f4a261', '#e9c46a', '#8ab17d', '#7fb3d5', '#c39bd3', '#e5989b'], second: '#3b2a20', text: '#4e3b2f' },
  { id: 'night', name: '夜空', bg: '#1b1e2b', root: ['#ffd166', '#1b1e2b'], branches: ['#ff8fab', '#ffd166', '#06d6a0', '#4cc9f0', '#b388ff'], second: '#1b1e2b', text: '#e9ecf5' },
];

// 结构（simple-mind-map 的 layout）
export const LAYOUTS = [
  { id: 'logicalStructure', name: '逻辑图' },
  { id: 'mindMap', name: '思维导图' },
  { id: 'organizationStructure', name: '组织图' },
  { id: 'catalogOrganization', name: '目录图' },
  { id: 'timeline', name: '时间轴' },
  { id: 'fishbone', name: '鱼骨图' },
];

// 配色 → simple-mind-map 的主题配置（分支底色另外写进二级节点的数据里，见 app.js paintBranches）
export function themeConfigOf(p) {
  return {
    backgroundColor: p.bg,
    lineWidth: 2.5,
    lineColor: p.branches[0],
    lineStyle: 'curve',
    rootLineKeepSameInCurve: false,
    lineRadius: 8,
    generalizationLineColor: p.branches[0],
    paddingX: 14,
    paddingY: 7,
    root: { shape: 'rectangle', fillColor: p.root[0], color: p.root[1], fontFamily: FONT, fontSize: 20, fontWeight: 'bold', borderColor: 'transparent', borderWidth: 0, borderRadius: 12 },
    second: { shape: 'rectangle', fillColor: p.branches[0], color: p.second, fontFamily: FONT, fontSize: 16, fontWeight: 'bold', borderColor: 'transparent', borderWidth: 0, borderRadius: 9, marginX: 56, marginY: 22 },
    node: { shape: 'rectangle', fillColor: 'transparent', color: p.text, fontFamily: FONT, fontSize: 14, fontWeight: 'normal', borderColor: 'transparent', borderWidth: 0, borderRadius: 6, marginX: 36, marginY: 6 },
    generalization: { fillColor: p.bg, color: p.text, borderColor: p.branches[0], fontFamily: FONT, fontSize: 14 },
  };
}
