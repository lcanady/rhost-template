/**
 * Focused test runner.
 *
 * Automatically figures out which source directories to compile by:
 *   1. Parsing each test file for search(name=...) object lookups
 *   2. Grepping all .mush source files for @create commands matching those names
 *   3. Building a minimal installer from only those source directories
 *   4. Running only the specified test suites against that installer
 *
 * Usage:
 *   npm run test:focus -- chargen.test.ts
 *   npm run test:focus -- chargen.test.ts combat.test.ts
 *   npm run test:focus -- --dry-run chargen.test.ts   (show plan, no container)
 *
 * Env:
 *   RHOST_IMAGE  (default lcanady/rhostmush:latest)
 *   RHOST_PASS   (default Nyctasia)
 */

import * as fs   from 'fs';
import * as path from 'path';
import { execFileSync, spawn } from 'child_process';
import { RhostClient, RhostContainer } from '@rhost/testkit';
import { buildChildEnv, redactPassword } from './env-utils';

const ROOT     = path.join(__dirname, '..');
const SRC      = path.join(ROOT, 'src');
const TESTS    = path.join(ROOT, 'tests');
const DIST     = path.join(ROOT, 'dist');
const FOCUS_OUT = path.join(DIST, 'focus-installer.txt');

const IMAGE          = process.env.RHOST_IMAGE || 'lcanady/rhostmush:latest';
const PASS           = process.env.RHOST_PASS  || 'Nyctasia';
const TEST_ACCT      = 'FocusSlot1';
const TEST_ACCT_PASS = 'TestPass1!';

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

const rawArgs  = process.argv.slice(2);
const dryRun   = rawArgs.includes('--dry-run');
const suiteArgs = rawArgs.filter(a => !a.startsWith('-'));

if (suiteArgs.length === 0) {
    console.error('Usage: npm run test:focus -- <suite.test.ts> [suite2.test.ts ...]');
    console.error('       npm run test:focus -- --dry-run <suite.test.ts>');
    process.exit(1);
}

// ---------------------------------------------------------------------------
// Step 1: parse test files for search(name=...) object lookups
// ---------------------------------------------------------------------------

function parseSearchNames(src: string): string[] {
    // Matches search(name=Some Object <ns.tag>) in any eval/command string.
    // Handles both single and double quoted contexts.
    const re = /search\s*\(\s*name\s*=\s*([^)'"]+?)\s*\)/g;
    const names: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
        const name = m[1].trim();
        if (name) names.push(name);
    }
    return [...new Set(names)];
}

// ---------------------------------------------------------------------------
// Step 2: grep all .mush files for @create commands, build name → dir map
// ---------------------------------------------------------------------------

interface SourceMap {
    /** object name (as written in @create) → absolute src directory */
    nameToDir: Map<string, string>;
    /** all src dirs discovered */
    allDirs: Set<string>;
}

function buildSourceMap(): SourceMap {
    const nameToDir = new Map<string, string>();
    const allDirs   = new Set<string>();

    function walk(dir: string) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(full);
            } else if (entry.name.endsWith('.mush')) {
                const relDir = path.relative(SRC, dir);
                allDirs.add(relDir || '.');
                const content = fs.readFileSync(full, 'utf8');
                // Match @create Name <tag> or @create Name <tag>=desc
                // Also @create/flags Name <tag>
                for (const line of content.split('\n')) {
                    const m = line.match(/^@create(?:\/\S+)?\s+(.+?)(?:\s*=.*)?$/i);
                    if (m) {
                        const name = m[1].trim();
                        nameToDir.set(name.toLowerCase(), path.relative(SRC, dir));
                    }
                }
            }
        }
    }

    walk(SRC);
    return { nameToDir, allDirs };
}

// ---------------------------------------------------------------------------
// Step 3: resolve which src/ dirs are needed for a set of object names
// ---------------------------------------------------------------------------

function resolveSrcDirs(objectNames: string[], sourceMap: SourceMap): string[] {
    // Always include the core system directory
    const needed = new Set<string>(['system']);

    for (const name of objectNames) {
        const dir = sourceMap.nameToDir.get(name.toLowerCase());
        if (dir && dir !== '.') {
            needed.add(dir);
        } else if (!dir) {
            console.warn(`  warn  No @create found for "${name}" — check source files`);
        }
    }

    return [...needed];
}

// ---------------------------------------------------------------------------
// Step 4: build a minimal installer from those dirs, in mush.json manifest order
// ---------------------------------------------------------------------------

interface MushJson {
    name?: string;
    version?: string;
    namespace?: string;
    installers?: Array<{ name: string; manifest: string[] }>;
}

function compileMush(source: string): string {
    const out: string[] = [];
    let pending: string | null = null;
    const flush = () => { if (pending !== null) { out.push(pending); pending = null; } };

    for (const raw of source.split('\n')) {
        const line = raw.trimEnd();
        if (!line.trim()) continue;
        if (/^\s/.test(line)) { if (pending !== null) pending += line.trim(); continue; }
        flush();
        if (/^@@/.test(line) || /^think\s/.test(line)) out.push(line);
        else pending = line;
    }
    flush();
    return out.join('\n');
}

function resolveEntry(entry: string): string[] {
    if (entry.endsWith('/')) {
        const dir = path.join(SRC, entry.slice(0, -1));
        if (!fs.existsSync(dir)) return [];
        return fs.readdirSync(dir).filter(f => f.endsWith('.mush')).sort().map(f => path.join(dir, f));
    }
    const ext = path.extname(entry);
    if (ext === '.js' || ext === '.ts') return [path.join(__dirname, entry)];
    return [path.join(SRC, entry)];
}

function processFile(file: string): string {
    const ext = path.extname(file);
    if (ext === '.mush') return compileMush(fs.readFileSync(file, 'utf8'));
    if (ext === '.ts')   return execFileSync('npx', ['ts-node', file], { encoding: 'utf8' });
    if (ext === '.js')   return execFileSync('node', [file], { encoding: 'utf8' });
    throw new Error(`focus: unknown file type — ${file}`);
}

function buildFocusInstaller(neededDirs: string[]): void {
    const mushJson: MushJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'mush.json'), 'utf8'));
    const mainInstaller = (mushJson.installers ?? []).find(i => i.name === 'main');
    if (!mainInstaller) throw new Error('No "main" installer found in mush.json');

    // Filter the main manifest to only entries that fall inside needed dirs.
    // Non-src entries (header.js, post.js) are always included.
    const filteredManifest = mainInstaller.manifest.filter(entry => {
        const ext = path.extname(entry);
        // Always include .js/.ts tool scripts (header, footer, etc.)
        if (ext === '.js' || ext === '.ts') return true;
        // Directory entry like "system/" → keep if "system" is needed
        if (entry.endsWith('/')) {
            const dirName = entry.slice(0, -1);
            return neededDirs.includes(dirName);
        }
        // File entry like "system/foo.mush" → keep if its parent dir is needed
        const dirName = entry.split('/')[0];
        return neededDirs.includes(dirName);
    });

    fs.mkdirSync(DIST, { recursive: true });

    const header = [
        '@@ ===========================================================================',
        `@@ ${mushJson.name ?? 'focus'} — focus installer`,
        `@@ Dirs: ${neededDirs.join(', ')}`,
        `@@ Built: ${new Date().toISOString()}`,
        '@@ ===========================================================================',
    ].join('\n');

    const sections: string[] = [header];

    for (const entry of filteredManifest) {
        for (const file of resolveEntry(entry)) {
            const label  = path.relative(ROOT, file);
            const result = processFile(file);
            if (result.trim()) { sections.push(result); console.log(`  ok   ${label}`); }
            else                { console.log(`  skip ${label}  (empty)`); }
        }
    }

    fs.writeFileSync(FOCUS_OUT, sections.join('\n') + '\n');
    const bytes = fs.statSync(FOCUS_OUT).size;
    console.log(`\n  wrote dist/focus-installer.txt  (${bytes} bytes)\n`);
}

// ---------------------------------------------------------------------------
// Container / deploy helpers
// ---------------------------------------------------------------------------

async function deployInstaller(client: RhostClient, file: string) {
    const raw   = fs.readFileSync(file, 'utf8');
    const lines = raw.split('\n').map(l => l.replace(/\r$/, '')).filter(l => l && !/^\s*@@/.test(l));
    const total = lines.length;
    const errors: string[] = [];
    const started = Date.now();
    const BATCH = 20;
    const rawConn = (client as any).conn;

    process.stdout.write(`  Deploying ${total} commands (batch=${BATCH})…\n`);

    for (let i = 0; i < lines.length; i += BATCH) {
        const batch = lines.slice(i, i + BATCH);
        for (let j = 0; j < batch.length - 1; j++) {
            rawConn.send(batch[j]);
            await new Promise(r => setTimeout(r, 20));
        }
        const out = (await client.command(batch[batch.length - 1], 30000)).join('\n');

        if (/#-1 |Permission denied|That attribute is not valid|No match|I don't see that|Huh\?/i.test(out)) {
            for (let j = 0; j < batch.length; j++) {
                const lineOut = (await client.command(batch[j])).join('\n');
                if (/#-1 |Permission denied|That attribute is not valid|No match|I don't see that|Huh\?/i.test(lineOut)) {
                    errors.push(`  line ${i + j + 1}: ${batch[j].slice(0, 60)}  → ${lineOut.split('\n')[0]}`);
                }
            }
        }
    }

    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    if (errors.length) {
        console.log(`  ⚠ ${errors.length} installer line(s) returned errors:`);
        for (const e of errors) console.log(e);
    }
    console.log(`  Install done in ${elapsed}s — ${total - errors.length}/${total} ok.`);
}

async function createTestAccount(client: RhostClient) {
    await client.command(`@pcreate ${TEST_ACCT}=${TEST_ACCT_PASS}`);
    const dbref = (await client.eval(`search(name=${TEST_ACCT})`)).trim().match(/#\d+/)?.[0];
    if (!dbref) throw new Error(`Failed to create test account ${TEST_ACCT}`);
    await client.command(`@set ${dbref}=WIZARD`);
    await client.command(`@set ${dbref}=ROYALTY`);
    await client.command(`@set ${dbref}=SIDEFX`);
    await client.command(`@dig ${TEST_ACCT} TestRoom`);
    const roomDbref = (await client.eval('lastcreate(me,r)')).trim().match(/#\d+/)?.[0];
    if (roomDbref) {
        await client.command(`@link ${dbref}=${roomDbref}`);
        await client.command(`@tel ${dbref}=${roomDbref}`);
    }
    console.log(`  ${TEST_ACCT} = ${dbref} (room ${roomDbref})`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
    // Resolve test files
    const suiteFiles = suiteArgs.map(a => {
        const full = path.isAbsolute(a) ? a : path.join(TESTS, a);
        if (!fs.existsSync(full)) throw new Error(`Test file not found: ${full}`);
        return full;
    });

    console.log(`\nFocus run: ${suiteFiles.map(f => path.basename(f)).join(', ')}\n`);

    // Parse all object names needed across all suites
    const allObjectNames: string[] = [];
    for (const file of suiteFiles) {
        const src   = fs.readFileSync(file, 'utf8');
        const names = parseSearchNames(src);
        console.log(`  ${path.basename(file)}: needs objects [${names.join(', ') || '(none found)'}]`);
        for (const n of names) if (!allObjectNames.includes(n)) allObjectNames.push(n);
    }

    // Map object names → source directories
    const sourceMap = buildSourceMap();
    const neededDirs = resolveSrcDirs(allObjectNames, sourceMap);
    console.log(`\nSource dirs to compile: [${neededDirs.join(', ')}]`);

    if (dryRun) {
        console.log('\n--dry-run: stopping before build. No container started.');
        return;
    }

    // Build focus installer
    console.log('\nBuilding focus installer…');
    buildFocusInstaller(neededDirs);

    // Start container
    console.log(redactPassword(`Starting container: ${IMAGE}  (wizard pw: ${PASS})`, PASS));
    const container = RhostContainer.fromImage(IMAGE);
    const { host, port } = await container.start();
    console.log(`Container up at ${host}:${port}`);

    const client = new RhostClient({ host, port, paceMs: 15, timeout: 60000 });
    try {
        await client.connect();
        await client.login('Wizard', PASS);
        console.log('Logged in as Wizard.');

        await client.command('@set me=SIDEFX');
        await client.command('@wipe #1/CRON*');

        console.log('Deploying focus installer…');
        await deployInstaller(client, FOCUS_OUT);
        await client.command('@wipe #1/CRON*');

        console.log('Creating test account…');
        await createTestAccount(client);
        await client.disconnect();

        // Run suites (sequentially — focus runs are usually 1-3 suites)
        let failed = 0;
        for (const file of suiteFiles) {
            const name = path.basename(file);
            const env  = buildChildEnv({ host, port, user: TEST_ACCT, pass: TEST_ACCT_PASS });
            console.log(`\n--- ${name} ---`);

            const status = await new Promise<number>((resolve) => {
                const proc = spawn('npx', ['ts-node', file], { env });
                proc.stdout.on('data', (d) => process.stdout.write(d));
                proc.stderr.on('data', (d) => process.stderr.write(d));
                proc.on('close', (code) => resolve(code ?? 1));
            });

            if (status !== 0) failed++;
        }

        if (failed > 0) {
            console.error(`\n${failed}/${suiteFiles.length} suite(s) failed.`);
            process.exit(1);
        }
        console.log(`\nAll ${suiteFiles.length} suite(s) passed.`);
    } finally {
        await container.stop().catch(() => {});
    }
}

main().catch(err => {
    console.error('Bootstrap error:', err);
    process.exit(2);
});
