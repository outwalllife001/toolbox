// 手机拍照 → 扫描件：找纸张四角 → 透视拉正（jscanify）→ 去阴影/黑白 → 多页合成 PDF
// 全部在浏览器里跑（OpenCV.js 4.7 WASM），不上传。
//
// 关于找角：jscanify 原版用「Canny + 最大轮廓 + 按象限取最远点」，纸放在木纹桌面、有手影时，
// 桌面纹理会和纸边连成一片，四个角跑到画面边上。这里换成「白纸分割 + 多种二值图候选 + 凸包拟合四边形 + 打分」，
// 再沿每条边精修四角；输出比例按透视反推（trueRatio）。拉正仍用 jscanify 的 extractPaper。

const VENDOR = new URL('../vendor/', import.meta.url);
let jscan = null;

// 读文件并汇报进度。GitHub Pages 会 gzip，content-length 是压缩后的长度，不能用来算进度或预分配缓冲区，
// 所以按已知的解压后大小估算
const CV_BYTES = 8980607;
async function fetchText(url, onProgress) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`下载失败 ${r.status}`);
  const reader = r.body.getReader(), parts = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value); got += value.length;
    if (onProgress) onProgress(Math.min(0.99, got / CV_BYTES));
  }
  return new Blob(parts, { type: 'text/javascript' });
}

function addScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = () => rej(new Error('脚本加载失败'));
    document.head.appendChild(s);
  });
}

// 注意：opencv.js 的 cv 对象带 then()，await 它会死循环；这里只轮询 cv.Mat，也不要从 async 函数里 return cv
export async function load(onProgress) {
  if (jscan) return;
  const blob = await fetchText(new URL('opencv/opencv.js', VENDOR), onProgress);
  const url = URL.createObjectURL(blob);
  await addScript(url);
  URL.revokeObjectURL(url);
  await new Promise((res, rej) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (window.cv && window.cv.Mat && window.cv.imread) { clearInterval(iv); res(); }
      else if (Date.now() - t0 > 60000) { clearInterval(iv); rej(new Error('OpenCV 初始化超时')); }
    }, 30);
  });
  await addScript(new URL('jscanify/jscanify.js', VENDOR).href);
  jscan = new window.jscanify();
  onProgress && onProgress(1);
}

// 把照片缩到长边不超过 max（手机原图 1200 万像素，全分辨率处理又慢又占内存）
export function toCanvas(img, max = 2400) {
  const w0 = img.naturalWidth || img.width, h0 = img.naturalHeight || img.height;
  const k = Math.min(1, max / Math.max(w0, h0));
  const c = document.createElement('canvas');
  c.width = Math.round(w0 * k); c.height = Math.round(h0 * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c;
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const area4 = q => Math.abs(q.reduce((s, p, i) => { const n = q[(i + 1) % 4]; return s + p.x * n.y - n.x * p.y; }, 0)) / 2;

// 四个点排成 左上、右上、右下、左下
function order(pts) {
  const c = { x: pts.reduce((s, p) => s + p.x, 0) / 4, y: pts.reduce((s, p) => s + p.y, 0) / 4 };
  const byAng = pts.slice().sort((a, b) => Math.atan2(a.y - c.y, a.x - c.x) - Math.atan2(b.y - c.y, b.x - c.x));
  // atan2 排序后从左上（x+y 最小）开始，顺时针
  let k = 0;
  byAng.forEach((p, i) => { if (p.x + p.y < byAng[k].x + byAng[k].y) k = i; });
  return [0, 1, 2, 3].map(i => byAng[(k + i) % 4]);
}

function isConvex(q) {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
    const z = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(z) < 1e-6) return false;
    if (sign && Math.sign(z) !== sign) return false;
    sign = Math.sign(z);
  }
  return true;
}

// 一个轮廓 → 凸包 → 逐步放宽精度直到拟合出 4 个点
function quadOf(contour) {
  const hull = new cv.Mat();
  cv.convexHull(contour, hull, false, true);
  const peri = cv.arcLength(hull, true);
  let quad = null;
  for (let e = 0.01; e <= 0.08 && !quad; e += 0.005) {
    const ap = new cv.Mat();
    cv.approxPolyDP(hull, ap, e * peri, true);
    if (ap.rows === 4) {
      const d = ap.data32S;
      quad = order([0, 1, 2, 3].map(i => ({ x: d[i * 2], y: d[i * 2 + 1] })));
    }
    ap.delete();
  }
  const hullArea = cv.contourArea(hull);
  hull.delete();
  return quad && isConvex(quad) ? { quad, hullArea } : null;
}

// 四边形里外的「白度」差：真纸是里面白、紧挨着的外圈暗；框进了桌面的四边形，里外差就小
function contrast(white, quad) {
  const W = white.cols, H = white.rows;
  const mask = cv.Mat.zeros(H, W, cv.CV_8UC1), ring = new cv.Mat();
  const pts = cv.matFromArray(4, 1, cv.CV_32SC2, quad.flatMap(p => [p.x, p.y]));
  const mv = new cv.MatVector(); mv.push_back(pts);
  cv.fillPoly(mask, mv, new cv.Scalar(255));
  const r = Math.max(5, Math.round(Math.max(W, H) / 40)) | 1;
  const k = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(r, r));
  cv.dilate(mask, ring, k);
  cv.subtract(ring, mask, ring);
  const inside = cv.mean(white, mask)[0], outside = cv.countNonZero(ring) ? cv.mean(white, ring)[0] : 0;
  [mask, ring, pts, mv, k].forEach(m => m.delete());
  return Math.max(0.02, (inside - outside) / 255);
}

// 二值图里找候选四边形
function candidatesFrom(bin, white, W, H, tag, out) {
  const contours = new cv.MatVector(), hier = new cv.Mat();
  cv.findContours(bin, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
  for (let i = 0; i < contours.size(); i++) {
    const c = contours.get(i);
    const a = cv.contourArea(c);
    if (a > 0.08 * W * H) {
      const r = quadOf(c);
      if (r) {
        const qa = area4(r.quad);
        // 打分：面积大、轮廓贴合四边形、里外白度差大、角不贴着画面边缘、对边长度接近
        const fill = Math.min(a, qa) / Math.max(a, qa);
        const onEdge = r.quad.filter(p => p.x < 3 || p.y < 3 || p.x > W - 4 || p.y > H - 4).length;
        const sides = [0, 1, 2, 3].map(k => dist(r.quad[k], r.quad[(k + 1) % 4]));
        const balance = Math.min(sides[0], sides[2]) / Math.max(sides[0], sides[2]) * Math.min(sides[1], sides[3]) / Math.max(sides[1], sides[3]);
        const score = Math.sqrt(qa / (W * H)) * fill ** 2 * contrast(white, r.quad) * (balance > 0.45 ? 1 : 0.3) * [1, 0.6, 0.3, 0.2, 0.1][onEdge];
        out.push({ quad: r.quad, score, tag });
      }
    }
    c.delete();
  }
  contours.delete(); hier.delete();
}

// 找纸：返回原图坐标下的四个角 [左上, 右上, 右下, 左下]，以及是否真的找到
export function detect(canvas) {
  const W0 = canvas.width, H0 = canvas.height;
  const k = Math.min(1, 640 / Math.max(W0, H0));
  const W = Math.round(W0 * k), H = Math.round(H0 * k);
  const src = cv.imread(canvas), small = new cv.Mat();
  cv.resize(src, small, new cv.Size(W, H), 0, 0, cv.INTER_AREA);
  src.delete();

  // 「白度」= 三个通道里最小的那个：白纸（含阴影里的白纸）三个通道都不低，木桌、彩色桌布的蓝通道很低
  // 「中性白」再减去饱和度：阳光下的浅色木桌也很亮，但偏黄，靠这个和白纸分开
  const white = new cv.Mat(H, W, cv.CV_8UC1), neutral = new cv.Mat(H, W, cv.CV_8UC1), gray = new cv.Mat();
  const d = small.data, wd = white.data, nd = neutral.data;
  for (let i = 0, j = 0; j < W * H; i += 4, j++) {
    const mn = Math.min(d[i], d[i + 1], d[i + 2]), mx = Math.max(d[i], d[i + 1], d[i + 2]);
    wd[j] = mn; nd[j] = Math.max(0, mn - 0.8 * (mx - mn));
  }
  cv.cvtColor(small, gray, cv.COLOR_RGBA2GRAY);
  small.delete();

  const cands = [];
  const blur = new cv.Mat(), bin = new cv.Mat();
  const kClose = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(11, 11));
  const kOpen = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(9, 9));   // 掐断纸和窗户、亮桌面之间的细连接
  for (const [m, tag] of [[white, 'white'], [neutral, 'neutral'], [gray, 'gray']]) {
    cv.GaussianBlur(m, blur, new cv.Size(5, 5), 0);
    const otsu = cv.threshold(blur, bin, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
    for (const dt of [-20, 0, 20, 40]) {
      const t = otsu + dt;
      if (t < 20 || t > 240) continue;
      cv.threshold(blur, bin, t, 255, cv.THRESH_BINARY);
      cv.morphologyEx(bin, bin, cv.MORPH_CLOSE, kClose);   // 补上字迹、阴影造成的洞
      cv.morphologyEx(bin, bin, cv.MORPH_OPEN, kOpen);
      candidatesFrom(bin, white, W, H, tag + dt, cands);
    }
  }
  // 边缘：纸和白色桌面颜色接近时靠这个
  cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);
  cv.Canny(blur, bin, 40, 120);
  const k3 = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
  cv.dilate(bin, bin, k3);
  candidatesFrom(bin, white, W, H, 'edge', cands);
  [white, neutral, gray, blur, bin, kClose, kOpen, k3].forEach(m => m.delete());

  cands.sort((a, b) => b.score - a.score);
  const best = cands[0];
  if (!best || best.score < 0.03) {
    const mx = W0 * 0.08, my = H0 * 0.08;
    return { found: false, corners: [{ x: mx, y: my }, { x: W0 - mx, y: my }, { x: W0 - mx, y: H0 - my }, { x: mx, y: H0 - my }] };
  }
  const rough = best.quad.map(p => ({ x: p.x / k, y: p.y / k }));
  return { found: true, tag: best.tag, corners: refine(canvas, rough),
    all: cands.map(c => ({ tag: c.tag, score: +c.score.toFixed(3), q: c.quad.map(p => [Math.round(p.x / k), Math.round(p.y / k)]) })) };
}

// 精修四角：在 1280 像素的「中性白」图上，沿每条边的法线找亮→暗跳变最大的位置，拟合直线，相邻两条边求交点。
// 640 像素上找到的角有几个像素误差，放大回原图后会在扫描件边上带进一条桌面
function refine(canvas, quad) {
  const k = Math.min(1, 1280 / Math.max(canvas.width, canvas.height));
  const W = Math.round(canvas.width * k), H = Math.round(canvas.height * k);
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(canvas, 0, 0, W, H);
  const d = ctx.getImageData(0, 0, W, H).data, N = new Float32Array(W * H);
  for (let i = 0, j = 0; j < W * H; i += 4, j++) {
    const mn = Math.min(d[i], d[i + 1], d[i + 2]), mx = Math.max(d[i], d[i + 1], d[i + 2]);
    N[j] = Math.max(0, mn - 0.8 * (mx - mn));
  }
  const at = (x, y) => {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    if (x0 < 0 || y0 < 0 || x0 >= W - 1 || y0 >= H - 1) return NaN;
    const fx = x - x0, fy = y - y0, i = y0 * W + x0;
    return (N[i] * (1 - fx) + N[i + 1] * fx) * (1 - fy) + (N[i + W] * (1 - fx) + N[i + W + 1] * fx) * fy;
  };
  const q = quad.map(p => ({ x: p.x * k, y: p.y * k }));
  const R = 14, lines = [];
  for (let s = 0; s < 4; s++) {
    const p = q[s], r = q[(s + 1) % 4], len = dist(p, r);
    const ux = (r.x - p.x) / len, uy = (r.y - p.y) / len, nx = uy, ny = -ux;   // 法线朝纸外
    const pts = [];
    for (let t = 0.08; t <= 0.92; t += 0.02) {
      const cx = p.x + (r.x - p.x) * t, cy = p.y + (r.y - p.y) * t;
      let bestS = 0, bestDrop = 0;
      for (let o = -R; o <= R; o++) {
        // 往外走一步变暗多少（各取 2 个像素平均，抗噪）
        const inside = (at(cx + nx * (o - 1), cy + ny * (o - 1)) + at(cx + nx * (o - 2), cy + ny * (o - 2))) / 2;
        const outside = (at(cx + nx * (o + 1), cy + ny * (o + 1)) + at(cx + nx * (o + 2), cy + ny * (o + 2))) / 2;
        const drop = inside - outside;
        if (drop > bestDrop) { bestDrop = drop; bestS = o; }
      }
      if (bestDrop > 18) pts.push({ x: cx + nx * bestS, y: cy + ny * bestS, o: bestS });
    }
    if (pts.length < 8) { lines.push(null); continue; }
    // 去掉偏离中位数太多的点（纸边被手指、阴影挡住的地方），再用剩下的点拟合直线
    const med = pts.map(t => t.o).sort((a, b) => a - b)[pts.length >> 1];
    const good = pts.filter(t => Math.abs(t.o - med) <= 3);
    if (good.length < 6) { lines.push(null); continue; }
    const mx = good.reduce((a, t) => a + t.x, 0) / good.length, my = good.reduce((a, t) => a + t.y, 0) / good.length;
    let sxx = 0, sxy = 0, syy = 0;
    for (const t of good) { sxx += (t.x - mx) ** 2; sxy += (t.x - mx) * (t.y - my); syy += (t.y - my) ** 2; }
    const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    lines.push({ x: mx, y: my, dx: Math.cos(ang), dy: Math.sin(ang) });
  }
  const sideLine = s => lines[s] || { x: q[s].x, y: q[s].y, dx: q[(s + 1) % 4].x - q[s].x, dy: q[(s + 1) % 4].y - q[s].y };
  const meet = (a, b) => {
    const den = a.dx * b.dy - a.dy * b.dx;
    if (Math.abs(den) < 1e-9) return null;
    const t = ((b.x - a.x) * b.dy - (b.y - a.y) * b.dx) / den;
    return { x: a.x + a.dx * t, y: a.y + a.dy * t };
  };
  // 角 i 是边 i-1 和边 i 的交点；离原来的角太远就不信它
  return q.map((p, i) => {
    const m = meet(sideLine((i + 3) % 4), sideLine(i));
    const ok = m && dist(m, p) < 20;
    return ok ? { x: m.x / k, y: m.y / k } : { x: p.x / k, y: p.y / k };
  });
}

// 纸的真实宽高比（宽/高）。斜着拍时近处的边长、远处的边短，直接量边长会把纸量"矮"。
// 用 Zhang & He《Whiteboard scanning and image enhancement》(2007) 的方法：假设主点在图像中心、像素是正方形，
// 由四个角反推焦距，再算出矩形的真实比例。退化（拍得很正）时退回按边长量。
function trueRatio(corners, W, H) {
  const [tl, tr, br, bl] = corners.map(p => [p.x - W / 2, p.y - H / 2, 1]);
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const k2 = dot(cross(tl, br), bl) / dot(cross(tr, br), bl);
  const k3 = dot(cross(tl, br), tr) / dot(cross(bl, br), tr);
  const n2 = tr.map((v, i) => k2 * v - tl[i]), n3 = bl.map((v, i) => k3 * v - tl[i]);
  const f2 = -(n2[0] * n3[0] + n2[1] * n3[1]) / (n2[2] * n3[2]);
  const sideRatio = Math.max(dist(corners[0], corners[1]), dist(corners[3], corners[2])) / Math.max(dist(corners[0], corners[3]), dist(corners[1], corners[2]));
  // 焦距要落在手机镜头的合理范围内（约 0.5–3 倍图像长边），否则说明几乎是正拍，量边长就够了
  if (!isFinite(f2) || f2 <= 0) return sideRatio;
  const f = Math.sqrt(f2), L = Math.max(W, H);
  if (f < 0.5 * L || f > 3 * L) return sideRatio;
  const r = Math.sqrt((n2[0] ** 2 / f2 + n2[1] ** 2 / f2 + n2[2] ** 2) / (n3[0] ** 2 / f2 + n3[1] ** 2 / f2 + n3[2] ** 2));
  return isFinite(r) && r > 0.2 && r < 5 ? r : sideRatio;
}

// 拉正：比例用 trueRatio 估算，接近 A4（1:1.414）就对齐到 A4
export function warp(canvas, corners, longSide = 1800) {
  const [tl, tr, br, bl] = corners;
  let ratio = 1 / trueRatio(corners, canvas.width, canvas.height);   // 高/宽
  if (Math.abs(ratio / Math.SQRT2 - 1) < 0.1) ratio = Math.SQRT2;
  else if (Math.abs(ratio * Math.SQRT2 - 1) < 0.1) ratio = 1 / Math.SQRT2;
  const outW = Math.round(ratio >= 1 ? longSide / ratio : longSide), outH = Math.round(ratio >= 1 ? longSide : longSide * ratio);
  // 四角往里收一点点，避免边上带进一条桌面
  const c = { x: (tl.x + tr.x + br.x + bl.x) / 4, y: (tl.y + tr.y + br.y + bl.y) / 4 };
  const pull = p => ({ x: p.x + (c.x - p.x) * 0.006, y: p.y + (c.y - p.y) * 0.006 });
  const [a, b, e, f] = [tl, tr, br, bl].map(pull);
  return jscan.extractPaper(canvas, outW, outH, { topLeftCorner: a, topRightCorner: b, bottomRightCorner: e, bottomLeftCorner: f });
}

// 去阴影：估计纸面背景亮度，再用原图除以背景。
// 背景 = 缩到 1/4 后做闭运算（先膨胀再腐蚀：比核窄的深色笔画被抹掉，大块阴影的边缘位置不变）→ 中值平滑 → 放大。
// 只做膨胀会把亮纸面"推"进阴影里，阴影边缘会留下一圈黑边
function flatten(src) {
  const W = src.cols, H = src.rows;
  const small = new cv.Mat(), bg = new cv.Mat(), out = new cv.Mat();
  cv.resize(src, small, new cv.Size(Math.max(8, Math.round(W / 4)), Math.max(8, Math.round(H / 4))), 0, 0, cv.INTER_AREA);
  const k = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(9, 9));
  cv.morphologyEx(small, small, cv.MORPH_CLOSE, k);
  k.delete();
  cv.medianBlur(small, small, 5);
  cv.resize(small, bg, new cv.Size(W, H), 0, 0, cv.INTER_LINEAR);
  cv.divide(src, bg, out, 255);
  small.delete(); bg.delete();
  return out;
}

const curve = (lo, hi, gamma) => {
  const t = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) { const x = Math.min(1, Math.max(0, (v - lo) / (hi - lo))); t[v] = Math.round(255 * x ** gamma); }
  return t;
};
const LUT = { scan: curve(25, 228, 1.35), bw: curve(70, 205, 1.6) };

// mode: scan（去阴影，保留彩色笔迹）| bw（黑白）| raw（只拉正）
export function enhance(warped, mode = 'scan') {
  const out = document.createElement('canvas');
  out.width = warped.width; out.height = warped.height;
  if (mode === 'raw') { out.getContext('2d').drawImage(warped, 0, 0); return out; }
  const src = cv.imread(warped), rgb = new cv.Mat();
  cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB);
  src.delete();
  let flat;
  if (mode === 'bw') {
    const g = new cv.Mat();
    cv.cvtColor(rgb, g, cv.COLOR_RGB2GRAY);
    flat = flatten(g); g.delete();
  } else flat = flatten(rgb);
  rgb.delete();
  const ctx = out.getContext('2d'), id = ctx.createImageData(out.width, out.height), o = id.data, f = flat.data, t = LUT[mode];
  const n = out.width * out.height;
  if (mode === 'bw') {
    for (let i = 0, j = 0; j < n; i += 4, j++) { const v = t[f[j]]; o[i] = o[i + 1] = o[i + 2] = v; o[i + 3] = 255; }
  } else {
    // 纸面压成纯白，笔迹加深；彩色笔迹（蓝笔、红勾）饱和度略提，不变灰
    for (let p = 0, i = 0, j = 0; p < n; p++, i += 4, j += 3) {
      const r = t[f[j]], g = t[f[j + 1]], b = t[f[j + 2]];
      const m = (r + g + b) / 3;
      o[i] = r + (r - m) * 0.25; o[i + 1] = g + (g - m) * 0.25; o[i + 2] = b + (b - m) * 0.25; o[i + 3] = 255;
    }
  }
  flat.delete();
  clearBorder(o, out.width, out.height);
  ctx.putImageData(id, 0, 0);
  return out;
}

// 扫描件四边如果带进了一条桌面：从边上往里、在 2.5% 宽的边带内，把和边连着的深色像素刷白。
// 正文有页边距，不会贴着纸边，所以不受影响
function clearBorder(o, W, H) {
  const band = Math.max(6, Math.round(Math.min(W, H) * 0.025));
  const dark = i => o[i] * 0.3 + o[i + 1] * 0.59 + o[i + 2] * 0.11 < 235;
  const white = i => { o[i] = o[i + 1] = o[i + 2] = 255; };
  const run = (start, step, n) => { for (let k = 0, i = start; k < n && dark(i); k++, i += step) white(i); };
  for (let x = 0; x < W; x++) { run(x * 4, W * 4, band); run(((H - 1) * W + x) * 4, -W * 4, band); }
  for (let y = 0; y < H; y++) { run(y * W * 4, 4, band); run((y * W + W - 1) * 4, -4, band); }
}

export function rotate(canvas, deg = 90) {
  const c = document.createElement('canvas');
  const side = deg % 180 !== 0;
  c.width = side ? canvas.height : canvas.width; c.height = side ? canvas.width : canvas.height;
  const ctx = c.getContext('2d');
  ctx.translate(c.width / 2, c.height / 2); ctx.rotate(deg * Math.PI / 180);
  ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
  return c;
}

const jpegBytes = (canvas, q) => new Promise(r => canvas.toBlob(async b => r(new Uint8Array(await b.arrayBuffer())), 'image/jpeg', q));

function scaled(canvas, k) {
  if (k >= 1) return canvas;
  const c = document.createElement('canvas');
  c.width = Math.round(canvas.width * k); c.height = Math.round(canvas.height * k);
  c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height);
  return c;
}

// 最小的 PDF：每页一张 JPEG，铺满 A4（横图用横向 A4）
function buildPdf(jpegs) {
  const enc = new TextEncoder(), chunks = [], offsets = [];
  let pos = 0;
  const put = x => { const b = typeof x === 'string' ? enc.encode(x) : x; chunks.push(b); pos += b.length; };
  const obj = (id, body, stream) => {
    offsets[id] = pos;
    put(`${id} 0 obj\n${body}\n`);
    if (stream) { put('stream\n'); put(stream); put('\nendstream\n'); }
    put('endobj\n');
  };
  put('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const n = jpegs.length, kids = [];
  for (let i = 0; i < n; i++) kids.push(`${3 + i * 3} 0 R`);
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Count ${n} /Kids [${kids.join(' ')}] >>`);
  jpegs.forEach(({ bytes, w, h }, i) => {
    const pid = 3 + i * 3, cid = pid + 1, iid = pid + 2;
    const land = w > h, PW = land ? 841.89 : 595.28, PH = land ? 595.28 : 841.89;
    const s = Math.min(PW / w, PH / h), dw = w * s, dh = h * s, x = (PW - dw) / 2, y = (PH - dh) / 2;
    const content = enc.encode(`q ${dw.toFixed(2)} 0 0 ${dh.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm /Im0 Do Q`);
    obj(pid, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources << /XObject << /Im0 ${iid} 0 R >> >> /Contents ${cid} 0 R >>`);
    obj(cid, `<< /Length ${content.length} >>`, content);
    obj(iid, `<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${bytes.length} >>`, bytes);
  });
  const xref = pos, total = 3 + n * 3;
  let x = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let i = 1; i < total; i++) x += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  put(x + `trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(chunks, { type: 'application/pdf' });
}

// 合成 PDF；maxKB 有值时先降 JPEG 质量、再降分辨率，直到不超过 maxKB
export async function makePdf(canvases, maxKB = 0) {
  const tryWith = async (q, k) => {
    const jpegs = [];
    for (const c0 of canvases) { const c = scaled(c0, k); jpegs.push({ bytes: await jpegBytes(c, q), w: c.width, h: c.height }); }
    return buildPdf(jpegs);
  };
  let pdf = await tryWith(0.88, 1);
  if (!maxKB || pdf.size <= maxKB * 1024) return pdf;
  for (const k of [1, 0.8, 0.64, 0.5, 0.4, 0.3]) {
    let lo = 0.3, hi = 0.88, best = null;
    for (let i = 0; i < 6; i++) {
      const q = (lo + hi) / 2, p = await tryWith(q, k);
      if (p.size <= maxKB * 1024) { best = p; lo = q; } else hi = q;
    }
    if (best) return best;
  }
  return tryWith(0.3, 0.25);
}
