import { once } from 'node:events';

/** @param {import('node:child_process').ChildProcess} child */
export const stopOwnedProcessGroup = async (child) => {
  if (child.pid && child.exitCode === null) {
    process.kill(-child.pid, 'SIGTERM');
    await once(child, 'exit');
  }
};
