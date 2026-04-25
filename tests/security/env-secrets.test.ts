/**
 * CRITICAL #4  — Env var leakage: all process.env passed to child processes
 * HIGH #7      — RHOST_PASS and other credentials visible in child env
 * LOW #11      — Wizard password logged in plaintext to stdout
 */
import { test, describe, assert } from './runner';
import { buildChildEnv, redactPassword } from '../../tools/env-utils';

describe('env isolation — child process env (CRITICAL #4 / HIGH #7)', () => {

    test('buildChildEnv includes required RHOST vars', () => {
        const env = buildChildEnv({ host: 'localhost', port: 4201, user: 'TestSlot1', pass: 'TestPass1!' });
        assert.equal(env.RHOST_HOST, 'localhost');
        assert.equal(env.RHOST_PORT, '4201');
        assert.equal(env.RHOST_USER, 'TestSlot1');
        assert.equal(env.RHOST_PASS, 'TestPass1!');
    });

    test('buildChildEnv does NOT leak arbitrary parent env vars', () => {
        // Simulate a CI env with secrets
        const prev = process.env.SECRET_API_KEY;
        process.env.SECRET_API_KEY = 'super-secret-value';
        try {
            const env = buildChildEnv({ host: 'h', port: 1, user: 'u', pass: 'p' });
            assert.ok(!('SECRET_API_KEY' in env), 'SECRET_API_KEY should not be in child env');
            assert.ok(!('AWS_SECRET_ACCESS_KEY' in env), 'AWS secrets should not leak');
            assert.ok(!('GITHUB_TOKEN' in env), 'GITHUB_TOKEN should not leak');
        } finally {
            if (prev === undefined) delete process.env.SECRET_API_KEY;
            else process.env.SECRET_API_KEY = prev;
        }
    });

    test('buildChildEnv includes safe system vars (PATH, HOME, TMPDIR)', () => {
        const env = buildChildEnv({ host: 'h', port: 1, user: 'u', pass: 'p' });
        // PATH is needed for npx, node to resolve
        assert.ok('PATH' in env, 'PATH must be present for child process to work');
    });

    test('buildChildEnv does not include RHOST_PASS from parent env', () => {
        // Parent env might have a different RHOST_PASS — child must use the test account pw
        const prev = process.env.RHOST_PASS;
        process.env.RHOST_PASS = 'parent-wizard-password';
        try {
            const env = buildChildEnv({ host: 'h', port: 1, user: 'TestSlot1', pass: 'TestPass1!' });
            assert.equal(env.RHOST_PASS, 'TestPass1!', 'must use test account pw, not parent RHOST_PASS');
        } finally {
            if (prev === undefined) delete process.env.RHOST_PASS;
            else process.env.RHOST_PASS = prev;
        }
    });

});

describe('password redaction in logs (LOW #11)', () => {

    test('redactPassword replaces password with ***', () => {
        const result = redactPassword('Starting container: lcanady/rhostmush:latest (wizard pw: Nyctasia)', 'Nyctasia');
        assert.ok(!result.includes('Nyctasia'), 'password must not appear in output');
        assert.ok(result.includes('***'), 'redacted marker must be present');
    });

    test('redactPassword is safe when password is empty', () => {
        const result = redactPassword('some log line', '');
        assert.equal(result, 'some log line');
    });

    test('redactPassword handles special regex characters in password', () => {
        const pw = 'P@$$w0rd!+.*[]';
        const line = `wizard pw: ${pw}`;
        const result = redactPassword(line, pw);
        assert.ok(!result.includes(pw), 'password must not appear in output');
    });

});
