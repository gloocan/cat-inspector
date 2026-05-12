import fs from 'node:fs';
import path from 'node:path';
const DEFAULT_SKIP = new Set([
    'node_modules',
    'dist',
    '.git',
    'coverage',
    '.vite',
]);
export function getAllTsFiles(dir, options = {}) {
    const skip = options.skipDirNames ?? DEFAULT_SKIP;
    const results = [];
    function walk(current) {
        let entries;
        try {
            entries = fs.readdirSync(current, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const ent of entries) {
            const full = path.join(current, ent.name);
            if (ent.isDirectory()) {
                if (skip.has(ent.name))
                    continue;
                walk(full);
            }
            else if (ent.isFile() && ent.name.endsWith('.ts') && !ent.name.endsWith('.d.ts')) {
                results.push(full);
            }
        }
    }
    walk(dir);
    return results;
}
//# sourceMappingURL=get-all-ts-files.js.map