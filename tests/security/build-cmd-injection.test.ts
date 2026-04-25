/**
 * CRITICAL #3 — Command injection via MANIFEST entries in build.ts
 *
 * execSync(`npx ts-node "${file}"`) with shell=true allows metacharacters
 * in file paths to execute arbitrary commands.
 */
import { test, describe, assert } from './runner';
import { validateManifestEntry } from '../../tools/validate';

describe('build — MANIFEST command injection', () => {

    test('rejects backtick injection in filename', () => {
        assert.throws(() => validateManifestEntry('`whoami`.js'), /invalid manifest entry/i);
    });

    test('rejects $() subshell in filename', () => {
        assert.throws(() => validateManifestEntry('$(rm -rf /).js'), /invalid manifest entry/i);
    });

    test('rejects semicolon injection', () => {
        assert.throws(() => validateManifestEntry('file.js; rm -rf /'), /invalid manifest entry/i);
    });

    test('rejects pipe injection', () => {
        assert.throws(() => validateManifestEntry('file.js | cat /etc/passwd'), /invalid manifest entry/i);
    });

    test('rejects path traversal in manifest entry', () => {
        assert.throws(() => validateManifestEntry('../../evil.js'), /invalid manifest entry/i);
    });

    test('rejects null bytes', () => {
        assert.throws(() => validateManifestEntry('file\x00.js'), /invalid manifest entry/i);
    });

    test('accepts valid .mush file entry', () => {
        assert.doesNotThrow(() => validateManifestEntry('system/config.mush'));
    });

    test('accepts valid directory entry', () => {
        assert.doesNotThrow(() => validateManifestEntry('system/'));
    });

    test('accepts valid .js tool entry', () => {
        assert.doesNotThrow(() => validateManifestEntry('header.js'));
        assert.doesNotThrow(() => validateManifestEntry('post.js'));
    });

    test('accepts valid .ts tool entry', () => {
        assert.doesNotThrow(() => validateManifestEntry('build.ts'));
    });

    test('rejects absolute path', () => {
        assert.throws(() => validateManifestEntry('/etc/passwd'), /invalid manifest entry/i);
    });

});
