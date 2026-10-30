const { tool_input } = JSON.parse(await new Response(process.stdin).text());
const cmd = tool_input.command ?? '';
// ponytail: regex heuristic, misses writes that never name src/ literally
// A redirect counts only when its target is in src/: a heredoc into .scratch/ may mention src/ paths.
const redirect = /(>>?|tee(\s+-a)?)\s*["']?[^\s"']*src\//;
const script = /sed\s+-i|(node|python3?)\s+-[ec]?(\s|$)/;
if (redirect.test(cmd) || (script.test(cmd) && cmd.includes('src/'))) {
  console.error(
    'Edit files in src/ with the Edit or Write tool. For a rename, use Edit with replace_all on the exact identifier. For a mutation check, make a temporary Edit and then reverse it.',
  );
  process.exit(2);
}
