export const cleanupTestResources = async (
  steps: readonly (() => void | Promise<void>)[],
  initialFailures: readonly unknown[] = []
): Promise<void> => {
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
