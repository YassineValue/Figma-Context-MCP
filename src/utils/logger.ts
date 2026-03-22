import { access, constants, mkdir, writeFile } from "fs/promises";

/**
 * Simple metrics counters for observability.
 * Tracks cache performance and API call volume without external dependencies.
 */
export const Metrics = {
  cacheHits: 0,
  cacheMisses: 0,
  apiCalls: 0,
  /** Reset all counters (useful for testing) */
  reset() {
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.apiCalls = 0;
  },
  summary() {
    const total = this.cacheHits + this.cacheMisses;
    const hitRate = total > 0 ? Math.round((this.cacheHits / total) * 100) : 0;
    return `cache: ${this.cacheHits}/${total} hits (${hitRate}%), api calls: ${this.apiCalls}`;
  },
};

/* eslint-disable @typescript-eslint/no-explicit-any -- logging accepts arbitrary values */
export const Logger = {
  /**
   * All logging goes to stderr. This is critical for stdio transport —
   * stdout is reserved for JSON-RPC messages. Even in HTTP mode, stderr
   * is the correct destination for operational logs.
   */
  log: (...args: any[]) => {
    console.error("[INFO]", ...args);
  },
  error: (...args: any[]) => {
    console.error("[ERROR]", ...args);
  },
};
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Write debug data to a log file. Only runs in development mode.
 * Uses async fs to avoid blocking the event loop on large Figma files.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- writes arbitrary debug data
export function writeLogs(name: string, value: any): void {
  if (process.env.NODE_ENV !== "development") return;

  const logsDir = "logs";
  const logPath = `${logsDir}/${name}`;

  // Fire-and-forget -- callers don't await this
  void (async () => {
    try {
      await access(process.cwd(), constants.W_OK);
      await mkdir(logsDir, { recursive: true });
      await writeFile(logPath, JSON.stringify(value, null, 2));
      Logger.log(`Debug log written to: ${logPath}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      Logger.log(`Failed to write logs to ${name}: ${errorMessage}`);
    }
  })();
}
