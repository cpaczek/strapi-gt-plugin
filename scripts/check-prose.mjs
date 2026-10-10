import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSyntax, walkSyntax } from './source-syntax.mjs';

const bannedPhrases = JSON.parse(
  readFileSync(new URL('./banned-phrases.json', import.meta.url), 'utf8')
);
const fixturePaths = new Set(['scripts/banned-phrases.json', 'scripts/checks.test.ts']);
const escapePattern = (phrase) => phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const patterns = bannedPhrases.map((phrase) => new RegExp(`\\b${escapePattern(phrase)}\\b`, 'gi'));

const proseFragments = (source, filename) => {
  if (!/\.[cm]?[jt]sx?$/.test(filename)) return [source];
  const parsed = parseSyntax(source, filename);
  const fragments = parsed.comments.map((comment) => comment.value);
  walkSyntax(parsed.program, (node) => {
    if ((node.type === 'Literal' || node.type === 'JSXText') && typeof node.value === 'string')
      fragments.push(node.value);
    if (node.type === 'TemplateLiteral')
      fragments.push(
        node.quasis.map((part) => part.value.cooked ?? part.value.raw).join(' {value} ')
      );
  });
  return fragments;
};

export const checkProse = (source, filename) => {
  const findings = [];
  for (const fragment of proseFragments(source, filename)) {
    for (const match of fragment.matchAll(/[\u2013\u2014\u2018\u2019\u201c\u201d]/g))
      findings.push(`Use plain punctuation at ${filename}: ${match.index}`);
    for (const pattern of patterns) {
      for (const match of fragment.matchAll(pattern))
        findings.push(`Prohibited phrase at ${filename}: ${match.index}`);
    }
    if (/\bnot only\b[\s\S]*?\bbut also\b/i.test(fragment))
      findings.push(`Remove the paired contrast at ${filename}`);
    for (const heading of fragment.matchAll(/^ {0,3}#{1,6}\s+.*$/gm)) {
      if (/\p{Extended_Pictographic}/u.test(heading[0]))
        findings.push(`Remove heading decoration at ${filename}`);
    }
  }
  return findings;
};

export const readCommitMessages = (range, cwd = process.cwd()) => {
  if (typeof range !== 'string' || !range || range.startsWith('-')) {
    throw new TypeError('Provide a Git revision or revision range.');
  }
  return execFileSync('git', ['log', '--format=%B%x00', range, '--'], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
    .split('\0')
    .map((message) => message.trim())
    .filter(Boolean);
};

const run = () => {
  const args = process.argv.slice(2);
  const historyIndex = args.indexOf('--commit-range');
  if (historyIndex >= 0) {
    const messages = readCommitMessages(args[historyIndex + 1]);
    const findings = messages.flatMap((message, index) =>
      checkProse(message, `commit-${index + 1}`)
    );
    if (findings.length) {
      process.stderr.write(`${findings.join('\n')}\n`);
      process.exitCode = 1;
    } else process.stdout.write(`Commit prose check passed (${messages.length} commits).\n`);
    return;
  }
  const commitIndex = args.indexOf('--commit-msg');
  const files =
    commitIndex >= 0
      ? [args[commitIndex + 1]]
      : execFileSync(
          'git',
          args.includes('--staged')
            ? ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']
            : ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
          { encoding: 'utf8' }
        )
          .split('\0')
          .filter(Boolean);
  const findings = [];
  for (const filename of new Set(files)) {
    if (
      !filename ||
      fixturePaths.has(filename) ||
      filename.startsWith('tests/fixtures/') ||
      !existsSync(filename)
    )
      continue;
    if (
      commitIndex < 0 &&
      !['.md', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json'].includes(extname(filename))
    )
      continue;
    if (filename.endsWith('package-lock.json')) continue;
    findings.push(...checkProse(readFileSync(filename, 'utf8'), filename));
  }
  if (findings.length) {
    process.stderr.write(`${findings.join('\n')}\n`);
    process.exitCode = 1;
  } else process.stdout.write(`Prose check passed (${new Set(files).size} files).\n`);
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run();
