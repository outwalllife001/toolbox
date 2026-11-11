export class HyperError extends Error {
    code;
    constructor(code, message) {
        super(message ?? code);
        this.name = 'HyperError';
        this.code = code;
    }
}
