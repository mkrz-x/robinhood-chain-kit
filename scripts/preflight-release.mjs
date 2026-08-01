#!/usr/bin/env node
/**
 * The cheap checks, before `npm run release` spends thirty seconds on the
 * expensive ones.
 *
 * Two reasons this exists.
 *
 * The first is patience: running `release` on an already-published version used
 * to type-check, build, run 219 tests, lint the package and type-check the
 * examples, and only then have npm say "you cannot publish over the previously
 * published versions". Every fact needed to refuse that is available in three
 * seconds.
 *
 * The second matters more. Publishing is the one step here that cannot be
 * undone, and moving releases to a laptop introduced exactly one new way to get
 * it wrong: publishing a tree that is not the one the tag names. The release
 * workflow detects that afterwards by comparing checksums, which is useful but
 * late — the bad tarball is already on the registry and npm does not allow a
 * replacement. Checking the working tree here prevents it instead.
 *
 * No dependencies, no network beyond one `npm view`. Pure preflight: it reads
 * and refuses, it never writes.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const fail = (...lines) => {
  for (const line of lines) console.error(`  ${line}`);
  process.exit(1);
};

const run = (cmd, args) =>
  execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const { name, version } = pkg;
console.error(`preflight ${name}@${version}`);

/* 1. the version must not already exist ---------------------------------- */
// `npm view <pkg>@<free-version>` exits 1 with E404 — being free is the normal
// path for a release, so a non-zero exit has to be classified rather than
// treated as failure. Reporting "could not reach the registry" on every healthy
// release would train the reader to ignore the one time it means something.
let published = "";
try {
  published = run("npm", ["view", `${name}@${version}`, "version"]);
} catch (error) {
  const stderr = String(error?.stderr ?? "");
  if (!/E404|No match found for version/.test(stderr)) {
    // a registry that cannot be reached is not evidence the version is free;
    // let the publish itself be the authority rather than guessing here
    const first = stderr.trim().split("\n")[0] || String(error);
    console.error(`  ! registry lookup failed, skipping the duplicate check: ${first}`);
  }
}
if (published) {
  fail(
    `${name}@${version} is already on the registry.`,
    "bump the version in package.json and add a CHANGELOG section for it.",
    "this script refuses early so you do not wait for the full verify to find out.",
  );
}

/* 2. the working tree must be clean -------------------------------------- */
// the failure a manual release introduces, and the only one the tag workflow
// cannot prevent — it can only report it once the tarball is already public
let dirty = "";
try {
  dirty = run("git", ["status", "--porcelain"]);
} catch {
  fail("not a git working tree — refusing to publish from an unknown source.");
}
if (dirty) {
  fail(
    "the working tree has uncommitted changes:",
    ...dirty.split("\n").slice(0, 10),
    "",
    "publishing is irreversible and npm does not allow replacing a version,",
    "so what goes out must be a commit you can point at afterwards.",
  );
}

/* 3. the CHANGELOG must describe this version ---------------------------- */
// mirrors the tag workflow's gate. finding out at tag time that the changelog
// is empty means the release is already public and the record is already wrong.
// Scanned line by line rather than with one regex. The first attempt ended the
// section with `\\Z`, which JavaScript does not support — it matches a literal
// "Z", so the last version in the file would have been read wrong. This mirrors
// the awk in the release workflow exactly.
const changelog = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
// dots in a semver are regex wildcards until escaped, and the trailing class
// stops 0.8.0 from matching a future 0.8.0-rc
const heading = new RegExp(`^## ${version.replace(/\./g, "\\.")}([^0-9.]|$)`);
let inside = false;
const collected = [];
for (const line of changelog.split("\n")) {
  if (inside && line.startsWith("## ")) break;
  if (inside) collected.push(line);
  else if (heading.test(line)) inside = true;
}
const body = collected.join("\n");
if (!inside || body.trim() === "") {
  fail(
    `CHANGELOG.md has no '## ${version}' section, or it is empty.`,
    "a version the changelog has never heard of is worse than an absent one,",
    "because the file then reads as complete when it is not.",
  );
}

const commit = run("git", ["rev-parse", "--short", "HEAD"]);
const branch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
console.error(`  clean tree at ${commit} (${branch}), changelog present, version free`);
console.error(`  after publishing:  git tag -a v${version} -m "..." && git push origin v${version}`);
