// A tiny, self-contained REPL fixture for prompt-mode tests. It prints "calc> "
// when ready, evaluates each line as JavaScript, prints the result, and exits on
// EOF (or the literal `quit`). `require` is in scope so a test can prove that a
// bash `setup` ran (and shared the working directory) before the REPL started.
const readline = require("readline");

process.stdout.write("calc> ");
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
  process.stdout.write("calc> ");
});

rl.on("close", () => process.exit(0));
