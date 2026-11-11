import type { HyperCompressOptions } from './options.js';
export interface PdfaLevel {
    part: number;
    conformance: string;
}
export declare function formatPdfaLevel(level: PdfaLevel): string;
export declare function parsePdfaFromXmp(xmp: string): PdfaLevel | null;
export declare function stripPdfaFromXmp(xmp: string): string;
export declare function conformanceSafeOptions(requested: HyperCompressOptions, level: PdfaLevel): HyperCompressOptions;
export declare function conformanceWarnings(requested: HyperCompressOptions, safe: HyperCompressOptions): string[];
export declare function raiseHeaderVersion(output: Uint8Array, minVersion: string): Uint8Array;
export declare function packAllowedWhilePreserving(): boolean;
export declare function detectPdfaInBytes(bytes: Uint8Array): PdfaLevel | null;
export declare function restoreHeaderVersion(source: Uint8Array, output: Uint8Array): Uint8Array;
