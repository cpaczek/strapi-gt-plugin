import { execFile } from 'node:child_process';
import { basename } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);

/** @param {string} output */
export const sanitizeCommandOutput = (output) =>
  output
    .replace(/\b(Bearer|Basic)\s+[^\s\\'",;]+/gi, '$1 [redacted]')
    .replace(
      /((?:authorization|proxy-authorization|cookie|set-cookie)[\\'"]*\s*:\s*)(?:(?!\\+[rn])[^\r\n])*/gim,
      '$1[redacted]'
    )
    .replace(
      /([\w-]*(?:password|secret|token|api[-_]?key)[\\'"]*\s*[:=]\s*)\\+["'](?:(?!\\+[rn])[^\r\n])*/gi,
      '$1[redacted]'
    )
    .replace(
      /([\w-]*(?:password|secret|token|api[-_]?key)[\\'"]*\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s\\,;&]+)/gi,
      '$1[redacted]'
    )
    .replace(/(https?:\/\/)[^/\s@]+@/gi, '$1[redacted]@');

/**
 * @param {string} command
 * @param {string[]} args
 * @param {import('node:child_process').ExecFileOptions} options
 * @returns {Promise<{ stdout: string, stderr: string }>}
 */
export const runSafeCommand = async (command, args, options) => {
  try {
    const result = await execute(command, args, { ...options, encoding: 'utf8' });
    return {
      stdout: sanitizeCommandOutput(result.stdout),
      stderr: sanitizeCommandOutput(result.stderr),
    };
  } catch (failure) {
    const properties = failure instanceof Error ? failure : new Error('Unknown process failure');
    const code = 'code' in properties ? String(properties.code) : 'unknown';
    const signal = 'signal' in properties && properties.signal ? String(properties.signal) : 'none';
    const output = ['stdout', 'stderr'].flatMap((field) => {
      const descriptor = Object.getOwnPropertyDescriptor(properties, field);
      return typeof descriptor?.value === 'string' ? [descriptor.value] : [];
    });
    // Do not retain the original error: Node prints enumerable child output and nested causes.
    throw new Error(
      sanitizeCommandOutput(
        `${basename(command)} failed (exit ${code}, signal ${signal}).\n${output.length ? output.join('\n') : properties.message}`
      )
    );
  }
};
