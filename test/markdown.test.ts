import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describeMarkdown } from "../src/vitest.js";

const here = dirname(fileURLToPath(import.meta.url));
const examples = join(here, "..", "examples");

// Run the shipped example transcripts as a real vitest suite. This is also the
// canonical demonstration of the vitest integration.
describeMarkdown(examples);
