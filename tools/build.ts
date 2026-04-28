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
const DEPS    = path.join(ROOT, 'deps');

// ---------------------------------------------------------------------------
// Config types
// ---------------------------------------------------------------------------

interface InstallerConfig {
  name:         string;
  description?: string;
  out:          string;    // relative to ROOT e.g. "dist/installer.txt"
  manifest:     string[];  // same entry rules: "file.mush", "dir/", "script.ts", "script.js"
}

interface MushJson {
  name:          string;
  version:       string;
  namespace?:    string;
  dependencies?: Record<string, string>;
  installers?:   InstallerConfig[];
}

interface LockEntry {
  version:  string;
  resolved: string;
  sha256:   string;
}

interface LockFile {
  lockVersion: number;
  resolved:    Record<string, LockEntry>;
}

// ---------------------------------------------------------------------------
// Load config
// ---------------------------------------------------------------------------

const pkg      = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'),   'utf8')) as { name: string; version: string };
const mushJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'mush.json'),      'utf8')) as MushJson;
const lockFile = JSON.parse(fs.readFileSync(path.join(ROOT, 'mush-lock.json'), 'utf8')) as LockFile;

// ---------------------------------------------------------------------------
// CLI flags
//   --only <name>   build a single named installer
//   --list          print installer names and exit
// ---------------------------------------------------------------------------

const onlyIdx    = process.argv.indexOf('--only');
const onlyFilter = onlyIdx >= 0 ? process.argv[onlyIdx + 1] : null;

if (process.argv.includes('--list')) {
  (mushJson.installers ?? []).forEach(i => console.log(i.name));
  process.exit(0);
}

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
  // execFileSync avoids shell injection — args passed as array, not string.
  if (ext === '.ts')   return execFileSync('npx', ['ts-node', file], { encoding: 'utf8' });
  if (ext === '.js')   return execFileSync('node', [file],           { encoding: 'utf8' });
  throw new Error(`build: unknown file type — ${file}`);
}

// ---------------------------------------------------------------------------
// Dependency resolution — prepends locked dep installers in declared order.
// Only applied to the installer named "main" (deps are not repeated in
// supplementary installers like "portal" or "bridge").
// ---------------------------------------------------------------------------

function loadDependencyInstallers(): { label: string; content: string }[] {
  const deps  = mushJson.dependencies ?? {};
  const names = Object.keys(deps);
  if (names.length === 0) return [];

  return names.map(name => {
    const lock = lockFile.resolved[name];
    if (!lock) {
      throw new Error(
        `Dependency "${name}" declared in mush.json but not in mush-lock.json.\n` +
        `Run \`npm run mush:install\` to resolve it.`
      );
    }
    const safeDir = name.replace(/\//g, '__');
    const depPath = path.join(DEPS, safeDir, lock.version, 'installer.txt');
    if (!fs.existsSync(depPath)) {
      throw new Error(
        `Dependency "${name}@${lock.version}" locked but missing at:\n  ${depPath}\n` +
        `Run \`npm run mush:install\` to re-fetch it.`
      );
    }
    console.log(`  dep  ${name}@${lock.version}`);
    return { label: `dep:${name}@${lock.version}`, content: fs.readFileSync(depPath, 'utf8') };
  });
}

// ---------------------------------------------------------------------------
// Build one installer
// ---------------------------------------------------------------------------

function buildInstaller(installer: InstallerConfig, deps: { label: string; content: string }[]): void {
  const outPath = path.join(ROOT, installer.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const fileHeader = [
    '@@ ===========================================================================',
    `@@ ${mushJson.name ?? pkg.name}${installer.description ? ' — ' + installer.description : ''}`,
    `@@ Version   : ${mushJson.version ?? pkg.version}`,
    `@@ Namespace : ${mushJson.namespace ?? '(none)'}`,
    `@@ Built     : ${new Date().toISOString()}`,
    '@@ ===========================================================================',
  ].join('\n');

  const sections: string[] = [fileHeader];

  // Prepend dependency installers only for the "main" installer.
  if (installer.name === 'main') {
    for (const { content } of deps) sections.push(content);
  }

  for (const entry of installer.manifest) {
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

  const outRelative = path.relative(ROOT, outPath);
  fs.writeFileSync(outPath, sections.join('\n') + '\n');
  const bytes = fs.statSync(outPath).size;
  console.log(`\n  wrote ${outRelative}  (${bytes} bytes)\n`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const installers = mushJson.installers ?? [];

if (installers.length === 0) {
  console.error('build: no "installers" array found in mush.json.');
  console.error('       Add at least one installer entry to mush.json to build.');
  process.exit(1);
}

const targets = onlyFilter
  ? installers.filter(i => i.name === onlyFilter)
  : installers;

if (onlyFilter && targets.length === 0) {
  const available = installers.map(i => i.name).join(', ');
  console.error(`build: no installer named "${onlyFilter}". Available: ${available}`);
  process.exit(1);
}

console.log(`\n${mushJson.name ?? pkg.name} — build v${mushJson.version ?? pkg.version}\n`);

const depSections = loadDependencyInstallers();

for (const installer of targets) {
  console.log(`--- ${installer.name}${installer.description ? ': ' + installer.description : ''} ---`);
  buildInstaller(installer, depSections);
}
