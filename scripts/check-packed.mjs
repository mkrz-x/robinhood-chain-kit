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

  const rootAssertion =
    "if (m.CHAIN_ID !== 4663 || typeof m.assessOracleHealth !== 'function' " +
    "|| typeof m.inspectTransaction !== 'function' " +
    "|| typeof m.readScaledUiMultiplierState !== 'function' " +
    "|| typeof m.loadStockTokenDirectory !== 'function') " +
    "throw new Error('packed root exports are incomplete')";
  // Subpath entries under both module systems. The viem entry matters most:
  // its runtime must load WITHOUT viem installed, because viem is an optional
  // peer and this consumer deliberately does not have it.
  const subpathAssertions = [
    ["robinhood-chain-kit/viem", "typeof m.robinhoodChainActions === 'function' && typeof m.createViemPreflightAdapter === 'function'"],
    ["robinhood-chain-kit/oracle", "typeof m.checkOracleHealth === 'function' && typeof m.computePriceDeviationBps === 'function'"],
    ["robinhood-chain-kit/erc8056", "typeof m.readScaledUiMultiplierState === 'function' && typeof m.findStockToken === 'function'"],
    ["robinhood-chain-kit/preflight", "typeof m.inspectTransaction === 'function'"],
  ];
  const scripts = [
    ["--input-type=module", (spec) => `const m=await import('${spec}');`],
    ["--input-type=commonjs", (spec) => `const m=require('${spec}');`],
  ];
  for (const [inputType, load] of scripts) {
    run(
      process.execPath,
      [inputType, "--eval", `${load("robinhood-chain-kit")}${rootAssertion}`],
      consumer,
    );
    for (const [spec, condition] of subpathAssertions) {
      run(
        process.execPath,
        [
          inputType,
          "--eval",
          `${load(spec)}if (!(${condition})) throw new Error('packed ${spec} exports are incomplete')`,
        ],
        consumer,
      );
    }
  }
  console.log("Packed ESM import and CommonJS require smoke tests passed (root + 4 subpaths)");
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
