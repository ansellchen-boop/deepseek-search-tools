/**
 * `--import` shim so `node test/harness.mjs` works from the workspace without a
 * node_modules link. Registers test/loader.mjs (see its header).
 */
import { register } from "node:module";
import { pathToFileURL } from "node:url";

register("./loader.mjs", pathToFileURL(import.meta.filename));
