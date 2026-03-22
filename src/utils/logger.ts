import fs from "fs";

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
  isHTTP: false,
  log: (...args: any[]) => {
    if (Logger.isHTTP) {
      console.log("[INFO]", ...args);
    } else {
      console.error("[INFO]", ...args);
    }
  },
  error: (...args: any[]) => {
    console.error("[ERROR]", ...args);
  },
};
/* eslint-enable @typescript-eslint/no-explicit-any */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- writes arbitrary debug data
export function writeLogs(name: string, value: any): void {
  if (process.env.NODE_ENV !== "development") return;

  try {
    const logsDir = "logs";
    const logPath = `${logsDir}/${name}`;

    // Check if we can write to the current directory
    fs.accessSync(process.cwd(), fs.constants.W_OK);

    // Create logs directory if it doesn't exist
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    fs.writeFileSync(logPath, JSON.stringify(value, null, 2));
    Logger.log(`Debug log written to: ${logPath}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    Logger.log(`Failed to write logs to ${name}: ${errorMessage}`);
  }
}
