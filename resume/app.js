// 免费简历生成器：填表 → 实时排版（4 套模板 × 6 种主色）→ 一键压成一页 → 文字版 PDF
// 数据只存在这台设备的浏览器里（localStorage），没有任何上传接口
import { TEMPLATES, COLORS, DENSITY, render, paginate, PAGE_W } from './templates.js';
import { toPdf, loadLibs } from './topdf.js';
import { SAMPLE, blank } from './sample.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const KEY = 'resume-v1';
const q = new URLSearchParams(location.search);

// ---------- 存储：可以存多份（不同岗位各一份）；免费版 1 份，开了会员不限 ----------
let store = null;
try { store = JSON.parse(localStorage.getItem(KEY)); } catch { }
if (!store || !Array.isArray(store.docs) || !store.docs.length) store = { cur: 0, docs: [{ name: '我的简历', data: fresh() }] };
function fresh() { return { tpl: 'onyx', color: COLORS[0], density: 0, ...blank() }; }
let d = store.docs[store.cur] ? store.docs[store.cur].data : store.docs[0].data;
let saveT = 0;
function save() {
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    try { localStorage.setItem(KEY, JSON.stringify(store)); $('saved').textContent = '已自动保存在这台设备上'; }
    catch { $('saved').textContent = '⚠️ 浏览器存储满了，没能自动保存（先下载 PDF 或备份）'; }
  }, 400);
}

// ---------- 预览 ----------
const rs = $('rs'), pv = $('pv'), pvScale = $('pvScale');
let pages = 1, scale = 1;
function fitScale() {
  if (window.__noScale) { pvScale.style.transform = 'none'; $('pvIn').style.height = rs.offsetHeight + 'px'; return; }
  scale = pv.clientWidth / PAGE_W;
  pvScale.style.transform = `scale(${scale})`;
  pvScale.style.height = '';
  $('pvIn').style.height = rs.offsetHeight * scale + 'px';
}
function draw() {
  render(rs, d);
  pages = paginate(rs);
  fitScale();
  const den = d.density | 0;
  $('pageInfo').innerHTML = pages > 1 ? `<b class="warn">${pages} 页</b>` : '1 页';
  $('fit').hidden = !(pages > 1 || den > 0);
  $('fit').textContent = pages > 1 ? '压成一页' : '恢复字号';
  $('fit').classList.toggle('hot', pages > 1);
  document.querySelectorAll('.tp-b').forEach(b => b.classList.toggle('on', b.dataset.t === d.tpl));
  document.querySelectorAll('.sw').forEach(b => b.classList.toggle('on', b.dataset.c === d.color));
}
let raf = 0;
const redraw = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { draw(); follow(); }); };
// 编辑哪里，预览就滚到哪里，并闪一下
let focusKey = null;
function follow() {
  if (!focusKey || $('pvCard').classList.contains('full')) return;
  const t = rs.querySelector(`[data-f="${CSS.escape(focusKey)}"]`);
  if (!t) return;
  const r = t.getBoundingClientRect(), r0 = rs.getBoundingClientRect();
  const y = (r.top - r0.top), h = r.height;
  const want = Math.max(0, y - Math.max(8, (pv.clientHeight - h) / 3));
  if (y < pv.scrollTop + 4 || y + h > pv.scrollTop + pv.clientHeight - 4) pv.scrollTo({ top: want, behavior: 'smooth' });
  t.classList.remove('flash'); void t.offsetWidth; t.classList.add('flash');
}
addEventListener('resize', () => { fitScale(); });
if ('ResizeObserver' in window) new ResizeObserver(() => fitScale()).observe(pv);

// ---------- 模板、颜色 ----------
$('tpls').innerHTML = TEMPLATES.map(t => `<button class="tp-b" data-t="${t.id}"><i class="tp-i tp-${t.id}"><s></s><s></s><s></s></i>${t.name}</button>`).join('');
$('colors').innerHTML = COLORS.map(c => `<button class="sw" data-c="${c}" style="--c:${c}" aria-label="颜色 ${c}"></button>`).join('');
$('tpls').onclick = e => { const b = e.target.closest('.tp-b'); if (!b) return; d.tpl = b.dataset.t; focusKey = null; draw(); save(); };
$('colors').onclick = e => { const b = e.target.closest('.sw'); if (!b) return; d.color = b.dataset.c; draw(); save(); };
// 压成一页：从当前档开始逐级收紧，直到一页放得下
$('fit').onclick = () => {
  if (pages <= 1) { d.density = 0; draw(); save(); toast('字号、间距恢复默认'); return; }
  const was = d.density | 0;
  for (let i = was + 1; i < DENSITY.length; i++) {
    d.density = i; draw();
    if (pages === 1) { save(); toast(`已压成一页（正文 ${DENSITY[i].fs}pt）`); return; }
  }
  save(); toast('压到最小还是放不下，删掉几条不重要的经历吧', 3500);
};
$('expand').onclick = () => {
  const full = $('pvCard').classList.toggle('full');
  $('expand').textContent = full ? '收起' : '整页';
  pv.scrollTop = 0; fitScale();
  if (full) $('pvCard').scrollIntoView({ block: 'start' });
};

// ---------- 表单 ----------
const PH = {
  edu: ['学校（可加学院）', '专业 · 学历', '成绩排名、主修课程…（每行一条）'],
  work: ['公司', '职位', '做了什么、结果怎样，尽量写数字（每行一条，自动加圆点）'],
  proj: ['项目名称', '你的角色', '项目内容、你负责的部分、结果（每行一条）'],
  campus: ['学生组织 / 活动', '职务', '做了什么（每行一条）'],
  skills: '英语六级、计算机二级、会用的软件…（每行一条）',
  awards: '奖学金、比赛获奖、荣誉称号…（每行一条）',
  summary: '两三句话介绍自己：擅长什么、做事风格',
};
const BASIC = [['phone', '电话', 'tel'], ['email', '邮箱', 'email'], ['city', '所在城市'], ['age', '年龄 / 出生年月'], ['politics', '政治面貌'], ['wechat', '微信（选填）']];
function formHtml() {
  const b = d.basics;
  let h = `<div class="fc" id="fcBasic"><div class="fc-hd"><b>基本信息</b></div>
    <div class="ph-row">
      <label class="ph-box${b.photo ? ' has' : ''}" for="photoFile">${b.photo ? `<img src="${b.photo}" alt="照片">` : '<span>＋<br>照片</span>'}</label>
      <div class="ph-f"><input data-k="b.name" placeholder="姓名" value="${esc(b.name)}" class="big"><input data-k="b.title" placeholder="求职意向（如：新媒体运营）" value="${esc(b.title)}"></div>
    </div>
    <p class="ph-tip">${b.photo ? `<button class="lnk" id="phDel">去掉照片</button> · ` : ''}没有证件照？<a href="../idphoto/">用「一键证件照」做一张</a></p>
    <div class="grid">${BASIC.map(([k, l, t]) => `<input data-k="b.${k}" placeholder="${l}" value="${esc(b[k])}"${t ? ` type="${t}"` : ''}>`).join('')}</div></div>`;
  d.sections.forEach((s, si) => {
    const ph = PH[s.id] || (s.type === 'text' ? '每行一条' : ['名称', '角色', '每行一条']);
    h += `<div class="fc${s.hidden ? ' off' : ''}" data-si="${si}"><div class="fc-hd">
      <input class="fc-t" data-k="${si}.title" value="${esc(s.title)}" aria-label="模块名称">
      <button class="ic" data-a="up" aria-label="上移">↑</button><button class="ic" data-a="down" aria-label="下移">↓</button>
      <button class="ic eye" data-a="hide">${s.hidden ? '显示' : '隐藏'}</button></div>`;
    if (!s.hidden) {
      if (s.type === 'text') h += `<textarea data-k="${si}.0.text" placeholder="${ph}" rows="3">${esc(s.items[0]?.text)}</textarea>`;
      else {
        s.items.forEach((it, i) => {
          h += `<div class="fi" data-i="${i}">
            <input data-k="${si}.${i}.org" placeholder="${ph[0]}" value="${esc(it.org)}" class="b">
            <input data-k="${si}.${i}.role" placeholder="${ph[1]}" value="${esc(it.role)}">
            <div class="dates"><input data-k="${si}.${i}.start" placeholder="开始 2021.09" value="${esc(it.start)}"><i>–</i><input data-k="${si}.${i}.end" placeholder="结束 / 至今" value="${esc(it.end)}"></div>
            <textarea data-k="${si}.${i}.desc" placeholder="${ph[2]}" rows="3">${esc(it.desc)}</textarea>
            <div class="fi-ac">${i ? `<button class="lnk" data-a="iup" data-i="${i}">上移</button>` : ''}<button class="lnk del" data-a="idel" data-i="${i}">删除这条</button></div></div>`;
        });
        h += `<button class="add" data-a="add">＋ 再加一条${esc(s.title.replace(/经历$/, ''))}</button>`;
      }
    }
    h += '</div>';
  });
  h += `<button class="add more" id="addSec">＋ 添加模块（证书、作品、语言…）</button>`;
  return h;
}
function drawForm() {
  $('form').innerHTML = formHtml();
  $('form').querySelectorAll('textarea').forEach(grow);
  $('phDel') && ($('phDel').onclick = () => { d.basics.photo = null; drawForm(); redraw(); save(); });
  $('addSec').onclick = () => {
    const name = prompt('模块名称（比如：证书、作品集、语言能力）', '作品集');
    if (!name) return;
    const text = confirm('这个模块是「一条条经历」吗？\n确定 = 经历（有单位、时间）\n取消 = 只写几行文字');
    d.sections.push({ id: 'x' + Date.now().toString(36), type: text ? 'entry' : 'text', title: name.slice(0, 12), items: [{}] });
    drawForm(); redraw(); save();
    $('form').lastElementChild.previousElementSibling.scrollIntoView({ block: 'center' });
  };
}
function grow(t) { t.style.height = 'auto'; t.style.height = Math.min(320, t.scrollHeight + 2) + 'px'; }
function keyOf(k) {   // 表单字段 → 预览里对应元素的 data-f
  if (k.startsWith('b.')) return k;
  const [si, a, f] = k.split('.');
  const s = d.sections[+si];
  if (!s) return null;
  return a === 'title' ? `${s.id}.t` : `${s.id}.${a}`;
}
function setVal(k, v) {
  if (k.startsWith('b.')) { d.basics[k.slice(2)] = v; return; }
  const [si, a, f] = k.split('.');
  const s = d.sections[+si];
  if (a === 'title') s.title = v;
  else (s.items[+a] ||= {})[f] = v;
}
$('form').addEventListener('input', e => {
  const k = e.target.dataset.k; if (!k) return;
  setVal(k, e.target.value);
  if (e.target.tagName === 'TEXTAREA') grow(e.target);
  focusKey = keyOf(k); redraw(); save();
});
$('form').addEventListener('focusin', e => { const k = e.target.dataset?.k; if (k) { focusKey = keyOf(k); follow(); } });
$('form').addEventListener('click', e => {
  const b = e.target.closest('button[data-a]'); if (!b) return;
  const si = +b.closest('.fc').dataset.si, s = d.sections[si], a = b.dataset.a, i = +b.dataset.i;
  if (a === 'up' && si > 0) [d.sections[si - 1], d.sections[si]] = [d.sections[si], d.sections[si - 1]];
  else if (a === 'down' && si < d.sections.length - 1) [d.sections[si + 1], d.sections[si]] = [d.sections[si], d.sections[si + 1]];
  else if (a === 'hide') s.hidden = !s.hidden;
  else if (a === 'add') s.items.push({});
  else if (a === 'iup' && i > 0) [s.items[i - 1], s.items[i]] = [s.items[i], s.items[i - 1]];
  else if (a === 'idel') {
    const it = s.items[i];
    if (Object.values(it || {}).some(v => String(v).trim()) && !confirm('删除这条经历？')) return;
    s.items.splice(i, 1); if (!s.items.length) s.items.push({});
  } else return;
  focusKey = `${s.id}.t`;
  drawForm(); redraw(); save();
});

// ---------- 照片：裁成一寸照比例（5:7），偏上取景 ----------
$('photoFile').onchange = async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try {
    const bmp = await createImageBitmap(f, { imageOrientation: 'from-image' }).catch(() => loadImg(f));
    const W = 450, H = 630, r = W / H;
    let sw = bmp.width, sh = bmp.height, sx = 0, sy = 0;
    if (sw / sh > r) { sw = sh * r; sx = (bmp.width - sw) / 2; } else { sh = sw / r; sy = (bmp.height - sh) * 0.2; }
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
    g.imageSmoothingQuality = 'high';
    g.drawImage(bmp, sx, sy, sw, sh, 0, 0, W, H);
    d.basics.photo = c.toDataURL('image/jpeg', 0.9);
    d.basics.showPhoto = true;
    focusKey = 'b.name';
    drawForm(); redraw(); save();
  } catch (err) { console.error(err); toast('这张照片打不开，换一张 JPG / PNG 试试'); }
};
function loadImg(f) { return new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = URL.createObjectURL(f); }); }

// ---------- 多份简历（不同岗位各存一份）：免费版 1 份，会员不限 ----------
function drawDocs() {
  $('docSel').innerHTML = store.docs.map((x, i) => `<option value="${i}"${i === store.cur ? ' selected' : ''}>${esc(x.name)}</option>`).join('');
}
$('docSel').onchange = () => { store.cur = +$('docSel').value; d = store.docs[store.cur].data; focusKey = null; drawForm(); draw(); save(); };
$('docNew').onclick = async () => {
  if (window.Member?.enabled && store.docs.length >= 1 && !(await Member.active())) {
    const r = await Member.gate({ title: '给不同岗位各存一份简历', text: '免费版存 1 份简历；开通工具箱会员可以存多份（比如「新媒体运营」「市场专员」各一份），随时切换。' });
    if (r !== 'member') return;
  }
  const name = prompt('给新的一份起个名字（比如岗位名）', (d.basics.title || '新的简历') + ' 2');
  if (!name) return;
  store.docs.push({ name: name.slice(0, 20), data: JSON.parse(JSON.stringify(d)) });
  store.cur = store.docs.length - 1; d = store.docs[store.cur].data;
  drawDocs(); drawForm(); draw(); save(); toast('已复制一份，改这一份不影响原来的');
};
$('docDel').onclick = () => {
  if (!confirm(store.docs.length > 1 ? `删除「${store.docs[store.cur].name}」？` : '清空所有内容，重新填写？')) return;
  if (store.docs.length > 1) { store.docs.splice(store.cur, 1); store.cur = 0; }
  else store.docs[0].data = fresh();
  d = store.docs[store.cur].data; drawDocs(); drawForm(); draw(); save();
};

// ---------- 示例 ----------
$('sample').onclick = async () => {
  const hasAny = d.basics.name || d.sections.some(s => s.items.some(it => Object.values(it).some(v => String(v).trim())));
  if (hasAny && !confirm('用示例内容替换你现在填的？（建议先「另存一份」）')) return;
  await fillSample();
  toast('已填入示例，改成你自己的就行');
};
async function fillSample() {
  const s = JSON.parse(JSON.stringify(SAMPLE));
  s.basics.photo = await fetch('sample-photo.jpg').then(r => r.blob()).then(b => new Promise(ok => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.readAsDataURL(b); })).catch(() => null);
  Object.assign(d, s, { density: 0 });
  focusKey = null; drawForm(); draw(); save();
}

// ---------- 导出 PDF ----------
let lastUrl = null;
$('go').onclick = async () => {
  if (!d.basics.name.trim()) { toast('先填上姓名'); $('form').querySelector('[data-k="b.name"]').focus(); return; }
  const btn = $('go'); btn.disabled = true; btn.classList.add('busy');
  const t0 = performance.now();
  try {
    setGo('准备字体…');
    // 导出前用不缩放的状态排一次，保证和预览一致
    draw();
    const out = await toPdf(rs, { title: `${d.basics.name} 简历`, onStep: s => setGo(s === '字体' ? '准备字体…' : s === '排版' ? '生成 PDF…' : '保存…') });
    const blob = new Blob([out.bytes], { type: 'application/pdf' });
    if (lastUrl) URL.revokeObjectURL(lastUrl);
    lastUrl = URL.createObjectURL(blob);
    const fname = `${d.basics.name}${d.basics.title ? '_' + d.basics.title : ''}_简历.pdf`.replace(/[\\/:*?"<>|\s]+/g, '');
    const a = $('dl'); a.href = lastUrl; a.download = fname;
    const kb = Math.max(1, Math.round(blob.size / 1024));
    $('outMeta').textContent = `${out.pages} 页 · ${kb} KB · 文字版，能选中复制 · 没有水印`;
    $('outWarn').hidden = !out.missing.length;
    if (out.missing.length) $('outWarn').textContent = `⚠️ 这几个字字库里没有，PDF 里会是空白：${out.missing.join(' ')}`;
    $('outShare').hidden = !(navigator.canShare && navigator.canShare({ files: [new File([blob], fname, { type: 'application/pdf' })] }));
    $('outShare').onclick = () => navigator.share({ files: [new File([blob], fname, { type: 'application/pdf' })], title: fname }).catch(() => { });
    $('wxTip').hidden = !/MicroMessenger|aweme|Douyin|QQ\//i.test(navigator.userAgent);
    window.__lastPdf = { bytes: out.bytes, pages: out.pages, ms: Math.round(performance.now() - t0), missing: out.missing, name: fname };
    $('out').hidden = false; document.body.classList.add('lock');
    showPdf(out.bytes).catch(e => console.warn('预览失败', e));
  } catch (e) {
    console.error(e); toast('生成失败：' + (e.message || e), 4000);
  } finally { btn.disabled = false; btn.classList.remove('busy'); setGo(); }
};
function setGo(t) { $('go').textContent = t || '下载 PDF'; }
// 用 PDF.js 把生成的 PDF 画出来：确认导出的就是这份
let pdfWorker = null;
async function showPdf(bytes) {
  const box = $('outPrev'); box.innerHTML = ''; box.dataset.done = '';
  const pdfjs = await import('../vendor/pdfjs/pdf.min.mjs');
  const V = new URL('../vendor/pdfjs/', import.meta.url).href;
  pdfjs.GlobalWorkerOptions.workerSrc = V + 'pdf.worker.min.mjs';
  const task = pdfjs.getDocument({ data: bytes.slice(), cMapUrl: V + 'cmaps/', cMapPacked: true, standardFontDataUrl: V + 'standard_fonts/', wasmUrl: V + 'wasm/', iccUrl: V + 'iccs/', worker: pdfWorker ||= new pdfjs.PDFWorker() });
  const doc = await task.promise;
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const vp = page.getViewport({ scale: Math.min(2, (box.clientWidth || 340) * devicePixelRatio / page.view[2]) });
    const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
    box.appendChild(c);
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp, canvas: c }).promise;
  }
  window.__pdfText = await (async () => { const pg = await doc.getPage(1); const tc = await pg.getTextContent(); return tc.items.map(i => i.str + (i.hasEOL ? '\n' : '')).join(''); })();
  await task.destroy();
  box.dataset.done = '1';
}
$('outClose').onclick = () => { $('out').hidden = true; document.body.classList.remove('lock'); };
$('out').onclick = e => { if (e.target === $('out')) $('outClose').click(); };

// ---------- 备份 / 恢复 ----------
$('backup').onclick = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify({ app: 'toolbox-resume', v: 1, ...store.docs[store.cur] })], { type: 'application/json' }));
  a.download = `${store.docs[store.cur].name}_简历备份.json`; a.click();
};
$('restoreFile').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const j = JSON.parse(await f.text());
    if (j.app !== 'toolbox-resume' || !j.data?.basics) throw new Error('不是这个工具的备份文件');
    Object.assign(d, j.data); drawForm(); draw(); save(); toast('已恢复');
  } catch (err) { toast('恢复失败：' + err.message, 3500); }
};

// ---------- 小提示 ----------
let toastT = 0;
function toast(t, ms = 2200) { const el = $('toast'); el.textContent = t; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => el.hidden = true, ms); }

// ---------- 代做入口：site/config.js 里配置了才显示；service.tools.resume 可以单独设置这一页的价格和说明 ----------
const svc = window.SITE_CONFIG && window.SITE_CONFIG.service;
if (svc) {
  const s = { ...svc, ...((svc.tools || {}).resume || {}) };
  $('service').innerHTML = `<h2>找我代做 <b>${esc(s.price)}</b></h2><p>${esc(s.text)}</p><p class="contact">${esc(s.contact)}</p>${s.qr ? `<img src="../${esc(s.qr)}" alt="联系方式二维码">` : ''}`;
  $('service').hidden = false;
}
if (window.Member?.enabled) $('faqMember').hidden = false;

// ---------- 启动 ----------
if (q.has('rec')) document.body.classList.add('rec');   // 录视频：舞台里网页只有 360×522，预览矮一点，表单才露得出来
drawDocs(); drawForm(); draw();
document.fonts.ready.then(() => draw());
document.fonts.addEventListener?.('loadingdone', () => draw());
if (q.has('sample')) fillSample();
// 空闲时预先加载 PDF 库，点下载时更快
setTimeout(() => loadLibs().catch(() => { }), 3000);
// 录制 / 测试用
window.__resume = { get data() { return d; }, set(v) { Object.assign(d, v); drawForm(); draw(); save(); }, draw, fillSample, get pages() { return pages; }, focus(k) { focusKey = k; follow(); } };
