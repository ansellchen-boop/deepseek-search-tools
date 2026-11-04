/**
 * Usage accounting for deepseek-search-tools.
 *
 * Every `web_search` / `web_fetch` call the plugin serves is appended to a
 * bounded, append-only record list that the Settings page reads back: what was
 * searched, how many results came back, whether it worked, and how long it took.
 *
 * Storage is a single JSON file under the DSH home
 * (`<DSH_HOME>/plugin-data/deepseek-search-tools/usage.json`) written atomically
 * through a temporary file, so a crash mid-write cannot truncate the history.
 * Reads/writes are best-effort: accounting must never fail a search.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

/** How many individual calls are kept on disk (older calls are dropped). */
export const USAGE_RECORD_LIMIT = 2_000;

/** How many calls the Settings page shows in one list. */
export const USAGE_RECENT_LIMIT = 300;

const STORE_VERSION = 1;
const DAY_MS = 86_400_000;
const SAVE_DEBOUNCE_MS = 400;

/**
 * Resolve the directory holding `usage.json`.
 * @param explicit - a configured `usageDataDir`, or "" for the default.
 * @returns an absolute directory path.
 */
export function resolveDataDir(explicit) {
  const configured = String(explicit ?? "").trim();
  if (configured) return configured;
  const home = String(process.env.DSH_HOME ?? "").trim() || join(homedir(), ".dsh");
  return join(home, "plugin-data", "deepseek-search-tools");
}

const pad = (value) => String(value).padStart(2, "0");

/**
 * Local calendar day of a timestamp.
 * @param at - epoch milliseconds.
 * @returns `YYYY-MM-DD` in the host's local time.
 */
export function dayKey(at) {
  const date = new Date(at);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const isRecord = (value) =>
  value !== null &&
  typeof value === "object" &&
  Number.isFinite(value.at) &&
  (value.kind === "search" || value.kind === "fetch") &&
  typeof value.ok === "boolean";

/**
 * Normalize one call into a stored record.
 * @param entry - the raw call description.
 * @returns a plain, JSON-lossless record.
 */
function toRecord(entry) {
  const at = Number.isFinite(entry?.at) ? entry.at : Date.now();
  const kind = entry?.kind === "fetch" ? "fetch" : "search";
  const record = {
    at,
    kind,
    target: String(entry?.target ?? "").slice(0, 500),
    ok: entry?.ok === true,
    ms: Math.max(0, Math.trunc(Number(entry?.ms) || 0)),
    results: Math.max(0, Math.trunc(Number(entry?.results) || 0)),
  };
  const requested = Number(entry?.requested);
  if (Number.isFinite(requested) && requested > 0) record.requested = Math.trunc(requested);
  // v0.2.0: which vendor served the call. Older records have no such field and
  // the Settings page shows "—" for them.
  const backend = String(entry?.backend ?? "").trim();
  if (backend) record.backend = backend.slice(0, 60);
  if (entry?.origin === "test") record.origin = "test";
  if (!record.ok) record.error = String(entry?.error ?? "unknown error").slice(0, 300);
  return record;
}

/**
 * Aggregate a list of records.
 * @param records - the records to fold.
 * @returns counts, result totals, and the mean latency of successful calls.
 */
function bucket(records) {
  let search = 0;
  let fetch = 0;
  let failed = 0;
  let results = 0;
  let okMs = 0;
  let okCount = 0;
  for (const record of records) {
    if (record.kind === "fetch") fetch += 1;
    else search += 1;
    if (record.ok) {
      results += record.results;
      okMs += record.ms;
      okCount += 1;
    } else {
      failed += 1;
    }
  }
  return {
    calls: records.length,
    search,
    fetch,
    failed,
    results,
    avgMs: okCount === 0 ? 0 : Math.round(okMs / okCount),
  };
}

/**
 * Create the usage store.
 * @param options - `dataDir` override, `limit` of stored records, and a logger.
 * @returns the store: record, summarize, clear, dataDir.
 */
const stores = new Map();

export function createUsageStore(options = {}) {
  // One writer per file. Two store instances would each keep their own list and
  // overwrite the whole document, silently dropping the other's calls.
  const directory = resolveDataDir(options.dataDir);
  const existing = stores.get(directory);
  if (existing !== undefined) return existing;
  const store = buildUsageStore(options, directory);
  stores.set(directory, store);
  return store;
}

function buildUsageStore({ limit = USAGE_RECORD_LIMIT, logger } = {}, directory) {
  const file = join(directory, "usage.json");
  // The package used to be called `dsh-deepseek-tools`; keep reading that log so
  // an upgrade does not blank the Settings page. Writes always go to the new file.
  const legacyFile =
    basename(directory) === "deepseek-search-tools"
      ? join(dirname(directory), "dsh-deepseek-tools", "usage.json")
      : null;

  let records = [];
  let loaded = false;
  let loading = null;
  let pending = [];
  let saving = null;
  let dirty = false;
  let sequence = 0;
  let timer = null;

  const warn = (message) => {
    try {
      logger?.debug?.(`deepseek-search-tools: ${message}`);
    } catch {
      // the logger is a convenience; accounting must not throw
    }
  };

  const readRecords = async (path) => {
    const text = await readFile(path, "utf8");
    const parsed = JSON.parse(text);
    return Array.isArray(parsed?.records) ? parsed.records.filter(isRecord) : [];
  };

  const ensureLoaded = () => {
    if (loaded) return Promise.resolve();
    loading ??= (async () => {
      try {
        records = (await readRecords(file)).concat(pending);
        pending = [];
      } catch (error) {
        // A missing file is the normal first-run state; a corrupt file is
        // dropped rather than allowed to break every later write.
        let recovered = [];
        if (error?.code !== "ENOENT") warn(`could not read usage.json (${error?.message ?? error})`);
        if (legacyFile !== null) {
          try {
            recovered = await readRecords(legacyFile);
          } catch {
            // no log under the old package name: nothing to carry over
          }
        }
        records = recovered.concat(pending);
        pending = [];
      }
      if (records.length > limit) records = records.slice(-limit);
      loaded = true;
    })();
    return loading;
  };

  const writeOnce = async () => {
    // Fold in anything recorded before the first read settled — otherwise the
    // very first debounced write would persist an empty list and lose the call.
    await ensureLoaded();
    try {
      await mkdir(directory, { recursive: true });
      // The temporary name carries a sequence number: two writers sharing one
      // temporary path is how a half-written document ends up on disk.
      const temporary = `${file}.${process.pid}.${(sequence += 1)}.tmp`;
      await writeFile(temporary, `${JSON.stringify({ version: STORE_VERSION, records }, null, 0)}\n`, "utf8");
      await rename(temporary, file);
    } catch (error) {
      warn(`could not write usage.json (${error?.message ?? error})`);
    }
  };

  // Exactly one writer at a time. Every caller (a record, a clear, a flush)
  // marks the store dirty and awaits the same loop, so writes are serialized.
  const save = () => {
    dirty = true;
    if (saving !== null) return saving;
    saving = (async () => {
      while (dirty) {
        dirty = false;
        await writeOnce();
      }
    })().finally(() => {
      saving = null;
      // A record that arrived after the loop's last check still needs a write.
      if (dirty) void save();
    });
    return saving;
  };

  const scheduleSave = () => {
    dirty = true;
    if (timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      void save();
    }, SAVE_DEBOUNCE_MS);
    timer.unref?.();
  };

  return {
    dataDir: directory,
    file,

    /**
     * Append one call. Never throws and never awaits I/O.
     * @param entry - `{ kind, target, ok, ms, results, requested?, origin?, error? }`.
     */
    record(entry) {
      const record = toRecord(entry);
      if (loaded) records.push(record);
      else pending.push(record);
      if (records.length > limit) records = records.slice(-limit);
      if (!loaded) void ensureLoaded();
      scheduleSave();
    },

    /**
     * Read the dashboard payload.
     * @param days - how many trailing local days the bar chart covers.
     * @returns totals, today, the per-day series, and the most recent calls.
     */
    async summarize(days = 7) {
      await ensureLoaded();
      const span = Math.min(31, Math.max(1, Math.trunc(days) || 7));
      const now = new Date();
      const series = [];
      for (let index = span - 1; index >= 0; index -= 1) {
        const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - index);
        const key = dayKey(day.getTime());
        series.push({ date: key, ...bucket(records.filter((record) => dayKey(record.at) === key)) });
      }
      return {
        file,
        total: bucket(records),
        today: series[series.length - 1],
        byDay: series,
        recent: records.slice(-USAGE_RECENT_LIMIT).reverse(),
        limit,
      };
    },

    /** Drop every stored call. */
    async clear() {
      await ensureLoaded();
      records = [];
      pending = [];
      scheduleSave();
      await this.flush();
      return { cleared: true };
    },

    /** Wait for any debounced write to reach disk. */
    async flush() {
      await ensureLoaded();
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      await save();
    },
  };
}
