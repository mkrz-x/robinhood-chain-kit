import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const temporaryRoot = mkdtempSync(join(tmpdir(), "robinhood-chain-kit-pack-"));

const run = (command, args, cwd) =>
  execFileSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

try {
  const packOutput = run("npm", ["pack", "--json", "--pack-destination", temporaryRoot], root);
  // npm forwards prepack/build output before its final JSON document.
  const jsonStart = packOutput.lastIndexOf("\n[");
  const packed = JSON.parse(packOutput.slice(jsonStart >= 0 ? jsonStart + 1 : 0));
  if (!Array.isArray(packed) || packed.length !== 1 || typeof packed[0]?.filename !== "string") {
    throw new Error("npm pack did not return one tarball");
  }

  const tarball = join(temporaryRoot, packed[0].filename);
  const consumer = join(temporaryRoot, "consumer");
  mkdirSync(consumer);
  writeFileSync(
    join(consumer, "package.json"),
    JSON.stringify({ name: "package-smoke-consumer", private: true }),
  );
  run(
    "npm",
    ["install", "--ignore-scripts", "--no-audit", "--no-fund", tarball],
    consumer,
  );

  const assertion =
    "if (m.CHAIN_ID !== 4663 || typeof m.assessOracleHealth !== 'function') " +
    "throw new Error('packed exports are incomplete')";
  run(
    process.execPath,
    ["--input-type=module", "--eval", `const m=await import('robinhood-chain-kit');${assertion}`],
    consumer,
  );
  run(
    process.execPath,
    ["--input-type=commonjs", "--eval", `const m=require('robinhood-chain-kit');${assertion}`],
    consumer,
  );
  console.log("Packed ESM import and CommonJS require smoke tests passed");
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
