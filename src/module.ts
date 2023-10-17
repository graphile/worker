import { readFileSync } from "fs";
import { dirname } from "path";
import _module = require("module");
const { Module, builtinModules } = _module;

declare global {
  var graphileWorker_fauxRequire: typeof fauxRequire;
  var graphileWorker_fauxRequireCache: Record<string, any> | null;
}

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
export function fauxRequire(spec: string, cache: Record<string, any> = {}) {
  if (builtinModules.includes(spec)) {
    // Don't try and faux require builtin modules
    return require(spec);
  }
  const filename = require.resolve(spec);
  if (filename.indexOf("/node_modules/") >= 0) {
    // Don't try and faux require node_modules (we only want one copy of these
    // in memory)
    return require(spec);
  }
  if (!filename.endsWith(".js")) {
    // Don't try and faux require .json, etc files
    return require(spec);
  }
  if (cache[filename]) {
    return cache[filename].exports;
  }
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

const fauxRequire = (path) => {
  const spec =
    path.startsWith(".") || path.startsWith("/")
      ? resolve(__dirname, path)
      : path;
  return global.graphileWorker_fauxRequire(spec, fauxRequire.cache);
}
fauxRequire.resolve = require.resolve;
fauxRequire.cache = global.graphileWorker_fauxRequireCache;

(function(module, exports, require) {
${code};
})(module, exports, fauxRequire);
`;

  // Since the code is evaluated synchronously, we set this immediately before
  // compiling and clear after.
  global.graphileWorker_fauxRequireCache = cache;
  cache[filename] = replacementModule;
  // @ts-ignore
  replacementModule._compile(codeWithWrapper, filename);
  global.graphileWorker_fauxRequireCache = null;

  replacementModule.loaded = true;

  return replacementModule.exports;
}

global.graphileWorker_fauxRequire = fauxRequire;
