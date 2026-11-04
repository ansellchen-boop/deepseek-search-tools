/**
 * The Settings → Tools page's host half.
 *
 * The browser bundle cannot reach the credentials service or the usage file
 * directly, so this module publishes a handful of loopback-only JSON routes on
 * the Web server the Settings page calls:
 *
 *   GET  <prefix>/backend-types  the v0.3.0 backend type catalog
 *   GET  <prefix>/usage-guide    the v0.3.1 structured usage guide
 *   POST <prefix>/overview       dashboard payload (API status + usage)
 *   POST <prefix>/test           one live search against /v1/tools/search
 *   POST <prefix>/backends/add     add one backend to searchBackends/fetchBackends
 *   POST <prefix>/backends/update  edit one backend row
 *   POST <prefix>/backends/remove  drop one backend row
 *   POST <prefix>/backends/toggle  enable/disable one row
 *   POST <prefix>/backends/key     store a backend key in the credentials service
 *   DELETE <prefix>/backends/key   forget a backend key
 *   POST <prefix>/key-set       store the API key in the credentials service
 *   POST <prefix>/key-unset     forget the stored key
 *   POST <prefix>/usage-clear   drop the accounting history
 *
 * Every route refuses non-loopback peers: a key write or a usage wipe must not
 * be reachable from another origin. The backend routes are POST/DELETE-only;
 * `backend-types` is the one GET (it is a static catalog and the settings page
 * reads it without a body).
 */

export const BRIDGE_PREFIX = "/api/deepseek-search-tools";

const MAX_JSON_BODY_BYTES = 64 * 1024;

/**
 * A handler failure that must surface as a specific HTTP status (the v0.3.0
 * contract asks for 501 when no config editor is loaded). Everything else
 * keeps the historical 200 + `{ ok: false }` shape.
 */
export class BridgeError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "BridgeError";
    this.status = status;
  }
}

/** A request that provably came from this machine's own page. */
function isLoopbackRequest(request) {
  const address = request.socket?.remoteAddress;
  if (address !== "127.0.0.1" && address !== "::1" && address !== "::ffff:127.0.0.1") return false;
  const host = request.headers.host;
  if (typeof host !== "string") return false;
  let hostUrl;
  try {
    hostUrl = new URL(`http://${host}`);
  } catch {
    return false;
  }
  if (hostUrl.hostname !== "127.0.0.1" && hostUrl.hostname !== "localhost" && hostUrl.hostname !== "[::1]") return false;
  if (request.headers["sec-fetch-site"] === "cross-site") return false;
  const origin = request.headers.origin;
  if (origin === undefined) return true;
  try {
    return new URL(origin).host === hostUrl.host;
  } catch {
    return false;
  }
}

function writeJson(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
  });
  response.end(JSON.stringify(body));
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_JSON_BODY_BYTES) return undefined;
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return parsed !== null && typeof parsed === "object" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function errorBody(error) {
  return { ok: false, message: error instanceof Error ? error.message : String(error) };
}

/** The HTTP status a thrown handler error maps to (200 keeps the old shape). */
function errorStatus(error) {
  return Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599 ? error.status : 200;
}

/**
 * Build the route table.
 * @param handlers - `{ backendTypes, usageGuide, overview, test, backendsAdd,
 *   backendsUpdate, backendsRemove, backendsToggle, backendsKeySet,
 *   backendsKeyUnset, setKey, unsetKey,
 *   clearUsage }`.
 * @returns the routes to register with `ctx.webServer.register`.
 */
export function makeBridgeRoutes(handlers, prefix = BRIDGE_PREFIX) {
  const guard = (request, response, methods) => {
    if (!isLoopbackRequest(request)) {
      writeJson(response, 403, { ok: false, message: "loopback requests only" });
      return false;
    }
    if (!methods.includes(request.method)) {
      writeJson(response, 405, { ok: false, message: `method not allowed: ${request.method ?? ""}` });
      return false;
    }
    return true;
  };

  const plain = (path, run, methods = ["POST"]) => ({
    kind: "exact",
    path: `${prefix}${path}`,
    handler: async (request, response) => {
      if (!guard(request, response, methods)) return;
      try {
        writeJson(response, 200, await run());
      } catch (error) {
        writeJson(response, errorStatus(error), errorBody(error));
      }
    },
  });

  const withBody = (path, run, methods = ["POST"]) => ({
    kind: "exact",
    path: `${prefix}${path}`,
    handler: async (request, response) => {
      if (!guard(request, response, methods)) return;
      const body = await readJsonBody(request);
      if (body === undefined) {
        writeJson(response, 400, { ok: false, message: "malformed JSON body" });
        return;
      }
      try {
        writeJson(response, 200, await run(body, request));
      } catch (error) {
        writeJson(response, errorStatus(error), errorBody(error));
      }
    },
  });

  return [
    // v0.3.0: the only GET — the type catalog the add/edit form is built from.
    plain("/backend-types", () => handlers.backendTypes(), ["GET"]),
    // v0.3.1: the same structured guide the docs are generated from.
    plain("/usage-guide", () => handlers.usageGuide(), ["GET"]),
    plain("/overview", () => handlers.overview()),
    // v0.2.0: the test route accepts `{ kind, backend?, query?, url? }`. No body
    // at all still means the 0.1.0 probe: one DeepSeek search for "DeepSeek".
    withBody("/test", (body) => handlers.test(body)),
    // v0.3.0 backend management. Each write answers with a fresh overview so the
    // page never has to assemble its own copy of the list.
    withBody("/backends/add", (body) => handlers.backendsAdd(body)),
    withBody("/backends/update", (body) => handlers.backendsUpdate(body)),
    withBody("/backends/remove", (body) => handlers.backendsRemove(body)),
    withBody("/backends/toggle", (body) => handlers.backendsToggle(body)),
    // One path answers both methods: POST stores, DELETE forgets. A single
    // exact-path route keeps the method guard authoritative.
    withBody("/backends/key", (body, request) => (
      request.method === "DELETE" ? handlers.backendsKeyUnset(body) : handlers.backendsKeySet(body)
    ), ["POST", "DELETE"]),
    withBody("/key-set", (body) => handlers.setKey(body)),
    withBody("/key-unset", () => handlers.unsetKey()),
    withBody("/usage-clear", () => handlers.clearUsage()),
  ];
}
