/** One JSON object per line — greppable on the workstation, ingestible by any log shipper. */
type Level = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(fields: Record<string, unknown>): Logger;
}

function errorFields(value: unknown): unknown {
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack };
  return value;
}

export function createLogger(base: Record<string, unknown> = {}, sink: (line: string) => void = (l) => process.stdout.write(l + "\n")): Logger {
  const write = (level: Level, msg: string, fields?: Record<string, unknown>) => {
    const out: Record<string, unknown> = { ts: new Date().toISOString(), level, msg, ...base };
    for (const [k, v] of Object.entries(fields ?? {})) out[k] = errorFields(v);
    sink(JSON.stringify(out));
  };
  return {
    debug: (m, f) => (process.env.LOG_LEVEL === "debug" ? write("debug", m, f) : undefined),
    info: (m, f) => write("info", m, f),
    warn: (m, f) => write("warn", m, f),
    error: (m, f) => write("error", m, f),
    child: (fields) => createLogger({ ...base, ...fields }, sink),
  };
}

/** Silent logger for tests. */
export const nullLogger: Logger = { debug() {}, info() {}, warn() {}, error() {}, child: () => nullLogger };
