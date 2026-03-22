import { execFile } from "child_process";
import { promisify } from "util";
import { Logger } from "./logger.js";

const execFileAsync = promisify(execFile);

type RequestOptions = RequestInit & {
  /**
   * Force format of headers to be a record of strings, e.g. { "Authorization": "Bearer 123" }
   *
   * Avoids complexity of needing to deal with `instanceof Headers`, which is not supported in some environments.
   */
  headers?: Record<string, string>;
};

/**
 * Format a helpful error message for Figma API HTTP errors.
 * Rate limits (429) and server errors (529) are common and get specific guidance.
 */
function formatHttpError(status: number, statusText: string, url: string): string {
  if (status === 429) {
    return (
      `Figma API rate limit (429) hit for ${url}. ` +
      "Figma applies rate limits per-token; wait 30-60s before retrying. " +
      "If this happens frequently, consider caching (FIGMA_CACHING env var) or using a higher-tier Figma plan."
    );
  }
  if (status === 529) {
    return (
      `Figma API overloaded (529) for ${url}. ` +
      "This is a temporary Figma-side issue. Wait 60-120s and retry."
    );
  }
  if (status === 403) {
    return (
      `Figma API access denied (403) for ${url}. ` +
      "Check that your API key or OAuth token has access to this file."
    );
  }
  if (status === 404) {
    return `Figma resource not found (404) for ${url}. Check that the file key and node IDs are correct.`;
  }
  return `Fetch failed with status ${status}: ${statusText}`;
}

/**
 * Fetch a URL with automatic curl fallback for corporate proxy environments.
 *
 * Not a true retry -- if fetch() fails (common behind corporate proxies that
 * block Node's native TLS), falls back to curl which respects system proxy config.
 */
export async function fetchWithRetry<T extends { status?: number }>(
  url: string,
  options: RequestOptions = {},
): Promise<T> {
  try {
    const response = await fetch(url, options);

    if (!response.ok) {
      throw new Error(formatHttpError(response.status, response.statusText, url));
    }
    return (await response.json()) as T;
  } catch (fetchError: unknown) {
    const fetchMessage = fetchError instanceof Error ? fetchError.message : String(fetchError);
    Logger.log(
      `[fetchWithRetry] Initial fetch failed for ${url}: ${fetchMessage}. Likely a corporate proxy or SSL issue. Attempting curl fallback.`,
    );

    const curlHeaders = formatHeadersForCurl(options.headers);
    // -s: Silent mode, -S: Show errors, --fail-with-body: error on HTTP failures, -L: Follow redirects
    const curlArgs = ["-s", "-S", "--fail-with-body", "-L", ...curlHeaders, url];

    try {
      Logger.log(`[fetchWithRetry] Executing curl with args: ${JSON.stringify(curlArgs)}`);
      const { stdout, stderr } = await execFileAsync("curl", curlArgs);

      if (stderr) {
        if (
          !stdout ||
          stderr.toLowerCase().includes("error") ||
          stderr.toLowerCase().includes("fail")
        ) {
          throw new Error(`Curl command failed with stderr: ${stderr}`);
        }
        Logger.log(
          `[fetchWithRetry] Curl command for ${url} produced stderr (but might be informational): ${stderr}`,
        );
      }

      if (!stdout) {
        throw new Error("Curl command returned empty stdout.");
      }

      const result = JSON.parse(stdout) as T;

      // Some Figma endpoints return 200 with an error status in the JSON body
      if (result.status && result.status !== 200) {
        throw new Error(formatHttpError(result.status, "API error in response body", url));
      }

      return result;
    } catch (curlError: unknown) {
      const curlMessage = curlError instanceof Error ? curlError.message : String(curlError);
      Logger.error(`[fetchWithRetry] Curl fallback also failed for ${url}: ${curlMessage}`);
      // Throw combined error so callers see both failure reasons
      const fetchMessage = fetchError instanceof Error ? fetchError.message : String(fetchError);
      throw new Error(
        `Figma API request failed. fetch: ${fetchMessage} | curl fallback: ${curlMessage}`,
      );
    }
  }
}

/**
 * Converts HeadersInit to an array of curl header arguments for execFile.
 */
function formatHeadersForCurl(headers: Record<string, string> | undefined): string[] {
  if (!headers) {
    return [];
  }

  const headerArgs: string[] = [];
  for (const [key, value] of Object.entries(headers)) {
    headerArgs.push("-H", `${key}: ${value}`);
  }
  return headerArgs;
}
