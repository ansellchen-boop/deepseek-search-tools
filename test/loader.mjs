import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

/**
 * Shim loader: lets the plugin resolve its DSH peer dependency
 * (`@deepseek-ai/schemastery`) from the desktop profile when Node's normal
 * resolution can't see it (the plugin lives in the workspace, the harness
 * dependency is linked into C:\Users\ansel\.dsh\profiles\desktop\node_modules).
 *
 * This is a LOCAL TESTING AID ONLY. In the desktop profile Node resolves the
 * bare specifier normally, and this file is not used.
 */
const PROFILE_NODE_MODULES = "C:/Users/ansel/.dsh/profiles/desktop/node_modules/";
const require = createRequire(pathToFileURL(PROFILE_NODE_MODULES + "noop.js"));
const isBare = (specifier) => !/^(node:|[a-zA-Z][a-zA-Z0-9+.-]*:)/.test(specifier) && !specifier.startsWith(".") && !specifier.startsWith("/");

export function initialize() {}

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (isBare(specifier)) {
      try {
        return { url: pathToFileURL(require.resolve(specifier)).href, shortCircuit: true };
      } catch {
        /* fall through to the original error */
      }
    }
    throw error;
  }
}
