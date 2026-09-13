#!/usr/bin/env node
/**
 * The `recital` command-line runner.
 *
 *   recital run <files|dirs|globs...>   run the CLI sessions in Markdown docs
 *   recital --help
 *   recital --version
 */

import { readFileSync } from "node:fs";

import { resolveMarkdownFiles } from "./files.js";
import { parseMarkdown } from "./parser.js";
import { runParsedDocument, type RunnerOptions } from "./runner.js";
import type { BlockResult, DocumentResult } from "./types.js";

const useColor = process.stdout.isTTY && process.env.NO_COLOR === undefined;
const c = {
  green: (s: string) => (useColor ? `\x1b[32m${s}\x1b[0m` : s),
  red: (s: string) => (useColor ? `\x1b[31m${s}\x1b[0m` : s),
  dim: (s: string) => (useColor ? `\x1b[2m${s}\x1b[0m` : s),
  bold: (s: string) => (useColor ? `\x1b[1m${s}\x1b[0m` : s),
};

const HELP = `recital — run Markdown files that describe CLI sessions.

Usage:
  recital run <files|dirs|globs...> [options]
  recital <files|dirs|globs...>            (run is the default command)

Options:
  --expect-success     Require every command to exit 0 (unless a block sets exit=).
  --shell <path>       Shell executable to drive (default: bash).
  --cwd <dir>          Working directory for the session.
  --lang <name>        Additional runnable code-fence language (repeatable).
  -h, --help           Show this help.
  -v, --version        Show version.

A runnable block is a fenced code block tagged \`console\` (or a --lang value):

  \`\`\`console
  $ echo hello
  hello
  \`\`\`

Matcher tokens in expected output: {{name:type}} captures, {{name}} back-refs,
{{:type}} / {{*}} anonymous wildcards; a lone \`...\` line skips arbitrary lines.
`;

interface ParsedArgs {
  files: string[];
  options: RunnerOptions & { languages?: string[] };
  help: boolean;
  version: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = [...argv];
  if (args[0] === "run") args.shift();

  const files: string[] = [];
  const options: RunnerOptions & { languages?: string[] } = {};
  let help = false;
  let version = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    switch (arg) {
      case "-h":
      case "--help":
        help = true;
        break;
      case "-v":
      case "--version":
        version = true;
        break;
      case "--expect-success":
        options.expectSuccess = true;
        break;
      case "--shell":
        options.shell = args[++i];
        break;
      case "--cwd":
        options.cwd = args[++i];
        break;
      case "--lang":
        (options.languages ??= ["console"]).push(args[++i]!);
        break;
      default:
        if (arg.startsWith("-")) {
          throw new Error(`Unknown option: ${arg}`);
        }
        files.push(arg);
    }
  }

  return { files, options, help, version };
}

function reportBlock(result: BlockResult): boolean {
  const name = result.block.heading
    ? `${result.block.heading} ${c.dim(`(line ${result.block.line})`)}`
    : c.dim(`block at line ${result.block.line}`);

  if (result.ok) {
    const skipped = "skip" in result.block.options;
    console.log(`  ${skipped ? c.dim("○ skip") : c.green("✓")} ${name}`);
    return true;
  }

  console.log(`  ${c.red("✗")} ${name}`);
  const failed = result.interactions.find((r) => !r.ok);
  if (failed?.error) {
    console.log(
      failed.error
        .split("\n")
        .map((l) => "      " + l)
        .join("\n"),
    );
  }
  return false;
}

function reportDocument(doc: DocumentResult): void {
  console.log(doc.ok ? c.green(c.bold(doc.path)) : c.red(c.bold(doc.path)));
  for (const block of doc.blocks) reportBlock(block);
}

async function main(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2));

  if (parsed.version) {
    // Version is injected at build time; fall back gracefully.
    console.log(process.env.npm_package_version ?? "0.1.0");
    return 0;
  }
  if (parsed.help || parsed.files.length === 0) {
    console.log(HELP);
    return parsed.help ? 0 : 1;
  }

  const files = resolveMarkdownFiles(parsed.files);
  if (files.length === 0) {
    console.error("No Markdown files matched.");
    return 1;
  }

  let failed = 0;
  let total = 0;
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const doc = parseMarkdown(source, { path: file, languages: parsed.options.languages });
    if (doc.blocks.length === 0) continue;
    total++;
    const result = await runParsedDocument(doc, parsed.options);
    reportDocument(result);
    if (!result.ok) failed++;
  }

  if (total === 0) {
    console.error("No runnable blocks found.");
    return 1;
  }

  console.log(
    failed === 0
      ? c.green(`\n${total} document(s) passed.`)
      : c.red(`\n${failed} of ${total} document(s) failed.`),
  );
  return failed === 0 ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(c.red(String(err?.stack ?? err)));
    process.exit(2);
  });
