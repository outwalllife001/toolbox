// 证件照核心算法：浏览器端移植自 HivisionIDPhotos (Apache-2.0)
// https://github.com/Zeyi-Lin/HivisionIDPhotos  hivision/creator/{human_matting,photo_adjuster,layout_calculator,utils}.py
// 流程：人像抠图(MODNet) → 补洞 → 人脸检测(BlazeFace) → 按人脸比例裁剪 → 标准照 / 高清照 / 六寸排版照
import * as ort from '../vendor/ort/ort.wasm.min.mjs';
import { FaceDetector, FilesetResolver } from '../vendor/mediapipe/vision_bundle.mjs';

const BASE = new URL('..', import.meta.url).href;
ort.env.wasm.wasmPaths = BASE + 'vendor/ort/';
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;

// BlazeFace 的框比 MTCNN 小一圈，HivisionIDPhotos 的比例参数是按 MTCNN 标定的。
// 这两个系数把 BlazeFace 框换算成 MTCNN 框（用 4 张样张对齐原版输出，见 days/day01-idphoto/README.md）
export const FACE_TO_MTCNN = { w: 0.92, h: 1.24, dy: -0.15 };

let matSess = null, faceDet = null;

export async function loadModels(onProgress = () => {}) {
  if (!matSess) {
    onProgress('model', 0);
    const buf = await fetchWithProgress(BASE + 'models/hivision_modnet.onnx', p => onProgress('model', p));
    matSess = await ort.InferenceSession.create(buf, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  }
  if (!faceDet) {
    const fileset = await FilesetResolver.forVisionTasks(BASE + 'vendor/mediapipe/wasm');
    faceDet = await FaceDetector.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: BASE + 'models/blaze_face_short_range.tflite', delegate: 'CPU' },
      runningMode: 'IMAGE', minDetectionConfidence: 0.5,
    });
  }
  onProgress('model', 1);
}

async function fetchWithProgress(url, onP) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('模型下载失败：' + r.status);
  // 线上（GitHub Pages）会 gzip：content-length 是压缩后的长度，流里拿到的是解压后的字节，
  // 所以不能按 content-length 预分配，只拿它估进度
  const total = +r.headers.get('content-length') || 0;
  if (!r.body) return new Uint8Array(await r.arrayBuffer());
  const chunks = [], rd = r.body.getReader(); let got = 0;
  for (;;) {
    const { done, value } = await rd.read();
    if (done) break;
    chunks.push(value); got += value.length;
    if (total) onP(Math.min(0.99, got / total));
  }
  const out = new Uint8Array(got); let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const ctx2d = c => c.getContext('2d', { willReadFrequently: true });

// 原版先把图缩到最长边 2000（resize_image_esp）
export function toProcessingCanvas(img, esp = 2000) {
  const w0 = img.naturalWidth || img.width, h0 = img.naturalHeight || img.height;
  const k = Math.min(1, esp / Math.max(w0, h0));
  const c = canvas(Math.round(w0 * k), Math.round(h0 * k));
  const g = ctx2d(c); g.imageSmoothingQuality = 'high'; g.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

// ---------- 1. 抠图：MODNet 512x512，归一化到 [-1,1] ----------
export async function matting(src) {
  const S = 512, small = canvas(S, S), g = ctx2d(small);
  g.imageSmoothingQuality = 'high'; g.drawImage(src, 0, 0, S, S);
  const px = g.getImageData(0, 0, S, S).data, n = S * S, x = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    x[i] = px[i * 4] / 127.5 - 1; x[n + i] = px[i * 4 + 1] / 127.5 - 1; x[2 * n + i] = px[i * 4 + 2] / 127.5 - 1;
  }
  const feeds = { [matSess.inputNames[0]]: new ort.Tensor('float32', x, [1, 3, S, S]) };
  const matte = (await matSess.run(feeds))[matSess.outputNames[0]].data;
  // 512 的蒙版放大回原尺寸（双线性），写进 alpha
  const m = new ImageData(S, S);
  for (let i = 0; i < n; i++) { const v = Math.max(0, Math.min(255, matte[i] * 255)); m.data[i * 4] = m.data[i * 4 + 1] = m.data[i * 4 + 2] = v; m.data[i * 4 + 3] = 255; }
  const mc = canvas(S, S); ctx2d(mc).putImageData(m, 0, 0);
  const W = src.width, H = src.height, big = canvas(W, H), bg = ctx2d(big);
  bg.imageSmoothingQuality = 'high'; bg.drawImage(mc, 0, 0, W, H);
  const alpha = bg.getImageData(0, 0, W, H).data;
  const out = ctx2d(src).getImageData(0, 0, W, H);
  for (let i = 0, N = W * H; i < N; i++) out.data[i * 4 + 3] = alpha[i * 4];
  hollowOutFix(out);
  const rgba = canvas(W, H); ctx2d(rgba).putImageData(out, 0, 0);
  return rgba;
}

// 原版 hollow_out_fix：二值化 → 5x5 腐蚀 3 次 → 最大轮廓内部全部补成不透明（白衬衫、浅色衣服常被抠漏）
function hollowOutFix(img) {
  const { width: W, height: H, data } = img, N = W * H;
  const bin = new Uint8Array(N);
  for (let i = 0; i < N; i++) bin[i] = data[i * 4 + 3] > 127 ? 1 : 0;
  const core = largestComponent(erode(bin, W, H, 6), W, H);
  // 从边界泛洪"最大块之外"；剩下的（最大块本身 + 它包住的洞）就是轮廓内部
  const outside = new Uint8Array(N), stack = new Int32Array(N); let sp = 0;
  const push = i => { if (!core[i] && !outside[i]) { outside[i] = 1; stack[sp++] = i; } };
  for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
  while (sp) {
    const i = stack[--sp], x = i % W;
    if (x > 0) push(i - 1);
    if (x < W - 1) push(i + 1);
    if (i >= W) push(i - W);
    if (i < N - W) push(i + W);
  }
  for (let i = 0; i < N; i++) if (!outside[i]) data[i * 4 + 3] = 255;
}

// 方形结构元素（边长 2r+1）的腐蚀：先按行、再按列，看左右（上下）连续 1 的长度是否都超过 r。
// 图像边缘按 0 处理，等价于原版先四周补 10 像素黑边
function erode(bin, W, H, r) {
  const tmp = new Uint8Array(W * H), out = new Uint8Array(W * H);
  const runA = new Int32Array(Math.max(W, H));
  for (let y = 0; y < H; y++) {
    const row = y * W; let run = 0;
    for (let x = 0; x < W; x++) { run = bin[row + x] ? run + 1 : 0; runA[x] = run; }
    run = 0;
    for (let x = W - 1; x >= 0; x--) { run = bin[row + x] ? run + 1 : 0; tmp[row + x] = runA[x] > r && run > r ? 1 : 0; }
  }
  for (let x = 0; x < W; x++) {
    let run = 0;
    for (let y = 0; y < H; y++) { run = tmp[y * W + x] ? run + 1 : 0; runA[y] = run; }
    run = 0;
    for (let y = H - 1; y >= 0; y--) { run = tmp[y * W + x] ? run + 1 : 0; out[y * W + x] = runA[y] > r && run > r ? 1 : 0; }
  }
  return out;
}

function largestComponent(bin, W, H) {
  const N = W * H, lab = new Int32Array(N), stack = new Int32Array(N);
  let best = 0, bestSize = 0, cur = 0;
  for (let s = 0; s < N; s++) {
    if (!bin[s] || lab[s]) continue;
    cur++; let sp = 0, size = 0; lab[s] = cur; stack[sp++] = s;
    while (sp) {
      const i = stack[--sp], x = i % W; size++;
      if (x > 0 && bin[i - 1] && !lab[i - 1]) { lab[i - 1] = cur; stack[sp++] = i - 1; }
      if (x < W - 1 && bin[i + 1] && !lab[i + 1]) { lab[i + 1] = cur; stack[sp++] = i + 1; }
      if (i >= W && bin[i - W] && !lab[i - W]) { lab[i - W] = cur; stack[sp++] = i - W; }
      if (i < N - W && bin[i + W] && !lab[i + W]) { lab[i + W] = cur; stack[sp++] = i + W; }
    }
    if (size > bestSize) { bestSize = size; best = cur; }
  }
  const out = new Uint8Array(N);
  for (let i = 0; i < N; i++) out[i] = lab[i] === best ? 1 : 0;
  return out;
}

// ---------- 2. 人脸检测 ----------
// 返回 MTCNN 口径的人脸框 {x,y,w,h}（处理尺寸下的像素），以及检测到的人脸数
export function detectFace(src) {
  let res = faceDet.detect(src).detections;
  if (!res.length) throw Object.assign(new Error('没有检测到人脸，请换一张正脸、光线均匀的照片'), { code: 'NO_FACE' });
  // 多张脸时取最大的那张（原版会直接报错；对普通用户更友好的做法是提示后继续）
  res = res.sort((a, b) => b.boundingBox.width * b.boundingBox.height - a.boundingBox.width * a.boundingBox.height);
  const b = res[0].boundingBox, k = FACE_TO_MTCNN;
  const cx = b.originX + b.width / 2, cy = b.originY + b.height / 2 + k.dy * b.height;
  const w = b.width * k.w, h = b.height * k.h;
  const kp = res[0].keypoints || [];
  let roll = 0;
  if (kp.length >= 2) roll = Math.atan2((kp[1].y - kp[0].y) * src.height, (kp[1].x - kp[0].x) * src.width) * 180 / Math.PI;
  return { rect: { x: cx - w / 2, y: cy - h / 2, w, h }, raw: b, count: res.length, roll };
}

// ---------- 3. 裁剪（photo_adjuster.adjust_photo 的移植） ----------
// size = [高, 宽]，与原版一致
export function adjustPhoto(rgba, face, size, opt = {}) {
  const P = { headMeasureRatio: 0.2, headHeightRatio: 0.45, headTopRange: [0.12, 0.1], ...opt };
  const { x, y, w, h } = face.rect;
  const whRatio = size[0] / size[1];
  const faceCenter = [x + w / 2, y + h / 2];
  const cropMeasure = (w * h) / P.headMeasureRatio;
  const k = Math.sqrt(cropMeasure / (size[0] * size[1]));
  const crop = [Math.trunc(size[0] * k), Math.trunc(size[1] * k)];
  let x1 = Math.trunc(faceCenter[0] - crop[1] / 2);
  let y1 = Math.trunc(faceCenter[1] - crop[0] * P.headHeightRatio);
  let y2 = y1 + crop[0], x2 = x1 + crop[1];

  const cut = cutRect(rgba, x1, y1, x2, y2);
  const [yTop, , xLeft, xRight] = getBox(cut);
  let statusLR = 0, cutTop = 0;
  if (xLeft > 0 || xRight > 0) { statusLR = 1; cutTop = Math.trunc(((xLeft + xRight) * whRatio) / 2); }
  const [statusTop, move] = detectDistance(yTop - cutTop, crop[0], P.headTopRange[0], P.headTopRange[1]);
  let result = cut;
  if (statusLR || statusTop) {
    result = cutRect(rgba, x1 + xLeft, y1 + cutTop + statusTop * move, x2 - xRight, y2 - cutTop + statusTop * move);
  }
  result = moveToBottom(result);
  const standard = resizeTo(result, size[1], size[0]);
  const minSide = Math.min(result.width, result.height), esp = Math.max(600, size[1]);
  const hd = minSide < esp
    ? resizeTo(result, result.height >= result.width ? esp : Math.trunc(result.width * esp / result.height),
        result.height >= result.width ? Math.trunc(result.height * esp / result.width) : esp)
    : result;
  return { standard, hd, crop: { x1, y1, x2, y2 } };
}

function cutRect(src, x1, y1, x2, y2) {
  const c = canvas(x2 - x1, y2 - y1);
  ctx2d(c).drawImage(src, -x1, -y1);   // 越界部分天然透明，等价于原版的补零
  return c;
}

// utils.get_box(model=2)：人像外接矩形到四边的距离 [上, 下, 左, 右]
function getBox(c, thresh = 127) {
  const W = c.width, H = c.height, d = ctx2d(c).getImageData(0, 0, W, H).data;
  let t = H, b = -1, l = W, r = -1;
  for (let yy = 0; yy < H; yy++) for (let xx = 0; xx < W; xx++) {
    if (d[(yy * W + xx) * 4 + 3] > thresh) { if (yy < t) t = yy; if (yy > b) b = yy; if (xx < l) l = xx; if (xx > r) r = xx; }
  }
  if (b < 0) return [0, 0, 0, 0];
  return [t, H - (b + 1), l, W - (r + 1)];
}

function detectDistance(value, cropH, max, min) {
  const v = value / cropH;
  if (v >= min && v <= max) return [0, 0];
  if (v > max) return [1, Math.trunc((v - max) * cropH)];
  return [-1, Math.trunc((min - v) * cropH)];
}

// 原版 move：底部有空隙时整体下移贴底
function moveToBottom(c) {
  const [, gap] = getBox(c);
  if (!gap) return c;
  const o = canvas(c.width, c.height);
  ctx2d(o).drawImage(c, 0, gap);
  return o;
}

function resizeTo(src, w, h) {
  // 大幅缩小时分级缩，避免锯齿（对应原版 standard_photo_resize 的逐级 INTER_AREA）
  let cur = src;
  while (cur.width / 2 > w && cur.height / 2 > h) {
    const half = canvas(Math.round(cur.width / 2), Math.round(cur.height / 2)), g = ctx2d(half);
    g.imageSmoothingQuality = 'high'; g.drawImage(cur, 0, 0, half.width, half.height); cur = half;
  }
  const o = canvas(w, h), g = ctx2d(o);
  g.imageSmoothingQuality = 'high'; g.drawImage(cur, 0, 0, w, h);
  return o;
}

// ---------- 4. 换底色 ----------
export function withBackground(rgba, color) {
  const o = canvas(rgba.width, rgba.height), g = ctx2d(o);
  g.fillStyle = color; g.fillRect(0, 0, o.width, o.height); g.drawImage(rgba, 0, 0);
  return o;
}

// ---------- 5. 六寸排版（layout_calculator 的移植，画布 1795x1205） ----------
export function layout(photo, size, cropLine = true, LW = 1795, LH = 1205) {
  const IH = 30, IW = 30, SH = 50, SW = 70, LBW = LW - 2 * SW, LBH = LH - 2 * SH;
  const fit = (h, w) => {
    let rows = 0, cols = 0, bh = h, bw = w;
    for (let i = 1; i < 4; i++) { const t = h * i + IH * (i - 1); if (t < LBH) { bh = t; rows = i; } else break; }
    for (let j = 1; j < 9; j++) { const t = w * j + IW * (j - 1); if (t < LBW) { bw = t; cols = j; } else break; }
    return { rows, cols, bh, bw, n: rows * cols };
  };
  const [H0, W0] = size, a = fit(H0, W0), b = fit(W0, H0), rot = b.n > a.n, m = rot ? b : a;
  const ph = rot ? W0 : H0, pw = rot ? H0 : W0;
  const x11 = Math.trunc((LW - m.bw) / 2), y11 = Math.trunc((LH - m.bh) / 2);
  const o = canvas(LW, LH), g = ctx2d(o);
  g.fillStyle = '#fff'; g.fillRect(0, 0, LW, LH);
  let tile = photo.width === W0 && photo.height === H0 ? photo : resizeTo(photo, W0, H0);
  if (rot) { const t = canvas(H0, W0), tg = ctx2d(t); tg.translate(0, W0); tg.rotate(-Math.PI / 2); tg.drawImage(tile, 0, 0); tile = t; }
  const pos = [];
  for (let j = 0; j < m.rows; j++) for (let i = 0; i < m.cols; i++) pos.push([x11 + i * (pw + IW), y11 + j * (ph + IH)]);
  for (const [px, py] of pos) g.drawImage(tile, px, py);
  if (cropLine) {
    g.strokeStyle = 'rgb(200,200,200)'; g.lineWidth = 1;
    const xs = new Set(), ys = new Set();
    for (const [px, py] of pos) { xs.add(px); xs.add(px + pw); ys.add(py); ys.add(py + ph); }
    g.beginPath();
    for (const xx of xs) { g.moveTo(xx + 0.5, 0); g.lineTo(xx + 0.5, LH); }
    for (const yy of ys) { g.moveTo(0, yy + 0.5); g.lineTo(LW, yy + 0.5); }
    g.stroke();
  }
  return { canvas: o, count: pos.length };
}

// ---------- 6. 压缩到指定 KB（考试报名系统常见要求） ----------
export async function toJpegUnderKB(c, maxKB, minKB = 0) {
  const blob = q => new Promise(r => c.toBlob(r, 'image/jpeg', q));
  let lo = 0.3, hi = 0.98, best = await blob(hi);
  if (best.size / 1024 <= maxKB) return { blob: best, quality: hi };
  best = null;
  for (let i = 0; i < 8; i++) {
    const q = (lo + hi) / 2, b = await blob(q);
    if (b.size / 1024 <= maxKB) { best = { blob: b, quality: q }; lo = q; } else hi = q;
  }
  if (!best) {
    // 质量压到底还超，就等比缩小尺寸再试
    const s = canvas(Math.round(c.width * 0.8), Math.round(c.height * 0.8));
    const g = ctx2d(s); g.imageSmoothingQuality = 'high'; g.drawImage(c, 0, 0, s.width, s.height);
    return toJpegUnderKB(s, maxKB, minKB);
  }
  return best;
}

// 一步到位：照片 → { rgba, face, standard(带透明), hd }
export async function createIdPhoto(img, size, onStep = () => {}) {
  const src = toProcessingCanvas(img);
  onStep('matting');
  const rgba = await matting(src);
  onStep('face');
  const face = detectFace(src);
  onStep('crop');
  const { standard, hd } = adjustPhoto(rgba, face, size);
  return { src, rgba, face, standard, hd };
}
