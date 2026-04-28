/**
 * RhostMUSH project showcase — persistent session runner.
 *
 * Sections are defined as JSON files in showcases/ and registered in
 * mush.json under "showcases". No TypeScript required for new sections.
 *
 * Usage:
 *   npx ts-node tools/showcase.ts [options] [section ...]
 *
 * Options:
 *   --spin          Start a fresh Docker container (default: connect to existing)
 *   --deploy        Deploy the installer first (default: on with --spin, off otherwise)
 *   --no-deploy     Skip installer even with --spin
 *   --installer N   Deploy installer by name instead of the first one (default: first)
 *   --host  HOST    MUSH host       (default: $RHOST_HOST or localhost)
 *   --port  PORT    MUSH port       (default: $RHOST_PORT or 4201)
 *   --pass  PASS    Wizard password (default: $RHOST_PASS or changeme)
 *   --list          Print available sections and exit (no connection needed)
 *
 * Examples:
 *   npx ts-node tools/showcase.ts              # interactive menu
 *   npx ts-node tools/showcase.ts hello-world  # run one section, then menu
 *   npx ts-node tools/showcase.ts --spin --deploy
 *   npx ts-node tools/showcase.ts --list
 */

import { RhostClient, RhostContainer } from '@rhost/testkit';
import * as fs       from 'fs';
import * as path     from 'path';
import * as readline from 'readline';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Ctx {
  wiz:    RhostClient;
  player: string;  // ShowcasePlayer dbref
  vars:   Record<string, string>;  // resolved vars from showcase files
}

interface ShowcaseStep {
  reset?:    boolean;  // wipe all _* attrs on the showcase player
  sub?:      string;   // print a sub-heading
  cmd?:      string;   // print an informational line
  eval?:     string;   // run wiz.eval() and print result; {{token}} interpolated
  label?:    string;   // display label for eval/command steps
  store?:    string;   // store eval result into vars under this key (no output)
  command?:  string;   // run wiz.command() and print result
  set_stats?: string;  // "STAT:val STAT:val ..." — sets &_CG_STAT_<STAT> attrs
}

interface ShowcaseEntry {
  key:   string;
  label: string;
  vars?: Record<string, string>;  // search() exprs resolved to dbrefs at startup
  steps: ShowcaseStep[];
}

type ShowcaseRef = ShowcaseEntry | { file: string };

interface InstallerConfig {
  name: string;
  out:  string;
}

interface MushJson {
  name:        string;
  showcases?:  ShowcaseRef[];
  installers?: InstallerConfig[];
}

// ---------------------------------------------------------------------------
// Load config (available before connect, used for --list)
// ---------------------------------------------------------------------------

const ROOT     = path.join(__dirname, '..');
const mushJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'mush.json'), 'utf8')) as MushJson;

function loadEntry(ref: ShowcaseRef): ShowcaseEntry {
  return 'file' in ref
    ? JSON.parse(fs.readFileSync(path.join(ROOT, ref.file), 'utf8')) as ShowcaseEntry
    : ref;
}

const ALL_ENTRIES: ShowcaseEntry[] = (mushJson.showcases ?? []).map(loadEntry);

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

const HEAVY = '═'.repeat(70);
const THIN  = '─'.repeat(70);

function hdr(n: number, total: number, label: string) {
  console.log('\n' + HEAVY);
  console.log(`  [${n}/${total}]  ${label}`);
  console.log(HEAVY);
}

function sub(label: string) { console.log(`\n  · ${label}`); }
function cmd(label: string) { console.log(`\n  >>> ${label}`); }

function show(raw: string | string[]) {
  const lines = Array.isArray(raw) ? raw : raw.split('\n');
  for (const l of lines) {
    if (/CRON_JOB_TIMECLOCK/i.test(l)) continue;
    console.log('      ' + l);
  }
}

// ---------------------------------------------------------------------------
// Shared step helpers
// ---------------------------------------------------------------------------

async function ev(ctx: Ctx, label: string, expr: string) {
  cmd(label);
  show(await ctx.wiz.eval(expr));
}

async function resetPlayer(ctx: Ctx) {
  const hiddenAttrs = (await ctx.wiz.eval(`lattr(${ctx.player}/_*)`)).trim();
  if (hiddenAttrs) {
    await ctx.wiz.eval(
      `null(iter(lattr(${ctx.player}/_*),set(${ctx.player},##:)))`
    );
  }
}

async function setAllStats(ctx: Ctx,
    vals = 'INT:6 REF:7 DEX:7 TECH:4 COOL:6 WILL:6 LUCK:6 MOVE:6 BODY:7 EMP:7') {
  for (const pair of vals.split(' ')) {
    const [stat, val] = pair.split(':');
    if (stat && val !== undefined) {
      await ctx.wiz.command(`&_CG_STAT_${stat} ${ctx.player}=${val}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Section builder
// ---------------------------------------------------------------------------

function buildSection(entry: ShowcaseEntry, entryVars: Record<string, string>): (ctx: Ctx) => Promise<void> {
  return async (ctx: Ctx) => {
    const merged = { ...ctx.vars, ...entryVars };
    const interp = (s: string) => s
      .replace(/\{\{player\}\}/g, ctx.player)
      .replace(/\{\{(\w+)\}\}/g,  (_, k) => merged[k] ?? `{{${k}}}`);

    for (const step of entry.steps) {
      if (step.reset) {
        await resetPlayer(ctx);
      } else if (step.set_stats !== undefined) {
        await setAllStats(ctx, step.set_stats || undefined);
      } else if (step.sub) {
        sub(step.sub);
      } else if (step.cmd) {
        cmd(step.cmd);
      } else if (step.eval) {
        const expr   = interp(step.eval);
        const result = (await ctx.wiz.eval(expr)).trim();
        if (step.store) {
          merged[step.store] = result.match(/#\d+/)?.[0] ?? result;
        } else {
          const label = step.label ? interp(step.label) : expr.slice(0, 60);
          cmd(label);
          show(result);
        }
      } else if (step.command) {
        const c     = interp(step.command);
        const label = step.label ? interp(step.label) : c.slice(0, 60);
        cmd(label);
        show(await ctx.wiz.command(c));
      }
    }
  };
}

// ---------------------------------------------------------------------------
// Interactive menu
// ---------------------------------------------------------------------------

function rlPrompt(rl: readline.Interface, question: string): Promise<string> {
  return new Promise(resolve => rl.question(question, resolve));
}

async function interactiveMenu(
    rl: readline.Interface,
    sections: Array<{ key: string; label: string }>,
): Promise<string[] | null> {
  console.log('\n' + HEAVY);
  console.log(`  ${mushJson.name} — Showcase`);
  console.log(HEAVY);
  console.log('\n  Available sections:\n');
  sections.forEach(({ key, label }, i) => {
    const n = String(i + 1).padStart(2);
    console.log(`  ${n}.  ${key.padEnd(14)}  ${label}`);
  });
  console.log('\n' + THIN);
  console.log('  Enter section numbers (comma/space), ranges (1-5), key names,');
  console.log('  "all" to run everything, or "q" to quit.');
  console.log(THIN);

  while (true) {
    const raw = (await rlPrompt(rl, '\n  Your choice: ')).trim().toLowerCase();

    if (raw === 'q' || raw === 'quit' || raw === 'exit') return null;
    if (raw === 'all' || raw === 'a') return sections.map(s => s.key);

    const tokens = raw.split(/[\s,]+/).filter(Boolean);
    const keys: string[] = [];
    let invalid = false;

    for (const tok of tokens) {
      const rangeMatch = tok.match(/^(\d+)-(\d+)$/);
      if (rangeMatch) {
        const lo = parseInt(rangeMatch[1], 10);
        const hi = parseInt(rangeMatch[2], 10);
        for (let n = lo; n <= hi; n++) {
          if (n < 1 || n > sections.length) { console.log(`  ! "${tok}" out of range`); invalid = true; break; }
          keys.push(sections[n - 1].key);
        }
      } else if (/^\d+$/.test(tok)) {
        const n = parseInt(tok, 10);
        if (n < 1 || n > sections.length) { console.log(`  ! "${tok}" out of range`); invalid = true; }
        else keys.push(sections[n - 1].key);
      } else {
        const sec = sections.find(s => s.key === tok);
        if (!sec) { console.log(`  ! Unknown section "${tok}"`); invalid = true; }
        else keys.push(sec.key);
      }
      if (invalid) break;
    }

    if (!invalid && keys.length > 0) return [...new Set(keys)];
    if (!invalid) console.log('  Please enter at least one section.');
  }
}

// ---------------------------------------------------------------------------
// Installer deploy
// ---------------------------------------------------------------------------

async function deployInstaller(client: RhostClient, installerName?: string) {
  const installers = mushJson.installers ?? [];
  const installer  = installerName
    ? installers.find(i => i.name === installerName)
    : installers[0];

  if (!installer) {
    throw new Error(
      installerName
        ? `No installer named "${installerName}" in mush.json.`
        : 'No installers defined in mush.json.'
    );
  }

  const file    = path.resolve(ROOT, installer.out);
  const raw     = fs.readFileSync(file, 'utf8');
  const lines   = raw.split('\n').map(l => l.replace(/\r$/, '')).filter(l => l && !/^\s*@@/.test(l));
  const total   = lines.length;
  const started = Date.now();
  const errors: string[] = [];

  console.log(`  Deploying "${installer.name}" — ${total} commands…`);
  const milestones = [25, 50, 75, 100]; let nextMs = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const out  = (await client.command(line)).join('\n');
    if (/^think\s/i.test(line)) {
      if (out.trim()) console.log(out);
    } else if (/#-1 |Permission denied|That attribute is not valid|No match|I don't see that|Huh\?/i.test(out)) {
      errors.push(`  line ${i + 1}: ${line.slice(0, 60)}…  → ${out.split('\n')[0]}`);
    }
    const pct = Math.floor(((i + 1) / total) * 100);
    while (nextMs < milestones.length && pct >= milestones[nextMs]) {
      process.stdout.write(`  … ${milestones[nextMs]}%  (${((Date.now() - started) / 1000).toFixed(1)}s)\n`);
      nextMs++;
    }
  }

  if (errors.length) {
    console.log(`  ! ${errors.length} error(s):`);
    errors.forEach(e => console.log(e));
  }
  console.log(`  Done in ${((Date.now() - started) / 1000).toFixed(1)}s — ${total - errors.length}/${total} ok.`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const argv = process.argv.slice(2);
  const flag = (f: string) => { const i = argv.indexOf(f); if (i >= 0) { argv.splice(i, 1); return true; } return false; };
  const opt  = (f: string, def: string) => {
    const i = argv.indexOf(f);
    if (i >= 0 && argv[i + 1]) { const v = argv[i + 1]; argv.splice(i, 2); return v; }
    return def;
  };

  // --list does not require a connection
  if (flag('--list')) {
    console.log(`\n${mushJson.name} — showcase sections:\n`);
    if (ALL_ENTRIES.length === 0) {
      console.log('  (no showcases defined — add entries to mush.json "showcases")');
    } else {
      ALL_ENTRIES.forEach(({ key, label }, i) =>
        console.log(`  ${String(i + 1).padStart(2)}.  ${key.padEnd(14)}  ${label}`)
      );
    }
    console.log('\nRun all:       npx ts-node tools/showcase.ts --spin --deploy');
    console.log('Run specific:  npx ts-node tools/showcase.ts <key> [<key>...]');
    console.log('Interactive:   npx ts-node tools/showcase.ts\n');
    return;
  }

  if (ALL_ENTRIES.length === 0) {
    console.error('No showcases defined. Add entries to mush.json "showcases" first.');
    console.error('See the README for the showcase JSON format.');
    process.exit(1);
  }

  const spin           = flag('--spin');
  const noDeployF      = flag('--no-deploy');
  const deployF        = flag('--deploy');
  const installerName  = opt('--installer', '');
  const host           = opt('--host', process.env.RHOST_HOST || 'localhost');
  const port           = parseInt(opt('--port', process.env.RHOST_PORT || '4201'), 10);
  const pass           = opt('--pass', process.env.RHOST_PASS || 'changeme');
  const doDeploy       = noDeployF ? false : (deployF || spin);
  const cliKeys        = argv.filter(a => !a.startsWith('-'));

  let container: { start(): Promise<{ host: string; port: number }>; stop(): Promise<void> } | null = null;
  let connHost = host, connPort = port;

  if (spin) {
    const image = process.env.RHOST_IMAGE || 'lcanady/rhostmush:latest';
    console.log(`\nSpinning up container from ${image}…`);
    container = RhostContainer.fromImage(image, {});
    ({ host: connHost, port: connPort } = await container.start());
    console.log(`Container up at ${connHost}:${connPort}`);
  } else {
    console.log(`\nConnecting to ${connHost}:${connPort}…`);
  }

  const wiz = new RhostClient({ host: connHost, port: connPort, paceMs: 20, commandSettleMs: 50, stripAnsi: false });
  await wiz.connect();
  await wiz.login('Wizard', pass);
  await wiz.command('@set me=SIDEFX');
  console.log('Connected as Wizard.');

  try {
    if (doDeploy) {
      console.log('\nDeploying installer…');
      await deployInstaller(wiz, installerName || undefined);
    }

    // Resolve all vars declared across all showcase files (cached, de-duped)
    const resolvedVarsCache: Record<string, string> = {};

    async function resolveVars(varDefs: Record<string, string>): Promise<Record<string, string>> {
      for (const [name, expr] of Object.entries(varDefs)) {
        if (!(name in resolvedVarsCache)) {
          const val = (await wiz.eval(expr)).trim().match(/#\d+/)?.[0] ?? '';
          if (!val) console.log(`  ! showcase var "${name}" not found — is the installer loaded?`);
          resolvedVarsCache[name] = val;
        }
      }
      return { ...resolvedVarsCache };
    }

    const sections: Array<{ key: string; label: string; fn: (ctx: Ctx) => Promise<void> }> = [];
    for (const entry of ALL_ENTRIES) {
      const entryVars = await resolveVars(entry.vars ?? {});
      sections.push({ key: entry.key, label: entry.label, fn: buildSection(entry, entryVars) });
    }

    // Create (or replace) showcase player
    const existing = (await wiz.eval('search(name=ShowcasePlayer)')).trim();
    if (existing.startsWith('#') && !existing.startsWith('#-1')) {
      await wiz.command(`@destroy ${existing}`);
    }
    await wiz.command('@create ShowcasePlayer');
    const player = ((await wiz.eval('search(name=ShowcasePlayer)')).trim().match(/#\d+/) ?? [])[0] ?? '';
    if (!player) throw new Error('Could not create ShowcasePlayer');
    console.log(`\nShowcase player: ${player}`);
    if (Object.keys(resolvedVarsCache).length > 0) {
      for (const [k, v] of Object.entries(resolvedVarsCache)) {
        console.log(`  ${k}: ${v || '(not found)'}`);
      }
    }

    const ctx: Ctx = { wiz, player, vars: resolvedVarsCache };

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    let firstRun = cliKeys.length > 0 ? cliKeys : null;

    while (true) {
      let selectedKeys: string[];

      if (firstRun) {
        const bad = firstRun.filter(k => !sections.some(s => s.key === k));
        if (bad.length) {
          console.error(`Unknown section(s): ${bad.join(', ')}\nRun --list to see available sections.`);
          process.exit(1);
        }
        selectedKeys = firstRun;
        firstRun = null;
      } else {
        const result = await interactiveMenu(rl, sections);
        if (result === null) break;
        selectedKeys = result;
      }

      const queue = sections.filter(s => selectedKeys.includes(s.key));
      console.log(`\nRunning: ${queue.map(s => s.key).join('  ')}\n`);

      let passed = 0, failed = 0;
      for (let i = 0; i < queue.length; i++) {
        const sec = queue[i];
        hdr(i + 1, queue.length, `${sec.key.toUpperCase()}  —  ${sec.label}`);
        try {
          await sec.fn(ctx);
          passed++;
        } catch (err) {
          console.error(`  ! section "${sec.key}" threw:`, err);
          failed++;
        }
      }

      console.log(`\n${HEAVY}`);
      console.log(`  Done — ${passed}/${queue.length} ok${failed ? `  (${failed} failed)` : ''}.`);
      console.log(HEAVY);

      if (spin && !process.stdin.isTTY) break;

      await rlPrompt(rl, '\n  Press Enter to return to the menu...');
    }

    rl.close();
    console.log('\nGoodbye.\n');

  } finally {
    await wiz.disconnect().catch(() => {});
    if (container) await container.stop().catch(() => {});
  }
}

main().catch(err => { console.error(err); process.exit(1); });
