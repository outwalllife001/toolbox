// 字幕画法：预览（叠在视频上的 canvas）和导出（逐帧画进视频）用同一个函数，所见即所得

export const STYLES = [
  ['白字黑边', { fill: '#ffffff', stroke: '#000000' }],
  ['黄字黑边', { fill: '#ffe14d', stroke: '#000000' }],
  ['白字黑底', { fill: '#ffffff', box: 'rgba(0,0,0,.62)' }],
  ['黑字白底', { fill: '#141414', box: 'rgba(255,255,255,.92)' }],
];
export const SIZES = [['小', 0.052], ['中', 0.064], ['大', 0.078]];   // 字高占画面短边的比例
// 竖屏视频底部会被抖音的标题、昵称盖住，所以「下」放在 72%；横屏放在 88%
export const POSITIONS = [['下', [0.72, 0.88]], ['中', [0.5, 0.5]], ['上', [0.2, 0.12]]];
const FONT = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "Source Han Sans SC", sans-serif';

export const cueAt = (cues, t) => cues.find(c => t >= c.start && t < c.end && c.text.trim());

// 太长的一行拆成两行（优先在空格处拆，中文按字数对半）
function lines(g, text, maxW) {
  if (g.measureText(text).width <= maxW) return [text];
  const chars = [...text], mid = chars.length / 2;
  let cut = Math.round(mid), best = 1e9;
  chars.forEach((c, i) => { if (c === ' ' && Math.abs(i - mid) < best) { best = Math.abs(i - mid); cut = i; } });
  if (best > chars.length / 4) cut = Math.round(mid);
  return [chars.slice(0, cut).join('').trim(), chars.slice(cut).join('').trim()];
}

export function drawCue(g, text, W, H, { style = 0, size = 1, pos = 0 } = {}) {
  if (!text) return;
  const st = STYLES[style][1], vertical = H >= W;
  let fs = Math.round(Math.min(W, H) * SIZES[size][1]);
  const maxW = W * 0.88;
  g.save();
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
  g.font = `800 ${fs}px ${FONT}`;
  let ls = lines(g, text, maxW);
  const widest = () => Math.max(...ls.map(l => g.measureText(l).width));
  if (widest() > maxW) { fs = Math.floor(fs * maxW / widest()); g.font = `800 ${fs}px ${FONT}`; }
  const lh = fs * 1.28, cy = H * POSITIONS[pos][1][vertical ? 0 : 1], y0 = cy - (ls.length - 1) * lh / 2;
  if (st.box) {
    const w = widest() + fs * 0.9, h = ls.length * lh + fs * 0.35, r = fs * 0.28;
    g.fillStyle = st.box;
    g.beginPath(); g.roundRect(W / 2 - w / 2, cy - h / 2, w, h, r); g.fill();
  }
  ls.forEach((l, i) => {
    const y = y0 + i * lh;
    if (st.stroke) { g.strokeStyle = st.stroke; g.lineWidth = Math.max(2, fs * 0.17); g.strokeText(l, W / 2, y); }
    g.fillStyle = st.fill; g.fillText(l, W / 2, y);
  });
  g.restore();
}
