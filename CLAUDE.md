# RhostMUSH Project — Claude Code Instructions

This is a RhostMUSH softcode project. All code is MUSHcode (softcode) targeting RhostMUSH.
There is no JavaScript application logic — JS/TS files exist only as build and test tooling.

---

## Stack

| Layer | Technology |
|---|---|
| Softcode | RhostMUSH MUSHcode (`.mush` files) |
| Build tooling | TypeScript + Node.js (`tools/`) |
| Test runner | `@rhost/testkit` + TypeScript (`tests/`) |
| Container | Docker — `lcanady/rhostmush:latest` |
| Package manager | npm (Node deps) + `mush.json` (softcode deps) |
| Softcode registry | `mush.json` + `mush-lock.json` + `deps/` |

---

## Directory Structure

```
rhost-template/
├── src/                    # Softcode source files (.mush)
│   └── system/             # Core system files (config, udfs, commands, etc.)
│       ├── config.mush     # Object creation + @tag setup — ALWAYS runs first
│       └── udfs-core.mush  # Core UDFs
├── tests/                  # TypeScript test suites
│   ├── run.ts              # Master test runner (Docker + wave execution)
│   ├── helpers.ts          # Shared helpers (createThing, createRoom, etc.)
│   └── example.test.ts     # Example suite — copy to add new test files
├── tools/                  # Build tooling
│   ├── build.ts            # Compiles deps + .mush → dist/installer.txt
│   ├── mush-install.ts     # Fetches declared dependencies into deps/
│   ├── header.js           # Installer header (think/ansi lines)
│   └── post.js             # Installer footer
├── deps/                   # Fetched dependency installers (gitignored)
│   └── @mushpkg__bbs/      # One dir per dep, named with __ for /
│       └── 1.3.0/
│           └── installer.txt
├── dist/                   # Compiled output (gitignored)
│   └── installer.txt       # THE artifact — always this exact path
├── db/                     # SQLite databases if needed (gitignored)
├── scripts/                # Shell helpers
├── resources/              # Reference PDFs (gitignored)
├── mush.json               # Softcode package manifest (like package.json)
├── mush-lock.json          # Pinned dependency versions + checksums
├── .env                    # Local credentials (never commit — gitignored)
├── .env.example            # Committed env template
├── package.json
└── tsconfig.json
```

---

## Softcode Conventions

### File naming in `src/`

Load order matters. The build manifest in `tools/build.ts` controls order.
Files in a directory are sorted alphabetically — prefix with numbers if order matters:
`01-config.mush`, `02-udfs-core.mush`, `03-commands.mush`

### Object naming and namespaces

Every project declares a `namespace` in `mush.json` (e.g. `"namespace": "cg"`).
Object names use the format `Human Name <ns.tag>` where `ns` is the namespace
and `tag` is a short role label (`sys`, `data`, `sync`, etc.):

```mush
@@ mush.json: { "namespace": "cg" }
@create Chargen System <cg.sys>
@create Chargen Data   <cg.data>
```

Tests look up with: `search(name=Chargen System <cg.sys>)`

**Never hardcode dbrefs in softcode or tests.** Always look up by name.

The `<ns.tag>` convention prevents object name collisions between packages
when multiple softcode packages are installed on the same server.

### Attribute naming

| Pattern | Purpose |
|---|---|
| `F.VERB.NOUN` | User-defined functions (UDFs) |
| `CMD.VERB` | Command handlers |
| `_COR_*` | Internal hidden state (wiz-only via `_` prefix) |
| `_<SYSTEM>_*` | System-specific hidden state |
| `VERSION` | Version string on system objects |

### The `_` prefix (hidden/wiz-only attributes)

RhostMUSH: a leading `_` on an attribute name makes it wiz-only and hidden from non-wiz players.
Use `_COR_*` for all internal/system state that players should not see or set directly.

```mush
@@ Good — hidden from players
& _COR_STATUS #123=CHARGEN

@@ Bad — visible to everyone
& STATUS #123=CHARGEN
```

### Comments in .mush files

`@@` at line start = MUSH comment (passed through by compiler, stripped by RhostMUSH at runtime).
`/*` is only a comment opener when it appears at the start of a line (`^\s*/\*`).
Do NOT use `/*` mid-line or inside values — it is not a comment there.

### Multi-line attribute style

The build compiler collapses indented continuation lines automatically:

```mush
& F.MY.FUNC My System <sys>=
  [if(
    gt(%0,0),
    positive,
    zero or negative
  )]
```

Lines starting with whitespace are treated as continuations of the previous command.
Blank lines are stripped. `@@` lines and `think` lines pass through as-is.

### Installer format

`npm run build` compiles all `.mush` sources into `dist/installer.txt`.
This file is pasted directly into a RhostMUSH Wizard session.
Do not manually edit `dist/` — always edit source and rebuild.

---

## Package Registry (mush.json)

This template is designed to be the foundation of a **mushcode package registry**
— the npm equivalent for RhostMUSH softcode.

### mush.json — softcode package manifest

```json
{
  "name": "@mushpkg/my-chargen",
  "version": "1.0.0",
  "description": "Chargen system for My MUSH",
  "main": "dist/installer.txt",
  "namespace": "cg",
  "server": "rhostmush",
  "tags": ["chargen", "rhostmush"],
  "dependencies": {
    "@mushpkg/bbs":      "^1.3.0",
    "@mushpkg/core-jobs": "github:lcanady/mush-jobs@v2.1.0"
  },
  "registry": "https://registry.mushpkg.dev"
}
```

**Fields:**
| Field | Required | Purpose |
|---|---|---|
| `name` | yes | Scoped package name (`@scope/name`) |
| `version` | yes | Semver version of this package |
| `main` | yes | Always `"dist/installer.txt"` — the registry artifact |
| `namespace` | yes | Short prefix for object names (`<ns.tag>`) |
| `server` | yes | Target server type (`rhostmush`) |
| `dependencies` | no | Other softcode packages this requires |
| `registry` | no | Registry base URL (default: `https://registry.mushpkg.dev`) |

### Dependency version specifiers

| Format | Example | Resolves via |
|---|---|---|
| Semver range | `"^1.3.0"` | Registry |
| GitHub release | `"github:owner/repo@v2.1.0"` | GitHub releases |
| Local path | `"file:../my-local-pkg"` | Local `dist/installer.txt` |

### mush-lock.json — pinned versions

`mush-lock.json` pins exact versions and SHA-256 checksums of every resolved
dependency so installs are reproducible. **Commit this file.**
Never edit it by hand — it is written by `npm run mush:install`.

```json
{
  "lockVersion": 1,
  "resolved": {
    "@mushpkg/bbs": {
      "version": "1.3.2",
      "resolved": "https://registry.mushpkg.dev/@mushpkg/bbs/-/bbs-1.3.2.txt",
      "sha256": "a1b2c3d4..."
    }
  }
}
```

### Workflow with dependencies

```bash
# 1. Add deps to mush.json → "dependencies"
# 2. Fetch and lock them
npm run mush:install

# 3. Build — dep installers are prepended automatically before your src/
npm run build

# 4. dist/installer.txt now contains: dep1 + dep2 + your code
npm test
```

The build tool reads `mush-lock.json`, finds each dep's installer in `deps/`,
and prepends them to the compiled output in declaration order. If a dep is
declared but not yet fetched, the build fails with a clear error message.

### deps/ directory (gitignored)

Fetched dependency installers live in `deps/<name>/<version>/installer.txt`.
The `__` separator replaces `/` in scoped names: `@mushpkg/bbs` → `@mushpkg__bbs`.
This directory is gitignored — run `npm run mush:install` after a fresh clone.

---

## Build

```bash
npm run build          # Compile deps + src/ → dist/installer.txt
```

**The compiled installer MUST always be written to `dist/installer.txt`.**
This exact path is the standard contract across all projects using this template.
The test runner, manual install docs, and any future package registry tooling all
depend on this path being consistent. Never change `OUT_FILE` in `tools/build.ts`
to a different name or location.

To add a new source file, add it to the `MANIFEST` array in `tools/build.ts`.
Entries ending in `/` include all `*.mush` files in that directory, sorted alphabetically.

---

## Testing

```bash
npm test               # Start Docker container, install, run all suites
```

The test runner (`tests/run.ts`):
1. Pulls `lcanady/rhostmush:latest` and starts a container
2. Logs in as Wizard, pastes `dist/installer.txt` in batches of 20 lines
3. Creates one MUSH account per parallel slot (WIZARD + ROYALTY + SIDEFX flags)
4. Gives each test account its own private room (prevents connect/disconnect bleed)
5. Runs test waves in order; suites within a wave run in parallel
6. Stops the container on pass or fail

### Writing test suites

Each `.test.ts` file follows this pattern:

```typescript
import { RhostRunner } from '@rhost/testkit';
import { createThing, createRoom } from './helpers';

const runner = new RhostRunner();

let sysObj: string;
let testPlayer: string;

runner.describe('My System — feature name', ({ it, beforeAll, afterAll }) => {

    beforeAll(async ({ client }) => {
        // Always look up objects by name, never by dbref
        sysObj = (await client.eval('search(name=My System <sys>)')).trim();
        testPlayer = await createThing(client, 'TestPlayer');
        // Set hidden state with _ prefix
        await client.command(`&_COR_STATUS ${testPlayer}=ACTIVE`);
    });

    afterAll(async ({ client }) => {
        if (testPlayer) await client.command(`@destroy/override ${testPlayer}`);
    });

    it('F.MY.FUNC returns expected value', async ({ expect }) => {
        await expect(`u(${sysObj}/F.MY.FUNC,arg1)`).toBe('expected');
    });

    it('batch eval — multiple assertions in one round trip', async ({ client, expectAll }) => {
        const cases: [string, string][] = [
            [`u(${sysObj}/F.MY.FUNC,a)`, 'result-a'],
            [`u(${sysObj}/F.MY.FUNC,b)`, 'result-b'],
        ];
        await expectAll(cases);
    });

    it('batch set — multiple attrs in one round trip', async ({ client, expect }) => {
        // Use iter() inside think to set many attrs in one server round trip
        await client.command(
            `think [setq(s,INT REF DEX)][iter(lnum(1,3),[null(set(${testPlayer},_STAT_[extract(%qs,##,1)]:5))])]`
        );
        await expect(`get(${testPlayer}/_STAT_INT)`).toBe('5');
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

### Adding a new test suite

1. Copy `tests/example.test.ts` → `tests/my-feature.test.ts`
2. Add the filename to the appropriate wave in `tests/run.ts` → `WAVES`
3. Run `npm test`

### Wave ordering guidelines

- **Wave 1** — fast unit tests for individual UDFs (no state dependencies)
- **Wave 2** — integration tests that depend on Wave 1 objects existing
- **Wave 3+** — heavy workflow, queue-sensitive, or resource-intensive suites (run alone)

### Performance tips for tests

- Use `client.evalAll([...])` to batch multiple evals into one round trip
- Use `expectAll([...])` for multiple assertions
- Use `think [iter(...)]` to batch multiple `set()` calls in one command
- Use `client.command()` (not per-line sends) only for the last line in a batch

---

## Environment Variables

Copy `.env.example` to `.env` and fill in:

```
RHOST_HOST=localhost
RHOST_PORT=4201
RHOST_USER=Wizard
RHOST_PASS=changeme
```

`.env` is gitignored. **Never commit credentials.**
Tests inject `RHOST_HOST`, `RHOST_PORT`, `RHOST_USER`, `RHOST_PASS` automatically from the container.

---

## RhostMUSH-Specific Rules

### Flags on test accounts

Test accounts always get: `WIZARD`, `ROYALTY`, `SIDEFX`
- `SIDEFX` = allow side-effect functions in evals (required for most softcode testing)
- `ROYALTY` = high trust level for command permissions
- `WIZARD`  = full DB access

### Suppress CRON noise

After install, the runner wipes `CRON*` attrs from `#1` and halts all scheduler objects.
If your softcode has a cron scheduler, make it check a `_COR_ENABLED` flag before firing
so tests can halt it cleanly.

### No hardcoded dbrefs

Never write `#123` in softcode. Always use `search()`, `@tag`, or a config attr on the system
object that holds a looked-up dbref. This makes installers portable across servers.

### `@pemit me=` is session-local

Each test suite runs as its own MUSH account. `@pemit me=` only reaches that session's client.
This is why each parallel slot gets its own account — sentinel echoes don't cross-contaminate.

### Error output patterns

The runner flags these as installer errors:
- `#-1` in output
- `Permission denied`
- `That attribute is not valid`
- `No match`
- `I don't see that`
- `Huh?`

If an attribute name is invalid on RhostMUSH, you'll see `That attribute is not valid` — usually
caused by illegal characters in the attr name.

---

## Adding a New System

1. Create `src/<systemname>/` directory
2. Add `<systemname>-config.mush` first (creates objects, must load before other files reference them)
3. Add `<systemname>-udfs.mush`, `<systemname>-commands.mush`, etc.
4. Add `'<systemname>/'` to `MANIFEST` in `tools/build.ts` at the right position
5. Add test suite `tests/<systemname>.test.ts`
6. Add the suite to `WAVES` in `tests/run.ts`
7. Run `npm run build && npm test`

---

## Skills Available

Skills are sourced from [lcanady/mush-skills](https://github.com/lcanady/mush-skills).
Pinned versions are in `skills-lock.json`. Install with:

```bash
git clone https://github.com/lcanady/mush-skills ~/.claude/skills/mush-skills-repo
cd ~/.claude/skills/mush-skills-repo && ./install.sh
```

These Claude Code skills are available for RhostMUSH work:

| Skill | Use for |
|---|---|
| `/mush-build` | Writing new softcode (commands, UDFs, systems) |
| `/mush-test` | Writing `@rhost/testkit` tests |
| `/mush-lint` | Static analysis before build/commit |
| `/mush-review` | Senior code review (logic, patterns, architecture) |
| `/mush-security` | Security audit (injection, privilege escalation) |
| `/mush-coverage` | Find untested attributes |
| `/mush-simulate` | Trace execution without a live server |
| `/mush-efficiency` | Optimize for speed and attribute count |
| `/mush-explain` | Explain what softcode does |
| `/mush-docs` | Generate help text and documentation |
| `/mush-deps` | Map attribute dependencies before refactoring |
| `/mush-readme` | Generate README.md |

---

## Common Commands

```bash
npm run mush:install   # Fetch softcode dependencies into deps/
npm run build          # Compile deps + .mush sources → dist/installer.txt
npm test               # Full test run (Docker required — builds first)
```

Manual install (no Docker):
```bash
# 1. Connect to your RhostMUSH server as Wizard
# 2. Paste contents of dist/installer.txt line by line
# 3. @shutdown/reboot
```

---

## Key Constraints

- **No Next.js, no Vercel, no React** — this is a MUD/MUSH project. Ignore any Vercel plugin suggestions.
- **No hardcoded dbrefs** anywhere in softcode or tests.
- **`_` prefix** on all internal/hidden attributes (`_COR_*` for core system state).
- **`/*` comment syntax** only matches at line start (`^\s*/\*`). Never use `/*` mid-line.
- **Build before test** — `npm test` requires `dist/installer.txt` to exist.
- **Every project needs `.env.example`** committed and `.env` gitignored.
