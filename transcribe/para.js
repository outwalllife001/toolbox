// 识别结果（每个字带时间戳）→ 句子 → 段落；导出 TXT。纯函数，浏览器和 node 都能跑
// 段落：停顿超过 1.1 秒（这段不太短时 0.95 秒，多半是换人说了）或者这段已经很长时另起一段；SenseVoice 是一段段（4–15 秒）识别的，
// 段和段交界、换人说话的地方常常没有标点，停顿够长就补一个句号（前一个字是「吗 / 呢」补问号）

const END = /^[。？！?!]$/;
const PUNCT = /^[，。？！；：、,.?!;:…]$/;

export function paragraphs(toks, { gap = 0.95, longGap = 1.1, sentGap = 0.8, soft = 110, hard = 220 } = {}) {
  // 1. 句子：遇到句末标点断开；字和字之间停顿超过 sentGap 也断开（补标点）
  const sents = []; let cur = null, lastT = -1, lastCh = '';
  const close = () => { if (cur && cur.text.trim()) sents.push(cur); cur = null; };
  for (let i = 0; i < toks.length; i++) {
    const k = toks[i], s = k.s;
    if (PUNCT.test(s.trim())) {
      if (!cur) continue;
      // 英文句号夹在数字中间是小数点
      if (s === '.' && /\d$/.test(cur.text) && /^\d/.test(toks[i + 1]?.s || '')) { cur.text += s; continue; }
      cur.text += s.trim();
      if (END.test(s.trim()) || s === '.') { cur.end = k.t; close(); }
      continue;
    }
    const pause = lastT < 0 ? 0 : k.t - lastT;
    if (cur && pause > sentGap) { cur.text = cur.text.replace(/[，,、]$/, '') + (/[吗呢么]$/.test(lastCh) ? '？' : '。'); close(); }
    if (!cur) cur = { start: k.t, end: k.t, text: '', pause };
    // 英文单词之间留空格（模型的 ▁ 已换成空格）；中文前面不要空格
    cur.text += cur.text ? s : s.trimStart();
    cur.end = k.t; lastT = k.t; lastCh = s.trim().slice(-1) || lastCh;
  }
  if (cur) { if (!END.test(cur.text.slice(-1))) cur.text = cur.text.replace(/[，,、]$/, '') + (/[a-z]$/i.test(cur.text) ? '.' : '。'); close(); }
  // 2. 段落
  const paras = []; let p = null;
  for (const s of sents) {
    const len = p ? [...p.text].length : 0;
    if (!p || s.pause >= longGap || (s.pause >= gap && len >= 6) || len >= soft) { p = { start: s.start, end: s.end, text: '' }; paras.push(p); }
    p.text += s.text.replace(/^\s+/, p.text && /[a-z.?!]$/i.test(p.text) ? ' ' : '');
    p.end = s.end;
  }
  // 太长的段（一直没停顿、没句号）在中间附近的逗号处切开
  const out = [];
  for (const q of paras) {
    let t = q.text;
    while ([...t].length > hard) {
      const mid = Math.floor(t.length / 2); let cut = -1;
      for (let d = 0; d < mid; d++) { if (/[，,；;]/.test(t[mid + d])) { cut = mid + d; break; } if (/[，,；;]/.test(t[mid - d])) { cut = mid - d; break; } }
      if (cut < 0) break;
      out.push({ start: q.start, end: q.end, text: t.slice(0, cut) + '。' }); t = t.slice(cut + 1);
    }
    out.push({ ...q, text: t });
  }
  return out.map(q => ({ start: +Math.max(0, q.start - 0.15).toFixed(2), end: +q.end.toFixed(2), text: q.text }));
}

export const clock = s => {
  s = Math.max(0, Math.floor(s));
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60, p = v => String(v).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(x)}` : `${p(m)}:${p(x)}`;
};

export const toText = (paras, { times = true } = {}) => paras.filter(p => p.text.trim())
  .map(p => (times ? `[${clock(p.start)}] ` : '') + p.text.trim()).join('\n\n') + '\n';

export const countChars = paras => paras.reduce((a, p) => a + p.text.replace(/[\s，。？！；：、,.?!;:…“”"']/g, '').length, 0);
