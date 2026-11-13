# Map: slop-term LLM integration

Label: wayfinder:map

## Destination

A build-ready spec at `.scratch/slop-term-llm/spec.md`, in the same shape as the [v1 spec](../slop-term-v1/spec.md), covering one first LLM release. Build tickets are cut from it afterwards, outside this map.

## Notes

- Charted on 2026-11-13, after every v1 build ticket was marked done.
- Builds on the [v1 spec](../slop-term-v1/spec.md). Use the terms in `GLOSSARY.md`.
- Tickets are in `issues/`. Each has `Type`, `Status` (open, claimed, resolved) and `Blocked by` lines at the top. Research findings go in `research/`.
- Default skills for a ticket session: `/grilling` and `/domain-modeling`.
- **The Agent teaches.** The v1 SSH Saved session dialog shows the `ssh` command it stands for. In the same way, the Agent shows every command it runs as a real command the user could type, with what it is for. After watching the Agent work, the user knows more about the host and the commands than before.
- "Agent" is a working term for the model acting on a Tab's host through slop-term. It is not in `GLOSSARY.md` yet. [Does the Agent run its commands in the Tab's shell or on a separate channel?](issues/07-tab-shell-or-separate-channel.md) fixes its definition.
- The centre of the first release is the Agent: the model investigates a host through slop-term. Read-only commands run without asking. Commands that remove or change things wait for the user's confirmation.
- Facts from charting: the user's employer allows hosted models and provides Gemini and Antigravity as product seats. The user holds no API key.

## Decisions so far

- [Which programmatic routes does a work Google account give to Gemini?](issues/03-gemini-programmatic-routes.md): an AI Studio API key or Vertex AI with a Cloud project. The Gemini CLI and Antigravity sign-ins are first-party only.
- [What does shell integration give slop-term?](issues/04-shell-integration.md): prompt state, output bounds and exit codes for a Tab's first shell. Shells nested inside it (`sudo -i`, a container, a second hop) lose the marks, and slop-term can detect that and refuse to type.
- [How do existing agents decide a shell command is safe to run unasked?](issues/05-safe-command-classification.md): parse with a real shell grammar, allow a small list of literal commands with listed flags, and ask for everything else. No sandbox reaches a remote host, so slop-term's check is the only gate.

## Not yet specified

- How the user talks to the Agent and sees what it did: a pane beside the Tab, a log, or text in the terminal. How much explanation goes with each command (a one-line purpose, a breakdown of flags on request, a summary of findings at the end), and whether the Agent may explain commands the user typed. Likely a prototype ticket once the jobs and the Tab-or-channel decision are settled.
- Whether the Agent can connect as a separate read-only account, so the remote host enforces the limit and slop-term's check is not the only barrier.
- How the Agent works on local shell Tabs, including a local shell Tab running `ssh`.
- A local model (Ollama, LM Studio) as a fallback if the work Gemini route cannot be called from slop-term.
- Cost and rate limits, and what the user sees when the model is slow or unavailable.
- Test seams for model calls and for the command check.
- Writing the spec itself.

## Out of scope

- An Agent that works across several hosts at once. The Agent is tied to one Tab in the first release.
