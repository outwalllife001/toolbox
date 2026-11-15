// 上色模型放在 Worker 里跑：页面不卡，进度条照常能动
// 消息：init {buf, backend, threads, base} → done ；run {id, gray(S×S，0–1), S} → done {ab(2×S×S), ms} ；error
let ort = null, sess = null;

async function init({ buf, backend, threads, base }) {
  ort = await import(backend === 'webgpu' ? base + 'vendor/ort/ort.webgpu.min.mjs' : base + 'vendor/ort/ort.wasm.min.mjs');
  ort.env.wasm.wasmPaths = base + 'vendor/ort/';
  ort.env.wasm.numThreads = threads;
  ort.env.logLevel = 'error';
  sess = await ort.InferenceSession.create(new Uint8Array(buf), { executionProviders: [backend], graphOptimizationLevel: 'all' });
}

// 输入：灰度图当成 RGB 三个通道一样的值（ImageNet 归一化在模型里）；输出：Lab 的 a、b
async function run({ id, gray, S }) {
  const n = S * S, x = new Float32Array(3 * n);
  x.set(gray, 0); x.set(gray, n); x.set(gray, 2 * n);
  const t0 = performance.now();
  const out = await sess.run({ [sess.inputNames[0]]: new ort.Tensor('float32', x, [1, 3, S, S]) });
  const t = out[sess.outputNames[0]], y = t.getData ? await t.getData() : t.data;
  const ab = new Float32Array(y);
  if (t.dispose) t.dispose();
  postMessage({ type: 'done', id, ab, ms: performance.now() - t0 }, [ab.buffer]);
}

onmessage = async ({ data }) => {
  try {
    if (data.type === 'init') { await init(data); postMessage({ type: 'done', id: 'init' }); }
    else if (data.type === 'run') await run(data);
  } catch (e) {
    postMessage({ type: 'error', id: data.id ?? 'init', message: (e && e.message) || String(e) });
  }
};
