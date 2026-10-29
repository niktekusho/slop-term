# Coding standards

Review applies these on top of the global writing and comment rules. Lint, format and type checks are enforced by `pnpm lint` and `pnpm typecheck`, so they aren't repeated here.

## Tests

- Every ticked acceptance item in a ticket names the test that covers it, or says why no test can. The ticket's "Back-end tests" and "UI tests" lines are the minimum, not the whole list.
- Tests sit at the two seams in the spec's Testing Decisions (`.scratch/slop-term-v1/spec.md`): the back end over IPC, and the UI against `FakeBackend`.
