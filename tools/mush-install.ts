#!/usr/bin/env ts-node
/**
 * mush install — fetch declared dependencies from the registry and write
 * them to deps/<name>/<version>/installer.txt so the build tool can prepend
 * them automatically.
 *
 * Usage:
 *   npx ts-node tools/mush-install.ts                  # install all deps
 *   npx ts-node tools/mush-install.ts @mushpkg/bbs     # install one dep
 *
 * Resolution order (first match wins):
 *   1. Local path override ("file:./local/path")
 *   2. GitHub release: "github:<owner>/<repo>@<version>"
 *   3. Registry: mush.json → "registry" field
 */

import * as fs      from 'fs';
import * as path    from 'path';
import * as https   from 'https';
import * as crypto  from 'crypto';

import {
    validateDepName,
    validateRedirectUrl,
    validateVersion,
    validateTarballUrl,
    validateGitHubRepo,
    validateGitHubTag,
    validateLocalPath,
    buildFetchOptions,
} from './validate';

interface MushJson {
  name: string;
  version: string;
  namespace?: string;
  dependencies?: Record<string, string>;
  registry?: string;
}

interface LockEntry {
  version: string;
  resolved: string;
  sha256: string;
}

interface LockFile {
  lockVersion: number;
  resolved: Record<string, LockEntry>;
}

const ROOT     = path.join(__dirname, '..');
const DEPS_DIR = path.join(ROOT, 'deps');

const mushJson  = JSON.parse(fs.readFileSync(path.join(ROOT, 'mush.json'), 'utf8')) as MushJson;
const lockPath  = path.join(ROOT, 'mush-lock.json');
const lockFile  = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as LockFile;

const REGISTRY  = mushJson.registry ?? 'https://registry.mushpkg.dev';

// ---------------------------------------------------------------------------
// Fetch helpers — validated redirect following, 30s timeout
// ---------------------------------------------------------------------------

function fetchBuffer(url: string, originalUrl?: string): Promise<Buffer> {
    const origin = originalUrl ?? url;
    const opts   = buildFetchOptions();
    return new Promise((resolve, reject) => {
        const req = https.get(url, opts, (res) => {
            if (res.statusCode === 301 || res.statusCode === 302) {
                let safeLocation: string;
                try {
                    safeLocation = validateRedirectUrl(origin, res.headers.location ?? '');
                } catch (err) {
                    reject(err);
                    return;
                }
                fetchBuffer(safeLocation, origin).then(resolve, reject);
                return;
            }
            if (res.statusCode !== 200) {
                reject(new Error(`HTTP ${res.statusCode} fetching ${url}`));
                return;
            }
            const chunks: Buffer[] = [];
            res.on('data', (c: Buffer) => chunks.push(c));
            res.on('end', () => resolve(Buffer.concat(chunks)));
            res.on('error', reject);
        });
        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error(`Request timed out after ${opts.timeout}ms: ${url}`));
        });
    });
}

function sha256(buf: Buffer): string {
    return crypto.createHash('sha256').update(buf).digest('hex');
}

// ---------------------------------------------------------------------------
// Registry meta response schema validation
// ---------------------------------------------------------------------------

interface RegistryMeta {
    version: string;
    dist: { tarball: string };
}

function parseRegistryMeta(raw: string): RegistryMeta {
    let meta: unknown;
    try {
        meta = JSON.parse(raw);
    } catch {
        throw new Error('Registry returned invalid JSON');
    }
    if (typeof meta !== 'object' || meta === null) {
        throw new Error('Registry response must be a JSON object');
    }
    const m = meta as Record<string, unknown>;
    if (typeof m.version !== 'string') {
        throw new Error('Registry response missing string "version" field');
    }
    if (typeof m.dist !== 'object' || m.dist === null || typeof (m.dist as Record<string,unknown>).tarball !== 'string') {
        throw new Error('Registry response missing "dist.tarball" string field');
    }
    // Validate the fields before returning
    validateVersion(m.version);
    validateTarballUrl((m.dist as Record<string,string>).tarball);
    return { version: m.version, dist: { tarball: (m.dist as Record<string,string>).tarball } };
}

// ---------------------------------------------------------------------------
// Resolution strategies
// ---------------------------------------------------------------------------

async function resolveGitHub(spec: string, rawVersion: string): Promise<{ url: string; buf: Buffer }> {
    const repo = spec.replace(/^github:/, '');
    validateGitHubRepo(repo);
    const version = rawVersion.startsWith('v') ? rawVersion : `v${rawVersion}`;
    validateGitHubTag(version);
    const url = `https://github.com/${repo}/releases/download/${version}/installer.txt`;
    console.log(`  fetch github  ${url}`);
    const buf = await fetchBuffer(url);
    return { url, buf };
}

async function resolveRegistry(name: string, versionRange: string): Promise<{ url: string; buf: Buffer; version: string }> {
    const metaUrl = `${REGISTRY}/${encodeURIComponent(name)}`;
    console.log(`  fetch meta    ${metaUrl}`);
    validateTarballUrl(metaUrl);
    const metaBuf = await fetchBuffer(metaUrl);
    const meta    = parseRegistryMeta(metaBuf.toString('utf8'));
    console.log(`  fetch pkg     ${meta.dist.tarball}  (${meta.version})`);
    const buf = await fetchBuffer(meta.dist.tarball);
    return { url: meta.dist.tarball, buf, version: meta.version };
}

// ---------------------------------------------------------------------------
// Dep directory path — always derived from validated name + version
// ---------------------------------------------------------------------------

function depDir(name: string, version: string): string {
    // name is already validated; replace / with __ for filesystem safety
    const safeDir = path.join(DEPS_DIR, name.replace(/\//g, '__'), version);
    validateLocalPath(safeDir, DEPS_DIR);
    return safeDir;
}

// ---------------------------------------------------------------------------
// Install one dependency
// ---------------------------------------------------------------------------

async function installDep(name: string, versionRange: string) {
    // Validate name before anything touches the filesystem
    validateDepName(name);
    console.log(`\ninstalling ${name}@${versionRange}`);

    // Local file override
    if (versionRange.startsWith('file:')) {
        const localPath = path.resolve(ROOT, versionRange.slice(5), 'dist', 'installer.txt');
        validateLocalPath(localPath, ROOT);
        if (!fs.existsSync(localPath)) throw new Error(`Local dep not found: ${localPath}`);
        const buf      = fs.readFileSync(localPath);
        const checksum = sha256(buf);
        const dir      = depDir(name, 'local');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'installer.txt'), buf);
        lockFile.resolved[name] = { version: 'local', resolved: versionRange, sha256: checksum };
        console.log(`  linked local  ${localPath}`);
        return;
    }

    let url: string;
    let buf: Buffer;
    let resolvedVersion: string = versionRange;

    if (versionRange.startsWith('github:')) {
        const [specPart, versionPart] = versionRange.split('@');
        const result = await resolveGitHub(specPart, versionPart ?? 'latest');
        url = result.url;
        buf = result.buf;
        resolvedVersion = versionPart ?? 'latest';
    } else {
        const result = await resolveRegistry(name, versionRange);
        url = result.url;
        buf = result.buf;
        resolvedVersion = result.version;
    }

    validateVersion(resolvedVersion);

    const checksum = sha256(buf);

    // Verify against lock if already present; refuse install if mismatch
    const existing = lockFile.resolved[name];
    if (existing) {
        if (existing.sha256 !== checksum) {
            throw new Error(
                `Checksum mismatch for ${name}:\n` +
                `  expected: ${existing.sha256}\n` +
                `  got:      ${checksum}\n` +
                `Delete mush-lock.json entry to force re-fetch.`
            );
        }
        // Version already locked — skip re-write but still update file on disk
    }

    const dir = depDir(name, resolvedVersion);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'installer.txt'), buf);

    lockFile.resolved[name] = { version: resolvedVersion, resolved: url, sha256: checksum };
    console.log(`  ok  ${name}@${resolvedVersion}  sha256:${checksum.slice(0, 12)}…`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
    const deps   = mushJson.dependencies ?? {};
    const filter = process.argv[2];
    const entries = filter
        ? Object.entries(deps).filter(([n]) => n === filter)
        : Object.entries(deps);

    if (entries.length === 0) {
        console.log(filter ? `No dependency named ${filter} in mush.json.` : 'No dependencies declared in mush.json.');
        return;
    }

    fs.mkdirSync(DEPS_DIR, { recursive: true });

    for (const [name, version] of entries) {
        await installDep(name, version);
    }

    fs.writeFileSync(lockPath, JSON.stringify(lockFile, null, 2) + '\n');
    console.log(`\nUpdated mush-lock.json  (${entries.length} dep(s) resolved)\n`);
}

main().catch(err => { console.error(err.message); process.exit(1); });
