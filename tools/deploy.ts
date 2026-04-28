/**
 * Live deploy — installs dist/installer.txt onto a real (non-Docker) RhostMUSH
 * server using the same batched paste logic as the test runner.
 *
 * Connection is read from env vars (or .env):
 *   RHOST_HOST  RHOST_PORT  RHOST_USER  RHOST_PASS
 *
 * Usage:
 *   npm run deploy:live
 *   npm run deploy:live -- --dry-run        (parse + count commands, no connect)
 */

import * as fs   from 'fs';
import * as path from 'path';
import { RhostClient } from '@rhost/testkit';
import { redactPassword } from './env-utils';

const ROOT      = path.join(__dirname, '..');

// Load .env manually (no dotenv dep)
const envPath = path.join(ROOT, '.env');
if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
        const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
}

const INSTALLER = path.join(ROOT, 'dist', 'installer.txt');
const DRY_RUN   = process.argv.includes('--dry-run');

const HOST = process.env.RHOST_HOST || 'localhost';
const PORT = parseInt(process.env.RHOST_PORT || '4201', 10);
const USER = process.env.RHOST_USER || 'Wizard';
const PASS = process.env.RHOST_PASS || '';

async function deployInstaller(client: RhostClient, file: string): Promise<{ applied: number; errors: number }> {
    const raw   = fs.readFileSync(file, 'utf8');
    const lines = raw.split('\n').map(l => l.replace(/\r$/, '')).filter(l => l && !/^\s*@@/.test(l));
    const total = lines.length;
    const errors: string[] = [];
    const started = Date.now();
    const BATCH = 20;
    const rawConn = (client as any).conn;
    const milestones = [25, 50, 75, 100];
    let nextMs = 0;

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
        console.log(`  ⚠ ${errors.length} line(s) returned errors:`);
        for (const e of errors) console.log(e);
    }
    console.log(`  Done in ${elapsed}s — ${total - errors.length}/${total} ok.`);
    return { applied: total, errors: errors.length };
}

async function main() {
    if (!fs.existsSync(INSTALLER)) {
        console.error(`Installer not found: dist/installer.txt\nRun \`npm run build\` first.`);
        process.exit(1);
    }

    const raw   = fs.readFileSync(INSTALLER, 'utf8');
    const lines = raw.split('\n').filter(l => l.trim() && !/^\s*@@/.test(l));
    console.log(`\nInstaller: dist/installer.txt  (${lines.length} commands)`);

    if (DRY_RUN) {
        console.log('--dry-run: stopping before connect.');
        return;
    }

    if (!PASS) {
        console.error('RHOST_PASS is not set. Copy .env.example → .env and fill it in.');
        process.exit(1);
    }

    console.log(redactPassword(`Connecting to ${HOST}:${PORT} as ${USER}…`, PASS));
    const client = new RhostClient({ host: HOST, port: PORT, paceMs: 15, timeout: 60000 });

    try {
        await client.connect();
        await client.login(USER, PASS);
        console.log('Connected.\n');

        const { errors } = await deployInstaller(client, INSTALLER);

        await client.disconnect();

        if (errors > 0) {
            console.error(`\nDeploy completed with ${errors} error(s). Review output above.`);
            process.exit(1);
        }
        console.log('\nDeploy successful.');
    } catch (err: any) {
        console.error(`\nDeploy failed: ${err.message}`);
        await client.disconnect().catch(() => {});
        process.exit(1);
    }
}

main().catch(err => { console.error(err); process.exit(2); });
