// 跟读：把「识别出来的字」对到「稿子」上，算出现在念到哪了
// 识别小模型常把字认成同音字（吐司 → 土司）、漏字、多字，人也会临场加词、跳句、重念，所以不能逐字比对：
//   · 稿子里每个字换成不带声调的拼音（多音字所有读音都算；平翘舌、前后鼻音、n/l 不分）
//   · 最近认出来的十来个字，和「当前位置前后一段稿子」做局部对齐（Smith-Waterman），要求最后一个字必须对上
//   · 顺着念（对上的就是下一个字）马上前进；往前跳、往回跳要连着对上好几个字才算
// 纯函数，不碰页面；Node 里也能跑（days/day19-prompter/follow_test.mjs）

const DIGIT = { 0: ['ling'], 1: ['yi', 'yao'], 2: ['er', 'liang'], 3: ['san'], 4: ['si'], 5: ['wu'], 6: ['liu'], 7: ['qi'], 8: ['ba'], 9: ['jiu'] };
const HAN = /[㐀-鿿]/;
const END = /[。！？!?；;…\n]/, PAUSE = /[，、,：:—]/;

// 拼音 → 模糊后的音节
export function fuzzy(py) {
  return py.toLowerCase().replace(/ü/g, 'v').replace(/^zh/, 'z').replace(/^ch/, 'c').replace(/^sh/, 's').replace(/^l/, 'n').replace(/ng$/, 'n');
}

// pinyinPro：pinyin-pro 的导出对象。返回 ch → 模糊音节数组（带缓存）
export function makeReadings(pinyinPro) {
  const cache = new Map();
  return ch => {
    let r = cache.get(ch);
    if (r) return r;
    if (HAN.test(ch)) {
      let list = [];
      try { list = pinyinPro.pinyin(ch, { toneType: 'none', type: 'array', multiple: true }); } catch { }
      r = [...new Set(list.filter(s => /^[a-zü]+$/i.test(s)).map(fuzzy))];
    } else if (DIGIT[ch]) r = DIGIT[ch].map(fuzzy);
    else if (/[a-z]/i.test(ch)) r = [ch.toUpperCase()];
    else r = [];
    cache.set(ch, r);
    return r;
  };
}

// 稿子 → chars（逐字符，给页面画）+ units（能念出来的单元，给对齐用）
//   chars[i] = { ch, u }      u：这个字符属于第几个单元；标点、空格是 -1
//   units[k] = { from, to, keys, soft, end, pause }   from/to：字符下标；soft：数字、英文，跳过不扣分；end / pause：后面跟着句号 / 逗号
export function parseScript(text, readings) {
  const src = [...text.replace(/\r\n?/g, '\n')];
  const chars = [], units = [];
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (HAN.test(ch)) {
      units.push({ from: i, to: i + 1, keys: readings(ch), soft: false, end: false, pause: false });
      chars.push({ ch, u: units.length - 1 });
    } else if (/[0-9]/.test(ch)) {
      units.push({ from: i, to: i + 1, keys: readings(ch), soft: true, end: false, pause: false });
      chars.push({ ch, u: units.length - 1 });
    } else if (/[a-z]/i.test(ch)) {
      let j = i; while (j < src.length && /[a-z0-9'’-]/i.test(src[j])) j++;
      units.push({ from: i, to: j, keys: [], soft: true, end: false, pause: false });
      for (let k = i; k < j; k++) chars.push({ ch: src[k], u: units.length - 1 });
      i = j - 1;
    } else {
      chars.push({ ch, u: -1 });
      const last = units[units.length - 1];
      if (last) { if (END.test(ch)) last.end = true; else if (PAUSE.test(ch)) last.pause = true; }
    }
  }
  if (units.length) units[units.length - 1].end = true;
  return { chars, units };
}

const M = 12;                 // 记住最近认出来的多少个字
const BACK = 40, AHEAD = 60;  // 平时只在当前位置前后这么多个字里找
const MATCH = 2, MISMATCH = -1.5, GAP = -1, SKIP = 3;

export class Follower {
  constructor(units) { this.units = units; this.pos = 0; this.hist = []; this.miss = 0; }
  get done() { return this.pos >= this.units.length; }
  seek(pos) { this.pos = Math.max(0, Math.min(this.units.length, pos)); this.hist = []; this.miss = 0; }

  // 认出来一个字（keys：它的模糊音节）。返回 null（位置没动）或 { pos, from, jump }（jump：不是顺着念下来的）
  push(keys) {
    if (!keys || !keys.length) return null;
    this.hist.push(keys); if (this.hist.length > M) this.hist.shift();
    let r = this._search(Math.max(0, this.pos - BACK), Math.min(this.units.length, this.pos + AHEAD), false);
    // 连着好几个字都对不上：可能跳到别的段落了，在整篇稿子里找（要连着对上 5 个字）
    if (!r && this.miss >= 5 && this.units.length > BACK + AHEAD) r = this._search(0, this.units.length, true);
    if (!r) { this.miss++; return null; }
    const from = this.pos;
    this.pos = r.j + 1; this.miss = 0;
    return { pos: this.pos, from, jump: r.j !== from };
  }

  _search(a, b, global) {
    const H = this.hist, m = H.length, U = this.units, w = b - a;
    if (w <= 0) return null;
    const last = H[m - 1];
    // prev[j]：H 的前 m−1 个字和 units[a … a+j) 的最好局部对齐得分（以两边各自的最后一个为结尾）
    // 每一格记三样：得分；稿子这边已经连着跳过了几个字（最多 SKIP 个）；最近连着对上了几个字（cnt：中间认错字不断，跳字、多字就从 0 数）。
    // 前面攒下的高分能「垫」着跨过一段稿子，所以往远处跳不看总分，看 cnt：新位置自己连着对上了几个字
    let prev = new Float32Array(w + 1), cur = new Float32Array(w + 1), prun = new Uint8Array(w + 1), crun = new Uint8Array(w + 1), pcnt = new Uint8Array(w + 1), ccnt = new Uint8Array(w + 1);
    for (let i = 1; i < m; i++) {
      const h = H[i - 1]; cur[0] = 0; crun[0] = 0; ccnt[0] = 0;
      for (let j = 1; j <= w; j++) {
        const u = U[a + j - 1], ok = hit(h, u.keys);
        let v = prev[j - 1] + (ok ? MATCH : MISMATCH), run = 0, cnt = pcnt[j - 1] + (ok ? 1 : 0);
        const up = prev[j] + GAP;
        if (up > v) { v = up; run = prun[j]; cnt = 0; }          // 说了稿子里没有的字：连对的计数也断开
        if (u.soft) { if (cur[j - 1] > v) { v = cur[j - 1]; run = crun[j - 1]; cnt = ccnt[j - 1]; } }
        else if (crun[j - 1] < SKIP && cur[j - 1] + GAP > v) { v = cur[j - 1] + GAP; run = crun[j - 1] + 1; cnt = 0; }
        if (v <= 0) { v = 0; run = 0; cnt = 0; }
        cur[j] = v; crun[j] = run; ccnt[j] = cnt;
      }
      [prev, cur] = [cur, prev]; [prun, crun] = [crun, prun]; [pcnt, ccnt] = [ccnt, pcnt];
    }
    let best = null, bu = -Infinity;
    for (let j = 1; j <= w; j++) {
      const k = a + j - 1;
      if (!hit(last, U[k].keys)) continue;
      const score = prev[j - 1] + MATCH, cnt = pcnt[j - 1] + 1, d = k - this.pos;
      let pass;
      if (global) pass = cnt >= 5;                                // 全篇找：连着对上 5 个字
      else if (d === 0) pass = score >= (this.miss <= 2 ? 2 : 4); // 顺着念：对上就走；刚才连着几个字对不上（在说稿子外的话），要连对两个才信
      else if (d > 0 && d <= 2) pass = score >= 3;                // 识别漏了一两个字：有前文垫着就跟上
      else if (d > 0) pass = cnt >= (d <= 10 ? 3 : 4);            // 往前跳：新位置连着对上 3 个字，跳得远要 4 个
      else pass = d <= -4 && cnt >= 4;                            // 往回：重复一两个字不回退；重念一句要连着对上 4 个字
      if (!pass) continue;
      const util = score + 2 * Math.min(cnt, 6) - (d >= 0 ? 0.25 * d : 0.3 * -d + 1);
      if (util > bu) { bu = util; best = { j: k, score, cnt }; }
    }
    return best;
  }
}

function hit(a, b) {
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) if (a[i] === b[j]) return true;
  return false;
}

// 念完大概要多久（秒）：汉字、数字按每分钟 cpm 个算，英文单词一个顶两个字
export function estimateSeconds(units, cpm = 240) {
  let n = 0;
  for (const u of units) n += u.soft && u.to - u.from > 1 ? 2 : 1;
  return n / cpm * 60;
}
