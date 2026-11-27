// 店铺海报：尺寸、配色、字体、模板、贴纸。这里只产出数据（fabric.js / 快图设计通用的 JSON），不碰 DOM，node 里也能跑。
// 模板都按 1242×1656（3:4）设计，换尺寸时用 resizeJson 把每个元素按比例挪位置、缩放（见函数注释）。
// 每个元素的 extension 里记着：role（跟着配色变的颜色）、font、fit / base（单行文字太长时自动缩小）、bleed / anchor（换尺寸时怎么摆）、kind（slot 图片位 / photo 照片）

export const BASE = { w: 1242, h: 1656 };
export const SIZES = [
  { id: 'p34', name: '竖版海报', ratio: '3:4', w: 1242, h: 1656, mult: 1, use: '朋友圈、小红书、群里发' },
  { id: 'p916', name: '手机全屏', ratio: '9:16', w: 1080, h: 1920, mult: 1, use: '手机全屏看、短视频封面' },
  { id: 'sq', name: '方形主图', ratio: '1:1', w: 1080, h: 1080, mult: 1, use: '商品主图、头像位' },
  { id: 'a4', name: 'A4 打印', ratio: 'A4', w: 1240, h: 1754, mult: 2, use: '打印出来贴店里（300dpi）' },
];
export const sizeOf = id => SIZES.find(s => s.id === id) || SIZES[0];

// 配色：8 个角色。bg 底色 / panel 大块浅色面板 / title 底色上的大标题 / text 底色上的正文 /
// brand 色块、丝带、按钮 / onBrand 色块上的字 / accent 小点缀（只给图形用，不给字用）/ onPanel 面板上的字
export const PALETTES = [
  { id: 'orange', name: '奶油橙', bg: '#FFF4E3', panel: '#FFFFFF', title: '#E8590C', text: '#5C4033', brand: '#FF7A1A', onBrand: '#FFFFFF', accent: '#FFC53D', onPanel: '#5C4033' },
  { id: 'green', name: '清新绿', bg: '#EAF6EC', panel: '#FFFFFF', title: '#1F7A3F', text: '#2F4F3A', brand: '#2FA35B', onBrand: '#FFFFFF', accent: '#FFD43B', onPanel: '#2F4F3A' },
  { id: 'red', name: '喜庆红', bg: '#C8161D', panel: '#FFF3D6', title: '#FFE08A', text: '#FFF3D6', brand: '#FFD34E', onBrand: '#A30F15', accent: '#FFE9A8', onPanel: '#A30F15' },
  { id: 'pink', name: '樱花粉', bg: '#FFE3EC', panel: '#FFFFFF', title: '#D6336C', text: '#6B3A4B', brand: '#F06595', onBrand: '#FFFFFF', accent: '#FFD43B', onPanel: '#6B3A4B' },
  { id: 'blue', name: '天空蓝', bg: '#E7F5FF', panel: '#FFFFFF', title: '#1864AB', text: '#2B4A66', brand: '#228BE6', onBrand: '#FFFFFF', accent: '#FFD43B', onPanel: '#2B4A66' },
  { id: 'yellow', name: '活力黄', bg: '#FFD60A', panel: '#FFFFFF', title: '#141414', text: '#2B2B2B', brand: '#141414', onBrand: '#FFD60A', accent: '#FF3B30', onPanel: '#141414' },
  { id: 'navy', name: '深蓝金', bg: '#14213D', panel: '#FFFFFF', title: '#FCA311', text: '#E5E5E5', brand: '#FCA311', onBrand: '#14213D', accent: '#FFFFFF', onPanel: '#14213D' },
  { id: 'mono', name: '黑白简约', bg: '#FFFFFF', panel: '#F1F3F5', title: '#111111', text: '#333333', brand: '#111111', onBrand: '#FFFFFF', accent: '#E03131', onPanel: '#111111' },
];
export const paletteOf = id => PALETTES.find(p => p.id === id) || PALETTES[0];
export const ROLES = ['bg', 'panel', 'title', 'text', 'brand', 'onBrand', 'accent', 'onPanel'];

// 字体：都是 SIL OFL 1.1 的开源字体裁出来的常用字子集（GB2312 的 6763 个汉字）。family 是裁完改过的内部名字，from 是原字体
export const FONTS = [
  { id: 'hei', family: 'Resume Sans SC', weight: 700, url: '../resume/fonts/sc-700.ttf', label: '端正粗黑', from: '思源黑体', mb: 2.2 },
  { id: 'kuaile', family: 'Poster Kuaile', weight: 400, url: 'fonts/kuaile.woff2', label: '圆润快乐体', from: '站酷快乐体', mb: 0.9 },
  { id: 'xiehei', family: 'Poster Xiehei', weight: 400, url: 'fonts/xiehei.woff2', label: '潮流斜黑', from: '得意黑', mb: 0.9 },
  { id: 'huangyou', family: 'Poster Huangyou', weight: 400, url: 'fonts/huangyou.woff2', label: '高挑黄油体', from: '站酷庆科黄油体', mb: 1.1 },
  { id: 'kai', family: 'Poster Kai', weight: 400, url: 'fonts/kai.woff2', label: '温润楷体', from: '霞鹜文楷', mb: 1.6 },
  { id: 'maobi', family: 'Poster Maobi', weight: 400, url: 'fonts/maobi.woff2', label: '毛笔楷书', from: '马善政毛笔楷书', mb: 3.2 },
];
export const fontOf = id => FONTS.find(f => f.id === id) || FONTS[0];

// ---------- 小工具：拼 fabric JSON ----------
const W = BASE.w, H = BASE.h;
let P = PALETTES[0];
const col = r => (r ? P[r] || r : '');
function common(x, y, o, e) {
  const sel = !!o.sel;
  const j = {
    left: x, top: y, originX: 'center', originY: 'center', angle: o.angle || 0, opacity: o.opacity ?? 1,
    selectable: sel, hasControls: sel, evented: sel,
    extension: { ...e, ...(o.bleed ? { bleed: o.bleed } : {}), ...(o.anchor ? { anchor: o.anchor } : {}), ...(sel ? {} : { lock: 1 }) },
  };
  if (o.shadow) j.shadow = { color: 'rgba(0,0,0,.22)', blur: 30, offsetX: 0, offsetY: 14 };
  return j;
}
const shape = (o) => ({
  fill: o.role === null ? '' : col(o.role || 'brand'), stroke: o.sRole ? col(o.sRole) : null, strokeWidth: o.sRole ? (o.sw || 6) : 0,
  ...(o.dash ? { strokeDashArray: o.dash } : {}), strokeLineJoin: 'round', strokeUniform: true,
});
const sext = o => ({ ...(o.role === null ? {} : { role: o.role || 'brand' }), ...(o.sRole ? { sRole: o.sRole } : {}) });
export const R = (x, y, w, h, o = {}) => ({ type: 'rect', width: w, height: h, rx: o.rx || 0, ry: o.rx || 0, ...shape(o), ...common(x, y, o, sext(o)) });
export const C = (x, y, r, o = {}) => ({ type: 'circle', radius: r, ...shape(o), ...common(x, y, o, sext(o)) });
export const PG = (pts, x, y, o = {}) => ({ type: 'polygon', points: pts.map(([a, b]) => ({ x: a, y: b })), ...shape(o), ...common(x, y, o, sext(o)) });
export const PATH = (d, x, y, o = {}) => ({ type: 'path', path: d, ...shape(o), ...common(x, y, o, sext(o)) });
// 文字：x,y 是中心；w 是文本框宽度；fit（默认开）= 一行放不下时自动缩小字号而不是折行
export function T(text, x, y, w, size, o = {}) {
  const f = fontOf(o.font || 'hei');
  return {
    type: 'textbox', text, width: w, fontSize: size, fontFamily: f.family, fontWeight: f.weight, fill: col(o.role || 'text'),
    textAlign: o.align || 'center', lineHeight: o.lh || 1.16, charSpacing: o.sp || 0, splitByGrapheme: true, editable: false,
    linethrough: !!o.strike, strokeWidth: 0, styles: [],   // styles 必须给：fabric 5 读 JSON 时缺了它，再导出就报错
    ...common(x, y, { sel: true, ...o }, { role: o.role || 'text', font: f.id, base: size, ...(o.fit === false ? {} : { fit: 1 }) }),
  };
}
// 组：kids 的坐标相对组中心。组默认可以选中（贴纸、标签）
export function G(x, y, w, h, kids, o = {}) {
  for (const k of kids) { k.selectable = false; k.evented = false; k.hasControls = false; delete k.extension.lock; }
  return { type: 'group', width: w, height: h, objects: kids, ...common(x, y, { sel: true, ...o }, { kind: o.kind || 'badge' }) };
}
// 图片位：一个虚线框 + 相机图标 + 提示。点它 → 「换成我的照片」。导出时没换的图片位不画出来
const CAM = 'M -34 -18 h 16 l 8 -12 h 20 l 8 12 h 16 a 8 8 0 0 1 8 8 v 36 a 8 8 0 0 1 -8 8 h -68 a 8 8 0 0 1 -8 -8 v -36 a 8 8 0 0 1 8 -8 z M 0 -6 a 15 15 0 1 0 0.01 0 z';
export function SLOT(x, y, w, h, o = {}) {
  const r = o.round ? Math.min(w, h) / 2 : (o.rx ?? 48), k = Math.min(w, h) / 620;
  const kids = [
    { ...R(0, 0, w, h, { role: 'panel', rx: r, sRole: 'brand', sw: 6, dash: [22, 16] }), opacity: 0.86 },
    { ...PATH(CAM, 0, -70 * k, { role: 'brand' }), scaleX: 2.3 * k, scaleY: 2.3 * k, fillRule: 'evenodd', opacity: 0.9 },
    T('点这里\n换成你的照片', 0, 78 * k, w * 0.9, 50 * k, { role: 'onPanel', lh: 1.35, fit: false }),
  ];
  const g = G(x, y, w, h, kids, { ...o, kind: 'slot' });
  g.extension.slot = { w, h, r };
  return g;
}
export function burst(n, r1, r2, rot = -Math.PI / 2) {
  const p = [];
  for (let i = 0; i < n * 2; i++) { const a = rot + i * Math.PI / n, r = i % 2 ? r2 : r1; p.push([Math.cos(a) * r, Math.sin(a) * r]); }
  return p;
}
const ribbon = (w, h, n = h * 0.42) => [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2 - n, 0], [w / 2, h / 2], [-w / 2, h / 2], [-w / 2 + n, 0]];
// 标签（圆角条 + 字），整体可选
const PILL = (text, x, y, w, h, size, o = {}) => G(x, y, w, h, [
  R(0, 0, w, h, { role: o.bg || 'brand', rx: o.rx ?? h / 2 }),
  T(text, 0, 0, w - h * 0.5, size, { role: o.ink || 'onBrand', font: o.font }),
], o);
// 一组要「整体一起挪」的元素（面板和面板上的字）：换尺寸时围着同一个点等比缩放，不会散开
const pin = (cx, cy, list) => { for (const o of list) o.extension.pin = [cx, cy]; return list; };
// 一撮彩纸（确定性的伪随机）；avoid = [x1, y1, x2, y2] 这块区域不撒（留给标题）
function confetti(seed, n, box, roles = ['accent', 'brand'], avoid = null) {
  let s = seed; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const out = [];
  for (let i = 0; i < n; i++) {
    const x = box[0] + rnd() * box[2], y = box[1] + rnd() * box[3], k = rnd(), role = roles[i % roles.length], a = rnd() * 180;
    if (avoid && x > avoid[0] && x < avoid[2] && y > avoid[1] && y < avoid[3]) continue;
    out.push(k < 0.4 ? C(x, y, 9 + rnd() * 9, { role, opacity: 0.85 }) : k < 0.75 ? R(x, y, 34 + rnd() * 20, 12, { role, angle: a, rx: 6, opacity: 0.85 }) : PG(burst(4, 20 + rnd() * 10, 7), x, y, { role, angle: a, opacity: 0.9 }));
  }
  return out;
}
const foot = (line1, line2, band = true, hgt = 230) => [
  ...(band ? [R(W / 2, H - hgt / 2, W, hgt, { role: 'brand', bleed: 'x', anchor: 'bottom' })] : []),
  T(line1, W / 2, H - hgt / 2 - 36, 1120, 48, { role: band ? 'onBrand' : 'text', anchor: 'bottom' }),
  T(line2, W / 2, H - hgt / 2 + 40, 1120, 40, { role: band ? 'onBrand' : 'text', anchor: 'bottom', opacity: 0.92 }),
];

// ---------- 模板 ----------
export const TEMPLATES = [
  {
    id: 'new', name: '新品上市', cat: '上新促销', palette: 'orange', photo: true, fonts: ['xiehei', 'hei'],
    build: () => [
      ...pin(W / 2, 900, [C(W / 2, 900, 470, { role: 'panel' })]), C(170, 640, 34, { role: 'accent' }), C(1090, 520, 22, { role: 'brand' }), C(1120, 1250, 30, { role: 'accent' }), C(140, 1180, 18, { role: 'brand' }),
      T('你 的 店 名', W / 2, 112, 900, 46, { role: 'text', sp: 120, anchor: 'top' }),
      T('新品上市', W / 2, 290, 1080, 220, { role: 'title', font: 'xiehei', anchor: 'top' }),
      T('新鲜到店 · 欢迎品尝', W / 2, 452, 1000, 60, { role: 'text', anchor: 'top' }),
      ...pin(W / 2, 900, [SLOT(W / 2, 900, 620, 620, { round: true }),
        G(985, 1180, 320, 320, [PG(burst(14, 160, 132), 0, 0, { role: 'brand' }), T('¥12', 0, -22, 230, 112, { role: 'onBrand', font: 'xiehei' }), T('尝鲜价', 0, 62, 200, 40, { role: 'onBrand' })], { angle: 10, shadow: true })]),
      ...foot('活动时间：12 月 1 日 — 12 月 31 日', '地址：幸福路 88 号  ·  电话：138 0000 0000'),
    ],
  },
  {
    id: 'sale', name: '限时特价', cat: '上新促销', palette: 'yellow', photo: true, fonts: ['huangyou', 'xiehei', 'hei'],
    build: () => [
      PILL('今日爆款', 230, 92, 310, 80, 44, { anchor: 'top' }),
      T('限时特价', W / 2, 322, 1120, 250, { role: 'title', font: 'huangyou', anchor: 'top' }),
      T('数量有限 · 卖完即止', W / 2, 490, 1000, 58, { role: 'text', anchor: 'top' }),
      ...pin(W / 2, 890, [R(W / 2 + 16, 890 + 16, 860, 620, { role: 'brand', rx: 56 }), SLOT(W / 2, 890, 860, 620, { rx: 56 })]),
      ...pin(W / 2, 1330, [T('¥9.9', 450, 1318, 640, 210, { role: 'title', font: 'xiehei' }),
        T('原价 ¥19.9', 940, 1290, 420, 54, { role: 'text', strike: true }),
        PILL('省 10 元', 940, 1376, 300, 84, 48, { bg: 'accent', ink: 'onPanel' })]),
      ...foot('活动时间：本周五 — 周日', '地址：幸福路 88 号  ·  电话：138 0000 0000', true, 190),
    ],
  },
  {
    id: 'bogo', name: '第二杯半价', cat: '上新促销', palette: 'pink', photo: true, fonts: ['kuaile', 'hei'],
    build: () => [
      C(940, 640, 420, { role: 'panel' }), C(150, 150, 60, { role: 'accent', opacity: 0.9 }), C(250, 1010, 26, { role: 'brand', opacity: 0.6 }), C(560, 190, 20, { role: 'brand', opacity: 0.6 }),
      T('第二杯', 360, 380, 600, 180, { role: 'title', font: 'kuaile' }),
      T('半价', 360, 620, 600, 270, { role: 'title', font: 'kuaile' }),
      T('周一到周五\n下午 2 点 — 5 点', 360, 880, 600, 52, { role: 'text', lh: 1.4, fit: false }),
      SLOT(900, 640, 520, 800, { rx: 260 }),
      PILL('现做现卖', 250, 1180, 300, 92, 46, { bg: 'panel', ink: 'onPanel' }), PILL('真材实料', 621, 1180, 300, 92, 46, { bg: 'panel', ink: 'onPanel' }), PILL('可以外带', 992, 1180, 300, 92, 46, { bg: 'panel', ink: 'onPanel' }),
      PATH(`M 0 90 C 200 0 420 0 621 70 C 830 140 1040 140 1242 50 L 1242 400 L 0 400 Z`, W / 2, H - 175, { role: 'brand', bleed: 'x', anchor: 'bottom' }),
      T('你的店名', W / 2, H - 190, 1000, 88, { role: 'onBrand', font: 'kuaile', anchor: 'bottom' }),
      T('地址：幸福路 88 号  ·  电话：138 0000 0000', W / 2, H - 86, 1120, 40, { role: 'onBrand', anchor: 'bottom' }),
    ],
  },
  {
    id: 'main', name: '商品主图', cat: '上新促销', palette: 'blue', photo: true, fonts: ['xiehei', 'hei'],
    build: () => [
      SLOT(W / 2, 650, 1050, 920, { rx: 60 }),
      PILL('热卖爆款', 290, 150, 380, 110, 56, { anchor: 'top', shadow: true }),
      PILL('现货速发', 250, 1200, 310, 88, 44, { bg: 'panel', ink: 'onPanel' }), PILL('支持退换', 621, 1200, 310, 88, 44, { bg: 'panel', ink: 'onPanel' }), PILL('实物拍摄', 992, 1200, 310, 88, 44, { bg: 'panel', ink: 'onPanel' }),
      R(W / 2, H - 170, W, 340, { role: 'brand', bleed: 'x', anchor: 'bottom' }),
      T('买二送一', 370, H - 200, 620, 150, { role: 'onBrand', font: 'xiehei', anchor: 'bottom' }),
      T('活动到本周日', 370, H - 82, 620, 46, { role: 'onBrand', anchor: 'bottom', opacity: 0.92 }),
      T('到手价', 900, H - 262, 500, 46, { role: 'onBrand', anchor: 'bottom' }),
      T('¥29.9', 900, H - 150, 520, 170, { role: 'onBrand', font: 'xiehei', anchor: 'bottom' }),
    ],
  },
  {
    id: 'vip', name: '会员充值', cat: '上新促销', palette: 'navy', photo: false, fonts: ['xiehei', 'hei'],
    build: () => {
      const card = (y, a, b) => G(W / 2, y, 1040, 230, [
        R(0, 0, 1040, 230, { role: 'panel', rx: 36 }),
        T(a, -210, 0, 540, 112, { role: 'onPanel', font: 'xiehei' }),
        R(290, 0, 380, 150, { role: 'brand', rx: 75 }),
        T(b, 290, 0, 330, 84, { role: 'onBrand', font: 'xiehei' }),
      ], { shadow: true });
      return [
        ...confetti(7, 26, [50, 50, 1140, 440], ['accent', 'brand'], [150, 110, 1090, 480]),
        T('会员充值', W / 2, 250, 1080, 220, { role: 'title', font: 'xiehei', anchor: 'top' }),
        T('充得多 · 送得多', W / 2, 420, 1000, 60, { role: 'text', anchor: 'top', sp: 80 }),
        card(650, '充 100 元', '送 20'), card(920, '充 300 元', '送 80'), card(1190, '充 500 元', '送 150'),
        T('活动时间：即日起至 12 月 31 日', W / 2, H - 190, 1120, 48, { role: 'text', anchor: 'bottom' }),
        T('你的店名  ·  幸福路 88 号  ·  138 0000 0000', W / 2, H - 110, 1120, 40, { role: 'text', anchor: 'bottom', opacity: 0.9 }),
      ];
    },
  },
  {
    id: 'open', name: '盛大开业', cat: '开业节日', palette: 'red', photo: false, fonts: ['maobi', 'xiehei', 'hei'],
    build: () => [
      C(W / 2, 480, 560, { role: 'panel', opacity: 0.07 }), C(W / 2, 480, 400, { role: 'panel', opacity: 0.07 }),
      ...confetti(11, 44, [40, 40, 1160, 760], ['accent', 'brand'], [90, 90, 1150, 810]),
      T('你 的 店 名', W / 2, 150, 900, 60, { role: 'text', sp: 160, anchor: 'top' }),
      T('盛大开业', W / 2, 440, 1120, 300, { role: 'title', font: 'maobi' }),
      G(W / 2, 730, 980, 130, [PG(ribbon(980, 130), 0, 0, { role: 'brand' }), T('开业三天 · 全场八折', 0, 0, 780, 66, { role: 'onBrand' })], { shadow: true }),
      ...pin(W / 2, 1150, [R(W / 2, 1150, 1040, 500, { role: 'panel', rx: 40 }),
        T('开业时间', W / 2, 980, 900, 46, { role: 'onPanel', sp: 200 }),
        T('12 月 18 日 上午 10 点', W / 2, 1095, 940, 104, { role: 'onPanel', font: 'xiehei' }),
        R(W / 2, 1180, 880, 4, { role: 'onPanel', opacity: 0.25 }),
        T('进店有礼 · 前 50 位顾客送小礼品', W / 2, 1250, 940, 52, { role: 'onPanel' }),
        T('充值会员另有优惠，到店问店员', W / 2, 1330, 940, 42, { role: 'onPanel', opacity: 0.85 })]),
      ...foot('地址：幸福路 88 号（地铁口旁）', '电话：138 0000 0000', false, 200),
    ],
  },
  {
    id: 'newyear', name: '新年活动', cat: '开业节日', palette: 'red', photo: false, fonts: ['maobi', 'xiehei', 'hei'],
    build: () => [
      PG(burst(16, 620, 250), W / 2, 420, { role: 'panel', opacity: 0.06 }),
      ...confetti(23, 40, [40, 60, 1160, 640], ['accent', 'brand', 'panel'], [100, 250, 1140, 780]),
      T('2027', W / 2, 170, 800, 110, { role: 'text', font: 'xiehei', sp: 300, anchor: 'top' }),
      T('新年快乐', W / 2, 420, 1120, 300, { role: 'title', font: 'maobi' }),
      PILL('元旦三天乐 · 全场 8 折起', W / 2, 690, 900, 112, 58, { shadow: true }),
      ...pin(W / 2, 1110, [R(W / 2, 1110, 1040, 520, { role: 'panel', rx: 40 }),
        T('① 进店消费满 100 元减 20 元', W / 2, 960, 940, 56, { role: 'onPanel' }),
        R(W / 2, 1035, 880, 4, { role: 'onPanel', opacity: 0.18 }),
        T('② 会员充值多送 10%', W / 2, 1110, 940, 56, { role: 'onPanel' }),
        R(W / 2, 1185, 880, 4, { role: 'onPanel', opacity: 0.18 }),
        T('③ 到店就送新年小礼物', W / 2, 1260, 940, 56, { role: 'onPanel' })]),
      ...foot('活动时间：1 月 1 日 — 1 月 3 日', '你的店名  ·  幸福路 88 号  ·  138 0000 0000', false, 220),
    ],
  },
  {
    id: 'notice', name: '放假通知', cat: '通知招聘', palette: 'green', photo: false, fonts: ['kai', 'xiehei', 'hei'],
    build: () => [
      R(W / 2, H / 2, W - 120, H - 120, { role: 'panel', rx: 44, bleed: 'xy' }),
      C(160, 160, 46, { role: 'accent', anchor: 'top' }), C(1090, 1500, 60, { role: 'brand', opacity: 0.25, anchor: 'bottom' }), C(1010, 1560, 26, { role: 'accent', anchor: 'bottom' }),
      T('放假通知', W / 2, 330, 980, 200, { role: 'onPanel', font: 'kai', anchor: 'top' }),
      R(W / 2, 470, 160, 12, { role: 'brand', rx: 6, anchor: 'top' }),
      T('尊敬的顾客：', 330, 640, 420, 56, { role: 'onPanel', font: 'kai', align: 'left' }),
      T('元旦期间本店放假三天，\n1 月 4 日（周一）起正常营业。', W / 2, 810, 940, 60, { role: 'onPanel', font: 'kai', lh: 1.6, fit: false }),
      G(W / 2, 1070, 940, 200, [R(0, 0, 940, 200, { role: 'brand', rx: 30 }), T('1 月 1 日 — 3 日 休息', 0, 0, 860, 92, { role: 'onBrand', font: 'xiehei' })]),
      T('给您带来不便，敬请谅解。', W / 2, 1260, 940, 54, { role: 'onPanel', font: 'kai' }),
      T('你的店名', 860, 1400, 520, 60, { role: 'onPanel', font: 'kai', align: 'right', anchor: 'bottom' }),
      T('2026 年 12 月 28 日', 860, 1480, 520, 44, { role: 'onPanel', font: 'kai', align: 'right', anchor: 'bottom', opacity: 0.85 }),
    ],
  },
  {
    id: 'hire', name: '招聘', cat: '通知招聘', palette: 'navy', photo: false, fonts: ['huangyou', 'xiehei', 'hei'],
    build: () => [
      T('JOIN US', W / 2, 130, 1000, 54, { role: 'text', sp: 700, opacity: 0.6, anchor: 'top' }),
      T('诚聘', 390, 380, 640, 330, { role: 'title', font: 'huangyou', align: 'left', anchor: 'top' }),
      T('我们在找\n踏实的你', 900, 390, 520, 76, { role: 'text', lh: 1.35, align: 'left', fit: false, anchor: 'top' }),
      ...pin(W / 2, 980, [R(W / 2, 980, 1060, 640, { role: 'panel', rx: 40 }),
        T('店员 2 名', 370, 790, 480, 72, { role: 'onPanel', align: 'left' }), T('4500 — 6000 元', 850, 790, 480, 72, { role: 'onPanel', font: 'xiehei', align: 'right' }),
        R(W / 2, 880, 900, 4, { role: 'onPanel', opacity: 0.18 }),
        T('学徒 1 名', 370, 970, 480, 72, { role: 'onPanel', align: 'left' }), T('包吃住 · 带薪学', 850, 970, 480, 72, { role: 'onPanel', font: 'xiehei', align: 'right' }),
        R(W / 2, 1060, 900, 4, { role: 'onPanel', opacity: 0.18 }),
        T('要求：踏实肯干，有经验的优先\n上班时间：早 9 点到晚 6 点，月休 4 天', W / 2, 1175, 900, 44, { role: 'onPanel', lh: 1.6, align: 'left', fit: false, opacity: 0.9 })]),
      PILL('联系电话 138 0000 0000', W / 2, H - 230, 900, 130, 58, { anchor: 'bottom', font: 'xiehei' }),
      T('你的店名  ·  幸福路 88 号', W / 2, H - 100, 1120, 42, { role: 'text', anchor: 'bottom', opacity: 0.9 }),
    ],
  },
  {
    id: 'menu', name: '价目表', cat: '通知招聘', palette: 'orange', photo: false, fonts: ['kai', 'xiehei', 'hei'],
    build: () => {
      const rows = [['招牌牛肉面', '¥18'], ['番茄鸡蛋面', '¥14'], ['酸辣粉', '¥12'], ['卤肉饭', '¥16'], ['凉拌黄瓜', '¥8'], ['酸梅汤', '¥5']], out = [];
      rows.forEach(([a, b], i) => {
        const y = 520 + i * 148;
        out.push(T(a, 400, y, 640, 64, { role: 'onPanel', font: 'kai', align: 'left' }), T(b, 990, y, 300, 70, { role: 'onPanel', font: 'xiehei', align: 'right' }));
        if (i < rows.length - 1) out.push(R(W / 2, y + 74, 1000, 4, { role: 'onPanel', opacity: 0.14 }));
      });
      return [
        ...pin(W / 2, 890, [R(W / 2, 890, 1120, 980, { role: 'panel', rx: 40 }), ...out]),
        T('今日菜单', W / 2, 200, 1000, 170, { role: 'title', font: 'kai', anchor: 'top' }),
        T('MENU', W / 2, 330, 800, 44, { role: 'text', sp: 900, opacity: 0.7, anchor: 'top' }),
        ...foot('你的店名  ·  营业时间 10:00 — 22:00', '地址：幸福路 88 号  ·  电话：138 0000 0000', true, 200),
      ];
    },
  },
  {
    id: 'closed', name: '暂停营业', cat: '通知招聘', palette: 'mono', photo: false, fonts: ['hei', 'xiehei'],
    build: () => [
      R(W / 2, H / 2, W - 100, H - 100, { role: null, sRole: 'brand', sw: 10, rx: 40, bleed: 'xy' }),
      C(W / 2, 330, 120, { role: 'brand' }), R(W / 2, 330, 120, 26, { role: 'onBrand', rx: 13 }),
      T('暂停营业', W / 2, 640, 1040, 240, { role: 'title' }),
      T('SORRY, WE ARE CLOSED', W / 2, 800, 1000, 46, { role: 'text', sp: 300, opacity: 0.6 }),
      R(W / 2, 900, 200, 10, { role: 'accent', rx: 5 }),
      T('店主有事外出，明天照常营业', W / 2, 1040, 1020, 64, { role: 'text' }),
      PILL('急事请打 138 0000 0000', W / 2, 1230, 900, 130, 60, { font: 'xiehei' }),
      T('你的店名', W / 2, 1450, 900, 56, { role: 'text', anchor: 'bottom' }),
    ],
  },
];
export const CATS = ['全部', ...new Set(TEMPLATES.map(t => t.cat))];
export const templateOf = id => TEMPLATES.find(t => t.id === id);

// 贴纸：点一下加到画面中间
export const STICKERS = [
  { id: 'price', name: '价格爆炸贴', build: () => G(0, 0, 320, 320, [PG(burst(14, 160, 132), 0, 0, { role: 'brand' }), T('¥9.9', 0, -20, 240, 104, { role: 'onBrand', font: 'xiehei' }), T('特价', 0, 62, 200, 42, { role: 'onBrand' })], { angle: 10, shadow: true }) },
  { id: 'round', name: '圆形标签', build: () => G(0, 0, 260, 260, [C(0, 0, 130, { role: 'brand' }), C(0, 0, 112, { role: null, sRole: 'onBrand', sw: 4, dash: [10, 10] }), T('新品', 0, 0, 190, 84, { role: 'onBrand', font: 'xiehei' })], { angle: -8, shadow: true }) },
  { id: 'ribbon', name: '丝带', build: () => G(0, 0, 760, 120, [PG(ribbon(760, 120), 0, 0, { role: 'brand' }), T('限时三天', 0, 0, 580, 62, { role: 'onBrand' })], { shadow: true }) },
  { id: 'pill', name: '圆角标签', build: () => PILL('今日推荐', 0, 0, 380, 100, 52, {}) },
  { id: 'pill2', name: '白底标签', build: () => PILL('买一送一', 0, 0, 380, 100, 52, { bg: 'panel', ink: 'onPanel', shadow: true }) },
  { id: 'tag', name: '角标', build: () => G(0, 0, 300, 150, [PG([[-150, -75], [150, -75], [150, 75], [-150, 75], [-110, 0]], 0, 0, { role: 'accent' }), T('HOT', 16, 0, 220, 76, { role: 'onPanel', font: 'xiehei' })], { angle: -6 }) },
  { id: 'star', name: '星星', build: () => PG(burst(5, 90, 40), 0, 0, { role: 'accent', sel: true }) },
  { id: 'spark', name: '闪光', build: () => PG(burst(4, 90, 22), 0, 0, { role: 'accent', sel: true }) },
  { id: 'dot', name: '圆', build: () => C(0, 0, 90, { role: 'brand', sel: true }) },
  { id: 'box', name: '圆角方块', build: () => R(0, 0, 420, 260, { role: 'panel', rx: 36, sel: true }) },
  { id: 'line', name: '分隔线', build: () => R(0, 0, 600, 8, { role: 'brand', rx: 4, sel: true }) },
  { id: 'heart', name: '爱心', build: () => PATH('M 0 30 C -60 -20 -100 -50 -100 -90 C -100 -130 -50 -150 0 -100 C 50 -150 100 -130 100 -90 C 100 -50 60 -20 0 30 Z', 0, 0, { role: 'accent', sel: true }) },
];

// 生成一张模板的 JSON（快图设计的格式：第一个对象是 id=workspace 的画布矩形）
export function buildTemplate(id, paletteId, sizeId = 'p34') {
  const t = templateOf(id) || TEMPLATES[0];
  P = paletteOf(paletteId || t.palette);
  const objects = t.build();
  const json = {
    version: '5.3.0',
    objects: [{ type: 'rect', id: 'workspace', left: 0, top: 0, width: W, height: H, fill: P.bg, strokeWidth: 0, selectable: false, hasControls: false, extension: { role: 'bg' } }, ...objects],
  };
  let n = 0;
  for (const o of objects) o.id = `${t.id}-${++n}`;
  const s = sizeOf(sizeId);
  return resizeJson(json, s.w, s.h);
}
export function buildSticker(id, paletteId) {
  P = paletteOf(paletteId);
  const s = STICKERS.find(x => x.id === id) || STICKERS[0];
  return s.build();
}
export function newText(paletteId, text = '点「改文字」换成你的内容') {
  P = paletteOf(paletteId);
  return T(text, 0, 0, 900, 64, { role: 'text' });
}

// 换尺寸：每个顶层元素的中心按宽、高各自的比例挪；大小统一按 s 缩放（不变形），s = 新尺寸和设计稿相比 min(宽比, 高比) ÷ 旧尺寸的同一个数。
// bleed：铺满的底（'xy' 两个方向都拉满，'x' 只横向拉满）；anchor：贴着上 / 下边的元素，按「离那条边的距离 × s」摆，换成更高的尺寸时不会和边脱开；
// pin：一块面板和上面的字，整体一起缩放、一起挪
export function resizeJson(json, W1, H1) {
  const ws = json.objects.find(o => o.id === 'workspace');
  const W0 = ws.width, H0 = ws.height;
  if (W0 === W1 && H0 === H1) return json;
  // s 按「相对设计稿（1242×1656）的缩放」之比来算，这样先换成方形再换回来，大小和位置都能原样回来（和换的顺序无关）
  const base = (w, h) => Math.min(w / W, h / H);
  const fx = W1 / W0, fy = H1 / H0, s = base(W1, H1) / base(W0, H0);
  for (const o of json.objects) {
    if (o === ws) { o.width = W1; o.height = H1; continue; }
    const e = o.extension || {};
    const sx = e.bleed === 'xy' || e.bleed === 'x' ? fx : s, sy = e.bleed === 'xy' || e.bleed === 'y' ? fy : s;
    if (e.pin) {
      // 成组的：围着组的中心等比缩放，组的中心按宽、高的比例挪
      const [px, py] = e.pin;
      o.left = px * fx + (o.left - px) * s; o.top = py * fy + (o.top - py) * s; e.pin = [px * fx, py * fy];
    } else {
      o.left = e.anchor === 'left' ? o.left * s : e.anchor === 'right' ? W1 - (W0 - o.left) * s : o.left * fx;
      o.top = e.anchor === 'top' ? o.top * s : e.anchor === 'bottom' ? H1 - (H0 - o.top) * s : o.top * fy;
    }
    o.scaleX = (o.scaleX ?? 1) * sx; o.scaleY = (o.scaleY ?? 1) * sy;
  }
  return json;
}

// 换配色：按 extension 里的 role / sRole 重新上色（组里的子元素也算）。手动改过颜色的元素（role 被清掉）不动
export function recolorJson(json, paletteId) {
  const p = paletteOf(paletteId);
  const walk = o => {
    const e = o.extension || {};
    if (e.role && p[e.role]) o.fill = p[e.role];
    if (e.sRole && p[e.sRole]) o.stroke = p[e.sRole];
    (o.objects || []).forEach(walk);
  };
  json.objects.forEach(walk);
  return json;
}
