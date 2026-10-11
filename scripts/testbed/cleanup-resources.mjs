/**
 * @param {readonly (() => void | Promise<void>)[]} steps
 * @param {readonly unknown[]} initialFailures
 * @returns {Promise<void>}
 */
export const cleanupTestResources = async (steps, initialFailures = []) => {
  const failures = [...initialFailures];
  for (const step of steps) {
    try {
      await step();
    } catch (failure) {
      failures.push(failure);
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1)
    throw new AggregateError(failures, 'Test resource cleanup failed', { cause: failures[0] });
};
