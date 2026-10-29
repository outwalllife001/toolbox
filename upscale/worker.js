// 放大推理放在 Worker 里：页面不卡，进度条和对比滑块照常能动
// 消息：init {model, backend, threads} → ready {backend} ；run {id, rgba, w, h, tile, pad} → tile × N → done ；error
// 分块照搬 Real-ESRGAN 的 RealESRGANer.tile_process（realesrgan/utils.py）：每块四周多带 pad 像素一起算，只取中间那块
// pad 取 24：这个网络 34 层 3×3 卷积，和整张一起算相比最大误差 < 1/255（原版默认 10，块边上会差到 14/255）
let ort = null, sess = null, backend = '';

async function init({ model, backend: be, threads, base }) {
  ort = await import(be === 'webgpu' ? base + 'vendor/ort/ort.webgpu.min.mjs' : base + 'vendor/ort/ort.wasm.min.mjs');
  ort.env.wasm.wasmPaths = base + 'vendor/ort/';
  ort.env.wasm.numThreads = threads;
  ort.env.logLevel = 'error';
  sess = await ort.InferenceSession.create(model, { executionProviders: [be], graphOptimizationLevel: 'all' });
  backend = be;
}

let cancelled = 0;
async function run({ id, rgba, w, h, tile, pad }) {
  const S = 4, tx = Math.ceil(w / tile), ty = Math.ceil(h / tile), total = tx * ty;
  const t0 = performance.now();
  let n = 0;
  for (let j = 0; j < ty; j++) for (let i = 0; i < tx; i++) {
    if (cancelled === id) return;
    const x0 = i * tile, y0 = j * tile, x1 = Math.min(x0 + tile, w), y1 = Math.min(y0 + tile, h);
    const xa = Math.max(0, x0 - pad), ya = Math.max(0, y0 - pad), xb = Math.min(w, x1 + pad), yb = Math.min(h, y1 + pad);
    const iw = xb - xa, ih = yb - ya, N = iw * ih, x = new Float32Array(3 * N);
    for (let yy = 0; yy < ih; yy++) {
      let s = ((ya + yy) * w + xa) * 4, d = yy * iw;
      for (let xx = 0; xx < iw; xx++, s += 4, d++) {
        x[d] = rgba[s] / 255; x[N + d] = rgba[s + 1] / 255; x[2 * N + d] = rgba[s + 2] / 255;
      }
    }
    const out = await sess.run({ [sess.inputNames[0]]: new ort.Tensor('float32', x, [1, 3, ih, iw]) });
    const t = out[sess.outputNames[0]], y = t.data, OW = iw * S, ON = OW * ih * S;
    // 只取中间（不带 pad）那块，转成 RGBA。Uint8ClampedArray 赋值会先裁到 0–255 再就近取整（同 numpy round），和原版的 clamp → ×255 → round 一样
    const ow = (x1 - x0) * S, oh = (y1 - y0) * S, ox = (x0 - xa) * S, oy = (y0 - ya) * S, px = new Uint8ClampedArray(ow * oh * 4);
    for (let yy = 0; yy < oh; yy++) {
      let s = (oy + yy) * OW + ox, d = yy * ow * 4;
      for (let xx = 0; xx < ow; xx++, s++, d += 4) {
        px[d] = y[s] * 255; px[d + 1] = y[ON + s] * 255; px[d + 2] = y[2 * ON + s] * 255; px[d + 3] = 255;
      }
    }
    if (t.dispose) t.dispose();
    n++;
    postMessage({ type: 'tile', id, x: x0 * S, y: y0 * S, w: ow, h: oh, px, n, total, ms: performance.now() - t0 }, [px.buffer]);
  }
  postMessage({ type: 'done', id, ms: performance.now() - t0 });
}

onmessage = async ({ data }) => {
  try {
    if (data.type === 'init') { await init(data); postMessage({ type: 'ready', backend }); }
    else if (data.type === 'run') await run(data);
    else if (data.type === 'cancel') cancelled = data.id;
  } catch (e) {
    postMessage({ type: 'error', id: data.id, message: (e && e.message) || String(e) });
  }
};
