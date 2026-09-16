// A tiny, self-contained REPL fixture for prompt-mode tests. It prints "calc> "
// when ready (or cycles through REPL_PROMPTS, a `|`-separated list), evaluates
// each line as JavaScript, prints the result, and exits on EOF (or the literal
// `quit`). `require` is in scope so a test can prove that a bash `setup` ran
// (and shared the working directory) before the REPL started.
const readline = require("readline");

const prompts = (process.env.REPL_PROMPTS || "calc> ").split("|");
let promptIndex = 0;
function writePrompt() {
  process.stdout.write(prompts[promptIndex % prompts.length]);
  promptIndex += 1;
}

writePrompt();
const rl = readline.createInterface({ input: process.stdin });

rl.on("line", (line) => {
  const t = line.trim();
  if (t === "quit") {
    rl.close();
    return;
  }
  let out;
  try {
    out = String(eval(t));
  } catch (err) {
    out = "error: " + err.message;
  }
  process.stdout.write(out + "\n");
  writePrompt();
});

rl.on("close", () => process.exit(0));
