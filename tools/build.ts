import * as fs                from 'fs';
import * as path              from 'path';
import { execFileSync }       from 'child_process';
import { validateManifestEntry } from './validate';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const ROOT    = path.join(__dirname, '..');
const SRC     = path.join(ROOT, 'src');
const TOOLS   = __dirname;
const DIST    = path.join(ROOT, 'dist');
const DEPS    = path.join(ROOT, 'deps');

// ---------------------------------------------------------------------------
// Package manifests
// ---------------------------------------------------------------------------

interface MushJson {
  name: string;
  version: string;
  namespace?: string;
  dependencies?: Record<string, string>;
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

const pkg      = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))  as { name: string; version: string };
const mushJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'mush.json'), 'utf8'))     as MushJson;
const lockFile = JSON.parse(fs.readFileSync(path.join(ROOT, 'mush-lock.json'), 'utf8')) as LockFile;

// ---------------------------------------------------------------------------
// Build manifest — ordered list of THIS project's source files.
//
//   "file.mush"   single softcode file compiled to single-line commands
//   "dir/"        all *.mush files in src/dir/, sorted alphabetically, compiled
//   "script.ts"   executed via ts-node; stdout appended as-is
//   "script.js"   executed via node; stdout appended as-is
//
// Dependency installers are automatically prepended BEFORE this manifest
// based on mush.json → "dependencies" and mush-lock.json resolution.
// Run `npm run mush:install` to fetch deps into deps/ before building.
// ---------------------------------------------------------------------------

const MANIFEST: string[] = [
  'header.js',
  'system/',   // src/system/*.mush in alpha order
  'post.js',
];

// The output file MUST always be dist/installer.txt.
// This path is the standard contract across all projects using this template
// and is required by the package registry and test runner.
const OUT_FILE = 'installer.txt';

// ---------------------------------------------------------------------------
// Compiler — collapses pretty-printed multi-line attrs to installer format.
// ---------------------------------------------------------------------------

function compileMush(source: string): string {
  const out: string[] = [];
  let pending: string | null = null;

  const flush = () => {
    if (pending !== null) { out.push(pending); pending = null; }
  };

  for (const raw of source.split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;

    if (/^\s/.test(line)) {
      if (pending !== null) pending += line.trim();
      continue;
    }

    flush();

    if (/^@@/.test(line) || /^think\s/.test(line)) {
      out.push(line);
    } else {
      pending = line;
    }
  }

  flush();
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// Entry resolution — src-relative for .mush, tools-relative for .js/.ts
// ---------------------------------------------------------------------------

function resolveFiles(entry: string): string[] {
  validateManifestEntry(entry);
  if (entry.endsWith('/')) {
    const dir = path.join(SRC, entry.slice(0, -1));
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter(f => f.endsWith('.mush'))
      .sort()
      .map(f => path.join(dir, f));
  }
  const ext = path.extname(entry);
  if (ext === '.js' || ext === '.ts') return [path.join(TOOLS, entry)];
  return [path.join(SRC, entry)];
}

function processFile(file: string): string {
  const ext = path.extname(file);
  if (ext === '.mush') return compileMush(fs.readFileSync(file, 'utf8'));
  // Use execFileSync (no shell) to prevent command injection via file paths.
  // Arguments are passed as an array — metacharacters are never interpreted.
  if (ext === '.ts')   return execFileSync('npx', ['ts-node', file], { encoding: 'utf8' });
  if (ext === '.js')   return execFileSync('node', [file],           { encoding: 'utf8' });
  throw new Error(`build: unknown file type — ${file}`);
}

// ---------------------------------------------------------------------------
// Dependency resolution — reads mush-lock.json, prepends dep installers
// ---------------------------------------------------------------------------

function loadDependencyInstallers(): { label: string; content: string }[] {
  const deps   = mushJson.dependencies ?? {};
  const names  = Object.keys(deps);
  if (names.length === 0) return [];

  const out: { label: string; content: string }[] = [];

  for (const name of names) {
    const lock = lockFile.resolved[name];
    if (!lock) {
      throw new Error(
        `Dependency "${name}" is declared in mush.json but not resolved in mush-lock.json.\n` +
        `Run \`npm run mush:install\` to fetch it.`
      );
    }

    const safeDir = name.replace(/\//g, '__');
    const depPath = path.join(DEPS, safeDir, lock.version, 'installer.txt');

    if (!fs.existsSync(depPath)) {
      throw new Error(
        `Dependency "${name}@${lock.version}" is locked but not present at:\n  ${depPath}\n` +
        `Run \`npm run mush:install\` to re-fetch it.`
      );
    }

    const raw = fs.readFileSync(depPath, 'utf8');
    out.push({ label: `dep:${name}@${lock.version}`, content: raw });
    console.log(`  dep  ${name}@${lock.version}`);
  }

  return out;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const header = [
  '@@ ===========================================================================',
  `@@ ${mushJson.name ?? pkg.name} — Installer`,
  `@@ Version   : ${mushJson.version ?? pkg.version}`,
  `@@ Namespace : ${mushJson.namespace ?? '(none)'}`,
  `@@ Built     : ${new Date().toISOString()}`,
  '@@ ===========================================================================',
].join('\n');

console.log(`\n${mushJson.name ?? pkg.name} — build v${mushJson.version ?? pkg.version}\n`);

fs.mkdirSync(DIST, { recursive: true });

const sections: string[] = [header];

// Prepend dependency installers in declared order
const depInstallers = loadDependencyInstallers();
for (const { label, content } of depInstallers) {
  sections.push(content);
  console.log(`  ok   ${label}`);
}

// Compile this project's own sources
for (const entry of MANIFEST) {
  for (const file of resolveFiles(entry)) {
    const label  = path.relative(ROOT, file);
    const result = processFile(file);
    if (result.trim()) {
      sections.push(result);
      console.log(`  ok   ${label}`);
    } else {
      console.log(`  skip ${label}  (empty)`);
    }
  }
}

const outPath = path.join(DIST, OUT_FILE);
fs.writeFileSync(outPath, sections.join('\n') + '\n');
const bytes = fs.statSync(outPath).size;
console.log(`\n  wrote dist/${OUT_FILE}  (${bytes} bytes)\n`);
