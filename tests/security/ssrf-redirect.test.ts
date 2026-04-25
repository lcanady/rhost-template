/**
 * CRITICAL #1 — SSRF via unvalidated HTTP redirect
 *
 * fetchBuffer() follows 301/302 redirects to any URL without validation.
 * An attacker-controlled registry can redirect to internal metadata endpoints.
 */
import { test, describe, assert } from './runner';
import { validateRedirectUrl } from '../../tools/validate';

describe('SSRF — redirect validation', () => {

    test('rejects redirect to different host', () => {
        assert.throws(
            () => validateRedirectUrl('https://registry.mushpkg.dev/pkg', 'https://attacker.com/evil'),
            /different host/i
        );
    });

    test('rejects redirect to AWS metadata endpoint', () => {
        assert.throws(
            () => validateRedirectUrl('https://registry.mushpkg.dev/pkg', 'https://169.254.169.254/latest/meta-data/'),
            /different host/i
        );
    });

    test('rejects redirect to non-HTTPS scheme', () => {
        assert.throws(
            () => validateRedirectUrl('https://registry.mushpkg.dev/pkg', 'http://registry.mushpkg.dev/pkg'),
            /non-HTTPS/i
        );
    });

    test('rejects redirect to file:// scheme', () => {
        assert.throws(
            () => validateRedirectUrl('https://registry.mushpkg.dev/pkg', 'file:///etc/passwd'),
            /non-HTTPS/i
        );
    });

    test('accepts same-host HTTPS redirect', () => {
        const result = validateRedirectUrl(
            'https://registry.mushpkg.dev/pkg/old',
            'https://registry.mushpkg.dev/pkg/new'
        );
        assert.equal(result, 'https://registry.mushpkg.dev/pkg/new');
    });

    test('resolves relative redirect against original', () => {
        const result = validateRedirectUrl(
            'https://registry.mushpkg.dev/pkg/old',
            '/pkg/new'
        );
        assert.equal(result, 'https://registry.mushpkg.dev/pkg/new');
    });

    test('rejects empty Location header', () => {
        assert.throws(
            () => validateRedirectUrl('https://registry.mushpkg.dev/pkg', ''),
            /no Location/i
        );
    });

});
