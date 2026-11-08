// 模型推理放在 Worker 里：页面不卡，进度条照常能动
// 消息：init {buf, backend, threads, base} → ready ；lines {id, rgba, w, h} → done {gray} ；
//       maskInit {id, buf} → done ；mask {id, rgba, S} → done {alpha} ；error
let ort = null, sess = null, maskSess = null;

async function init({ buf, backend, threads, base }) {
  ort = await import(backend === 'webgpu' ? base + 'vendor/ort/ort.webgpu.min.mjs' : base + 'vendor/ort/ort.wasm.min.mjs');
  ort.env.wasm.wasmPaths = base + 'vendor/ort/';
  ort.env.wasm.numThreads = threads;
  ort.env.logLevel = 'error';
  sess = await ort.InferenceSession.create(new Uint8Array(buf), { executionProviders: [backend], graphOptimizationLevel: 'all' });
}

// 线稿：输入 RGB 0–1，输出 1 通道 0–1（1 是白）。整张一起算（网络里有 InstanceNorm，分块会有接缝）
async function lines({ id, rgba, w, h }) {
  const n = w * h, x = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) { const s = i * 4; x[i] = rgba[s] / 255; x[n + i] = rgba[s + 1] / 255; x[2 * n + i] = rgba[s + 2] / 255; }
  const t0 = performance.now();
  const out = await sess.run({ [sess.inputNames[0]]: new ort.Tensor('float32', x, [1, 3, h, w]) });
  const t = out[sess.outputNames[0]], y = t.getData ? await t.getData() : t.data, gray = new Uint8ClampedArray(n);
  for (let i = 0; i < n; i++) gray[i] = y[i] * 255;   // Uint8ClampedArray 赋值会先裁到 0–255 再取整
  if (t.dispose) t.dispose();
  postMessage({ type: 'done', id, gray, ms: performance.now() - t0 }, [gray.buffer]);
}

// 去背景：和第 3 期抠图同一个 IS-Net（同样的归一化：除以最大值再减 0.5），固定用 CPU；用过一次 Worker 里才有这个模型
async function maskInit({ id, buf }) {
  if (!maskSess) maskSess = await ort.InferenceSession.create(new Uint8Array(buf), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  postMessage({ type: 'done', id });
}
async function mask({ id, rgba, S }) {
  const n = S * S, x = new Float32Array(3 * n);
  let mx = 1;
  for (let i = 0; i < n * 4; i++) if ((i & 3) !== 3 && rgba[i] > mx) mx = rgba[i];
  for (let i = 0; i < n; i++) { const s = i * 4; x[i] = rgba[s] / mx - 0.5; x[n + i] = rgba[s + 1] / mx - 0.5; x[2 * n + i] = rgba[s + 2] / mx - 0.5; }
  const t0 = performance.now();
  const out = await maskSess.run({ [maskSess.inputNames[0]]: new ort.Tensor('float32', x, [1, 3, S, S]) });
  const p = out[maskSess.outputNames[0]].data;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < n; i++) { const v = p[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
  const alpha = new Uint8ClampedArray(n), k = 255 / Math.max(1e-6, hi - lo);
  for (let i = 0; i < n; i++) alpha[i] = (p[i] - lo) * k;
  postMessage({ type: 'done', id, alpha, ms: performance.now() - t0 }, [alpha.buffer]);
}

onmessage = async ({ data }) => {
  try {
    if (data.type === 'init') { await init(data); postMessage({ type: 'done', id: 'init' }); }
    else if (data.type === 'lines') await lines(data);
    else if (data.type === 'maskInit') await maskInit(data);
    else if (data.type === 'mask') await mask(data);
  } catch (e) {
    postMessage({ type: 'error', id: data.id ?? 'init', message: (e && e.message) || String(e) });
  }
};
