/**
 * System scaffolder — generates boilerplate for a new softcode system.
 *
 * Usage:
 *   npm run new:system -- <name>
 *   npm run new:system -- <name> "Human Name"
 *
 * Examples:
 *   npm run new:system -- chargen
 *   npm run new:system -- combat "Combat System"
 *
 * Creates:
 *   src/<name>/config.mush       — @create + @tag
 *   src/<name>/udfs.mush         — UDF stubs
 *   src/<name>/commands.mush     — command handler stubs
 *   tests/<name>.test.ts         — test suite stub
 *
 * Updates:
 *   mush.json                    — adds "<name>/" to manifest
 *   tests/run.ts                 — adds "<name>.test.ts" to Wave 1
 */

import * as fs   from 'fs';
import * as path from 'path';

const ROOT  = path.join(__dirname, '..');
const SRC   = path.join(ROOT, 'src');
const TESTS = path.join(ROOT, 'tests');

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2).filter(a => !a.startsWith('-'));

if (args.length === 0) {
    console.error('Usage: npm run new:system -- <name> ["Human Name"]');
    console.error('  name       directory/namespace tag  e.g. chargen');
    console.error('  Human Name display name              e.g. "Chargen System"');
    process.exit(1);
}

const systemName = args[0].toLowerCase().replace(/[^a-z0-9-]/g, '-');
const humanName  = args[1] ?? (systemName.charAt(0).toUpperCase() + systemName.slice(1) + ' System');

// ---------------------------------------------------------------------------
// Read namespace from mush.json
// ---------------------------------------------------------------------------

interface MushJson {
    namespace?: string;
    installers?: Array<{ name: string; manifest: string[] }>;
}

const mushJsonPath = path.join(ROOT, 'mush.json');
const mushJson: MushJson = JSON.parse(fs.readFileSync(mushJsonPath, 'utf8'));
const ns = mushJson.namespace ?? 'pkg';
const tag = systemName.slice(0, 3);  // e.g. chargen → cha, combat → com

// ---------------------------------------------------------------------------
// Guard: already exists?
// ---------------------------------------------------------------------------

const sysDir = path.join(SRC, systemName);
if (fs.existsSync(sysDir)) {
    console.error(`src/${systemName}/ already exists. Aborting.`);
    process.exit(1);
}

// ---------------------------------------------------------------------------
// src/<name>/config.mush
// ---------------------------------------------------------------------------

const configMush = `\
@@ ============================================================================
@@ ${humanName} — config
@@ Creates objects and sets up @tags. This file loads first.
@@ ============================================================================

@create ${humanName} <${ns}.${tag}>
@set lastcreate(me,t)=INHERIT SAFE HALT

@@ Store a lookup tag for portable dbref resolution
@tag ${ns}.${tag}=lastcreate(me,t)
`;

// ---------------------------------------------------------------------------
// src/<name>/udfs.mush
// ---------------------------------------------------------------------------

const udfsMush = `\
@@ ============================================================================
@@ ${humanName} — user-defined functions (UDFs)
@@ ============================================================================

@@ Template: & F.VERB.NOUN [search(@tag/${ns}.${tag})]=<body>
@@
@@ & F.${tag.toUpperCase()}.EXAMPLE [search(@tag/${ns}.${tag})]=
@@   [if(
@@     gt(%0,0),
@@     positive,
@@     zero or negative
@@   )]
`;

// ---------------------------------------------------------------------------
// src/<name>/commands.mush
// ---------------------------------------------------------------------------

const commandsMush = `\
@@ ============================================================================
@@ ${humanName} — commands
@@ ============================================================================

@@ Template: & CMD.VERB [search(@tag/${ns}.${tag})]=<body>
@@
@@ & CMD.STATUS [search(@tag/${ns}.${tag})]=$+${systemName}/status:
@@   @pemit %#=Status: [u(me/F.${tag.toUpperCase()}.STATUS,%#)]
`;

// ---------------------------------------------------------------------------
// tests/<name>.test.ts
// ---------------------------------------------------------------------------

const testTs = `\
import { RhostRunner } from '@rhost/testkit';
import { createThing } from './helpers';

const runner = new RhostRunner();

let sysObj: string;
let testObj: string;

runner.describe('${humanName}', ({ it, beforeAll, afterAll }) => {

    beforeAll(async ({ client }) => {
        sysObj = (await client.eval('search(name=${humanName} <${ns}.${tag}>)')).trim();
        if (!sysObj || sysObj.startsWith('#-1')) {
            throw new Error('${humanName} not found — did the installer run?');
        }
        testObj = await createThing(client, '${humanName}TestObj');
    });

    afterAll(async ({ client }) => {
        if (testObj) await client.command(\`@destroy/override \${testObj}\`);
    });

    it('system object exists', async ({ expect }) => {
        await expect(\`type(\${sysObj})\`).toBe('THING');
    });

    // Add tests here:
    // it('F.${tag.toUpperCase()}.EXAMPLE returns expected value', async ({ expect }) => {
    //     await expect(\`u(\${sysObj}/F.${tag.toUpperCase()}.EXAMPLE,5)\`).toBe('positive');
    // });

});

runner.run({
    host:     process.env.RHOST_HOST || 'localhost',
    port:     parseInt(process.env.RHOST_PORT || '4201', 10),
    username: process.env.RHOST_USER || 'Wizard',
    password: process.env.RHOST_PASS || '',
}).then(r => process.exit(r.failed > 0 ? 1 : 0))
  .catch(err => { console.error(err); process.exit(1); });
`;

// ---------------------------------------------------------------------------
// Write files
// ---------------------------------------------------------------------------

fs.mkdirSync(sysDir, { recursive: true });

const files: [string, string][] = [
    [path.join(sysDir, 'config.mush'),    configMush],
    [path.join(sysDir, 'udfs.mush'),      udfsMush],
    [path.join(sysDir, 'commands.mush'),  commandsMush],
    [path.join(TESTS, `${systemName}.test.ts`), testTs],
];

for (const [filePath, content] of files) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`  created  ${path.relative(ROOT, filePath)}`);
}

// ---------------------------------------------------------------------------
// Update mush.json manifest
// ---------------------------------------------------------------------------

const mainInstaller = mushJson.installers?.find(i => i.name === 'main');
if (mainInstaller) {
    // Insert before post.js (last entry) if present, else append
    const manifest = mainInstaller.manifest;
    const postIdx  = manifest.findIndex(e => e === 'post.js' || e === 'post.ts');
    const entry    = `${systemName}/`;
    if (!manifest.includes(entry)) {
        if (postIdx >= 0) manifest.splice(postIdx, 0, entry);
        else manifest.push(entry);
        fs.writeFileSync(mushJsonPath, JSON.stringify(mushJson, null, 2) + '\n', 'utf8');
        console.log(`  updated  mush.json  (added "${entry}" to manifest)`);
    }
}

// ---------------------------------------------------------------------------
// Update tests/run.ts WAVES
// ---------------------------------------------------------------------------

const runTsPath = path.join(TESTS, 'run.ts');
const runTs     = fs.readFileSync(runTsPath, 'utf8');
const testFile  = `${systemName}.test.ts`;

if (!runTs.includes(testFile)) {
    // Append to Wave 1 array: find the first '['  inside WAVES and add the entry
    const updated = runTs.replace(
        /(const WAVES[^=]*=\s*\[[\s\S]*?\/\/ Wave 1[^\[]*\[)([^\]]*)\]/,
        (_, before, inside) => {
            const trimmed = inside.trimEnd();
            const comma   = trimmed.trimEnd().endsWith(',') || trimmed.trim() === '' ? '' : ',';
            return `${before}${trimmed}${comma}\n        '${testFile}'\n    ]`;
        }
    );
    if (updated !== runTs) {
        fs.writeFileSync(runTsPath, updated, 'utf8');
        console.log(`  updated  tests/run.ts  (added "${testFile}" to Wave 1)`);
    } else {
        console.log(`  skipped  tests/run.ts  (could not find Wave 1 — add "${testFile}" manually)`);
    }
}

console.log(`
Done. Next steps:
  1. Edit src/${systemName}/config.mush   — adjust @create / @tag names
  2. Edit src/${systemName}/udfs.mush     — add UDFs
  3. Edit tests/${systemName}.test.ts     — add test cases
  4. npm run build && npm run test:focus -- ${systemName}.test.ts
`);
