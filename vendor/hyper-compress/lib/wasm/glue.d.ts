import { type HyperCompressOptions } from '../sdk/node/options.js';
import { type CompressLevel } from '../sdk/node/presets.js';
import { type PdfaLevel } from '../sdk/node/pdfa.js';
export interface HyperWasmModule {
    _hyper_compress_buffer(inPtr: number, inSize: number, passwordPtr: number, idsPtr: number, valsPtr: number, optCount: number, outSizePtr: number, outSignedPtr: number): number;
    _hyper_decrypt_buffer(inPtr: number, inSize: number, passwordPtr: number, outSizePtr: number): number;
    _hyper_pack_buffer(inPtr: number, inSize: number, outSizePtr: number): number;
    _hyper_pack_buffer_pdfa(inPtr: number, inSize: number, outSizePtr: number): number;
    _hyper_get_xmp(inPtr: number, inSize: number, passwordPtr: number, outSizePtr: number): number;
    _hyper_set_xmp(inPtr: number, inSize: number, xmpPtr: number, xmpSize: number, outSizePtr: number): number;
    _hyper_free(ptr: number): void;
    _malloc(size: number): number;
    _free(ptr: number): void;
    HEAPU8: Uint8Array;
    HEAPU32: Uint32Array;
    HEAP32: Int32Array;
}
export interface HyperWasmOptions {
    preset?: CompressLevel | undefined;
    options?: Partial<HyperCompressOptions> | undefined;
    password?: string | null | undefined;
    targetSizeBytes?: number | undefined;
}
export interface HyperWasmResult {
    data: Uint8Array;
    originalSize: number;
    compressedSize: number;
    signed: boolean;
    signaturesRemoved: boolean;
    pdfa: PdfaLevel | null;
    pdfaOutcome: 'none' | 'preserved' | 'claim-withdrawn';
    metTarget: boolean | null;
    warnings: string[];
}
export declare function decryptBuffer(mod: HyperWasmModule, input: Uint8Array, password: string): Uint8Array | null;
export declare function packBuffer(mod: HyperWasmModule, input: Uint8Array, pdfaSafe?: boolean): Uint8Array | null;
export declare function getXmp(mod: HyperWasmModule, input: Uint8Array, password?: string | null): string | null;
export declare function setXmp(mod: HyperWasmModule, input: Uint8Array, xmp: string): Uint8Array | null;
export declare function detectPdfa(mod: HyperWasmModule, input: Uint8Array, password?: string | null): PdfaLevel | null;
export declare function runEngine(mod: HyperWasmModule, input: Uint8Array, tokens: string[], password: string | null): {
    data: Uint8Array | null;
    signed: boolean;
    signaturesRemoved: boolean;
};
export declare function resolveOptions(opts: HyperWasmOptions): HyperCompressOptions;
export declare function compressBuffer(mod: HyperWasmModule, input: Uint8Array, opts?: HyperWasmOptions): HyperWasmResult;
export declare function describePdfaOutcome(r: HyperWasmResult): string;
