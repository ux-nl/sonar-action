import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const workspaces = [];

/**
 * Creates a temporary workspace containing the given files.
 * @param {Record<string, string>} files relative path → contents
 * @returns {string} absolute workspace path
 */
export function tmpWorkspace(files = {}) {
    const dir = mkdtempSync(path.join(tmpdir(), 'sonar-action-'));
    workspaces.push(dir);
    writeFiles(dir, files);
    return dir;
}

/**
 * Removes every workspace created by `tmpWorkspace()` so far. Call this from
 * an `after()` hook in test files that use `tmpWorkspace`.
 */
export function cleanupWorkspaces() {
    while (workspaces.length > 0) {
        const dir = workspaces.pop();
        rmSync(dir, { recursive: true, force: true });
    }
}

/** @param {string} dir @param {Record<string, string>} files */
export function writeFiles(dir, files) {
    for (const [name, contents] of Object.entries(files)) {
        const file = path.join(dir, name);
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, contents);
    }
}
