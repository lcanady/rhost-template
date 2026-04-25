/**
 * CRITICAL #2 — Path traversal via dependency name
 *
 * A crafted package name containing `..` sequences can escape DEPS_DIR
 * and write files anywhere on disk when path.join() normalizes the path.
 */
import { test, describe, assert } from './runner';
import { validateDepName } from '../../tools/validate';

describe('dep name — path traversal', () => {

    test('rejects dotdot traversal in scope', () => {
        assert.throws(() => validateDepName('@pkg/../../etc/cron.d/evil'), /invalid package name/i);
    });

    test('rejects dotdot in package portion', () => {
        assert.throws(() => validateDepName('@scope/../../../etc/passwd'), /invalid package name/i);
    });

    test('rejects bare dotdot', () => {
        assert.throws(() => validateDepName('../evil'), /invalid package name/i);
    });

    test('rejects null bytes', () => {
        assert.throws(() => validateDepName('@pkg/foo\x00bar'), /invalid package name/i);
    });

    test('rejects backslash traversal', () => {
        assert.throws(() => validateDepName('@pkg/foo\\..\\..\\windows\\system32'), /invalid package name/i);
    });

    test('rejects names with shell metacharacters', () => {
        assert.throws(() => validateDepName('@pkg/foo;rm -rf /'), /invalid package name/i);
        assert.throws(() => validateDepName('@pkg/foo`whoami`'), /invalid package name/i);
        assert.throws(() => validateDepName('@pkg/foo$(id)'),    /invalid package name/i);
    });

    test('accepts valid scoped name', () => {
        assert.doesNotThrow(() => validateDepName('@mushpkg/bbs'));
        assert.doesNotThrow(() => validateDepName('@mushpkg/core-jobs'));
    });

    test('accepts valid unscoped name', () => {
        assert.doesNotThrow(() => validateDepName('bbs'));
        assert.doesNotThrow(() => validateDepName('core-jobs-2'));
    });

});
