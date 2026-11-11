import type { HyperWasmModule, HyperWasmOptions, HyperWasmResult } from './glue.js';
export interface HyperWasmEngine {
    init(): Promise<void>;
    compress(input: Uint8Array, opts?: HyperWasmOptions): Promise<HyperWasmResult>;
    verifyPassword(input: Uint8Array, password: string): Promise<boolean>;
}
export declare function createEngine(load: () => Promise<HyperWasmModule>): HyperWasmEngine;
export { HYPER_PRESETS } from '../sdk/node/presets.js';
export type { CompressLevel } from '../sdk/node/presets.js';
export { buildHyperTokens, normalizeHyperOptions } from '../sdk/node/options.js';
export type { HyperCompressOptions } from '../sdk/node/options.js';
export type { PdfaLevel } from '../sdk/node/pdfa.js';
export { HyperError } from '../sdk/node/errors.js';
export type { HyperErrorCode } from '../sdk/node/errors.js';
export type { HyperWasmModule, HyperWasmOptions, HyperWasmResult } from './glue.js';
