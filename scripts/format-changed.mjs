import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const excludedDirectories = new Set([
  '.git',
  '.work',
  '.worktrees',
  'node_modules',
  'dist',
  'build',
  '.next',
  'coverage',
  'test-results',
  'playwright-report',
]);
const supportedExtensions = new Set([
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.json',
  '.jsonc',
  '.md',
  '.yml',
  '.yaml',
  '.css',
]);
const isInside = (root, candidate) => {
  const path = relative(root, candidate);
  return path !== '' && path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
};

export const selectChangedFiles = (event, root) => {
  if (
    !event ||
    typeof event !== 'object' ||
    !event.tool_input ||
    typeof event.tool_input !== 'object'
  )
    return [];
  const input = event.tool_input;
  const paths = [];
  if (typeof input.file_path === 'string') paths.push(input.file_path);
  if (typeof input.command === 'string') {
    for (const match of input.command.matchAll(/^\*\*\* (?:Update File|Add File|Move to): (.+)$/gm))
      paths.push(match[1].trim());
  }
  const canonicalRoot = realpathSync(root);
  const selected = new Set();
  for (const filename of paths) {
    const candidate = resolve(root, filename);
    if (!isInside(root, candidate) || !supportedExtensions.has(extname(candidate))) continue;
    if (
      relative(root, candidate)
        .split(sep)
        .some((part) => excludedDirectories.has(part) || part.startsWith('.env'))
    )
      continue;
    if (!existsSync(candidate)) continue;
    const canonical = realpathSync(candidate);
    if (!isInside(canonicalRoot, canonical) || !statSync(canonical).isFile()) continue;
    if (
      relative(canonicalRoot, canonical)
        .split(sep)
        .some((part) => excludedDirectories.has(part) || part.startsWith('.env'))
    )
      continue;
    selected.add(candidate);
  }
  return [...selected];
};

const run = () => {
  const event = JSON.parse(readFileSync(0, 'utf8'));
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const files = selectChangedFiles(event, root);
  if (files.length === 0) return;
  const executable = join(
    root,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'oxfmt.cmd' : 'oxfmt'
  );
  execFileSync(executable, ['--write', ...files], { cwd: root, stdio: 'inherit', shell: false });
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run();
