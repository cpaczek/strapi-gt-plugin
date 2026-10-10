# Plugin tests

Write observable behavior before implementation and record the initial failure.
Keep control cases that reject unsafe input or writes. Changes to gold tests need
a reason in the working decisions log. Add adversarial Unicode, nesting, large
payload, concurrency and partial-failure cases. Do not mirror implementation logic.
