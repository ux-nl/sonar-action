import { closeSync, existsSync, openSync, readFileSync, readSync } from 'node:fs';

/**
 * Parses a JSON file, returning null when it is missing or invalid.
 * @param {string} file
 * @returns {any|null}
 */
export function readJson(file) {
    if (!existsSync(file)) {
        return null;
    }
    try {
        return JSON.parse(readFileSync(file, 'utf8'));
    } catch {
        return null;
    }
}

/**
 * Reads the first bytes of a file as UTF-8 without loading the whole file.
 * @param {string} file
 * @param {number} bytes
 * @returns {string}
 */
export function peek(file, bytes = 4096) {
    const fd = openSync(file, 'r');
    try {
        const buffer = Buffer.alloc(bytes);
        const read = readSync(fd, buffer, 0, bytes, 0);
        return buffer.subarray(0, read).toString('utf8');
    } finally {
        closeSync(fd);
    }
}
