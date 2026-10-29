# Map: slop-term LLM integration

Label: wayfinder:map

## Destination

Not chosen yet. The likely end is a build-ready spec for LLM features in slop-term, built after v1 ships. For now this map only records the idea.

## Notes

- Parked on 2026-10-29 at the user's request. Chart it properly (grilling and domain-modeling) when v1 is done.
- Builds on the [v1 spec](../slop-term-v1/spec.md). Use the terms in `GLOSSARY.md`.

## Decisions so far

## Not yet specified

- Which jobs the LLM does: explain selected output or an error, turn a plain-language request into a command placed at the prompt (the user presses Enter), answer questions using the Tab's context (host, OSC 7 folder, recent scrollback), or act as an agent that runs commands in a Tab itself. The agent option changes the safety story the most.
- Where the model runs: a hosted API with the key kept by a Credential provider, a local model (Ollama, LM Studio), or both. This depends on whether the user's employer allows sending work data to hosted models.
- What the model may see: scrollback can contain internal hostnames, data and secrets. Whether to filter it, and whether coloured (production) Saved sessions get stricter rules.
- Timing: whether any of it starts before every v1 build ticket is done.

## Out of scope
