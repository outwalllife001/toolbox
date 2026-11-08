// 跨源隔离（只给「录音转文字」「照片变涂色画」两页用）：给这一页和它要加载的文件补上 COOP / COEP 响应头，浏览器才允许 SharedArrayBuffer，
// 语音识别才能开多线程（电脑上快 3 倍多）。GitHub Pages 不能自己设响应头，只能用 Service Worker 补（思路同 gzuidhof/coi-serviceworker，MIT）。
// 放在网站根目录是因为 ONNX Runtime 的多线程 Worker 是从 vendor/ort/ 起的，Service Worker 要管得到那里。
// 别的页面不受影响：没列出的请求 Service Worker 不接手（不调 respondWith），浏览器照常处理；别的页面加载同一批共用文件（vendor/ort 等）
// 时也会带上 COEP / CORP 头，对没开跨源隔离的页面没有作用（days/day09-transcribe/sw_check.mjs 把前 8 期的页面都走了一遍）
const PAGE = /\/(transcribe|coloring)\/(index\.html)?$/;   // 只有这两页的 HTML 带 COOP/COEP
const NEED = /\/(transcribe\/|coloring\/|vendor\/ort\/|vendor\/mediabunny\/|subtitle\/asr\.js|models\/sensevoice\/|config\.js|member\.js|member\/)/;
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (u.origin !== self.location.origin) return;
  if (r.cache === 'only-if-cached' && r.mode !== 'same-origin') return;
  const doc = r.mode === 'navigate';
  if (doc ? !PAGE.test(u.pathname) : !NEED.test(u.pathname)) return;
  e.respondWith(fetch(r).then(res => {
    if (res.status === 0 || res.type === 'opaqueredirect') return res;
    const h = new Headers(res.headers);
    h.set('Cross-Origin-Embedder-Policy', 'require-corp');
    h.set('Cross-Origin-Resource-Policy', 'same-origin');
    if (doc) h.set('Cross-Origin-Opener-Policy', 'same-origin');
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
  }));
});
