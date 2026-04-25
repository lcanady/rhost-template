/**
 * Utilities for safe environment variable handling in test child processes.
 *
 * The core principle: never spread ...process.env into child processes.
 * Only pass an explicit allowlist of safe system vars plus the RHOST_* vars
 * needed for the test connection. This prevents CI secrets, API keys, and
 * credentials from leaking into test processes.
 */

interface RhostConnectArgs {
    host: string;
    port: number;
    user: string;
    pass: string;
}

/**
 * Safe system environment variables that child processes legitimately need.
 * Everything not in this list is excluded — no ...process.env spreading.
 */
const SAFE_SYSTEM_VARS = [
    'PATH',
    'HOME',
    'TMPDIR',
    'TEMP',
    'TMP',
    'LANG',
    'LC_ALL',
    'LC_CTYPE',
    'TERM',
    'USER',
    'LOGNAME',
    'SHELL',
    'NODE_PATH',
    'NODE_OPTIONS',
    'npm_config_cache',
    // Docker / CI vars that are safe to pass
    'DOCKER_HOST',
    'CI',
    'RHOST_IMAGE',
];

/**
 * Build the environment object for a test child process.
 * Only includes the RHOST_* connection vars and a safe subset of system vars.
 * Never leaks arbitrary parent env vars (API keys, secrets, tokens, etc.).
 */
export function buildChildEnv(args: RhostConnectArgs): Record<string, string> {
    const env: Record<string, string> = {};

    // Copy only the safe system vars that are actually set
    for (const key of SAFE_SYSTEM_VARS) {
        const val = process.env[key];
        if (val !== undefined) env[key] = val;
    }

    // Always override RHOST_* with the explicit test connection args.
    // This prevents any RHOST_PASS from the parent env from bleeding through.
    env.RHOST_HOST = args.host;
    env.RHOST_PORT = String(args.port);
    env.RHOST_USER = args.user;
    env.RHOST_PASS = args.pass;

    return env;
}

/**
 * Redact a password from a log line before printing to stdout.
 * Escapes regex metacharacters in the password before substituting.
 */
export function redactPassword(line: string, password: string): string {
    if (!password) return line;
    const escaped = password.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return line.replace(new RegExp(escaped, 'g'), '***');
}
