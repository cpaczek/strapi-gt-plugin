import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const extractCommands = (markdown) => {
  const commands = [];
  const fence = { marker: '', length: 0, shell: false, line: 0 };
  for (const [index, source] of markdown.split(/\r?\n/).entries()) {
    const opening = source.match(/^ {0,3}(`{3,}|~{3,})([^`~]*)$/);
    if (!fence.marker && opening) {
      fence.marker = opening[1][0];
      fence.length = opening[1].length;
      fence.shell = ['sh', 'bash', 'shell'].includes(opening[2].trim());
      fence.line = index + 1;
      continue;
    }
    if (!fence.marker) continue;
    const closing = source.match(/^ {0,3}(`{3,}|~{3,})\s*$/);
    if (closing && closing[1][0] === fence.marker && closing[1].length >= fence.length) {
      fence.marker = '';
      continue;
    }
    if (!fence.shell) continue;
    const command = source.trim();
    if (!command || command.startsWith('#')) continue;
    // Restrict examples to literal argv; no shell interpreter ever receives Markdown.
    if (!/^[a-zA-Z0-9_./@:=+-]+(?:[ \t]+[a-zA-Z0-9_./@:=+-]+)*$/.test(command)) {
      throw new Error(`Use a literal command without shell syntax at line ${index + 1}.`);
    }
    commands.push({ line: index + 1, command, arguments: command.split(/[ \t]+/) });
  }
  if (fence.marker) throw new Error(`Unclosed code fence at line ${fence.line}.`);
  return commands;
};

const main = () => {
  const [filename = 'README.md', ...options] = process.argv.slice(2);
  if (options.some((option) => option !== '--run-versions') || options.length > 1) {
    throw new Error('Usage: node scripts/check-readme.mjs README.md [--run-versions]');
  }
  const commands = extractCommands(readFileSync(filename, 'utf8'));
  const executedVersionChecks = [];
  if (options.includes('--run-versions')) {
    for (const entry of commands) {
      if (['node --version', 'pnpm --version'].includes(entry.command)) {
        const [program, ...args] = entry.arguments;
        const output = execFileSync(program === 'node' ? process.execPath : program, args, {
          encoding: 'utf8',
          timeout: 30_000,
          stdio: ['ignore', 'pipe', 'pipe'],
        }).trim();
        executedVersionChecks.push({ command: entry.command, output });
      }
    }
  }
  process.stdout.write(`${JSON.stringify({ commands, executedVersionChecks }, null, 2)}\n`);
};
try {
  main();
} catch (failure) {
  process.stderr.write(`${failure instanceof Error ? failure.message : 'README check failed.'}\n`);
  process.exitCode = 1;
}
