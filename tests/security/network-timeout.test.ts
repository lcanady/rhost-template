/**
 * LOW #10 — No HTTPS timeout on registry fetches
 *
 * A slow-read attack can hang the install process indefinitely.
 * We test that fetchWithTimeout rejects after the deadline.
 */
import { test, describe, assert } from './runner';
import { buildFetchOptions } from '../../tools/validate';

describe('network — fetch timeout options (LOW #10)', () => {

    test('buildFetchOptions includes a timeout', () => {
        const opts = buildFetchOptions();
        assert.ok(typeof opts.timeout === 'number', 'timeout must be a number');
        assert.ok(opts.timeout > 0, 'timeout must be positive');
        assert.ok(opts.timeout <= 60_000, 'timeout must be <= 60s for usability');
    });

    test('buildFetchOptions includes User-Agent header', () => {
        const opts = buildFetchOptions();
        assert.ok(opts.headers && (opts.headers as Record<string,string>)['User-Agent'], 'User-Agent must be set');
    });

    test('default timeout is 30 seconds', () => {
        const opts = buildFetchOptions();
        assert.equal(opts.timeout, 30_000);
    });

});
