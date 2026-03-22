import { config as loadEnv } from "dotenv";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import os from "os";
import { isAbsolute, join, resolve } from "path";
import type { FigmaAuthOptions } from "./services/figma.js";
import type { FigmaCachingOptions } from "./services/figma-file-cache.js";

interface ServerConfig {
  auth: FigmaAuthOptions;
  port: number;
  host: string;
  outputFormat: "yaml" | "json";
  skipImageDownloads?: boolean;
  imageDir: string;
  caching?: FigmaCachingOptions;
}

function maskApiKey(key: string): string {
  if (!key || key.length <= 4) return "****";
  return `****${key.slice(-4)}`;
}

interface CliArgs {
  "figma-api-key"?: string;
  "figma-oauth-token"?: string;
  env?: string;
  port?: number;
  host?: string;
  json?: boolean;
  "skip-image-downloads"?: boolean;
  "image-dir"?: string;
}

type DurationUnit = "ms" | "s" | "m" | "h" | "d";

const DURATION_IN_MS: Record<DurationUnit, number> = {
  ms: 1,
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
};

export function getServerConfig(isStdioMode: boolean): ServerConfig {
  // Parse command line arguments
  const argv = yargs(hideBin(process.argv))
    .options({
      "figma-api-key": {
        type: "string",
        description: "Figma API key (Personal Access Token)",
      },
      "figma-oauth-token": {
        type: "string",
        description: "Figma OAuth Bearer token",
      },
      env: {
        type: "string",
        description: "Path to custom .env file to load environment variables from",
      },
      port: {
        type: "number",
        description: "Port to run the server on",
      },
      host: {
        type: "string",
        description: "Host to run the server on",
      },
      json: {
        type: "boolean",
        description: "Output data from tools in JSON format instead of YAML",
        default: false,
      },
      "skip-image-downloads": {
        type: "boolean",
        description: "Do not register the download_figma_images tool (skip image downloads)",
        default: false,
      },
      "image-dir": {
        type: "string",
        description:
          "Base directory for image downloads. The download tool will only write files within this directory. Defaults to the current working directory.",
      },
    })
    .help()
    .version(process.env.NPM_PACKAGE_VERSION ?? "unknown")
    .parseSync() as CliArgs;

  // Load environment variables ASAP from custom path or default
  const envFilePath = argv["env"] ? resolve(argv["env"]) : resolve(process.cwd(), ".env");
  loadEnv({ path: envFilePath, override: true });

  // Build log lines inline (replaces the old configSources tracking)
  const logLines: string[] = [];
  const logSrc = (name: string, value: string, source: string) =>
    logLines.push(`- ${name}: ${value} (source: ${source})`);

  logSrc("ENV_FILE", envFilePath, argv["env"] ? "cli" : "default");

  // Auth
  const auth: FigmaAuthOptions = { figmaApiKey: "", figmaOAuthToken: "", useOAuth: false };

  if (argv["figma-api-key"]) {
    auth.figmaApiKey = argv["figma-api-key"];
  } else if (process.env.FIGMA_API_KEY) {
    auth.figmaApiKey = process.env.FIGMA_API_KEY;
  }

  if (argv["figma-oauth-token"]) {
    auth.figmaOAuthToken = argv["figma-oauth-token"];
    auth.useOAuth = true;
  } else if (process.env.FIGMA_OAUTH_TOKEN) {
    auth.figmaOAuthToken = process.env.FIGMA_OAUTH_TOKEN;
    auth.useOAuth = true;
  }

  if (auth.useOAuth) {
    logSrc("FIGMA_OAUTH_TOKEN", maskApiKey(auth.figmaOAuthToken), argv["figma-oauth-token"] ? "cli" : "env");
    logLines.push("- Authentication Method: OAuth Bearer Token");
  } else {
    logSrc("FIGMA_API_KEY", maskApiKey(auth.figmaApiKey), argv["figma-api-key"] ? "cli" : "env");
    logLines.push("- Authentication Method: Personal Access Token (X-Figma-Token)");
  }

  // Port
  let port = 3333;
  let portSource = "default";
  if (argv.port) {
    port = argv.port;
    portSource = "cli";
  } else if (process.env.FRAMELINK_PORT) {
    const parsed = parseInt(process.env.FRAMELINK_PORT, 10);
    if (isNaN(parsed)) {
      console.error(`Invalid FRAMELINK_PORT "${process.env.FRAMELINK_PORT}". Must be a number.`);
      process.exit(1);
    }
    port = parsed;
    portSource = "env";
  } else if (process.env.PORT) {
    const parsed = parseInt(process.env.PORT, 10);
    if (isNaN(parsed)) {
      console.error(`Invalid PORT "${process.env.PORT}". Must be a number.`);
      process.exit(1);
    }
    port = parsed;
    portSource = "env";
  }
  logSrc("FRAMELINK_PORT", String(port), portSource);

  // Host
  let host = "127.0.0.1";
  let hostSource = "default";
  if (argv.host) {
    host = argv.host;
    hostSource = "cli";
  } else if (process.env.FRAMELINK_HOST) {
    host = process.env.FRAMELINK_HOST;
    hostSource = "env";
  }
  logSrc("FRAMELINK_HOST", host, hostSource);

  // Output format
  let outputFormat: "yaml" | "json" = "yaml";
  let outputSource = "default";
  if (argv.json) {
    outputFormat = "json";
    outputSource = "cli";
  } else if (process.env.OUTPUT_FORMAT) {
    const fmt = process.env.OUTPUT_FORMAT;
    if (fmt !== "yaml" && fmt !== "json") {
      console.error(`Invalid OUTPUT_FORMAT "${fmt}". Must be "yaml" or "json".`);
      process.exit(1);
    }
    outputFormat = fmt;
    outputSource = "env";
  }
  logSrc("OUTPUT_FORMAT", outputFormat, outputSource);

  // Skip image downloads
  let skipImageDownloads = false;
  let skipSource = "default";
  if (argv["skip-image-downloads"]) {
    skipImageDownloads = true;
    skipSource = "cli";
  } else if (process.env.SKIP_IMAGE_DOWNLOADS === "true") {
    skipImageDownloads = true;
    skipSource = "env";
  }
  logSrc("SKIP_IMAGE_DOWNLOADS", String(skipImageDownloads), skipSource);

  // Image directory
  let imageDir = process.cwd();
  let imageDirSource = "default";
  if (argv["image-dir"]) {
    imageDir = resolve(argv["image-dir"]);
    imageDirSource = "cli";
  } else if (process.env.IMAGE_DIR) {
    imageDir = resolve(process.env.IMAGE_DIR);
    imageDirSource = "env";
  }
  logSrc("IMAGE_DIR", imageDir, imageDirSource);

  // Caching
  const caching = parseCachingConfig(process.env.FIGMA_CACHING);
  logLines.push(
    `- FIGMA_CACHING: ${caching ? JSON.stringify({ cacheDir: caching.cacheDir, ttlMs: caching.ttlMs }) : "disabled"}`,
  );

  // Validate auth
  if (!auth.figmaApiKey && !auth.figmaOAuthToken) {
    console.error(
      "Either FIGMA_API_KEY or FIGMA_OAUTH_TOKEN is required (via CLI argument or .env file)",
    );
    process.exit(1);
  }

  // Log configuration in HTTP mode
  if (!isStdioMode) {
    console.error("\nConfiguration:");
    for (const line of logLines) console.error(line);
    console.error();
  }

  return { auth, port, host, outputFormat, skipImageDownloads, imageDir, caching };
}

function parseCachingConfig(rawValue: string | undefined): FigmaCachingOptions | undefined {
  if (!rawValue) return undefined;

  try {
    const parsed = JSON.parse(rawValue) as {
      cacheDir?: string;
      ttl: {
        value: number;
        unit: DurationUnit;
      };
    };

    if (!parsed || typeof parsed !== "object") {
      throw new Error("FIGMA_CACHING must be a JSON object");
    }

    if (!parsed.ttl || typeof parsed.ttl.value !== "number" || parsed.ttl.value <= 0) {
      throw new Error("FIGMA_CACHING.ttl.value must be a positive number");
    }

    if (!parsed.ttl.unit || !(parsed.ttl.unit in DURATION_IN_MS)) {
      throw new Error("FIGMA_CACHING.ttl.unit must be one of ms, s, m, h, d");
    }

    const ttlMs = parsed.ttl.value * DURATION_IN_MS[parsed.ttl.unit];
    const cacheDir = resolveCacheDir(parsed.cacheDir);

    return {
      cacheDir,
      ttlMs,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to parse FIGMA_CACHING: ${message}`);
    process.exit(1);
  }
}

function resolveCacheDir(inputPath?: string): string {
  const defaultDir = getDefaultCacheDir();
  if (!inputPath) {
    return defaultDir;
  }

  const expanded = expandHomeDir(inputPath.trim());
  if (isAbsolute(expanded)) {
    return expanded;
  }
  return resolve(process.cwd(), expanded);
}

function expandHomeDir(targetPath: string): string {
  if (targetPath === "~") {
    return os.homedir();
  }

  if (targetPath.startsWith("~/")) {
    return resolve(os.homedir(), targetPath.slice(2));
  }

  return targetPath;
}

function getDefaultCacheDir(): string {
  const platform = process.platform;
  if (platform === "win32") {
    const base = process.env.LOCALAPPDATA || resolve(os.homedir(), "AppData", "Local");
    return join(base, "FigmaMcpCache");
  }

  if (platform === "darwin") {
    return join(os.homedir(), "Library", "Caches", "FigmaMcp");
  }

  // linux and others -> use XDG cache dir
  const xdgCache = process.env.XDG_CACHE_HOME || join(os.homedir(), ".cache");
  return join(xdgCache, "figma-mcp");
}
