/**
 * Persistent dev container — starts a RhostMUSH Docker container, installs
 * the current build, and keeps it running so you can iterate quickly without
 * paying the container startup cost on every test run.
 *
 * While this is running, use rhost-testkit watch in a second terminal:
 *   npx rhost-testkit watch tests/chargen.test.ts
 *
 * The connection env vars are printed on startup and written to .env.local
 * (gitignored) so the watch command picks them up automatically.
 *
 * Usage:
 *   npm run dev
 *   npm run dev -- --no-install    (skip installer paste, use existing DB)
 */

import * as fs   from 'fs';
import * as path from 'path';
import { RhostClient, RhostContainer } from '@rhost/testkit';
import { redactPassword } from './env-utils';

const ROOT      = path.join(__dirname, '..');
const INSTALLER = path.join(ROOT, 'dist', 'installer.txt');
const ENV_LOCAL = path.join(ROOT, '.env.local');

const IMAGE    = process.env.RHOST_IMAGE || 'lcanady/rhostmush:latest';
const PASS     = process.env.RHOST_PASS  || 'Nyctasia';
const NO_INSTALL = process.argv.includes('--no-install');

const TEST_ACCT      = 'DevSlot1';
const TEST_ACCT_PASS = 'DevPass1!';

async function deployInstaller(client: RhostClient, file: string) {
    const raw   = fs.readFileSync(file, 'utf8');
    const lines = raw.split('\n').map(l => l.replace(/\r$/, '')).filter(l => l && !/^\s*@@/.test(l));
    const total = lines.length;
    const BATCH = 20;
    const rawConn = (client as any).conn;

    process.stdout.write(`  Installing ${total} commands…\n`);

    for (let i = 0; i < lines.length; i += BATCH) {
        const batch = lines.slice(i, i + BATCH);
        for (let j = 0; j < batch.length - 1; j++) {
            rawConn.send(batch[j]);
            await new Promise(r => setTimeout(r, 20));
        }
        await client.command(batch[batch.length - 1], 30000);
    }
    console.log(`  Install done.`);
}

async function main() {
    console.log(redactPassword(`\nStarting dev container: ${IMAGE}`, PASS));
    const container = RhostContainer.fromImage(IMAGE);
    const { host, port } = await container.start();

    const wizClient = new RhostClient({ host, port, paceMs: 15, timeout: 60000 });
    try {
        await wizClient.connect();
        await wizClient.login('Wizard', PASS);
        await wizClient.command('@set me=SIDEFX');
        await wizClient.command('@wipe #1/CRON*');

        if (!NO_INSTALL) {
            if (!fs.existsSync(INSTALLER)) {
                console.error(`dist/installer.txt not found — run \`npm run build\` first.`);
                await container.stop();
                process.exit(1);
            }
            await deployInstaller(wizClient, INSTALLER);
        }

        // Create a persistent dev test account
        await wizClient.command(`@pcreate ${TEST_ACCT}=${TEST_ACCT_PASS}`);
        const dbref = (await wizClient.eval(`search(name=${TEST_ACCT})`)).trim().match(/#\d+/)?.[0];
        if (dbref) {
            await wizClient.command(`@set ${dbref}=WIZARD`);
            await wizClient.command(`@set ${dbref}=ROYALTY`);
            await wizClient.command(`@set ${dbref}=SIDEFX`);
        }
        await wizClient.disconnect();
    } catch (err: any) {
        console.error(`Setup failed: ${err.message}`);
        await container.stop();
        process.exit(1);
    }

    // Write .env.local for watch mode to pick up
    const envContent = [
        `RHOST_HOST=${host}`,
        `RHOST_PORT=${port}`,
        `RHOST_USER=${TEST_ACCT}`,
        `RHOST_PASS=${TEST_ACCT_PASS}`,
    ].join('\n') + '\n';
    fs.writeFileSync(ENV_LOCAL, envContent, 'utf8');

    // Print connection details clearly
    console.log(`
╔══════════════════════════════════════════════════════╗
║  Dev container ready                                 ║
╠══════════════════════════════════════════════════════╣
║  Host : ${host.padEnd(44)}║
║  Port : ${String(port).padEnd(44)}║
║  User : ${TEST_ACCT.padEnd(44)}║
╠══════════════════════════════════════════════════════╣
║  In a second terminal, run:                          ║
║    npx rhost-testkit watch                           ║
║    npx rhost-testkit watch tests/chargen.test.ts     ║
╚══════════════════════════════════════════════════════╝
`);
    console.log('  Connection info written to .env.local');
    console.log('  Press Ctrl+C to stop the container.\n');

    // Keep alive until Ctrl+C
    await new Promise<void>((resolve) => {
        process.on('SIGINT', () => resolve());
        process.on('SIGTERM', () => resolve());
    });

    console.log('\nStopping container…');
    await container.stop().catch(() => {});
    fs.rmSync(ENV_LOCAL, { force: true });
    console.log('Done.');
}

main().catch(err => { console.error(err); process.exit(2); });
