import { dirname } from "path";

import { readFileSync } from "fs";
import _module = require("module");
const { Module } = _module;

function stripBOM(str: string) {
  if (str.charCodeAt(0) === 0xfeff) {
    return str.slice(1);
  }
  return str;
}

/**
 * This function emulates the behavior of `require()`, enabling us to call it
 * multiple times without worrying about having to clear out the cache (useful
 * for watch mode).
 */
export function fauxRequire(spec: string) {
  const filename = require.resolve(spec);
  const contents = readFileSync(filename, "utf8");

  const code = stripBOM(contents);

  // Construct the module
  const replacementModule = new Module(filename, this);
  // And initialise it:
  // Ref: https://github.com/nodejs/node/blob/eb6741b15ebd93ffdd71e87cbc1350b9e94ef222/lib/internal/modules/cjs/loader.js#L616
  replacementModule.filename = filename;

  /*
   * This is naughty - we're using the Node internals. We should probably
   * instead duplicate the code here like @std/esm does:
   *
   * https://github.com/standard-things/esm/issues/66
   * https://github.com/standard-things/esm/blob/16035f6d25fdafb921a49401c7693a863cc14f81/src/module/static/node-module-paths.js
   * https://github.com/standard-things/esm/blob/16035f6d25fdafb921a49401c7693a863cc14f81/src/module/internal/load.js
   */
  // @ts-ignore
  replacementModule.paths = Module._nodeModulePaths(dirname(filename));
  const codeWithWrapper = `\
const { resolve } = require('path');
(function(module, exports, require) {
${code};
})(module, exports, (path) => global.graphileWorker_fauxRequire(resolve(__dirname, path)));
`;
  // @ts-ignore
  replacementModule._compile(codeWithWrapper, filename);

  replacementModule.loaded = true;

  return replacementModule.exports;
}

global["graphileWorker_fauxRequire"] = fauxRequire;
