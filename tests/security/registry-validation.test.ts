/**
 * HIGH #5  — Checksum bypass on first install
 * HIGH #6  — JSON injection from registry response
 * MEDIUM #8 — No validation of GitHub refs
 * MEDIUM #9 — Local file path escaping
 */
import { test, describe, assert } from './runner';
import * as path from 'path';
import {
    validateVersion,
    validateTarballUrl,
    validateGitHubRepo,
    validateGitHubTag,
    validateLocalPath,
} from '../../tools/validate';

describe('registry — version string validation (HIGH #6)', () => {

    test('rejects path traversal in version', () => {
        assert.throws(() => validateVersion('../../../etc/passwd'), /traversal/i);
    });

    test('rejects slash in version', () => {
        assert.throws(() => validateVersion('1.0/evil'), /traversal/i);
    });

    test('rejects backslash in version', () => {
        assert.throws(() => validateVersion('1.0\\evil'), /traversal/i);
    });

    test('rejects empty string', () => {
        assert.throws(() => validateVersion(''), /non-empty/i);
    });

    test('accepts semver', () => {
        assert.doesNotThrow(() => validateVersion('1.2.3'));
        assert.doesNotThrow(() => validateVersion('1.2.3-beta.1'));
        assert.doesNotThrow(() => validateVersion('0.0.1'));
    });

    test('accepts v-prefixed tag', () => {
        assert.doesNotThrow(() => validateVersion('v1.2.3'));
    });

    test('accepts "latest" tag', () => {
        assert.doesNotThrow(() => validateVersion('latest'));
    });

});

describe('registry — tarball URL validation (HIGH #6)', () => {

    test('rejects file:// scheme', () => {
        assert.throws(() => validateTarballUrl('file:///etc/passwd'), /HTTPS/i);
    });

    test('rejects http:// scheme', () => {
        assert.throws(() => validateTarballUrl('http://registry.mushpkg.dev/pkg.txt'), /HTTPS/i);
    });

    test('rejects AWS metadata endpoint', () => {
        assert.throws(() => validateTarballUrl('https://169.254.169.254/latest/meta-data/'), /private network/i);
    });

    test('rejects loopback', () => {
        assert.throws(() => validateTarballUrl('https://127.0.0.1/evil.txt'), /private network/i);
        assert.throws(() => validateTarballUrl('https://localhost/evil.txt'), /private network/i);
    });

    test('rejects RFC-1918 addresses', () => {
        assert.throws(() => validateTarballUrl('https://10.0.0.1/evil.txt'), /private network/i);
        assert.throws(() => validateTarballUrl('https://192.168.1.1/evil.txt'), /private network/i);
        assert.throws(() => validateTarballUrl('https://172.16.0.1/evil.txt'), /private network/i);
    });

    test('rejects invalid URL', () => {
        assert.throws(() => validateTarballUrl('not-a-url'), /invalid tarball url/i);
    });

    test('accepts valid HTTPS registry URL', () => {
        assert.doesNotThrow(() => validateTarballUrl('https://registry.mushpkg.dev/@mushpkg/bbs/-/bbs-1.3.2.txt'));
    });

    test('accepts valid GitHub release URL', () => {
        assert.doesNotThrow(() => validateTarballUrl('https://github.com/owner/repo/releases/download/v1.0.0/installer.txt'));
    });

});

describe('GitHub ref validation (MEDIUM #8)', () => {

    test('rejects dotdot in repo', () => {
        assert.throws(() => validateGitHubRepo('../evil/repo'), /invalid/i);
    });

    test('rejects extra path segments', () => {
        assert.throws(() => validateGitHubRepo('owner/repo/extra'), /invalid/i);
    });

    test('rejects shell metacharacters in repo', () => {
        assert.throws(() => validateGitHubRepo('owner/repo;rm -rf /'), /invalid/i);
    });

    test('accepts valid owner/repo', () => {
        assert.doesNotThrow(() => validateGitHubRepo('lcanady/mush-jobs'));
        assert.doesNotThrow(() => validateGitHubRepo('mushpkg/core-bbs'));
    });

    test('rejects dotdot in tag', () => {
        assert.throws(() => validateGitHubTag('../../../admin/release'), /invalid/i);
    });

    test('rejects slash in tag', () => {
        assert.throws(() => validateGitHubTag('v1.0/../../evil'), /invalid/i);
    });

    test('accepts valid semver tag', () => {
        assert.doesNotThrow(() => validateGitHubTag('v1.2.3'));
        assert.doesNotThrow(() => validateGitHubTag('1.2.3-beta'));
    });

});

describe('local path validation (MEDIUM #9)', () => {

    const ROOT = '/project/root';

    test('rejects path escaping root via dotdot', () => {
        assert.throws(
            () => validateLocalPath('/project/root/../../etc/passwd', ROOT),
            /traversal/i
        );
    });

    test('rejects path completely outside root', () => {
        assert.throws(
            () => validateLocalPath('/etc/passwd', ROOT),
            /traversal/i
        );
    });

    test('accepts path inside root', () => {
        assert.doesNotThrow(() => validateLocalPath('/project/root/deps/pkg/installer.txt', ROOT));
    });

    test('accepts root itself', () => {
        assert.doesNotThrow(() => validateLocalPath('/project/root', ROOT));
    });

});
