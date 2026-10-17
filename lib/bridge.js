/**
 * The Settings → Tools page's host half.
 *
 * The browser bundle cannot reach the credentials service or the usage file
 * directly, so this module publishes a handful of loopback-only JSON routes on
 * the Web server the Settings page calls:
 *
 *   POST <prefix>/overview      dashboard payload (API status + usage)
 *   POST <prefix>/test          one live search against /v1/tools/search
 *   POST <prefix>/key-set       store the API key in the credentials service
 *   POST <prefix>/key-unset     forget the stored key
 *   POST <prefix>/usage-clear   drop the accounting history
 *
 * Every route is POST-only and refuses non-loopback peers: a key write or a
 * usage wipe must not be reachable from another origin.
 */

export const BRIDGE_PREFIX = "/api/deepseek-search-tools";

const MAX_JSON_BODY_BYTES = 64 * 1024;

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

/**
 * Build the route table.
 * @param handlers - `{ overview, test, setKey, unsetKey, clearUsage }`.
 * @returns the routes to register with `ctx.webServer.register`.
 */
export function makeBridgeRoutes(handlers, prefix = BRIDGE_PREFIX) {
  const guard = (request, response) => {
    if (!isLoopbackRequest(request)) {
      writeJson(response, 403, { ok: false, message: "loopback requests only" });
      return false;
    }
    if (request.method !== "POST") {
      writeJson(response, 405, { ok: false, message: `method not allowed: ${request.method ?? ""}` });
      return false;
    }
    return true;
  };

  const plain = (path, run) => ({
    kind: "exact",
    path: `${prefix}${path}`,
    handler: async (request, response) => {
      if (!guard(request, response)) return;
      try {
        writeJson(response, 200, await run());
      } catch (error) {
        writeJson(response, 200, { ok: false, message: error instanceof Error ? error.message : String(error) });
      }
    },
  });

  const withBody = (path, run) => ({
    kind: "exact",
    path: `${prefix}${path}`,
    handler: async (request, response) => {
      if (!guard(request, response)) return;
      const body = await readJsonBody(request);
      if (body === undefined) {
        writeJson(response, 400, { ok: false, message: "malformed JSON body" });
        return;
      }
      try {
        writeJson(response, 200, await run(body));
      } catch (error) {
        writeJson(response, 200, { ok: false, message: error instanceof Error ? error.message : String(error) });
      }
    },
  });

  return [
    plain("/overview", () => handlers.overview()),
    plain("/test", () => handlers.test()),
    withBody("/key-set", (body) => handlers.setKey(body)),
    withBody("/key-unset", () => handlers.unsetKey()),
    withBody("/usage-clear", () => handlers.clearUsage()),
  ];
}
