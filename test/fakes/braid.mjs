// Fake `braid` for the tests: `agents --json` prints $FAKE_BRAID_STATE, `start`/`do` append their arguments to $FAKE_BRAID_LOG.
import { appendFileSync, readFileSync } from "node:fs";

const args = process.argv.slice(2);
if (args[0] === "--version") console.log("braid 0.1.0");
else if (args[0] === "agents" && args[1] === "--json") process.stdout.write(readFileSync(process.env.FAKE_BRAID_STATE, "utf8"));
else if (args[0] === "start" || args[0] === "do") {
  appendFileSync(process.env.FAKE_BRAID_LOG, JSON.stringify({ args, cwd: process.cwd() }) + "\n");
  console.log(`started ${args[0]}`);
} else process.exit(2);
