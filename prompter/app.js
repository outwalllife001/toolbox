import { parseScript, Follower, makeReadings, estimateSeconds } from './follow.js';

const $ = id => document.getElementById(id);
const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const Q = new URLSearchParams(location.search);
// 录视频、自动测试用：?demo=<wav 地址> 用一段录音代替麦克风，&democam=<视频地址> 代替前置镜头（调 __pp.demoPlay() 才开始放）；?nocount 不倒数
const DEMO = Q.get('demo'), DEMOCAM = Q.get('democam');
const KEY = 'toolbox-prompter-state', SAVED = 'toolbox-prompter-saved', FREE_SAVED = 3;
const SAMPLE = `大家好，今天教大家一个超简单的早餐：两片吐司，一个鸡蛋，5分钟就能搞定，上班族一定要试试！
先把吐司放进锅里，小火煎到两面金黄。再打一个鸡蛋，撒一点点盐，盖上锅盖焖一分钟。
最后把鸡蛋夹进吐司里，配一杯热牛奶，营养又顶饱。学会了记得点赞收藏，我们下期再见！`;
const readings = makeReadings(window.pinyinPro);

const st = { text: '', mode: 'follow', cpm: 240, size: 30, cam: false, count: true, mirror: false };
try { Object.assign(st, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { }
if (!['follow', 'auto'].includes(st.mode)) st.mode = 'follow';
st.cpm = Math.min(420, Math.max(120, +st.cpm || 240)); st.size = Math.min(56, Math.max(20, +st.size || 30));
function persist() { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch { } }
function toast(t, ms = 2600) { const e = $('toast'); e.textContent = t; e.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { e.hidden = true; }, ms); }
const mmss = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const dur = s => s < 60 ? `${Math.max(1, Math.round(s))} 秒` : `${Math.floor(s / 60)} 分${Math.round(s % 60) ? ` ${Math.round(s % 60)} 秒` : '钟'}`;

// ---------- 识别 Worker（第一次要用时才建、才下载模型） ----------
let worker = null, modelState = 'none', modelWait = null;      // none | loading | ready | error
function ensureModel(onProgress) {
  if (onProgress) ensureModel.cb = onProgress;
  if (modelWait) return modelWait;
  modelState = 'loading';
  modelWait = new Promise((res, rej) => {
    try { worker = new Worker(new URL('worker.js', import.meta.url), { type: 'module' }); } catch (e) { rej(e); return; }
    worker.onerror = e => { rej(new Error(e.message || '识别组件加载失败')); };
    worker.onmessage = ({ data: m }) => {
      if (m.type === 'progress') ensureModel.cb && ensureModel.cb(m.p);
      else if (m.type === 'ready') { modelState = 'ready'; res(); }
      else if (m.type === 'started') pp.onStarted && pp.onStarted();
      else if (m.type === 'chars') onChars(m);
      else if (m.type === 'error') { if (modelState !== 'ready') rej(new Error(m.message)); else console.error('识别出错', m.message); }
    };
    worker.postMessage({ type: 'load' });
  });
  modelWait.catch(() => { modelState = 'error'; modelWait = null; if (worker) worker.terminate(); worker = null; });
  return modelWait;
}
let warmed = false;
function warm() {     // 稿子有内容了、又选的是跟读：先在后台把模型下好
  if (warmed || st.mode !== 'follow' || !st.text.trim()) return;
  warmed = true; ensureModel().catch(() => { warmed = false; });
}

// ---------- 表单 ----------
const ta = $('script');
function syncForm() {
  if (ta.value !== st.text) ta.value = st.text;
  for (const b of $('mode').children) b.classList.toggle('on', b.dataset.v === st.mode);
  $('speedRow').hidden = st.mode !== 'auto';
  $('speed').value = st.cpm; $('speedV').textContent = `${st.cpm} 字/分`;
  $('size').value = st.size; $('sizeV').textContent = `${st.size} 号`;
  $('cam').checked = st.cam; $('count3').checked = st.count; $('mirror').checked = st.mirror;
  $('modeHint').textContent = st.mode === 'follow'
    ? '对着手机念就行：念到哪，字亮到哪、滚到哪；你停下来它也停，不用自己调速度。要用麦克风，目前只认普通话。'
    : '按固定速度往下滚，不需要麦克风；念的时候可以随时暂停、点一句跳过去。';
  $('goHint').textContent = st.mode === 'follow'
    ? (modelState === 'ready' ? '语音识别已经准备好。声音只在你的手机里识别，不上传' : '第一次用「跟着我的声音走」要下载约 20MB 的语音识别模型，之后不用再下；声音只在你的手机里识别，不上传')
    : '匀速滚动不用麦克风、不用下载模型';
  $('go').textContent = st.cam ? '开始提词并录像' : '开始提词';
  count();
}
let parsedCache = null;
function parsed() { if (!parsedCache || parsedCache.text !== st.text) parsedCache = { text: st.text, ...parseScript(st.text, readings) }; return parsedCache; }
function count() {
  const n = parsed().units.length;
  $('count').innerHTML = n ? `<b>${n}</b> 个字 · 按${st.mode === 'auto' ? `每分钟 ${st.cpm} 字` : '平常语速'}念完大约 <b>${dur(estimateSeconds(parsed().units, st.mode === 'auto' ? st.cpm : 240))}</b>` : '还没有内容';
}
ta.addEventListener('input', () => { st.text = ta.value; persist(); count(); warm(); });
$('sample').onclick = () => { st.text = SAMPLE; syncForm(); persist(); warm(); toast('已填入示例稿'); };
$('clear').onclick = () => { st.text = ''; syncForm(); persist(); ta.focus(); };
$('mode').onclick = e => { const b = e.target.closest('button'); if (!b) return; st.mode = b.dataset.v; syncForm(); persist(); warm(); };
$('speed').oninput = e => { st.cpm = +e.target.value; syncForm(); persist(); };
$('size').oninput = e => { st.size = +e.target.value; syncForm(); persist(); };
$('cam').onchange = e => { st.cam = e.target.checked; syncForm(); persist(); };
$('count3').onchange = e => { st.count = e.target.checked; persist(); };
$('mirror').onchange = e => { st.mirror = e.target.checked; persist(); };

// ---------- 提词界面 ----------
const pp = {
  state: 'idle',            // idle | prep | count | run | pause | done
  mode: 'follow',           // 这一次实际用的方式（拿不到麦克风会退成匀速）
  P: null, fol: null, spans: [], sents: [], sentOf: [],
  shown: 0, doneChar: 0, curSent: -1, y: 0, autoPos: 0,
  lastAdv: -1e9, rate: 4, track: [], heard: [], log: [],
  elapsed: 0, raf: 0, last: 0, lag: 0,
  input: null, rec: null, chunks: [], recType: '', wake: null, lastRec: null,
};
const inner = $('ppInner'), box = $('ppText');

function build() {
  const P = pp.P = parsed();
  pp.fol = new Follower(P.units);
  const frag = document.createDocumentFragment();
  pp.spans = new Array(P.chars.length).fill(null);
  P.chars.forEach((c, i) => {
    if (c.ch === '\n') {
      frag.appendChild(document.createElement('br'));
      if (P.chars[i + 1] && P.chars[i + 1].ch === '\n') { const g = document.createElement('span'); g.className = 'gap'; frag.appendChild(g); }
      return;
    }
    const s = document.createElement('span'); s.textContent = c.ch; s.dataset.i = i; frag.appendChild(s); pp.spans[i] = s;
  });
  inner.textContent = ''; inner.appendChild(frag);
  // 句子：到句号 / 换行为止；高亮「正在念的这一句」
  pp.sents = []; pp.sentOf = new Array(P.units.length);
  let u0 = 0;
  P.units.forEach((u, k) => {
    pp.sentOf[k] = pp.sents.length;
    if (u.end) { pp.sents.push({ u0, u1: k + 1, c0: P.units[u0].from, c1: k + 1 < P.units.length ? P.units[k + 1].from : P.chars.length }); u0 = k + 1; }
  });
  Object.assign(pp, { shown: 0, doneChar: 0, curSent: -1, y: 0, autoPos: 0, lastAdv: -1e9, rate: 4, track: [], heard: [], log: [], elapsed: 0 });
  inner.style.transform = 'translate3d(0,0,0)';
  layout(); paint(true);
}

// 把「念到第 shown 个单元」画出来：念过的变黄，正在念的那一句变亮
function paint(force) {
  const P = pp.P, N = P.units.length, idx = Math.min(N, Math.floor(pp.shown + 1e-6));
  const dc = idx < N ? P.units[idx].from : P.chars.length;
  if (dc !== pp.doneChar || force) {
    const a = Math.min(dc, pp.doneChar), b = Math.max(dc, pp.doneChar);
    for (let i = force ? 0 : a; i < (force ? P.chars.length : b); i++) { const s = pp.spans[i]; if (s) s.classList.toggle('d', i < dc); }
    pp.doneChar = dc;
  }
  const sent = N ? pp.sentOf[Math.min(idx, N - 1)] : -1;
  if (sent !== pp.curSent) {
    const old = pp.sents[pp.curSent], cur = pp.sents[sent];
    if (old) for (let i = old.c0; i < old.c1; i++) pp.spans[i] && pp.spans[i].classList.remove('cur');
    if (cur) for (let i = cur.c0; i < cur.c1; i++) pp.spans[i] && pp.spans[i].classList.add('cur');
    pp.curSent = sent;
  }
}
// 「正在念的这一行」固定停在稿子区域的这个高度（开了镜头时稿子区域只有上半屏）；稿子开头垫这么高，第一行一上来就在这儿
function layout() {
  pp.anchor = Math.round(box.clientHeight * (pp.cam ? 0.45 : 0.34)); inner.style.paddingTop = pp.anchor + 'px';
  // 浏览器把稿子折成了哪几行（按每个字的 offsetTop 分组）
  pp.lines = []; pp.lineOf = new Int32Array(pp.spans.length).fill(-1); pp.lineTop = [];
  let last = -1e9;
  pp.spans.forEach((sp, i) => {
    if (!sp) return;
    sp.classList.remove('off', 'far');
    const t = sp.offsetTop;
    if (Math.abs(t - last) > 3) { pp.lines.push([]); pp.lineTop.push(t); last = t; }
    pp.lines[pp.lines.length - 1].push(sp); pp.lineOf[i] = pp.lines.length - 1;
  });
  pp.lineH = pp.lineTop.length > 1 ? pp.lineTop[1] - pp.lineTop[0] : (parseFloat(getComputedStyle(inner).lineHeight) || 40);
  pp.lineState = new Uint8Array(pp.lines.length); pp.curLine = -9;
}
// 开了镜头时稿子只占上半屏、下面是人：只留「正在念的这一行 + 后面放得下的几行」，再往后的先不显示（最后一行调暗），
// 不用 CSS 遮罩做渐隐——遮罩要每帧离屏合成一遍，带着视频画面时很费
function windowLines(cur) {
  if (cur === pp.curLine) return;
  pp.curLine = cur;
  const below = pp.cam ? Math.max(1, Math.floor((box.clientHeight - pp.anchor - pp.lineH) / pp.lineH)) : 1e9;
  for (let L = 0; L < pp.lines.length; L++) {
    const stt = !pp.cam ? 0 : L > cur + below ? 2 : (L === cur + below && below >= 2) ? 1 : 0;
    if (stt === pp.lineState[L]) continue;
    for (const sp of pp.lines[L]) { sp.classList.toggle('off', stt === 2); sp.classList.toggle('far', stt === 1); }
    pp.lineState[L] = stt;
  }
}
addEventListener('resize', () => { if (pp.state !== 'idle') layout(); });
function anchorSpan() {
  const P = pp.P, N = P.units.length; if (!N) return null;
  const idx = Math.min(N - 1, Math.floor(pp.shown + 1e-6));
  return pp.spans[P.units[idx].from];
}
// 往前「猜」不能越过逗号、句号：人在那儿多半要停一下
function leadLimit(pos) {
  const U = pp.P.units;
  if (pos > 0 && (U[pos - 1].end || U[pos - 1].pause)) return pos;
  for (let k = pos; k < U.length; k++) if (U[k].end || U[k].pause) return k + 1;
  return U.length;
}
const LEAD_S = 0.3;      // 识别出一个字比说完它大约晚 0.3 秒：正在连着念的时候，高亮按语速往前带这么多
function frame(now) {
  const dt = Math.min(0.1, (now - pp.last) / 1000); pp.last = now;
  const N = pp.P.units.length;
  if (pp.state === 'run') {
    pp.elapsed += dt;
    if (pp.mode === 'auto') {
      pp.autoPos = Math.min(N, pp.autoPos + dt * st.cpm / 60); pp.shown = pp.autoPos;
      if (pp.autoPos >= N) finish();
    } else {
      const pos = pp.fol.pos;
      let target = pos;
      if (now - pp.lastAdv < 650 && pos > 0 && pos < N) target = Math.min(pos + Math.min(2.5, pp.rate * LEAD_S), leadLimit(pos));
      if (target < pp.shown - 3) pp.shown = target;                       // 往回跳（重念）：直接过去
      else if (target > pp.shown) pp.shown = Math.min(target, pp.shown + Math.max(pp.rate, (target - pp.shown) * 9) * dt);
    }
    paint();
  }
  const a = anchorSpan();
  if (a) {
    const line = pp.lineOf[+a.dataset.i];
    windowLines(line);
    const yT = Math.max(0, pp.lineTop[line] - pp.anchor);
    if (yT !== pp.y) {
      pp.y += (yT - pp.y) * (1 - Math.exp(-dt * 7));
      if (Math.abs(yT - pp.y) < 0.3) pp.y = yT;
      inner.style.transform = `translate3d(0,${-pp.y.toFixed(1)}px,0)`;
    }
  }
  const tm = mmss(pp.elapsed);
  if (tm !== pp.tm) { pp.tm = tm; $('ppTime').textContent = tm; }
  pp.raf = requestAnimationFrame(frame);
}

// Worker 认出来的字
function onChars(m) {
  pp.lag = m.lag;
  if (pp.state !== 'run' || pp.mode !== 'follow') return;
  const now = performance.now();
  for (const c of m.list) {
    pp.heard.push(c.ch);
    const r = pp.fol.push(readings(c.ch));
    pp.log.push([Math.round(now - (pp.demoT0 || 0)), c.ch, pp.fol.pos, +c.t.toFixed(2)]);
    if (!r) continue;
    pp.lastAdv = now;
    pp.track.push([now, r.pos]);
    while (pp.track.length > 2 && now - pp.track[0][0] > 3000) pp.track.shift();
    const [t0, p0] = pp.track[0];
    if (!r.jump && now - t0 > 800 && r.pos > p0) pp.rate += (Math.min(7, Math.max(2.5, (r.pos - p0) / ((now - t0) / 1000))) - pp.rate) * 0.3;
    if (r.jump && Math.abs(r.pos - r.from) > 3) pp.track = [[now, r.pos]];
    if (pp.fol.done) setTimeout(finish, 700);
  }
}

function setStatus(msg, cls = '') { $('ppMsg').textContent = msg; $('ppStatus').className = 'pp-status ' + cls; }
function level(buf) {
  let s = 0; for (let i = 0; i < buf.length; i += 4) s += buf[i] * buf[i];
  const v = Math.min(1, Math.sqrt(s / (buf.length / 4)) * 9);
  const k = [0.6, 1, 0.8, 0.5], bars = $('ppLv').children;
  for (let i = 0; i < 4; i++) bars[i].style.height = (3 + v * 11 * k[i]).toFixed(0) + 'px';
}
function onAudio(buf, rate) {
  level(buf);
  if (pp.state === 'run' && pp.mode === 'follow' && worker) worker.postMessage({ type: 'audio', data: buf }, [buf.buffer]);
}

// ---------- 输入：麦克风 / 镜头（或者演示用的录音、视频） ----------
async function openInput(needAudio, needCam) {
  if (DEMO) return openDemo(needCam);
  const md = navigator.mediaDevices;
  if (!md || !md.getUserMedia) { const e = new Error('这个浏览器不让网页用麦克风'); e.name = 'NoDevice'; throw e; }
  const stream = await md.getUserMedia({
    audio: needAudio ? { echoCancellation: true, noiseSuppression: true, channelCount: 1 } : false,
    video: needCam ? { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } } : false,
  });
  const inp = { stream, rate: 0, ctx: null, close() { stream.getTracks().forEach(t => t.stop()); if (this.ctx) this.ctx.close().catch(() => { }); } };
  if (needCam) { const v = $('camV'); v.srcObject = stream; v.hidden = false; v.play().catch(() => { }); }
  if (pp.mode === 'follow') {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = inp.ctx = new AC();
    if (ctx.state === 'suspended') await ctx.resume().catch(() => { });
    inp.rate = ctx.sampleRate;
    const src = ctx.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
    let node;
    try {
      await ctx.audioWorklet.addModule(new URL('capture.js', import.meta.url));
      node = new AudioWorkletNode(ctx, 'capture', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: 'explicit' });
      node.port.onmessage = e => onAudio(e.data, ctx.sampleRate);
    } catch {      // 老浏览器没有 AudioWorklet
      node = ctx.createScriptProcessor(2048, 1, 1);
      node.onaudioprocess = e => onAudio(new Float32Array(e.inputBuffer.getChannelData(0)), ctx.sampleRate);
    }
    const mute = ctx.createGain(); mute.gain.value = 0;
    src.connect(node); node.connect(mute); mute.connect(ctx.destination);
  }
  return inp;
}
// 演示：一段 16 位 PCM 的 wav 按真实时间一块块喂进同一条流程（demoPlay 之前喂静音），视频当作镜头画面
async function openDemo(needCam) {
  const b = new DataView(await (await fetch(DEMO)).arrayBuffer());
  let o = 12, rate = 16000, x = null;
  while (o < b.byteLength - 8) {
    const id = String.fromCharCode(b.getUint8(o), b.getUint8(o + 1), b.getUint8(o + 2), b.getUint8(o + 3)), sz = b.getUint32(o + 4, true);
    if (id === 'fmt ') rate = b.getUint32(o + 12, true);
    if (id === 'data') { x = new Float32Array(sz >> 1); for (let i = 0; i < x.length; i++) x[i] = b.getInt16(o + 8 + i * 2, true) / 32768; break; }
    o += 8 + sz + (sz & 1);
  }
  const v = $('camV'), c = $('camC');
  const inp = { stream: null, rate, playAt: null, fed: 0, t0: performance.now(), sent: 0, closed: false };
  if (needCam && DEMOCAM) {
    v.src = DEMOCAM; v.muted = true; v.loop = false; v.hidden = false; v.classList.add('tiny');
    await new Promise(r => { v.onloadeddata = r; v.onerror = r; });
    // 录屏用的浏览器是软件渲染，<video> 铺满屏只有约 10 帧/秒；把画面一帧帧画到 canvas 上能到 26 帧/秒（days/day19-prompter/build/probe2.mjs）。
    // 所以演示时镜头画面走 canvas，<video> 缩成角落里的一个点只管解码。真机上不走这里，用的是 <video>
    if (v.videoWidth) {
      c.width = v.videoWidth; c.height = v.videoHeight; c.hidden = false;
      const g = c.getContext('2d'); let last = -1;
      const draw = () => { if (inp.closed) return; if (v.currentTime !== last) { last = v.currentTime; g.drawImage(v, 0, 0); } requestAnimationFrame(draw); };
      draw();
    }
  }
  inp.timer = setInterval(() => {
    const now = performance.now(), want = Math.floor((now - inp.t0) * rate / 1000), n = want - inp.sent;
    if (n < rate * 0.03) return;
    const blk = new Float32Array(n);
    if (inp.playAt !== null) { const from = Math.floor((inp.sent / rate * 1000 + inp.t0 - inp.playAt) * rate / 1000); for (let i = 0; i < n; i++) { const k = from + i; if (k >= 0 && k < x.length) blk[i] = x[k]; } }
    inp.sent = want; onAudio(blk, rate);
  }, 30);
  // 开始放录音：识别流也从头来（录音的第 0 个样本 = 流的第 0 个样本），这样每次演示认出来的字、亮起的时刻都一样；
  // 不这样做时录音落在 0.32 秒分块上的位置是随机的，个别位置会多认或漏认一两个字（跟读照样能跟上，只是那一两个字亮得晚）
  inp.play = () => {
    const now = performance.now(); inp.playAt = inp.t0 = pp.demoT0 = now; inp.sent = 0;
    if (worker && pp.mode === 'follow') worker.postMessage({ type: 'start', rate });
    if (needCam && DEMOCAM) v.play().catch(() => { });
  };
  inp.close = () => { inp.closed = true; clearInterval(inp.timer); v.pause(); };
  if (needCam && DEMOCAM && !c.hidden && c.captureStream) { try { inp.stream = c.captureStream(24); } catch { } }
  return inp;
}

// ---------- 录像 ----------
function startRec(stream) {
  if (!stream || !window.MediaRecorder) { toast('这个浏览器不支持录像，只提词'); return; }
  const type = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find(t => MediaRecorder.isTypeSupported(t)) || '';
  try {
    pp.chunks = []; pp.recType = type;
    pp.rec = new MediaRecorder(stream, type ? { mimeType: type, videoBitsPerSecond: 6e6 } : undefined);
    pp.rec.ondataavailable = e => { if (e.data && e.data.size) pp.chunks.push(e.data); };
    pp.rec.start(1000); pp.recT0 = performance.now(); pp.recPaused = 0;
    $('ppRec').hidden = false;
  } catch (e) { console.error(e); pp.rec = null; toast('录像没能开始：' + (e.message || e)); }
}
function stopRec() {
  const rec = pp.rec; pp.rec = null; $('ppRec').hidden = true;
  if (!rec) return Promise.resolve(null);
  return new Promise(res => {
    const done = () => { const type = (rec.mimeType || pp.recType || 'video/webm').split(';')[0]; res(pp.chunks.length ? new Blob(pp.chunks, { type }) : null); };
    rec.onstop = done;
    if (rec.state === 'inactive') return done();      // 画面源已经结束，录像自己停了
    try { rec.stop(); } catch { return done(); }
    setTimeout(done, 4000);                            // 个别浏览器 stop 之后迟迟不回调：有多少存多少
  });
}

// ---------- 开始 / 暂停 / 结束 ----------
async function start() {
  if (pp.state !== 'idle') return;
  if (!parsed().units.length) { toast('先把稿子粘贴进来'); ta.focus(); return; }
  pp.state = 'prep'; pp.mode = st.mode; pp.cam = st.cam;
  const el = $('pp');
  el.hidden = false; el.classList.toggle('cam', st.cam); el.classList.toggle('mirror', st.mirror); el.style.setProperty('--fs', st.size + 'px');
  document.body.classList.add('lock');
  $('ppDone').hidden = true; $('ppCount').hidden = true; $('ppLoad').hidden = true; $('ppRec').hidden = true; $('camV').hidden = true; $('camC').hidden = true;
  $('ppPause').textContent = '暂停';
  build();
  pp.last = performance.now(); pp.raf = requestAnimationFrame(frame);
  setStatus('正在准备…');
  try { pp.wake = navigator.wakeLock ? await navigator.wakeLock.request('screen').catch(() => null) : null; } catch { }
  // 1. 麦克风 / 镜头
  const needAudio = pp.mode === 'follow' || st.cam;
  if (needAudio || st.cam) {
    setStatus(st.cam ? '请允许使用麦克风和摄像头' : '请允许使用麦克风');
    try { pp.input = await openInput(needAudio, st.cam); }
    catch (e) {
      console.warn(e);
      const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
      if (st.cam) { pp.cam = false; el.classList.remove('cam'); layout(); }
      if (pp.mode === 'follow') {
        pp.mode = 'auto';
        toast(denied ? '没拿到麦克风权限，这次先按匀速滚动。想让字跟着声音走：在浏览器设置里允许麦克风' : '这个浏览器用不了麦克风（微信 / 抖音里请点右上角「在浏览器打开」），这次先按匀速滚动', 5200);
      } else toast('没拿到摄像头权限，这次只提词不录像', 4000);
      // 镜头不行但麦克风可能可以：只要声音再试一次
      if (st.mode === 'follow' && st.cam && !DEMO) { try { pp.mode = 'follow'; pp.input = await openInput(true, false); toast('没拿到摄像头权限，这次只提词不录像', 4000); } catch { pp.mode = 'auto'; } }
    }
    if (pp.state !== 'prep') return cleanup();
    setStatus('正在准备…');
  }
  // 2. 语音识别模型
  if (pp.mode === 'follow') {
    try {
      if (modelState !== 'ready') {
        $('ppLoad').hidden = false; $('ppLoadB').style.width = '0%';
        await ensureModel(p => { $('ppLoadB').style.width = (p * 100).toFixed(0) + '%'; $('ppLoadT').textContent = p < 0.98 ? `正在下载语音识别模型 ${(p * 100).toFixed(0)}%` : '马上就好…'; });
      }
      await new Promise(res => { pp.onStarted = res; worker.postMessage({ type: 'start', rate: pp.input.rate }); });
    } catch (e) {
      console.error(e); pp.mode = 'auto';
      toast('语音识别没能加载（' + (e.message || e) + '），这次先按匀速滚动', 5000);
    }
    $('ppLoad').hidden = true;
    if (pp.state !== 'prep') return cleanup();
  }
  // 3. 倒数
  if (st.count && !Q.has('nocount')) {
    pp.state = 'count';
    for (let n = 3; n >= 1; n--) {
      $('ppCount').hidden = false; $('ppCount').textContent = n; setStatus('准备');
      await new Promise(r => setTimeout(r, 800));
      if (pp.state !== 'count') return cleanup();
    }
    $('ppCount').hidden = true;
  }
  pp.state = 'run';
  if (pp.cam && pp.input && pp.input.stream) startRec(pp.input.stream);
  runStatus();
}
function runStatus() {
  const rec = pp.rec ? '录像中 · ' : '';
  if (pp.state === 'pause') setStatus('已暂停');
  else if (pp.mode === 'follow') setStatus(rec + '正在听', pp.rec ? 'on rec' : 'on');
  else setStatus(rec + `匀速 ${st.cpm} 字/分`, pp.rec ? 'rec' : '');
}
function finish() {
  if (pp.state !== 'run') return;
  pp.state = 'done'; pp.shown = pp.P.units.length; paint();
  if (pp.rec) { setStatus('念完了 · 还在录像', 'rec'); toast('稿子念完了，点「结束录制」保存视频', 4000); }
  else { setStatus('念完了'); $('ppDone').hidden = false; }
}
function cleanup() {
  cancelAnimationFrame(pp.raf);
  if (pp.input) { try { pp.input.close(); } catch { } pp.input = null; }
  if (worker) worker.postMessage({ type: 'stop' });
  if (pp.wake) { try { pp.wake.release(); } catch { } pp.wake = null; }
  const v = $('camV'); v.srcObject = null; v.removeAttribute('src'); v.hidden = true; v.classList.remove('tiny'); $('camC').hidden = true;
  $('pp').hidden = true; document.body.classList.remove('lock');
  pp.state = 'idle'; syncForm();
}
function grabPoster() {
  try {
    const v = $('camV'); if (!v.videoWidth) return '';
    const c = document.createElement('canvas'), k = Math.min(1, 720 / v.videoWidth);
    c.width = Math.round(v.videoWidth * k); c.height = Math.round(v.videoHeight * k);
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.8);
  } catch { return ''; }
}
async function exit() {
  if (pp.state === 'idle') return;
  const had = !!pp.rec, secs = pp.rec ? (performance.now() - pp.recT0) / 1000 : 0;
  const poster = had ? grabPoster() : '';
  pp.state = 'closing';
  const blob = await stopRec();
  cleanup();
  if (had && blob && blob.size) showOut(blob, secs, poster);
  else if (had) toast('这次没录到内容');
}
$('go').onclick = start;
$('ppExit').onclick = exit; $('ppQuit').onclick = exit; $('ppRec').onclick = exit;
$('ppPause').onclick = () => {
  if (pp.state === 'run') { pp.state = 'pause'; $('ppPause').textContent = '继续'; if (pp.rec && pp.rec.state === 'recording') try { pp.rec.pause(); } catch { } }
  else if (pp.state === 'pause') { pp.state = 'run'; $('ppPause').textContent = '暂停'; pp.lastAdv = -1e9; if (pp.rec && pp.rec.state === 'paused') try { pp.rec.resume(); } catch { } }
  else return;
  runStatus();
};
function seek(u) {
  pp.fol.seek(u); pp.shown = u; pp.autoPos = u; pp.lastAdv = -1e9; pp.track = [];
  if (pp.state === 'done') { pp.state = 'run'; $('ppDone').hidden = true; runStatus(); }
  paint();
}
$('ppTop').onclick = () => { if (['run', 'pause', 'done'].includes(pp.state)) seek(0); };
$('ppAgain').onclick = () => { seek(0); pp.elapsed = 0; };
function resize(d) { st.size = Math.min(56, Math.max(20, st.size + d)); $('pp').style.setProperty('--fs', st.size + 'px'); persist(); layout(); }
$('ppSm').onclick = () => resize(-2); $('ppLg').onclick = () => resize(2);
// 点稿子上的任意一个字：从那儿接着念
inner.onclick = e => {
  const s = e.target.closest('span[data-i]'); if (!s || !['run', 'pause', 'done'].includes(pp.state)) return;
  const P = pp.P; let i = +s.dataset.i;
  while (i < P.chars.length && P.chars[i].u < 0) i++;
  if (i < P.chars.length) seek(P.chars[i].u);
};

// ---------- 录好的视频 ----------
let lastUrl = null;
function showOut(blob, secs, poster) {
  if (lastUrl) URL.revokeObjectURL(lastUrl);
  lastUrl = URL.createObjectURL(blob);
  const mp4 = /mp4/.test(blob.type), ext = mp4 ? 'mp4' : 'webm';
  const d = new Date(), p2 = n => String(n).padStart(2, '0');
  const name = `提词录制_${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}.${ext}`;
  // 有截到的画面就先显示它，点播放才加载视频（有的手机不点播放是黑的）
  const ov = $('outV');
  if (poster) { ov.poster = poster; ov.preload = 'none'; } else { ov.removeAttribute('poster'); ov.preload = 'metadata'; }
  ov.src = lastUrl;
  $('outMeta').textContent = `${dur(secs)} · ${(blob.size / 1048576).toFixed(1)} MB · ${ext.toUpperCase()}${mp4 ? '' : '（这个浏览器只能录 WebM，发抖音、微信前可以用工具箱的「视频压缩」转成 MP4）'} · 稿子没有录进去`;
  const a = $('dl'); a.href = lastUrl; a.download = name;
  const file = new File([blob], name, { type: blob.type });
  $('outShare').hidden = !(navigator.canShare && navigator.canShare({ files: [file] }));
  $('outShare').onclick = () => navigator.share({ files: [file], title: name }).catch(() => { });
  $('wxTip').hidden = !/MicroMessenger|aweme|Douyin|QQ\//i.test(navigator.userAgent);
  $('toSub').href = mp4 ? '../subtitle/' : '../video-compress/'; $('toSub').textContent = mp4 ? '去加字幕 ›' : '去转成 MP4 ›';
  pp.lastRec = { blob, name, secs, type: blob.type };
  $('out').hidden = false; document.body.classList.add('lock');
}
$('outBack').onclick = () => { $('outV').pause(); $('out').hidden = true; document.body.classList.remove('lock'); };

// ---------- 我的稿子（本机保存，第 4 篇起要会员） ----------
const loadSaved = () => { try { return JSON.parse(localStorage.getItem(SAVED) || '[]'); } catch { return []; } };
const putSaved = l => { try { localStorage.setItem(SAVED, JSON.stringify(l)); return true; } catch { toast('存不下了：浏览器给网页的空间满了'); return false; } };
const titleOf = t => (t.trim().split('\n')[0] || '').replace(/[，。！？、,.!?：:；;\s]+$/, '').slice(0, 12) || '没有标题';
function drawSaved() {
  const l = loadSaved();
  $('saved').innerHTML = l.map((s, i) => `<span class="chip"><button data-i="${i}">${esc(s.title)}</button><button class="x" data-x="${i}" aria-label="删除">✕</button></span>`).join('');
}
$('saved').onclick = e => {
  const l = loadSaved(), b = e.target.closest('button'); if (!b) return;
  if (b.dataset.x != null) { l.splice(+b.dataset.x, 1); putSaved(l); drawSaved(); return; }
  st.text = l[+b.dataset.i].text; syncForm(); persist(); warm(); toast('已调出');
};
$('saveIt').onclick = async () => {
  if (!st.text.trim()) { toast('先把稿子粘贴进来'); return; }
  let l = loadSaved();
  const title = titleOf(st.text), same = l.findIndex(s => s.title === title);
  const rec = { title, text: st.text, t: Date.now() };
  if (same >= 0) { l[same] = rec; if (putSaved(l)) { drawSaved(); toast('已更新'); } return; }
  if (l.length >= FREE_SAVED && window.Member && Member.enabled && !(await Member.active())) {
    const r = await Member.gate({ title: '多存几篇稿子', text: `免费版能在这台手机上存 ${FREE_SAVED} 篇稿子（提词、跟读、录像都不限次数、不限时长）；开通工具箱会员可以存任意多篇，开场白、口播稿、直播话术随时调出来。`, free: '换掉最早存的那篇' });
    if (!r) return;
    if (r === 'free') l.shift();
  }
  l.push(rec); if (putSaved(l)) { drawSaved(); toast('已保存'); }
};

// ---------- 代做入口 ----------
const svc = window.SITE_CONFIG && window.SITE_CONFIG.service;
if (svc) {
  const s = { ...svc, ...(svc.tools && svc.tools.prompter) };
  $('service').innerHTML = `<h2>找我代做 <b>${esc(s.price)}</b></h2><p>${esc(s.text)}</p><p class="contact">${esc(s.contact)}</p>${s.qr ? `<img src="../${esc(s.qr)}" alt="联系方式二维码">` : ''}`;
  $('service').hidden = false;
}

// 供分镜和测试用
window.__pp = {
  st, pp, start, exit, seek, SAMPLE,
  set(p) { Object.assign(st, p); syncForm(); persist(); },
  state: () => pp.state, mode: () => pp.mode, pos: () => pp.fol ? pp.fol.pos : 0, shown: () => pp.shown, total: () => pp.P ? pp.P.units.length : 0,
  heard: () => pp.heard.join(''), log: () => pp.log, model: () => modelState, loadModel: () => ensureModel(),
  demoPlay() { if (pp.input && pp.input.play) pp.input.play(); },
};
syncForm(); drawSaved();
window.__ppReady = true;
