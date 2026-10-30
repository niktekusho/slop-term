# Coding standards

Review applies these on top of the global writing and comment rules. Lint, format and type checks are enforced by `pnpm lint` and `pnpm typecheck`, so they aren't repeated here.

## Tests

- Every acceptance item in the ticket names the test that covers it, or says why no test can, in a "Test coverage" section of the ticket file. A ticket's "Back-end tests" and "UI tests" lines are the minimum, not the whole list.
- A platform fact the code relies on and the implementer checked by running it goes in the ticket's "Test coverage" section, with the command that showed it. The reviewer weighs it above documentation that disagrees.
- A dialog that asks the user to confirm a change sends the back end the values it showed, captured when it opened. Its test emits a `tree` event while the dialog is open.
- Tests sit at the two seams in the spec's Testing Decisions (`.scratch/slop-term-v1/spec.md`): the back end over IPC, and the UI against `FakeBackend`.
