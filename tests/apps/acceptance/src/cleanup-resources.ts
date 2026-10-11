export const cleanupTestResources = async (
  steps: readonly (() => void | Promise<void>)[],
  initialFailures: readonly unknown[] = []
): Promise<void> => {
  for (const step of steps) await step();
  if (initialFailures.length) throw initialFailures[0];
};
