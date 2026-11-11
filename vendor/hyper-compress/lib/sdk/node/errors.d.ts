export type HyperErrorCode = 'decrypt_failed' | 'engine_error' | 'timeout' | 'cancelled';
export declare class HyperError extends Error {
    readonly code: HyperErrorCode;
    constructor(code: HyperErrorCode, message?: string);
}
