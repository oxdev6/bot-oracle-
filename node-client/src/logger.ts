import type { LogLevel } from "./types";

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  /** A logger that stamps every record with the given base fields. */
  child(base: LogFields): Logger;
}

export type LogFields = Record<string, unknown>;

export interface LoggerOptions {
  level?: LogLevel;
  /** `json` emits one JSON object per line (for log shippers); `pretty` is for
   *  a human at a terminal. */
  format?: "json" | "pretty";
  /** Sink for error/warn lines. Defaults to process.stderr. */
  stderr?: (line: string) => void;
  /** Sink for debug/info lines. Defaults to process.stdout. */
  stdout?: (line: string) => void;
  /** Clock injection for deterministic tests. */
  now?: () => Date;
}

function normalizeLevel(level: LogLevel | undefined): LogLevel {
  return level && level in ORDER ? level : "info";
}

export function createLogger(opts: LoggerOptions = {}, base: LogFields = {}): Logger {
  const threshold = ORDER[normalizeLevel(opts.level)];
  const format = opts.format ?? "pretty";
  const writeOut = opts.stdout ?? ((line) => process.stdout.write(line + "\n"));
  const writeErr = opts.stderr ?? ((line) => process.stderr.write(line + "\n"));
  const clock = opts.now ?? (() => new Date());

  function emit(level: LogLevel, msg: string, fields?: LogFields) {
    if (ORDER[level] < threshold) return;
    const merged = { ...base, ...fields };
    const line =
      format === "json" ? formatJson(level, msg, merged, clock()) : formatPretty(level, msg, merged, clock());
    if (level === "error" || level === "warn") writeErr(line);
    else writeOut(line);
  }

  return {
    debug: (m, f) => emit("debug", m, f),
    info: (m, f) => emit("info", m, f),
    warn: (m, f) => emit("warn", m, f),
    error: (m, f) => emit("error", m, f),
    child: (extra) => createLogger(opts, { ...base, ...extra }),
  };
}

function formatJson(level: LogLevel, msg: string, fields: LogFields, now: Date): string {
  return JSON.stringify({ time: now.toISOString(), level, msg, ...fields });
}

function formatPretty(level: LogLevel, msg: string, fields: LogFields, now: Date): string {
  const stamp = now.toISOString().slice(11, 23);
  const suffix = Object.entries(fields)
    .map(([k, v]) => `${k}=${formatValue(v)}`)
    .join(" ");
  return `${stamp} ${level.toUpperCase().padEnd(5)} ${msg}${suffix ? " " + suffix : ""}`;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return String(value);
  if (typeof value === "string") return value.includes(" ") ? JSON.stringify(value) : value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
