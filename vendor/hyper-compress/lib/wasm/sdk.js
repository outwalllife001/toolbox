import { compressBuffer, decryptBuffer } from './glue.js';
import { HyperError } from '../sdk/node/errors.js';
function describe(err) {
    return err instanceof Error ? err.message : String(err);
}
export function createEngine(load) {
    let pending = null;
    const getModule = () => {
        pending ??= load().catch((err) => {
            pending = null;
            throw new HyperError('engine_error', `wasm module failed to load: ${describe(err)}`);
        });
        return pending;
    };
    return {
        async init() {
            await getModule();
        },
        async compress(input, opts = {}) {
            const mod = await getModule();
            try {
                return compressBuffer(mod, input, opts);
            }
            catch (err) {
                if (err instanceof HyperError)
                    throw err;
                throw new HyperError('engine_error', describe(err));
            }
        },
        async verifyPassword(input, password) {
            const mod = await getModule();
            return decryptBuffer(mod, input, password) !== null;
        },
    };
}
export { HYPER_PRESETS } from '../sdk/node/presets.js';
export { buildHyperTokens, normalizeHyperOptions } from '../sdk/node/options.js';
export { HyperError } from '../sdk/node/errors.js';
