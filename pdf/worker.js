// 压缩线程：Hyper Compress（BentoPDF 团队开源的 PDF 压缩引擎，基于 PDFium，AGPL-3.0）编译成的 WASM，单线程
// 只重新压缩图片、精简字体和文件结构，文字还是文字（能选中、能搜索），页数和页面大小不变
// 本目录的代码以 AGPL-3.0 发布（见同目录 LICENSE.md）
// 不走包的 index.js：自己建引擎，好让解密（glue.js 的 decryptBuffer，包没导出）和压缩共用同一个 WASM 实例
import createModule from '../vendor/hyper-compress/engine/hyper-compress.js';
import { createEngine } from '../vendor/hyper-compress/lib/wasm/sdk.js';
import { decryptBuffer } from '../vendor/hyper-compress/lib/wasm/glue.js';

let modP = null;
const getModule = () => modP ||= createModule().catch(err => { modP = null; throw err; });
const { compress } = createEngine(getModule);

// 画质阶梯：从清晰到小。全部以引擎的 medium 预设为底（精简字体、去缩略图、合并重复字体），只换图片的画质和分辨率
// 先降 JPEG 质量、最后才降分辨率：手机拍的文件，150dpi 质量 25 字还清楚，100dpi 以下小字就认不出了（第 12 期 README 有对比图）
// 不用 JPEG 2000（preferJpx）：有的阅读器、报名系统显示不了，会变成空白页
const BASE = { preset: 'medium', options: { preferJpx: false } };
const rung = (q, dpi, force = true) => ({ ...BASE, options: { ...BASE.options, imageQuality: q, maxDpi: dpi, forceDownsample: force } });
const LADDER = [
  rung(80, 200, false),   // 0 清晰（A4 上 200dpi，打印也够）
  rung(65, 150),          // 1
  rung(50, 150),          // 2 推荐（= 引擎的 medium）
  rung(35, 150),          // 3
  rung(25, 150),          // 4 字还清楚
  rung(20, 120),          // 5 最小：小字勉强认得出
  rung(12, 100),          // 6
  rung(5, 72),            // 7 最低：小字认不出了
];
const NAMED = { hq: 0, std: 2, min: 5 };

let ready = null;
self.onmessage = async e => {
  const m = e.data, { id } = m;
  const step = d => self.postMessage({ id, type: 'step', ...d });
  try {
    if (m.type === 'warmup') {
      // 压一个最小的 PDF，让引擎把 WASM 下载、编译、初始化好
      ready ||= compress(tinyPdf(), BASE).catch(err => { ready = null; throw err; });
      await ready;
      self.postMessage({ id, type: 'done' });
      return;
    }
    const input = new Uint8Array(m.bytes);
    if (m.type === 'decrypt') {
      // 有打开密码的用密码；只禁止编辑（没有打开密码）的传空密码。输出是不带加密的同一份 PDF
      const data = decryptBuffer(await getModule(), input, m.password || '');
      if (!data) throw Object.assign(new Error('密码不对，解不开'), { code: 'decrypt_failed' });
      self.postMessage({ id, type: 'done', data }, [data.buffer]);
      return;
    }
    const t0 = performance.now();
    let out, tries = [];
    const run = (i, k, n) => {
      step({ i: k, n, rung: i });
      const t = performance.now();
      return compress(input, LADDER[i]).then(r => { tries.push({ rung: i, size: r.compressedSize, ms: Math.round(performance.now() - t) }); return r; });
    };
    if (typeof m.level === 'string') {
      out = await run(NAMED[m.level], 1, 1);
    } else {
      // 指定大小：先试最清晰的一档，放不下再二分找「放得下的最清晰」的那档（最多 5 次）
      const target = m.level.target;
      if (input.length <= target) {
        out = { data: input, compressedSize: input.length, originalSize: input.length, metTarget: true, untouched: true };
      } else {
        // 各档大小随档位单调变小：找 size ≤ target 的最小档位
        let best = null, smallest = null, k = 0;
        const est = 1 + Math.ceil(Math.log2(LADDER.length));   // 最多试几次（进度条用）
        const r0 = await run(0, ++k, est);
        if (r0.compressedSize <= target) best = { i: 0, r: r0 }; else smallest = r0;
        let lo = 1, hi = best ? 0 : LADDER.length - 1;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          const r = await run(mid, ++k, est);
          if (r.compressedSize < smallest.compressedSize) smallest = r;
          if (r.compressedSize <= target) { best = { i: mid, r }; hi = mid - 1; } else lo = mid + 1;
        }
        out = best ? best.r : smallest;
        out.metTarget = !!best;
        out.rung = best ? best.i : LADDER.length - 1;
      }
    }
    const data = out.data;
    self.postMessage({
      id, type: 'done', data, size: data.length, metTarget: out.metTarget ?? null, untouched: !!out.untouched,
      rung: out.rung, tries, ms: Math.round(performance.now() - t0), signed: !!out.signed,
    }, [data.buffer]);
  } catch (err) {
    self.postMessage({ id, type: 'error', code: err && err.code || 'engine_error', message: err && err.message || String(err) });
  }
};

// 一页空白的最小 PDF（预热用）
function tinyPdf() {
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] >>'];
  let s = '%PDF-1.4\n', offs = [];
  objs.forEach((o, i) => { offs.push(s.length); s += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = s.length;
  s += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  s += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return new TextEncoder().encode(s);
}
