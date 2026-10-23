// 识别结果（每个字带时间戳）→ 字幕条 / SRT。纯函数，主线程和 Worker 都能用

// ---------- 字 → 字幕条：按标点、长停顿断句，太长的按字数对半分，时间取自每个字的时间戳 ----------
const BREAK = /^[，。？！；：,?!;:…]$/;
const SKIP = /^[、“”‘’"'《》（）()\[\]【】·—-]$/;
export const width = s => [...s].reduce((a, c) => a + (c.charCodeAt(0) < 128 ? 0.55 : 1), 0);

export function toCues(toks, { maxChars = 14, gap = 0.8, total = Infinity } = {}) {
  // 先按标点 / 停顿分句（英文句号夹在数字中间是小数点，不断）
  const phrases = []; let cur = [];
  const flush = endT => { if (cur.length) phrases.push({ toks: cur, end: endT }); cur = []; };
  toks.forEach((k, i) => {
    const s = k.s.trim();
    if (s === '.' && /\d$/.test(toks[i - 1]?.s || '') && /^\d/.test(toks[i + 1]?.s || '')) { cur.push(k); return; }
    if (BREAK.test(s) || s === '.') { flush(k.t); return; }
    if (SKIP.test(s)) { if (cur.length) cur.push({ s: ' ', t: k.t }); return; }
    if (cur.length && k.t - cur[cur.length - 1].t > gap) flush(null);
    cur.push(k);
  });
  flush(null);
  // 太长的句子分成几条，切点挑在理想位置附近、和下一个字间隔最大的地方
  const cues = [];
  for (const p of phrases) {
    const text = p.toks.map(k => k.s).join(''), n = Math.ceil(width(text) / maxChars);
    let parts = [p.toks];
    if (n > 1) {
      parts = []; let rest = p.toks;
      for (let i = n; i > 1; i--) {
        const ideal = Math.round(rest.length / i);
        let cut = ideal, bg = -1;
        for (let c = Math.max(1, ideal - 2); c <= Math.min(rest.length - 1, ideal + 2); c++) {
          const g = rest[c].t - rest[c - 1].t + (rest[c].s.startsWith(' ') || rest[c - 1].s === ' ' ? 0.2 : 0);
          if (g > bg) { bg = g; cut = c; }
        }
        parts.push(rest.slice(0, cut)); rest = rest.slice(cut);
      }
      parts.push(rest);
    }
    parts.forEach((ks, i) => {
      const t = ks.map(k => k.s).join('').replace(/\s+/g, ' ').trim();
      if (!t) return;
      const last = ks[ks.length - 1].t;
      cues.push({ start: ks[0].t - 0.12, end: i === parts.length - 1 && p.end != null ? p.end + 0.05 : last + 0.35, text: t });
    });
  }
  // 收尾：至少显示 0.7 秒；不和下一条重叠；和下一条只差一点点就接上，免得闪
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i], nx = cues[i + 1];
    c.start = Math.max(0, i ? Math.max(c.start, cues[i - 1].end) : c.start);
    c.end = Math.max(c.end, c.start + 0.7);
    if (nx) { if (nx.start - c.end < 0.35) c.end = nx.start; c.end = Math.min(c.end, Math.max(nx.start, c.start + 0.2)); }
    c.end = Math.min(c.end, total);
    c.start = +c.start.toFixed(2); c.end = +c.end.toFixed(2);
  }
  return cues;
}

// ---------- SRT ----------
const ts = s => { const ms = Math.round(s * 1000), p = (v, n = 2) => String(v).padStart(n, '0'); return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`; };
export const toSrt = cues => cues.map((c, i) => `${i + 1}\n${ts(c.start)} --> ${ts(c.end)}\n${c.text}\n`).join('\n');

// 分段识别时一段一段接上：和上一段最后一条重叠就截短，只差一点点就接上
export function append(all, more) {
  const a = all[all.length - 1], b = more[0];
  if (a && b && (a.end > b.start || b.start - a.end < 0.35)) a.end = Math.max(a.start + 0.2, b.start);
  all.push(...more);
  return all;
}
