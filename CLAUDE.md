# slop-term

Tickets: `.scratch/slop-term-v1-build/issues/NN-*.md`. Set `**Status:** done` by hand when a ticket ships. Spec: `.scratch/slop-term-v1/spec.md`. Design decisions: `.scratch/slop-term-v1/issues/`. Retros: `.scratch/retro-ticket-NN.md`.

Test seams are fixed in the spec's Testing Decisions: write the first failing test before the first `src/` edit.

Check with `pnpm lint` while working and run `pnpm lint:fix` once before the commit: a format mid-session rewrites files already in context.

After editing a shared test helper (`harness.ts`, `ssh-server.ts`, `fake-backend.ts`), run the files that import it with `pnpm vitest related --run <file>`. A break there hides among timeouts in the full suite.

Run the full suite locally with `pnpm test:local`. It uses 2 workers, which ran green in 3 of 3 runs on the 16 GB laptop, against 2 of 3 with 4 workers.

Revert an experiment in a committed file with `git checkout -- <file>`: an Edit back can leave part of the change.

Review uncommitted work with `git diff HEAD`. A `<fixed-point>...HEAD` diff is empty until the commit.

Run `git config core.hooksPath .githooks` once per clone to enable the pre-commit check.
