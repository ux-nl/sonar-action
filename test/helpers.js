import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * Creates a temporary workspace containing the given files.
 * @param {Record<string, string>} files relative path → contents
 * @returns {string} absolute workspace path
 */
export function tmpWorkspace(files = {}) {
    const dir = mkdtempSync(path.join(tmpdir(), 'sonar-action-'));
    writeFiles(dir, files);
    return dir;
}

/** @param {string} dir @param {Record<string, string>} files */
export function writeFiles(dir, files) {
    for (const [name, contents] of Object.entries(files)) {
        const file = path.join(dir, name);
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, contents);
    }
}
