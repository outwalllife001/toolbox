// 文字 → Kokoro v1.1-zh 的音素。浏览器和 node 都能跑（分词库、拼音库从外面传进来）。
//
// 中文部分照着 Kokoro 官方的文字前端 misaki（hexgrad/misaki，Apache-2.0）v1.1 中文流程移植：
//   结巴分词 + 词性 → 合并「不 / 一 / 叠词 / 连续三声 / 儿」→ 拼音 → 变调（不、一、轻声、三声连读）→ 儿化 → 注音符号音素
//   它的 zh_frontend.py / tone_sandhi.py 改自 PaddleSpeech（Apache-2.0）。模型就是用这套前端的输出训练的，所以符号、分词斜杠都要对上。
// 和原版不一样的地方：
//   · 拼音用 pinyin-pro 整句标注（原版用 pypinyin 逐词标），多音字靠上下文
//   · 数字、日期、时间、电话、单位自己规整（原版用 cn2an，只管数字）
//   · 英文单词查 misaki 的英文词典（us_gold），查不到按字母念；没有 espeak
import { MUST_NEURAL, MUST_NOT_NEURAL, VOCAB, LETTERS } from './g2p-data.js';

// ---------------------------------------------------------------- 1. 数字和符号规整
const DIG = '零一二三四五六七八九';
const digits = (s, yao) => Array.from(s).map(c => (c === '1' && yao ? '幺' : DIG[+c] ?? '')).join('');
function sec(n) {
  let r = '', zero = false;
  const u = ['', '十', '百', '千'];
  for (let i = 3; i >= 0; i--) {
    const d = Math.floor(n / 10 ** i) % 10;
    if (d === 0) { if (r) zero = true; } else { if (zero) { r += '零'; zero = false; } r += DIG[d] + u[i]; }
  }
  return r;
}
export function intToZh(str) {
  str = String(str).replace(/^0+(?=\d)/, '');
  if (str.length > 16) return digits(str);
  if (/^0*$/.test(str)) return '零';
  const groups = [];
  for (let i = str.length; i > 0; i -= 4) groups.unshift(parseInt(str.slice(Math.max(0, i - 4), i), 10));
  const units = ['', '万', '亿', '万亿'];
  let r = '', needZero = false;
  groups.forEach((g, idx) => {
    if (g === 0) { needZero = true; return; }
    if (r && (needZero || g < 1000)) r += '零';
    r += sec(g) + units[groups.length - 1 - idx];
    needZero = false;
  });
  r = r.replace(/^一十/, '十');
  // 口语里「2000 / 20000 / 200」读两千、两万、两百；「二十」「十二万」不变
  r = r.replace(/二(?=[百千])/g, '两').replace(/(^|[^十零])二(?=[万亿])/g, '$1两');
  return r;
}
export function numToZh(s) {
  s = String(s);
  const m = /^(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) return s;
  if (m[2] === undefined && /^0\d/.test(m[1])) return digits(m[1]);      // 007 这类按位念
  return intToZh(m[1]) + (m[2] !== undefined ? '点' + digits(m[2]) : '');
}
const UNITS = [
  ['km/h', '公里每小时'], ['m/s', '米每秒'], ['kg', '公斤'], ['KG', '公斤'], ['Kg', '公斤'], ['mg', '毫克'], ['km', '公里'], ['cm', '厘米'], ['mm', '毫米'],
  ['ml', '毫升'], ['mL', '毫升'], ['㎡', '平方米'], ['m²', '平方米'], ['m2', '平方米'], ['min', '分钟'], ['g', '克'], ['m', '米'], ['L', '升'], ['h', '小时'], ['w', '万'], ['W', '万'],
];
const N = '(\\d+(?:\\.\\d+)?)';
const LIANG = '个|次|天|倍|种|位|名|只|张|本|台|部|份|块|条|件|句|步|遍|秒|分钟|小时|周|岁|年(?!级)|点|元|斤|公斤|米|公里|颗|片|杯|碗|瓶|包|盒|套|篇|首|段|道|人|家|款|招|万|千|百|亿';

export function normalize(text) {
  let t = String(text);
  t = t.replace(/[０-９Ａ-Ｚａ-ｚ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/％/g, '%').replace(/[　\t]/g, ' ');
  t = t.replace(/https?:\/\/[^\s一-鿿]+/g, ' ').replace(/[\u{10000}-\u{10FFFF}]/gu, '').replace(/[︀-️​-‍☀-➿]/g, '');
  t = t.replace(/[*`_|#>\\^]+/g, ' ').replace(/[\[\]{}<]/g, ' ');
  t = t.replace(/(\d),(?=\d{3}(?!\d))/g, '$1');                                              // 1,000,000
  // 日期
  t = t.replace(/(?<!\d)((?:1[5-9]|20)\d{2})[-/.](0?[1-9]|1[0-2])[-/.](0?[1-9]|[12]\d|3[01])(?!\d)/g, (_, y, m, d) => `${digits(y)}年${intToZh(m)}月${intToZh(d)}日`);
  t = t.replace(/(?<!\d)((?:1[5-9]|20)\d{2})\s*[-~～—–至到]\s*((?:1[5-9]|20)\d{2})年/g, (_, a, b) => `${digits(a)}年到${digits(b)}年`);
  t = t.replace(/(?<!\d)((?:1[5-9]|20)\d{2})年/g, (_, y) => digits(y) + '年');
  t = t.replace(/(?<![\d年])(\d{2})年(?=\d{1,2}月|代)/g, (_, y) => digits(y) + '年');             // 98年3月、90年代
  // 电话
  t = t.replace(/(?<![\d.])1[3-9]\d{9}(?![\d.])/g, m => digits(m, true));
  t = t.replace(/(?<![\d.])(0\d{2,3})-(\d{7,8})(?![\d.])/g, (_, a, b) => digits(a, true) + '，' + digits(b, true));
  t = t.replace(/(?<![\d.])([48]00)-?(\d{3})-?(\d{4})(?![\d.])/g, (_, a, b, c) => digits(a + b + c, true));
  t = t.replace(/(?<![\d.])\d{12,}(?![\d.])/g, m => digits(m));
  // 时间、比分
  t = t.replace(/(?<![\d:.])([01]?\d|2[0-3])[:：]([0-5]\d)(?:[:：]([0-5]\d))?(?![\d:])/g, (_, h, m, s) => {
    let r = (h === '2' || h === '02' ? '两' : intToZh(h)) + '点';
    if (+m === 30 && s === undefined) r += '半';
    else if (+m !== 0 || s !== undefined) r += (+m < 10 ? '零' + (+m ? DIG[+m] : '') : intToZh(m)) + '分';
    if (s !== undefined) r += intToZh(s) + '秒';
    return r;
  });
  t = t.replace(/(\d+)[:：](\d+)(?!\d)/g, (_, a, b) => intToZh(a) + '比' + intToZh(b));
  // 百分比、分数、温度、钱
  t = t.replace(new RegExp(`(-?)${N}%`, 'g'), (_, neg, n) => (neg ? '负' : '') + '百分之' + numToZh(n));
  t = t.replace(new RegExp(`${N}‰`, 'g'), (_, n) => '千分之' + numToZh(n));
  t = t.replace(/(?<![\d/.])(\d+)\/(\d+)(?![\d/.])/g, (_, a, b) => intToZh(b) + '分之' + intToZh(a));
  t = t.replace(new RegExp(`(-?)${N}\\s*(?:℃|°C)`, 'g'), (_, neg, n) => (neg ? '零下' : '') + numToZh(n) + '摄氏度');
  t = t.replace(new RegExp(`${N}°`, 'g'), (_, n) => numToZh(n) + '度');
  t = t.replace(new RegExp(`[¥￥]\\s*${N}([万亿]?)`, 'g'), (_, n, u) => numToZh(n) + u + '元');
  t = t.replace(new RegExp(`\\$\\s*${N}([万亿]?)`, 'g'), (_, n, u) => numToZh(n) + u + '美元');
  t = t.replace(new RegExp(`€\\s*${N}([万亿]?)`, 'g'), (_, n, u) => numToZh(n) + u + '欧元');
  // 范围、负数、算式
  t = t.replace(new RegExp(`${N}\\s*[-~～—–]\\s*(?=\\d)`, 'g'), (_, a) => a + '到');
  t = t.replace(/(^|[^\dA-Za-z一-鿿])-(?=\d)/g, '$1负');
  t = t.replace(/(\d)\s*[×xX*]\s*(?=\d)/g, '$1乘').replace(/(\d)\s*÷\s*(?=\d)/g, '$1除以').replace(/(\d)\s*\+\s*(?=\d)/g, '$1加').replace(/(\d)\s*=\s*(?=\d)/g, '$1等于');
  t = t.replace(/(\d)\+/g, '$1加').replace(/≥/g, '大于等于').replace(/≤/g, '小于等于').replace(/[=＝]/g, '等于').replace(/\+/g, '加').replace(/&/g, '和').replace(/@/g, ' ');
  // 单位（只认紧跟在数字后面的）
  for (const [u, zh] of UNITS) t = t.replace(new RegExp(`(\\d)\\s?${u.replace(/[/²]/g, '\\$&')}(?![A-Za-z])`, 'g'), '$1' + zh);
  // 2 + 量词 → 两
  t = t.replace(new RegExp(`(?<![\\d.第零一二三四五六七八九十百千万亿点])2(?=${LIANG})`, 'g'), '两');
  // 剩下的数字
  t = t.replace(/\d+(?:\.\d+)?/g, m => numToZh(m));
  // 标点
  t = t.replace(/\.{3,}|。{3,}|…+/g, '…').replace(/[—–-]{2,}/g, '—').replace(/[~～]+/g, '，').replace(/[·•]/g, ' ').replace(/[‘’]/g, "'").replace(/[『』]/g, '"');
  t = t.replace(/\//g, ' ').replace(/[%$¥￥€°]/g, ' ');
  return t.replace(/[ ]{2,}/g, ' ').trim();
}

// ---------------------------------------------------------------- 2. 分句
const END = '。！？!?；;…';
const CLOSE = '”’"\'」』）)】》';
const SOFT = '，,、：:';
const content = s => (s.match(/[一-鿿A-Za-z0-9]/g) || []).length;
// 一句最多 maxLen 个字（汉字、字母、数字）：模型一次念太长会越念越快，长句在逗号处拆开
export function splitText(text, maxLen = 32) {
  const out = [];
  const paras = String(text).replace(/\r/g, '').split(/\n+/);
  paras.forEach((para, pi) => {
    const sents = [];
    let cur = '';
    const cs = Array.from(para);
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i];
      cur += c;
      let end = END.includes(c);
      if (c === '.' && !(/\d/.test(cs[i - 1] || '') && /\d/.test(cs[i + 1] || '')) && !/[A-Za-z0-9.]/.test(cs[i + 1] || ' ')) end = true;
      if (end) {
        while (i + 1 < cs.length && (END.includes(cs[i + 1]) || CLOSE.includes(cs[i + 1]) || cs[i + 1] === '.')) cur += cs[++i];
        sents.push(cur); cur = '';
      }
    }
    if (cur.trim()) sents.push(cur);
    const pieces = [];
    const cut = s => {
      if (content(s) <= maxLen) { pieces.push(s); return; }
      const cs2 = Array.from(s), mid = cs2.length / 2;
      let best = -1, bd = Infinity;
      for (let i = 1; i < cs2.length - 1; i++) {
        if (!SOFT.includes(cs2[i])) continue;
        if ((cs2[i] === ',' || cs2[i] === ':') && /\d/.test(cs2[i - 1]) && /\d/.test(cs2[i + 1])) continue;
        const l = content(cs2.slice(0, i + 1).join('')), r = content(cs2.slice(i + 1).join(''));
        if (l < 4 || r < 4) continue;
        const d = Math.abs(i - mid);
        if (d < bd) { bd = d; best = i; }
      }
      if (best < 0) {             // 没有逗号的超长句：按空格，再不行就硬拆
        for (let i = 1; i < cs2.length - 1; i++) if (cs2[i] === ' ' && Math.abs(i - mid) < bd) { bd = Math.abs(i - mid); best = i; }
        if (best < 0) best = Math.floor(mid);
      }
      cut(cs2.slice(0, best + 1).join('')); cut(cs2.slice(best + 1).join(''));
    };
    sents.forEach(s => cut(s));
    // 很短的句子并到前一句（同一段里，合起来不超过 maxLen）：「好。」「对吧？」单独念容易吞字
    const merged = [];
    for (const p of pieces) {
      const last = merged[merged.length - 1];
      if (last !== undefined && (content(p) < 5 || content(last) < 5) && content(last) + content(p) <= maxLen) merged[merged.length - 1] = last + p;
      else merged.push(p);
    }
    merged.forEach((s, i) => { if (content(s)) out.push({ text: s.trim(), para: pi, first: i === 0, soft: SOFT.includes(s.trim().slice(-1)) }); });
  });
  return out;
}

// ---------------------------------------------------------------- 3. 拼音 → 声母 / 韵母（pypinyin 严格模式的写法）
const INITIALS = ['zh', 'ch', 'sh', 'b', 'p', 'm', 'f', 'd', 't', 'n', 'l', 'g', 'k', 'h', 'j', 'q', 'x', 'r', 'z', 'c', 's'];
export function splitPinyin(py) {
  let s = py.replace(/ü/g, 'v').replace(/ê/g, 'ei');
  if (s === 'ng' || s === 'n' || s === 'hng') return ['n', ''];
  if (s === 'm' || s === 'hm') return ['m', ''];
  if (s[0] === 'y') s = s.startsWith('yu') ? 'v' + s.slice(2) : s.startsWith('yi') ? s.slice(1) : 'i' + s.slice(1);
  else if (s[0] === 'w') s = s.startsWith('wu') ? s.slice(1) : 'u' + s.slice(1);
  const ini = INITIALS.find(c => s.startsWith(c)) || '';
  let fin = s.slice(ini.length);
  if ('jqx'.includes(ini) && ini && fin[0] === 'u') fin = 'v' + fin.slice(1);
  if (fin === 'iu') fin = 'iou'; else if (fin === 'ui') fin = 'uei'; else if (fin === 'un') fin = 'uen';
  if (fin === 'i') { if (ini === 'z' || ini === 'c' || ini === 's') fin = 'ii'; else if (ini === 'zh' || ini === 'ch' || ini === 'sh' || ini === 'r') fin = 'iii'; }
  return [ini, fin];
}
const ZH_MAP = { b: 'ㄅ', p: 'ㄆ', m: 'ㄇ', f: 'ㄈ', d: 'ㄉ', t: 'ㄊ', n: 'ㄋ', l: 'ㄌ', g: 'ㄍ', k: 'ㄎ', h: 'ㄏ', j: 'ㄐ', q: 'ㄑ', x: 'ㄒ', zh: 'ㄓ', ch: 'ㄔ', sh: 'ㄕ', r: 'ㄖ', z: 'ㄗ', c: 'ㄘ', s: 'ㄙ', a: 'ㄚ', o: 'ㄛ', e: 'ㄜ', ie: 'ㄝ', ai: 'ㄞ', ei: 'ㄟ', ao: 'ㄠ', ou: 'ㄡ', an: 'ㄢ', en: 'ㄣ', ang: 'ㄤ', eng: 'ㄥ', er: 'ㄦ', i: 'ㄧ', u: 'ㄨ', v: 'ㄩ', ii: 'ㄭ', iii: '十', ve: '月', ia: '压', ian: '言', iang: '阳', iao: '要', in: '阴', ing: '应', iong: '用', iou: '又', ong: '中', ua: '穵', uai: '外', uan: '万', uang: '王', uei: '为', uen: '文', ueng: '瓮', uo: '我', van: '元', vn: '云', io: 'ㄧㄛ', '': '' };

// ---------------------------------------------------------------- 4. 变调（照 tone_sandhi.py）
const XENG = new Set(['x', 'eng']);
const PUNC = new Set(Array.from(';:,.!?—…"()“”'));
const SANDHI_PUNC = "、：，；。？！“”‘’':,;.?!";
const NUMERIC = new Set(Array.from('0123456789零〇一二三四五六七八九十百千万亿兆两壹贰叁肆伍陆柒捌玖拾佰仟萬億幺廿卅'));
const MUST_ERHUA = new Set(['小院儿', '胡同儿', '范儿', '老汉儿', '撒欢儿', '寻老礼儿', '妥妥儿', '媳妇儿']);
const NOT_ERHUA = new Set(['虐儿', '为儿', '护儿', '瞒儿', '救儿', '替儿', '有儿', '一儿', '我儿', '俺儿', '妻儿', '拐儿', '聋儿', '乞儿', '患儿', '幼儿', '孤儿', '婴儿', '婴幼儿', '连体儿', '脑瘫儿', '流浪儿', '体弱儿', '混血儿', '蜜雪儿', '舫儿', '祖儿', '美儿', '应采儿', '可儿', '侄儿', '孙儿', '侄孙儿', '女儿', '男儿', '红孩儿', '花儿', '虫儿', '马儿', '鸟儿', '猪儿', '猫儿', '狗儿', '少儿']);
// 原版给 pypinyin 加的几个词（多音字）
const FIX_WORDS = { 开户行: 'kai1 hu4 hang2', 发卡行: 'fa4 ka3 hang2', 放款行: 'fang4 kuan3 hang2', 茧行: 'jian3 hang2', 行号: 'hang2 hao4', 各地: 'ge4 di4', 借还款: 'jie4 huan2 kuan3', 时间为: 'shi2 jian1 wei2', 为准: 'wei2 zhun3', 色差: 'se4 cha1', 掺和: 'chan1 huo5' };
const isZh = c => c >= '一' && c <= '鿿';
const DE2 = new Set('获得 取得 赢得 夺得 博得 求得 换得 购得 心得 所得 难得 应得 自得 可得 必得 只得 不得 习得 两得 多得 少得 而得 易得 值得'.split(' '));
const KEEP_SHANG_XIA = new Set('以上 之上 向上 往上 朝上 如上 至上 无上 而上 北上 直上 以下 之下 向下 往下 朝下 如下 而下 南下 直下 上下 天下 地下 手下 脚下 足下 麾下 门下 部下 属下 名下 旗下 眼下 时下 当下 私下 低下 高下 不下 上上 下下'.split(' '));
const NUM_RUN = /[零〇一二三四五六七八九十百千万亿两]{2,}/g;
const NUM_PY = { 零: 'ling2', 〇: 'ling2', 一: 'yi1', 二: 'er4', 三: 'san1', 四: 'si4', 五: 'wu3', 六: 'liu4', 七: 'qi1', 八: 'ba1', 九: 'jiu3', 十: 'shi2', 百: 'bai3', 千: 'qian1', 万: 'wan4', 亿: 'yi4', 两: 'liang3' };
// 中文口播里常见、英文词典里没有的词
const EN_EXTRA = { kokoro: 'kˈOkəɹO', wifi: 'wˈIfˌI', tiktok: 'tˈɪktˌɑk', vivo: 'vˈivO', oppo: 'ˈɑpO', bilibili: 'bˌɪlibˈɪli', claude: 'klˈɔd', canva: 'kˈænvə', linux: 'lˈɪnəks', xiaomi: 'ʃˈWmi', huawei: 'hwˈɑwA', taobao: 'tˈWbˌW', douyin: 'dˈOjˌɪn', deepseek: 'dˈipsˌik', github: 'ɡˈɪthˌʌb', youtube: 'jˈutˌub', iphone: 'ˈIfˌOn', ipad: 'ˈIpˌæd', vlog: 'vlˈɑɡ' };
const allThree = ts => ts.length > 0 && ts.every(x => x === '3');
const isRedup = w => w.length === 2 && w[0] === w[1];

export function createG2P({ pinyin, jieba, enLex = null, pyFix = null, hmm = true }) {
  const wpCache = new Map();
  const wordPinyin = w => {
    let r = wpCache.get(w);
    if (!r) { r = pinyin(w, { toneType: 'num', toneSandhi: false, v: true, type: 'array' }); if (wpCache.size < 20000) wpCache.set(w, r); }
    return r;
  };
  const splitWord = word => {
    const list = jieba.cut_for_search(word, hmm).slice().sort((a, b) => a.length - b.length);
    const first = list[0] ?? word, at = word.indexOf(first);
    return at === 0 ? [first, word.slice(first.length)] : [word.slice(0, word.length - first.length), first];
  };

  function buSandhi(w, t) {
    if (w.length === 3 && w[1] === '不') t[1] = '5';
    else for (let i = 0; i < w.length; i++) if (w[i] === '不' && i + 1 < w.length && t[i + 1] === '4') t[i] = '2';
  }
  function yiSandhi(w, t) {
    if (w.includes('一') && Array.from(w).every(c => c === '一' || NUMERIC.has(c))) {
      // 原版：纯数字的词里「一」一律一声。这里按实际读法补两条：一百 / 一千读四声；打头的一万 / 一亿读二声（十一万的一不变）
      for (let i = 0; i + 1 < w.length; i++) {
        if (w[i] !== '一') continue;
        if (w[i + 1] === '百' || w[i + 1] === '千' || w[i + 1] === '两') t[i] = '4';
        else if ((w[i + 1] === '万' || w[i + 1] === '亿') && (i === 0 || '零万亿'.includes(w[i - 1]))) t[i] = '2';
      }
      return;
    }
    if (w.length === 3 && w[1] === '一' && w[0] === w[2]) t[1] = '5';
    else if (w.startsWith('第一')) t[1] = '1';
    else for (let i = 0; i < w.length; i++) {
      if (w[i] === '一' && i + 1 < w.length) {
        if (i > 0 && NUMERIC.has(w[i - 1])) continue;                       // 十一月、二十一个：个位上的一不变（原版会变，不合实际读法）
        if (i === 0 && '月号日'.includes(w[1])) continue;                   // 一月、一号
        if (t[i + 1] === '4' || t[i + 1] === '5') t[i] = '2';
        else if (!SANDHI_PUNC.includes(w[i + 1])) t[i] = '4';
      }
    }
  }
  function neuralSandhi(w, pos, t, base) {
    if (MUST_NOT_NEURAL.has(w)) return;
    for (let j = 1; j < w.length; j++) if (w[j] === w[j - 1] && 'nva'.includes(pos[0])) t[j] = '5';
    const ge = w.indexOf('个'), last = w[w.length - 1], n = w.length;
    if ('吧呢啊呐噻嘛吖嗨呐哦哒滴哩哟喽啰耶喔诶'.includes(last)) t[n - 1] = '5';
    else if ('的地得'.includes(last)) { if (base[n - 1] === 'de' && !(last === '得' && (DE2.has(w) || DE2.has(w.slice(-2))))) t[n - 1] = '5'; }   // 原版不看读音一律轻声（目的、土地、获得都成了轻声），这里只管读 de 的，获得、取得这些留二声
    else if (n === 3 && w[1] === '得' && base[1] === 'de' && !'获取赢夺博求习心所应可自必不'.includes(w[0])) t[1] = '5';                          // 跑得快、看得见
    else if (n === 2 && last === '个' && !'整各逐挨单'.includes(w[0])) t[1] = '5';                      // 换个、买个、这个
    else if (n > 1 && last === '里' && ['s', 'f', 'l', 'r', 't'].includes(pos) && t[n - 2] !== '3') t[n - 1] = '5';   // 家里、心里、这里、夜里（哪里留给三声连读）
    else if (n === 1 && '了着过'.includes(w) && ['ul', 'uz', 'ug'].includes(pos)) t[n - 1] = '5';
    else if (n > 1 && '们子'.includes(last) && (pos === 'r' || pos === 'n')) t[n - 1] = '5';
    else if (n > 1 && '上下'.includes(last) && ['s', 'l', 'f'].includes(pos)) { if (!KEEP_SHANG_XIA.has(w)) t[n - 1] = '5'; }       // 以上、向下这些原版也读成轻声，不对
    else if (n > 1 && '来去'.includes(last) && '上下进出回过起开'.includes(w[n - 2])) t[n - 1] = '5';
    else if ((ge >= 1 && (NUMERIC.has(w[ge - 1]) || '几有两半多各整每做是'.includes(w[ge - 1]))) || w === '个') t[ge] = '5';
    else if (MUST_NEURAL.has(w) || MUST_NEURAL.has(w.slice(-2))) t[n - 1] = '5';
    const [a, b] = splitWord(w);
    let off = 0;
    for (const sub of [a, b]) {
      if (sub && (MUST_NEURAL.has(sub) || MUST_NEURAL.has(sub.slice(-2)))) t[off + sub.length - 1] = '5';
      off += sub.length;
    }
  }
  function threeSandhi(w, t) {
    const n = w.length;
    if (n === 2 && allThree(t)) t[0] = '2';
    else if (n === 3) {
      const [a] = splitWord(w);
      if (allThree(t)) {
        if (a.length === 2) { t[0] = '2'; t[1] = '2'; } else if (a.length === 1) t[1] = '2';
      } else {
        const la = a.length, A = t.slice(0, la), B = t.slice(la);
        // 所有/人 → 前两个字都是三声时第一个变二声；好/喜欢 → 后一段不全是三声、但它的头和前一段的尾都是三声时，前一段的尾变二声
        if (A.length === 2 && allThree(A)) t[0] = '2';
        if (B.length === 2 && allThree(B)) t[la] = '2';
        else if (B.length && !allThree(B) && B[0] === '3' && A.length && t[la - 1] === '3') t[la - 1] = '2';
      }
    } else if (n === 4) {
      if (t[0] === '3' && t[1] === '3') t[0] = '2';
      if (t[2] === '3' && t[3] === '3') t[2] = '2';
    }
  }

  // 一段中文（可以带标点、空格，不含英文和数字）→ 音素
  function zh(text) {
    if (!text) return '';
    const cs = Array.from(text);
    // 连着两个以上的数字字（一百一十一万、二零二六）先单独拿出来当一个数词：结巴会把它们切碎（一百一十 / 一万），「一」的变调就乱了
    let seg = [];
    // 结巴靠 HMM 猜出来的新词（词性 x）里要是夹着「地、的、得、了…」，多半猜错了（框地、地笑、儿里），这种词不用 HMM 重切
    const tag = part => {
      if (!part) return;
      for (const x of jieba.tag(part, hmm)) {
        if (hmm && x.tag === 'x' && x.word.length >= 2 && /[的地得了着过儿们吗呢吧啊里]/.test(x.word) && Array.from(x.word).every(isZh)) for (const y of jieba.tag(x.word, false)) seg.push([y.word, y.tag]);
        else seg.push([x.word, x.tag]);
      }
    };
    let lastAt = 0;
    for (const m of text.matchAll(NUM_RUN)) { tag(text.slice(lastAt, m.index)); seg.push([m[0], 'm#']); lastAt = m.index + m[0].length; }
    tag(text.slice(lastAt));
    if (seg.map(x => x[0]).join('') !== text) seg = cs.map(c => [c, isZh(c) ? 'n' : 'x']);          // 分词结果对不上原文（不该发生）就逐字
    // 拼音，逐字对齐。单字词看整句上下文（pinyin-pro 整句标注）；两个字以上的词按词查：先查读音修正表（和原版 pypinyin 对齐），没有再用 pinyin-pro
    const OPT = { toneType: 'num', toneSandhi: false, v: true };
    const all = pinyin(text, { type: 'all', ...OPT });
    const py = all.length === cs.length ? all.map(o => (o.isZh ? o.pinyin : '')) : cs.map(c => (isZh(c) ? pinyin(c, OPT) : ''));
    {
      let o = 0;
      for (const [w, pos] of seg) {
        const n = w.length;
        if (pos === 'm#') Array.from(w).forEach((c, k) => { py[o + k] = NUM_PY[c]; });
        else if (n >= 2 && isZh(w[0]) && isZh(w[n - 1])) {
          let wp = pyFix && pyFix.get(w);
          wp = wp ? wp.split(' ') : wordPinyin(w);
          if (wp.length === n) wp.forEach((x, k) => { if (x) py[o + k] = x; });
        } else if (n === 1) {
          const prev = cs[o - 1] || '';
          if (w === '只' && /^zhi1/.test(py[o]) && !'一二两三四五六七八九十百千万几数每这那哪半双单'.includes(prev)) py[o] = 'zhi3';   // 只剩、只在：pinyin-pro 默认读成「一只」的只
          else if (w === '地') py[o] = '块片亩的这那种扫拖擦下落倒满遍占此各该一两三四五六七八九十几'.includes(prev) ? 'di4' : 'de5';        // 单个的「地」多半是「慢慢地」的地
          else if (w === '得') py[o] = '我你他她它们咱您谁还就也都才又可总真只便'.includes(prev) && isZh(cs[o + 1] || '') ? 'dei3' : 'de5';   // 我得走了 / 跑得快
          else if (w === '还' && '钱款债书清账贷'.includes(cs[o + 1] || '')) py[o] = 'huan2';
          else if (w === '着' && pos === 'uz') py[o] = 'zhe5';
          else if (w === '了' && pos === 'ul') py[o] = 'le5';
        }
        o += n;
      }
    }
    for (const [w, fix] of Object.entries(FIX_WORDS)) {
      for (let at = text.indexOf(w); at >= 0; at = text.indexOf(w, at + 1)) fix.split(' ').forEach((p, k) => { py[at + k] = p; });
    }
    cs.forEach((c, i) => { if (c === '嗯') py[i] = 'n2'; else if (c === '呗') py[i] = 'bei5'; else if (c === '嘞') py[i] = 'lei5'; else if (c === '咗') py[i] = 'zuo5'; else if (c === '嗲') py[i] = 'dia3'; });
    const toneAt = i => { const m = /(\d)$/.exec(py[i] || ''); return m ? (m[1] === '0' ? '5' : m[1]) : (py[i] ? '5' : cs[i]); };
    const withOff = list => { let o = 0; return list.map(([w, p]) => { const r = [w, p, o]; o += w.length; return r; }); };
    const tonesOf = (w, off) => Array.from(w).map((_, k) => toneAt(off + k));

    // --- pre_merge_for_modify
    const mergeBu = s => {
      const out = [];
      for (let i = 0; i < s.length; i++) {
        let [w, p] = s[i];
        if (!XENG.has(p) && i > 0 && s[i - 1][0] === '不') w = '不' + w;
        const np = i + 1 < s.length ? s[i + 1][1] : null;
        if (w !== '不' || np === null || XENG.has(np)) out.push([w, p]);
      }
      return out;
    };
    const mergeYi = s => {
      let out = [], skip = false;
      for (let i = 0; i < s.length; i++) {
        const [w, p] = s[i];
        if (skip) { skip = false; continue; }
        if (i >= 1 && w === '一' && i + 1 < s.length && s[i - 1][0] === s[i + 1][0] && s[i - 1][1] === 'v' && !XENG.has(s[i + 1][1])) {
          out[out.length - 1] = [out[out.length - 1][0] + '一' + s[i + 1][0], out[out.length - 1][1]]; skip = true;
        } else out.push([w, p]);
      }
      const out2 = [];
      for (const [w, p] of out) {
        if (out2.length && out2[out2.length - 1][0] === '一' && !XENG.has(p)) out2[out2.length - 1] = [out2[out2.length - 1][0] + w, out2[out2.length - 1][1]];
        else out2.push([w, p]);
      }
      return out2;
    };
    const mergeRedup = s => {
      const out = [];
      for (const [w, p] of s) { if (out.length && w === out[out.length - 1][0] && !XENG.has(p)) out[out.length - 1][0] += w; else out.push([w, p]); }
      return out;
    };
    const mergeThree = (s, mode) => {
      const so = withOff(s), fl = so.map(([w, p, o]) => (XENG.has(p) ? ['0'] : tonesOf(w, o)));
      const out = [], mergedLast = new Array(s.length).fill(false);
      for (let i = 0; i < s.length; i++) {
        const [w, p] = s[i];
        const hit = !XENG.has(p) && i >= 1 && !mergedLast[i - 1] &&
          (mode === 1 ? allThree(fl[i - 1]) && allThree(fl[i]) : fl[i - 1][fl[i - 1].length - 1] === '3' && fl[i][0] === '3');
        if (hit && !isRedup(s[i - 1][0]) && s[i - 1][0].length + w.length <= 3) { out[out.length - 1][0] += w; mergedLast[i] = true; }
        else out.push([w, p]);
      }
      return out;
    };
    const mergeEr = s => {
      const out = [];
      for (let i = 0; i < s.length; i++) { const [w, p] = s[i]; if (i >= 1 && w === '儿' && !XENG.has(out[out.length - 1][1])) out[out.length - 1][0] += w; else out.push([w, p]); }
      return out;
    };
    seg = mergeEr(mergeThree(mergeThree(mergeRedup(mergeYi(mergeBu(seg))), 1), 2));

    // --- 逐词：变调 → 儿化 → 音素
    const tokens = [];
    for (let [w, pos, off] of withOff(seg)) {
      const wc = Array.from(w);
      if (pos === 'x' && wc.every(isZh)) pos = 'X';
      else if (pos !== 'x' && PUNC.has(w)) pos = 'x';
      if (XENG.has(pos) || !wc.some(isZh)) {
        for (const c of wc) {
          if (/\s/.test(c)) { if (tokens.length) tokens[tokens.length - 1].ws += c; }
          else if (PUNC.has(c)) tokens.push({ ph: c, ws: '', x: true });
        }
        continue;
      }
      if (tokens.length && !tokens[tokens.length - 1].x && !tokens[tokens.length - 1].ws) tokens[tokens.length - 1].ws = '/';
      const t = tonesOf(w, off);
      const base = wc.map((_, k) => (py[off + k] || '').replace(/\d$/, ''));
      if (pos === 'm#') {                                   // 数词：只管「一」和三声连读（五百 → 二声 + 三声）
        yiSandhi(w, t);
        const o3 = t.slice();
        for (let k = 0; k + 1 < t.length; k++) if (o3[k] === '3' && o3[k + 1] === '3') t[k] = '2';
      } else { buSandhi(w, t); yiSandhi(w, t); neuralSandhi(w, pos, t, base); threeSandhi(w, t); }
      const syl = wc.map((c, k) => (base[k] ? [...splitPinyin(base[k]), t[k]] : null));
      // 儿化
      const n = wc.length;
      if (wc[n - 1] === '儿' && syl[n - 1] && syl[n - 1][2] === '1') syl[n - 1][2] = '2';
      const keepEr = !MUST_ERHUA.has(w) && (NOT_ERHUA.has(w) || pos === 'a' || pos === 'j' || pos === 'nr');
      let ph = '';
      const parts = [];
      for (let k = 0; k < n; k++) {
        const s = syl[k];
        if (!s) { if (PUNC.has(wc[k])) parts.push(wc[k]); continue; }
        if (!keepEr && k === n - 1 && wc[k] === '儿' && (s[2] === '2' || s[2] === '5') && !NOT_ERHUA.has(w.slice(-2)) && parts.length && Array.isArray(parts[parts.length - 1])) {
          parts[parts.length - 1].r = true;
        } else parts.push(s);
      }
      for (const s of parts) {
        if (!Array.isArray(s)) { ph += s; continue; }
        const [ini, fin, tone] = s;
        if (s.r && fin === 'e') ph += (ZH_MAP[ini] ?? '') + ZH_MAP.er + tone;                    // 这儿 → zher
        else ph += (ZH_MAP[ini] ?? '') + (ZH_MAP[fin] ?? '') + (s.r ? 'R' : '') + tone;
      }
      tokens.push({ ph, ws: '', x: false });
    }
    return tokens.map(k => k.ph + k.ws).join('');
  }

  // --- 英文：查词典，查不到拆驼峰 / 去词尾，再不行按字母念
  const lex = w => (enLex ? enLex.get(w) : undefined);
  const spell = w => {
    const ps = Array.from(w).filter(c => /[A-Za-z]/.test(c)).map(c => LETTERS[c.toUpperCase()]);
    if (!ps.length) return '';
    return ps.map((p, i) => (i === ps.length - 1 ? p : p.replace('ˈ', 'ˌ'))).join('');
  };
  const lookup = w => {
    if (!w) return null;
    let p = lex(w) ?? lex(w.toLowerCase());
    if (p === undefined && w.length > 1 && w[0] === w[0].toUpperCase()) p = lex(w[0] + w.slice(1).toLowerCase());
    return p ?? null;
  };
  const withS = stem => (!stem ? null : 'ptkfθ'.includes(stem.slice(-1)) ? stem + 's' : 'szʃʒʧʤ'.includes(stem.slice(-1)) ? stem + 'ᵻz' : stem + 'z');
  const withEd = stem => (!stem ? null : 'pkfθʃsʧ'.includes(stem.slice(-1)) ? stem + 't' : stem.slice(-1) === 'd' || stem.slice(-1) === 't' ? stem + 'ᵻd' : stem + 'd');
  function enWord(w) {
    if (w.length === 1) return LETTERS[w.toUpperCase()] || '';
    if (EN_EXTRA[w.toLowerCase()]) return EN_EXTRA[w.toLowerCase()];
    if (!enLex || (w === w.toUpperCase() && w.length <= 5 && !lex(w))) return lex(w) ?? spell(w);       // 全大写的缩写：AI、PDF、TTS
    let p = lookup(w);
    if (p) return p;
    const lw = w.toLowerCase();
    if (lw.endsWith("'s") && (p = lookup(w.slice(0, -2)))) return withS(p);
    if (lw.length > 3 && lw.endsWith('s') && !lw.endsWith('ss') && (p = lookup(w.slice(0, -1)))) return withS(p);
    if (lw.length > 4 && lw.endsWith('es') && (p = lookup(w.slice(0, -2)))) return withS(p);
    if (lw.length > 4 && lw.endsWith('ies') && (p = lookup(w.slice(0, -3) + 'y'))) return withS(p);
    if (lw.length > 4 && lw.endsWith('ed') && ((p = lookup(w.slice(0, -2))) || (p = lookup(w.slice(0, -1))))) return withEd(p);
    if (lw.length > 5 && lw.endsWith('ing') && ((p = lookup(w.slice(0, -3))) || (p = lookup(w.slice(0, -3) + 'e')))) return p + 'ɪŋ';
    const parts = w.match(/[A-Z]+(?![a-z])|[A-Z]?[a-z]+/g);                                           // GitHub → Git Hub，iPhone → i Phone
    if (parts && parts.length > 1) return parts.map(x => enWord(x)).join('');
    return spell(w);
  }
  const en = text => text.split(/[\s-]+/).filter(Boolean).map(w => enWord(w.replace(/^'+|'+$/g, ''))).filter(Boolean).join(' ');

  const mapPunct = t => t.replace(/[、，]/g, ', ').replace(/[。．]/g, '. ').replace(/！/g, '! ').replace(/：/g, ': ').replace(/；/g, '; ').replace(/？/g, '? ')
    .replace(/[«《「【]/g, ' “').replace(/[»》」】]/g, '” ').replace(/（/g, ' (').replace(/）/g, ') ').trim();

  // 一句原文 → { norm, ps（音素串）, ids（模型输入，首尾各一个 0）, en（有没有英文单词） }
  function phonemize(text) {
    const norm = normalize(text);
    const t = mapPunct(norm);
    const segs = [];
    let hasEn = false;
    for (const m of t.matchAll(/([A-Za-z '-]*[A-Za-z][A-Za-z '-]*)|([^A-Za-z]+)/g)) {
      const e = (m[1] || '').trim(), z = (m[2] || '').trim();
      if (z) segs.push(zh(z));
      else if (e) { segs.push(en(e)); if (/[A-Za-z]{2,}/.test(e)) hasEn = true; }
    }
    let ps = segs.join(' ').replace(/ {2,}/g, ' ').trim();
    const ids = [0];
    for (const c of ps) { const id = VOCAB[c]; if (id !== undefined) ids.push(id); }
    if (ids.length > 510) ids.length = 510;
    ids.push(0);
    return { norm, ps, ids, en: hasEn };
  }
  return { phonemize, zh, en, normalize, splitText };
}
export const needsEnglish = text => /[A-Za-z]{2,}/.test(text);
export function parseLex(txt) {
  const m = new Map();
  for (const line of txt.split('\n')) { const i = line.indexOf('\t'); if (i > 0) m.set(line.slice(0, i), line.slice(i + 1)); }
  return m;
}
