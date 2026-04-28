# rhost-template

A batteries-included project template for building RhostMUSH softcode systems.
Provides a compiler, Docker-based test runner, and CLAUDE.md conventions so every
new RhostMUSH project starts with the same structure.

---

## Requirements

- Node.js 20+
- npm
- Docker (for `npm test`)
- [Claude Code](https://claude.ai/code) with [mush-skills](https://github.com/lcanady/mush-skills) installed

---

## Quick Start

```bash
# 1. Install Claude Code skills (once per machine)
git clone https://github.com/lcanady/mush-skills ~/.claude/skills/mush-skills-repo
cd ~/.claude/skills/mush-skills-repo && ./install.sh
# Restart Claude Code

# 2. Use this template on GitHub → "Use this template" button
#    or copy locally:
cp -r rhost-template my-new-game
cd my-new-game

# 3. Install Node dependencies
npm install

# 4. Configure environment
cp .env.example .env
# Edit .env with your server details (only needed for manual installs)

# 5. Build the installer
npm run build
# → writes dist/installer.txt

# 6. Run tests (requires Docker)
npm test
```

---

## Project Structure

```
my-project/
├── src/                    # Softcode source (.mush files)
│   └── system/             # Core system files
│       ├── config.mush     # Object creation — ALWAYS runs first
│       └── udfs-core.mush  # Core UDFs
├── showcases/              # Showcase JSON files (one per feature demo)
│   └── example.json        # Copy this to add a new showcase section
├── tests/                  # TypeScript test suites (@rhost/testkit)
│   ├── run.ts              # Master test runner (Docker + wave execution)
│   ├── helpers.ts          # Shared helpers (createThing, createRoom, etc.)
│   └── example.test.ts     # Starter suite — copy to add new tests
├── tools/                  # Build tooling
│   ├── build.ts            # Compiles .mush → dist/installer.txt
│   ├── showcase.ts         # Interactive showcase runner
│   ├── header.js           # Installer header (think/ansi lines)
│   └── post.js             # Installer footer
├── dist/                   # Compiled output (gitignored)
│   └── installer.txt       # Paste this into RhostMUSH as Wizard
├── db/                     # SQLite databases if needed (gitignored)
├── scripts/                # Shell helpers
├── resources/              # Reference PDFs/rulebooks (gitignored)
├── .env                    # Local credentials (never commit)
├── .env.example            # Committed env template
├── CLAUDE.md               # Claude Code instructions for this project
├── mush.json               # Softcode package manifest
├── package.json
└── tsconfig.json
```

---

## Package Registry

This template is registry-ready. `mush.json` is the softcode equivalent of
`package.json` — it declares your package's identity, namespace, and dependencies
on other softcode packages.

### mush.json

```json
{
  "name": "@mushpkg/my-project",
  "version": "1.0.0",
  "main": "dist/installer.txt",
  "namespace": "cg",
  "server": "rhostmush",
  "dependencies": {
    "@mushpkg/bbs": "^1.3.0",
    "@mushpkg/jobs": "github:lcanady/mush-jobs@v2.0.0"
  },
  "registry": "https://registry.mushpkg.dev"
}
```

### Installing dependencies

```bash
npm run mush:install
```

Fetches each entry in `mush.json → dependencies` into `deps/` and writes
`mush-lock.json` with pinned versions and SHA-256 checksums. Commit `mush-lock.json`;
`deps/` is gitignored (re-fetch after a fresh clone).

Supported version specifiers:

| Format | Example |
|---|---|
| Semver (registry) | `"^1.3.0"` |
| GitHub release | `"github:owner/repo@v2.0.0"` |
| Local path | `"file:../local-pkg"` |

---

## Build

```bash
npm run mush:install   # fetch deps first (if any)
npm run build
```

Compiles all `.mush` files listed in `mush.json → installers[].manifest` into a single
`dist/installer.txt`. Multiple named installers are supported — use `--only <name>` to
build one:

```bash
npm run build -- --only main
npm run build -- --list        # print installer names
```

Dependency installers are automatically prepended before your own source files.

The compiler:
- Collapses indented continuation lines into single-line commands
- Strips blank lines
- Passes `@@` comments and `think` lines through as-is
- Executes `.js` / `.ts` helper scripts and appends their stdout

### Adding a new source file

1. Create `src/<system>/my-feature.mush`
2. Add `'<system>/my-feature.mush'` (or `'<system>/'` for all files in the dir) to
   the `manifest` array of the appropriate installer in `mush.json`
3. Run `npm run build`

---

## Showcase

The showcase runner lets you demo your softcode interactively against a live server —
no test fixtures, no assertions, just real output. Useful for demos, debugging visual
output, and end-to-end walkthroughs.

```bash
npm run showcase                     # interactive menu
npm run showcase -- --list           # list available sections (no connection)
npm run showcase -- my-section       # run one section, then menu
npm run showcase -- --spin --deploy  # spin Docker, deploy, then menu
```

### How it works

Each showcase section is a JSON file in `showcases/`. Register files in `mush.json`:

```json
{
  "showcases": [
    { "file": "showcases/hello-world.json" }
  ]
}
```

### Showcase file format

```json
{
  "key":   "hello-world",
  "label": "Hello world — basic UDF output",
  "vars": {
    "sys": "search(name=My System <tmpl.sys>)"
  },
  "steps": [
    { "sub": "Basic eval" },
    { "eval": "u({{sys}}/F.HELLO,{{player}})", "label": "+hello" },
    { "sub": "Command with stored result" },
    { "eval": "num(me)", "store": "wiz_dbref" },
    { "command": "think {{wiz_dbref}}", "label": "wiz dbref" },
    { "sub": "Reset player state" },
    { "reset": true }
  ]
}
```

### Step types

| Field | Purpose |
|---|---|
| `{ "sub": "text" }` | Print a sub-heading |
| `{ "cmd": "text" }` | Print an informational line |
| `{ "eval": "expr", "label": "..." }` | Run `wiz.eval(expr)` and show result |
| `{ "eval": "expr", "store": "key" }` | Eval and store result in vars (silent) |
| `{ "command": "cmd", "label": "..." }` | Run `wiz.command(cmd)` and show output |
| `{ "reset": true }` | Wipe all `_*` attrs on the showcase player |
| `{ "set_stats": "INT:6 REF:7 ..." }` | Set `_CG_STAT_*` attrs (chargen systems) |

### Template tokens

All `eval`, `command`, and `label` strings support `{{token}}` interpolation:

| Token | Value |
|---|---|
| `{{player}}` | ShowcasePlayer dbref |
| `{{key}}` | Any key declared in the file's `vars` block |
| `{{key}}` | Any key stored by a prior `store` step |

`vars` values are MUSH expressions evaluated at startup (e.g. `search(name=...)`).
The result's dbref is extracted automatically; the full result is kept if no dbref
is found (useful for non-dbref values).

### CLI options

| Flag | Purpose |
|---|---|
| `--spin` | Start a fresh Docker container |
| `--deploy` | Deploy the first installer before running |
| `--no-deploy` | Skip deploy even with `--spin` |
| `--installer NAME` | Deploy a specific named installer |
| `--host HOST` | MUSH host (default: `$RHOST_HOST` or `localhost`) |
| `--port PORT` | MUSH port (default: `$RHOST_PORT` or `4201`) |
| `--pass PASS` | Wizard password (default: `$RHOST_PASS` or `changeme`) |
| `--list` | Print sections and exit, no connection needed |

---

## Testing

```bash
npm test
```

The test runner (`tests/run.ts`):

1. Pulls `lcanady/rhostmush:latest` and starts a throwaway container
2. Logs in as Wizard, deploys `dist/installer.txt` in batches of 20 lines
3. Creates one MUSH account per parallel test slot (WIZARD + ROYALTY + SIDEFX)
4. Gives each account a private room (prevents connect/disconnect message bleed)
5. Runs test **waves** in order; suites within a wave run in parallel
6. Stops the container on pass or fail

### Test waves

Edit `WAVES` in `tests/run.ts` to control grouping and parallelism:

```typescript
const WAVES: string[][] = [
    // Wave 1 — fast unit tests (run in parallel)
    ['feature-a.test.ts', 'feature-b.test.ts'],
    // Wave 2 — integration tests (run after Wave 1 completes)
    ['workflow.test.ts'],
    // Wave 3 — heavy/queue-sensitive (run alone)
    ['e2e.test.ts'],
];
```

### Writing a test suite

Copy `tests/example.test.ts` and adapt:

```typescript
import { RhostRunner } from '@rhost/testkit';
import { createThing } from './helpers';

const runner = new RhostRunner();
let sysObj: string;

runner.describe('My Feature', ({ it, beforeAll }) => {

    beforeAll(async ({ client }) => {
        // Always look up by name — never hardcode dbrefs
        sysObj = (await client.eval('search(name=My System <sys>)')).trim();
    });

    it('F.MY.FUNC returns expected value', async ({ expect }) => {
        await expect(`u(${sysObj}/F.MY.FUNC,arg)`).toBe('expected');
    });

});

runner.run({
    host:     process.env.RHOST_HOST || 'localhost',
    port:     parseInt(process.env.RHOST_PORT || '4201', 10),
    username: process.env.RHOST_USER || 'Wizard',
    password: process.env.RHOST_PASS || '',
}).then(r => process.exit(r.failed > 0 ? 1 : 0))
  .catch(err => { console.error(err); process.exit(1); });
```

---

## Softcode Conventions

### Object naming and namespaces

Set a `namespace` in `mush.json`. Objects use `<ns.tag>` format:

```mush
@@ mush.json: { "namespace": "cg" }
@create Chargen System <cg.sys>
@create Chargen Data   <cg.data>
```

Look up in tests with: `search(name=Chargen System <cg.sys>)`

The `<ns.tag>` convention prevents name collisions between packages on the same server.

### Attribute naming

| Pattern | Purpose |
|---|---|
| `F.VERB.NOUN` | User-defined functions |
| `CMD.VERB` | Command handlers (`$+cmd`) |
| `_COR_*` | Hidden internal state (wiz-only via `_` prefix) |
| `_<SYS>_*` | System-specific hidden state |

### `_` prefix = wiz-only hidden

In RhostMUSH, a `_` prefix makes an attribute invisible to non-wizard players.
Use it for all internal state that players should not read or set directly.

### Comments

- `@@` at line start = MUSH comment (safe anywhere)
- `/*` is only a comment when it appears at `^\s*/\*` (start of line)
- Never use `/*` mid-line or inside attribute values

---

## Manual Installation (no Docker)

```bash
npm run build
# Paste contents of dist/installer.txt into your RhostMUSH session as Wizard
# Then: @shutdown/reboot
```

---

## Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `RHOST_HOST` | `localhost` | Server hostname |
| `RHOST_PORT` | `4201` | Server port |
| `RHOST_USER` | `Wizard` | Login name |
| `RHOST_PASS` | `changeme` | Login password |
| `RHOST_IMAGE` | `lcanady/rhostmush:latest` | Docker image for tests |

Copy `.env.example` → `.env` and fill in values. Never commit `.env`.

---

## Claude Code Skills

| Skill | Use for |
|---|---|
| `/mush-build` | Writing new softcode |
| `/mush-test` | Writing `@rhost/testkit` tests |
| `/mush-lint` | Static analysis before build |
| `/mush-review` | Code review (logic, patterns) |
| `/mush-security` | Security audit |
| `/mush-coverage` | Find untested attributes |
| `/mush-simulate` | Trace execution without a server |
| `/mush-efficiency` | Optimize speed and attribute count |
| `/mush-explain` | Explain what softcode does |
| `/mush-docs` | Generate in-game help text |
| `/mush-deps` | Map attribute dependencies |
| `/mush-readme` | Regenerate this README |

---

## License

MIT
