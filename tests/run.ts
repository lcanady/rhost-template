/**
 * Test runner for RhostMUSH projects.
 *
 * Flow:
 *   1. Start a disposable RhostMUSH Docker container via @rhost/testkit
 *   2. Log in as Wizard, paste dist/installer.txt line-by-line (batched)
 *   3. Create N dedicated test accounts (WIZARD+SIDEFX) for parallel suites
 *   4. Run suites in parallel waves — each suite uses its own account so
 *      @pemit me= goes only to that session (no sentinel cross-contamination)
 *   5. Stop the container (even on failure)
 *
 * Usage: npm test
 * Env:   RHOST_IMAGE  (default lcanady/rhostmush:latest)
 *        RHOST_PASS   (default Nyctasia — stock docker wizard password)
 *
 * ---------------------------------------------------------------------------
 * EDIT THIS SECTION to match your project's test files and installer.
 * ---------------------------------------------------------------------------
 */

import { RhostClient, RhostContainer } from '@rhost/testkit';
import { spawn } from 'child_process';
import * as fs   from 'fs';
import * as path from 'path';
import { buildChildEnv, redactPassword } from '../tools/env-utils';

const IMAGE    = process.env.RHOST_IMAGE || 'lcanady/rhostmush:latest';
const PASS     = process.env.RHOST_PASS  || 'Nyctasia';
const INSTALLER = path.resolve(__dirname, '..', 'dist', 'installer.txt');

// ---------------------------------------------------------------------------
// Test waves — suites in the same wave run in parallel; waves run in order.
// Each suite in a wave gets its own dedicated MUSH account to prevent
// @pemit sentinel bleed between parallel sessions.
//
// Ordering guidelines:
//   - Put fast unit/UDF tests in early waves
//   - Put heavy workflow or E2E tests in later waves
//   - Put resource-intensive or queue-sensitive suites alone in their own wave
// ---------------------------------------------------------------------------

const WAVES: string[][] = [
    // Wave 1 — fast unit tests
    ['example.test.ts'],
    // Wave 2 — integration / workflow tests (add more as needed)
    // ['workflow.test.ts'],
];

const TEST_FILES       = WAVES.flat();
const MAX_WAVE_WIDTH   = Math.max(...WAVES.map(w => w.length));
const TEST_ACCT_PASS   = 'TestPass1!';
const TEST_ACCTS       = Array.from({ length: MAX_WAVE_WIDTH }, (_, i) => `TestSlot${i + 1}`);

// ---------------------------------------------------------------------------
// Installer deployment — batches commands to avoid per-line round-trip cost
// ---------------------------------------------------------------------------

async function deployInstaller(client: RhostClient, file: string) {
    const raw   = fs.readFileSync(file, 'utf8');
    const lines = raw.split('\n').map(l => l.replace(/\r$/, '')).filter(l => l && !/^\s*@@/.test(l));
    const total = lines.length;
    const started = Date.now();
    const errors: string[] = [];

    const BATCH = 20;
    const rawConn = (client as any).conn;
    const milestones = [25, 50, 75, 100];
    let nextMs = 0;

    process.stdout.write(`  Deploying ${total} installer commands (batch=${BATCH})…\n`);

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
                    errors.push(`  line ${i + j + 1}: ${batch[j].slice(0, 60)}…  → ${lineOut.split('\n')[0]}`);
                }
            }
        }

        const done = Math.min(i + BATCH, total);
        const pct  = Math.floor((done / total) * 100);
        while (nextMs < milestones.length && pct >= milestones[nextMs]) {
            const elapsed = ((Date.now() - started) / 1000).toFixed(1);
            process.stdout.write(`  … ${milestones[nextMs]}%  (${done}/${total}, ${elapsed}s)\n`);
            nextMs++;
        }
    }

    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    if (errors.length) {
        console.log(`  ⚠ ${errors.length} installer line(s) returned errors:`);
        for (const e of errors) console.log(e);
    }
    console.log(`  Install finished in ${elapsed}s — ${total - errors.length}/${total} ok.`);
    return total;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
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
        console.log('Wiped CRON* attrs from #1.');

        if (!fs.existsSync(INSTALLER)) {
            throw new Error(`Installer not found: ${INSTALLER}\nRun \`npm run build\` first.`);
        }
        console.log(`Deploying ${INSTALLER} ...`);
        const n = await deployInstaller(client, INSTALLER);
        console.log(`Sent ${n} installer command(s).`);

        // Post-install: halt any softcode cron schedulers to prevent noise.
        await client.command('@wipe #1/CRON*');
        for (const pat of ['*Cron*', '*cron*', '*CRON*']) {
            const found = (await client.eval(`search(name=${pat})`)).trim();
            if (found && !found.startsWith('#-1') && !/^no match/i.test(found)) {
                for (const dbref of found.split(/\s+/)) {
                    if (dbref.startsWith('#') && dbref !== '#1') {
                        await client.command(`@set ${dbref}=HALT`);
                    }
                }
            }
        }

        // Create one dedicated test account per parallel slot.
        console.log(`Creating ${TEST_ACCTS.length} test account(s)…`);
        for (const name of TEST_ACCTS) {
            await client.command(`@pcreate ${name}=${TEST_ACCT_PASS}`);
            const dbref = (await client.eval(`search(name=${name})`)).trim().match(/#\d+/)?.[0];
            if (!dbref) throw new Error(`Failed to create test account ${name}`);
            await client.command(`@set ${dbref}=WIZARD`);
            await client.command(`@set ${dbref}=ROYALTY`);
            await client.command(`@set ${dbref}=SIDEFX`);
            await client.command(`@dig ${name} TestRoom`);
            const roomDbref = (await client.eval(`lastcreate(me,r)`)).trim().match(/#\d+/)?.[0];
            if (roomDbref) {
                await client.command(`@link ${dbref}=${roomDbref}`);
                await client.command(`@tel ${dbref}=${roomDbref}`);
            }
            console.log(`  ${name} = ${dbref} (room ${roomDbref})`);
        }

        await client.disconnect();

        // Run suites in parallel waves.
        let failed = 0;
        const allFailed: string[] = [];

        for (let waveIdx = 0; waveIdx < WAVES.length; waveIdx++) {
            const wave = WAVES[waveIdx];
            console.log(`\n--- Wave ${waveIdx + 1}/${WAVES.length}: ${wave.join(', ')} ---`);

            const procs = wave.map((file, slotIdx) => {
                const acct = TEST_ACCTS[slotIdx % TEST_ACCTS.length];
                const env = buildChildEnv({ host, port, user: acct, pass: TEST_ACCT_PASS });
                return new Promise<{ file: string; status: number }>((resolve) => {
                    const proc = spawn('npx', ['ts-node', path.resolve(__dirname, file)], { env });
                    const chunks: Buffer[] = [];
                    proc.stdout.on('data', (d) => chunks.push(d));
                    proc.stderr.on('data', (d) => chunks.push(d));
                    proc.on('close', (code) => {
                        process.stdout.write(`\n========== ${file} ==========\n`);
                        process.stdout.write(Buffer.concat(chunks));
                        resolve({ file, status: code ?? 1 });
                    });
                });
            });

            const results = await Promise.all(procs);
            for (const r of results) {
                if (r.status !== 0) { failed++; allFailed.push(r.file); }
            }
        }

        if (failed > 0) {
            console.error(`\n${failed}/${TEST_FILES.length} suite(s) failed: ${allFailed.join(', ')}`);
            await container.stop();
            process.exit(1);
        }
        console.log(`\nAll ${TEST_FILES.length} suite(s) passed.`);
    } finally {
        await container.stop().catch(() => {});
    }
}

main().catch(err => {
    console.error('Bootstrap error:', err);
    process.exit(2);
});
