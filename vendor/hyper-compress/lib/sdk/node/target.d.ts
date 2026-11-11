import type { HyperCompressOptions } from './options.js';
export declare const TARGET_QUALITY_FLOOR = 5;
export declare const TARGET_DPI_LADDER: readonly number[];
export declare const TARGET_QUALITY_STEPS = 7;
export declare function targetStartQuality(base: HyperCompressOptions): number;
export declare function targetLadder(base: HyperCompressOptions): HyperCompressOptions[];
export declare function targetMissWarning(smallest: number, target: number): string;
