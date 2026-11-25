// AudioWorklet：把麦克风的声音攒成 2048 个样本一块，发给页面（页面再转给识别 Worker）
class Capture extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(2048); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      let o = 0;
      while (o < ch.length) {
        const k = Math.min(ch.length - o, this.buf.length - this.n);
        this.buf.set(ch.subarray(o, o + k), this.n); this.n += k; o += k;
        if (this.n === this.buf.length) { this.port.postMessage(this.buf, [this.buf.buffer]); this.buf = new Float32Array(2048); this.n = 0; }
      }
    }
    return true;
  }
}
registerProcessor('capture', Capture);
