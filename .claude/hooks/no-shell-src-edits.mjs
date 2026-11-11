const { tool_input } = JSON.parse(await new Response(process.stdin).text());
const cmd = tool_input.command ?? '';
// ponytail: regex heuristic, misses writes that never name src/ literally
// A redirect or `sed -i` counts only when its target is in src/: a heredoc into .scratch/ may mention src/ paths.
const redirect = /(>>?|tee(\s+-a)?)\s*["']?[^\s"']*src\//;
// The file `sed -i` edits is the last word of its command.
const sedInPlace = cmd
  .split(/[;&|\n]/)
  .some(
    (part) =>
      /^\s*sed\s+-i/.test(part) &&
      /src\//.test(part.trim().split(/\s+/).at(-1)),
  );
const script = /(node|python3?)\s+-[ec]?(\s|$)/;
if (
  redirect.test(cmd) ||
  sedInPlace ||
  (script.test(cmd) && cmd.includes('src/'))
) {
  console.error(
    'Edit files in src/ with the Edit or Write tool. For a rename, use Edit with replace_all on the exact identifier. For a mutation check, make a temporary Edit and then reverse it.',
  );
  process.exit(2);
}
