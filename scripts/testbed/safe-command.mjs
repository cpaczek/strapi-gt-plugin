import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export const sanitizeCommandOutput = (output) => output;
export const runSafeCommand = promisify(execFile);
