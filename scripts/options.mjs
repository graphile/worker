#!/usr/bin/env zx
import "zx/globals";
import * as fs from "fs/promises";

// Create a symlink so `import "graphile-worker"` works
await $`ln -s .. node_modules/graphile-worker`;

// Get the markdown output for options
const output = await $`graphile config options`;

// Crop it down to only include the stuff under the worker header
const SEARCH = "\n## worker\n";
const i = output.stdout.indexOf(SEARCH);
if (i < 0) {
  throw new Error("Worker heading not found!");
}
const optionsMd = output.stdout.slice(i + SEARCH.length).trim();

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
