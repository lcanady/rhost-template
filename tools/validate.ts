/**
 * Input validation for mush-install — all security-critical checks live here
 * so they are independently testable without importing the full installer.
 */
import * as path from 'path';

// npm-compatible package name: optional @scope/, then lowercase alphanumeric + hyphens/dots
// Rejects: .., null bytes, slashes (beyond the scope separator), shell metacharacters
const SCOPED_RE   = /^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/;
const UNSCOPED_RE = /^[a-z0-9][a-z0-9._-]*$/;

/** Throws if `name` is not a safe npm-style package name. */
export function validateDepName(name: string): void {
    if (!name || typeof name !== 'string') {
        throw new Error('Invalid package name: must be a non-empty string');
    }
    if (name.includes('\x00')) {
        throw new Error('Invalid package name: contains null byte');
    }
    if (name.includes('..') || name.includes('\\')) {
        throw new Error('Invalid package name: contains path traversal sequence');
    }
    if (!/^[@a-z0-9]/.test(name)) {
        throw new Error('Invalid package name: must start with letter, digit, or @');
    }
    if (!SCOPED_RE.test(name) && !UNSCOPED_RE.test(name)) {
        throw new Error(`Invalid package name: "${name}" does not match expected format`);
    }
}

/**
 * Validates that a redirect Location header stays within the expected host.
 * Throws if the redirect points to a different host or a non-HTTPS scheme.
 */
export function validateRedirectUrl(originalUrl: string, location: string): string {
    if (!location) throw new Error('SSRF: redirect has no Location header');

    let redirectUrl: URL;
    try {
        // Resolve relative redirects against the original
        redirectUrl = new URL(location, originalUrl);
    } catch {
        throw new Error(`SSRF: invalid redirect Location: ${location}`);
    }

    if (redirectUrl.protocol !== 'https:') {
        throw new Error(`SSRF: redirect to non-HTTPS URL rejected: ${redirectUrl.href}`);
    }

    const originalHost = new URL(originalUrl).hostname;
    if (redirectUrl.hostname !== originalHost) {
        throw new Error(
            `SSRF: redirect to different host rejected: ${originalHost} → ${redirectUrl.hostname}`
        );
    }

    return redirectUrl.href;
}

/**
 * Validates a resolved version string from the registry.
 * Must be a valid semver or simple tag name — no path traversal.
 */
export function validateVersion(version: string): void {
    if (!version || typeof version !== 'string') {
        throw new Error('Invalid version: must be a non-empty string');
    }
    // Block path traversal sequences first (more specific error message)
    if (version.includes('..') || version.includes('/') || version.includes('\\') || version.includes('\x00')) {
        throw new Error(`Invalid version: "${version}" contains path traversal sequence`);
    }
    // Allow semver (1.2.3, 1.2.3-beta.1) and simple tags (v1.2.3, latest)
    if (!/^v?[a-z0-9][a-z0-9._+-]*$/i.test(version)) {
        throw new Error(`Invalid version: "${version}" contains unsafe characters`);
    }
}

/**
 * Validates that a resolved tarball URL is HTTPS and not a local file or
 * private-network address that could be used for SSRF.
 */
export function validateTarballUrl(url: string): void {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        throw new Error(`Invalid tarball URL: ${url}`);
    }
    if (parsed.protocol !== 'https:') {
        throw new Error(`Tarball URL must be HTTPS, got: ${parsed.protocol}`);
    }
    // Block RFC-1918 / loopback / link-local
    const BLOCKED = [/^127\./, /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^169\.254\./, /^::1$/, /^localhost$/i];
    if (BLOCKED.some(r => r.test(parsed.hostname))) {
        throw new Error(`SSRF: tarball URL resolves to private network address: ${parsed.hostname}`);
    }
}

/**
 * Validates a MANIFEST entry in build.ts.
 * Entries may only be relative paths ending in .mush, .js, .ts, or / (dir).
 * Rejects absolute paths, dotdot traversal, and shell metacharacters.
 */
export function validateManifestEntry(entry: string): void {
    if (!entry || typeof entry !== 'string') {
        throw new Error('Invalid manifest entry: must be a non-empty string');
    }
    // Block null bytes
    if (entry.includes('\x00')) {
        throw new Error('Invalid manifest entry: contains null byte');
    }
    // Block absolute paths
    if (entry.startsWith('/') || /^[A-Za-z]:[\\/]/.test(entry)) {
        throw new Error(`Invalid manifest entry: absolute paths not allowed: "${entry}"`);
    }
    // Block dotdot traversal
    if (entry.includes('..')) {
        throw new Error(`Invalid manifest entry: path traversal not allowed: "${entry}"`);
    }
    // Block shell metacharacters: backtick, $, ;, |, &, >, <, newline, space (except in dir paths)
    if (/[`$;|&><\n\r\t]/.test(entry)) {
        throw new Error(`Invalid manifest entry: shell metacharacters not allowed: "${entry}"`);
    }
    // Must end with a safe extension or be a directory (trailing /)
    if (!/\.(mush|js|ts)$/.test(entry) && !entry.endsWith('/')) {
        throw new Error(`Invalid manifest entry: must end in .mush, .js, .ts, or / (dir): "${entry}"`);
    }
}

/**
 * Returns standard HTTPS request options including a 30-second timeout
 * and a descriptive User-Agent. Pass to every https.get() call.
 */
export function buildFetchOptions(): { timeout: number; headers: Record<string, string> } {
    return {
        timeout: 30_000,
        headers: { 'User-Agent': 'mush-install/1.0 (https://mushpkg.dev)' },
    };
}

/**
 * Validates a GitHub owner/repo string.
 * Must match "owner/repo" — no extra path segments or special characters.
 */
export function validateGitHubRepo(repo: string): void {
    if (!/^[a-z0-9._-]+\/[a-z0-9._-]+$/i.test(repo)) {
        throw new Error(`Invalid GitHub repo: "${repo}" — expected owner/repo format`);
    }
}

/**
 * Validates a GitHub tag / version ref.
 * Alphanumeric, hyphens, dots, and leading 'v' only.
 */
export function validateGitHubTag(tag: string): void {
    if (!/^v?[a-z0-9][a-z0-9._-]*$/i.test(tag)) {
        throw new Error(`Invalid GitHub tag: "${tag}" — must be alphanumeric with hyphens/dots`);
    }
}

/**
 * Ensures a resolved local path stays inside the expected root directory.
 * Prevents `file:../../../etc/passwd` style traversal.
 */
export function validateLocalPath(resolvedPath: string, rootDir: string): void {
    const norm = path.normalize(resolvedPath);
    const root = path.normalize(rootDir) + path.sep;
    if (!norm.startsWith(root) && norm !== path.normalize(rootDir)) {
        throw new Error(
            `Path traversal detected: resolved path "${norm}" escapes root "${root}"`
        );
    }
}
