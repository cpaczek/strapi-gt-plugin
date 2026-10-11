import { once } from 'node:events';

/** @param {import('node:child_process').ChildProcess} child */
export const stopOwnedProcessGroup = async (child) => {
  // The detached group can outlive its wrapper, so always signal the recorded group.
  if (child.pid) {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch (failure) {
      if (!(failure instanceof Error && 'code' in failure && failure.code === 'ESRCH'))
        throw failure;
    }
  }
  if (child.pid && child.exitCode === null && child.signalCode === null) await once(child, 'exit');
};
