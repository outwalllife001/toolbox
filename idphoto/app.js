import * as core from './core.js';

// 尺寸表来自 HivisionIDPhotos demo/assets/size_list_CN.csv（[高, 宽] 像素，300dpi）
const SIZES = [
  ['一寸', 413, 295], ['二寸', 626, 413], ['小一寸', 378, 260], ['大一寸', 567, 390], ['小二寸', 531, 413],
  ['教师资格证', 413, 295], ['国家公务员考试', 413, 295], ['初级会计考试', 413, 295], ['英语四六级考试', 192, 144],
  ['计算机等级考试', 567, 390], ['研究生考试', 709, 531], ['社保卡', 441, 358], ['电子驾驶证', 378, 260],
  ['美国签证', 600, 600], ['日本签证', 413, 295], ['韩国签证', 531, 413], ['五寸', 1499, 1050],
];
// 底色同 demo/assets/color_list_CN.csv
const COLORS = [['蓝色', '#628bce'], ['白色', '#ffffff'], ['红色', '#d74532'], ['深蓝', '#4b6190'], ['浅灰', '#f2f0f0'], ['黑色', '#000000']];

const $ = id => document.getElementById(id);
const st = { img: null, size: SIZES[0], color: COLORS[0][1], res: null, sizeKey: null, ready: false, urls: {} };

const mm = px => Math.round(px / 300 * 25.4);
$('sizes').innerHTML = SIZES.map((s, i) =>
  `<button class="chip${i ? '' : ' on'}" data-i="${i}">${s[0]}<small>${mm(s[2])}×${mm(s[1])}mm</small></button>`).join('');
const swatchHtml = COLORS.map((c, i) => `<button class="sw${i ? '' : ' on'}" data-c="${c[1]}" style="background:${c[1]}" aria-label="${c[0]}"><span>${c[0]}</span></button>`).join('');
$('colors').innerHTML = swatchHtml;
$('colors2').innerHTML = swatchHtml;

function setStatus(text, cls = '') { const s = $('status'); s.textContent = text; s.className = 'status ' + cls; }
function refreshGo() { $('go').disabled = !(st.img && st.ready); }

core.loadModels((k, p) => { if (p < 1) setStatus(`正在加载 AI 模型 ${Math.round(p * 100)}%（只需加载一次）`, 'busy'); })
  .then(() => { st.ready = true; setStatus(st.img ? '' : '先上传一张照片'); refreshGo(); })
  .catch(e => setStatus('模型加载失败：' + e.message));

$('file').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  const url = URL.createObjectURL(f), im = new Image();
  im.src = url; await im.decode();
  st.img = im; st.res = null; st.sizeKey = null;
  $('srcPreview').src = url; $('srcPreview').hidden = false; $('dropEmpty').hidden = true; $('drop').classList.add('has');
  $('result').hidden = true;
  if (st.ready) setStatus('');
  refreshGo();
});

$('sizes').addEventListener('click', e => {
  const b = e.target.closest('.chip'); if (!b) return;
  document.querySelectorAll('.chip').forEach(x => x.classList.toggle('on', x === b));
  st.size = SIZES[+b.dataset.i];
  if (st.res) generate();
});

function pickColor(c) {
  st.color = c;
  document.querySelectorAll('.sw').forEach(x => x.classList.toggle('on', x.dataset.c === c));
  if (st.res) render(true);
}
$('colors').addEventListener('click', e => { const b = e.target.closest('.sw'); if (b) pickColor(b.dataset.c); });
$('colors2').addEventListener('click', e => { const b = e.target.closest('.sw'); if (b) pickColor(b.dataset.c); });

$('go').addEventListener('click', generate);

async function generate() {
  if (!st.img || !st.ready) return;
  $('go').disabled = true;
  const t0 = performance.now();
  const label = { matting: 'AI 抠图中…', face: '识别人脸位置…', crop: '按标准裁剪…' };
  try {
    const key = st.size[1] + 'x' + st.size[2];
    if (st.res && st.res.rgba) {
      // 换尺寸不用重新抠图
      setStatus(label.crop, 'busy');
      Object.assign(st.res, core.adjustPhoto(st.res.rgba, st.res.face, [st.size[1], st.size[2]]));
    } else {
      st.res = await core.createIdPhoto(st.img, [st.size[1], st.size[2]], s => setStatus(label[s], 'busy'));
    }
    st.sizeKey = key;
    render();
    const sec = ((performance.now() - t0) / 1000).toFixed(1);
    setStatus(`完成，用时 ${sec} 秒${st.res.face.count > 1 ? '（检测到多张脸，已选最大的一张）' : ''}`, 'done');
    $('result').hidden = false;
    $('layoutBox').hidden = true; $('kbOut').hidden = true;
    requestAnimationFrame(() => $('result').scrollIntoView({ behavior: 'smooth', block: 'start' }));
  } catch (e) {
    console.error(e);
    setStatus(e.code === 'NO_FACE' ? e.message : '处理失败：' + e.message);
  } finally { refreshGo(); }
}

function blobUrl(name, blob) {
  if (st.urls[name]) URL.revokeObjectURL(st.urls[name]);
  return (st.urls[name] = URL.createObjectURL(blob));
}
const toBlob = (c, type = 'image/jpeg', q = 0.95) => new Promise(r => c.toBlob(r, type, q));

async function render(flash) {
  const c = core.withBackground(st.res.standard, st.color);
  st.final = c;
  const url = blobUrl('std', await toBlob(c));
  $('out').src = url;
  if (flash) { $('out').classList.remove('flash'); void $('out').offsetWidth; $('out').classList.add('flash'); }
  $('dlStd').href = url; $('dlStd').download = `证件照_${st.size[0]}_${st.size[2]}x${st.size[1]}.jpg`;
  $('meta').textContent = `${st.size[0]} · ${st.size[2]}×${st.size[1]} 像素`;
  if (!$('layoutBox').hidden) makeLayout();
  $('kbOut').hidden = true;
}

async function makeLayout() {
  const { canvas, count } = core.layout(st.final, [st.size[1], st.size[2]]);
  const url = blobUrl('layout', await toBlob(canvas));
  $('layoutImg').src = url;
  $('dlLayout').href = url; $('dlLayout').download = `六寸排版_${st.size[0]}_${count}张.jpg`;
  $('layoutMeta').textContent = `一张 6 寸相纸排 ${count} 张${st.size[0]}，打印后沿灰线裁开`;
  $('layoutBox').hidden = false;
}
$('mkLayout').addEventListener('click', async () => {
  await makeLayout();
  $('layoutBox').scrollIntoView({ behavior: 'smooth', block: 'center' });
});

$('mkKb').addEventListener('click', async () => {
  const kb = Math.max(5, +$('kb').value || 200);
  const { blob } = await core.toJpegUnderKB(st.final, kb);
  const url = blobUrl('kb', blob), a = document.createElement('a');
  a.href = url; a.download = `证件照_${st.size[0]}_${Math.round(blob.size / 1024)}KB.jpg`;
  $('kbOut').innerHTML = `已压缩到 ${(blob.size / 1024).toFixed(0)} KB ✓ <a href="${url}" download="${a.download}">保存</a>`;
  $('kbOut').hidden = false;
});
