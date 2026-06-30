#!/usr/bin/env zx
// @ts-check
import "zx/globals";

import * as fs from "fs/promises";

// Create a temporary instance so we can read the options
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "gwdu-"));
const prev = process.cwd();

// Determine TypeScript version to synchronise with ours
const packageJson = JSON.parse(
  await fs.readFile(`${prev}/package.json`, "utf8"),
);
const typescriptVersion = packageJson.devDependencies.typescript;
if (!typescriptVersion) {
  throw new Error("Could not determine `typescript` version");
}
const graphileVersion = packageJson.devDependencies.graphile;
if (!graphileVersion) {
  throw new Error("Could not determine `graphile` version");
}

await fs.writeFile(
  `${tmp}/package.json`,
  JSON.stringify(
    { type: "module", name: "@localrepo/tmp", private: true },
    null,
    2,
  ) + "\n",
);
await fs.cp(`${prev}/.yarnrc.yml`, `${tmp}/.yarnrc.yml`);
await fs.cp(`${prev}/.yarn`, `${tmp}/.yarn/`, { recursive: true });
cd(tmp);
await $`yarn link ${prev}`;

// If we have the crystal repo locally, use it's version of the `graphile` CLI
try {
  const crystalRepo = `${process.env.HOME}/Dev/graphile/crystal`;
  const stat = await fs.stat(crystalRepo);
  if (stat.isDirectory()) {
    console.log(`Using local crystal modules`);
    await $`yarn link ${crystalRepo} --all`;
  }
} catch {
  // Ignore
}

await $`yarn add graphile-worker graphile@${graphileVersion} typescript@${typescriptVersion}`;
await fs.writeFile(
  `graphile.config.ts`,
  `\
import type {} from "graphile-worker";

const preset: GraphileConfig.Preset = {
  worker: {},
};

export default preset;
`,
);

// Get the markdown output for options
const output = await $`yarn graphile config options`;

// Go back and destroy our tempdir
cd(prev);
// Remove our temporary directory
await fs.rm(tmp, { recursive: true, force: true });

// Crop it down to only include the stuff under the worker header
const SEARCH = "\n## worker\n";
const i = output.stdout.indexOf(SEARCH);
if (i < 0) {
  console.log(output.stdout);
  throw new Error("Worker heading not found!");
}
const optionsMd = output.stdout
  .slice(i + SEARCH.length)
  .trim()
  .replace(/\(https:\/\/worker\.graphile\.org\//g, "(/");

// Load the config.md doc file and replace the part between the comment tags
const configMd = await fs.readFile("website/docs/config.md", "utf8");
const START = "<!--BEGIN:OPTIONS-->";
const END = "<!--END:OPTIONS-->";
const start = configMd.indexOf(START);
const end = configMd.indexOf(END);
if (start < 0 || end <= start) {
  throw new Error(`Invalid format for start/end!`);
}
const newMd =
  configMd.substring(0, start + START.length) +
  "\n" +
  optionsMd +
  "\n" +
  configMd.slice(end);

// Write this file back out again
await fs.writeFile("website/docs/config.md", newMd);

// And finally prettify it
await $`prettier --write website/docs/config.md`;

console.log("Done");
