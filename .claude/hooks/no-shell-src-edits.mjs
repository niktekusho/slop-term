const { tool_input } = JSON.parse(await new Response(process.stdin).text());
const cmd = tool_input.command ?? '';
// ponytail: regex heuristic, misses writes that never name src/ literally
const writes = /sed\s+-i|python3?\s+-|<<|>\s*\S*src\/|tee\s+\S*src\//;
if (cmd.includes('src/') && writes.test(cmd)) {
  console.error(
    'Edit files in src/ with the Edit or Write tool. For a rename, use Edit with replace_all on the exact identifier. For a mutation check, make a temporary Edit and then reverse it.',
  );
  process.exit(2);
}
