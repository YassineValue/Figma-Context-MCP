import { randomUUID } from "node:crypto";
import express, { type Request, type Response } from "express";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { Server } from "http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Logger, Metrics } from "./utils/logger.js";
import { createServer } from "./mcp/index.js";
import { getServerConfig } from "./config.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

let httpServer: Server | null = null;

/**
 * Each HTTP session gets its own McpServer + transport pair.
 * The MCP SDK binds one server to one transport -- sharing a single McpServer
 * across sessions causes "Already connected to a transport" errors on reconnect.
 */
type Session = {
  transport: StreamableHTTPServerTransport | SSEServerTransport;
  server: McpServer;
};
const sessions: Record<string, Session> = {};

/**
 * Start the MCP server in either stdio or HTTP mode.
 */
export async function startServer(): Promise<void> {
  const isStdioMode = process.env.NODE_ENV === "cli" || process.argv.includes("--stdio");

  const config = getServerConfig(isStdioMode);

  const serverOptions = {
    outputFormat: config.outputFormat as "yaml" | "json",
    skipImageDownloads: config.skipImageDownloads,
    imageDir: config.imageDir,
    caching: config.caching,
  };

  if (isStdioMode) {
    const server = createServer(config.auth, serverOptions);
    const transport = new StdioServerTransport();
    await server.connect(transport);
  } else {
    const createMcpServer = () => createServer(config.auth, serverOptions);
    console.error(`Initializing Figma MCP Server in HTTP mode on ${config.host}:${config.port}...`);
    await startHttpServer(config.host, config.port, createMcpServer);

    const gracefulShutdown = async (signal: string) => {
      Logger.log(`Received ${signal}, shutting down...`);
      await stopHttpServer();
      Logger.log("Server shutdown complete");
      process.exit(0);
    };

    process.on("SIGINT", () => void gracefulShutdown("SIGINT"));
    process.on("SIGTERM", () => void gracefulShutdown("SIGTERM"));
  }
}

export async function startHttpServer(
  host: string,
  port: number,
  createMcpServer: () => McpServer,
): Promise<Server> {
  if (httpServer) {
    throw new Error("HTTP server is already running");
  }

  const app = express();

  // Track last activity per session for idle reaping
  const sessionLastActivity = new Map<string, number>();
  const SESSION_MAX_IDLE_MS = 10 * 60 * 1000;

  // Session activity middleware — update timestamp on every request with a session ID
  app.use((req, _res, next) => {
    const sid = req.headers["mcp-session-id"] as string | undefined;
    if (sid) sessionLastActivity.set(sid, Date.now());
    next();
  });

  // Session reaper: every 5 minutes, remove sessions inactive for >10 minutes
  const reaperInterval = setInterval(() => {
    const now = Date.now();
    for (const id of Object.keys(sessions)) {
      const lastActive = sessionLastActivity.get(id) ?? 0;
      if (now - lastActive > SESSION_MAX_IDLE_MS) {
        Logger.log(`Reaping idle session ${id}`);
        try { void sessions[id].transport.close(); } catch { /* ignore */ }
        delete sessions[id];
        sessionLastActivity.delete(id);
      }
    }
  }, 5 * 60 * 1000);
  reaperInterval.unref(); // Don't keep process alive just for the reaper

  // Health check endpoint for monitoring
  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      metrics: Metrics.summary(),
      activeSessions: Object.keys(sessions).length,
    });
  });

  // Parse JSON requests for the Streamable HTTP endpoint only, will break SSE endpoint
  app.use("/mcp", express.json());

  // Modern Streamable HTTP endpoint
  app.post("/mcp", async (req, res) => {
    Logger.log("Received StreamableHTTP request");
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    let transport: StreamableHTTPServerTransport;

    if (sessionId && sessions[sessionId]) {
      // Reuse existing transport
      Logger.log("Reusing existing StreamableHTTP transport for sessionId", sessionId);
      transport = sessions[sessionId].transport as StreamableHTTPServerTransport;
    } else if (!sessionId && isInitializeRequest(req.body)) {
      Logger.log("New initialization request for StreamableHTTP");
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (newSessionId) => {
          sessions[newSessionId] = { transport, server: mcpServer };
        },
      });
      transport.onclose = () => {
        if (transport.sessionId) {
          delete sessions[transport.sessionId];
        }
      };
      const mcpServer = createMcpServer();
      await mcpServer.connect(transport);
    } else {
      Logger.log("Invalid request:", req.body);
      res.status(400).json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Bad Request: No valid session ID provided",
        },
        id: null,
      });
      return;
    }

    let progressInterval: NodeJS.Timeout | null = null;
    const progressToken = req.body.params?._meta?.progressToken;
    let progress = 0;
    if (progressToken && sessionId && sessions[sessionId]) {
      Logger.log(
        `Setting up progress notifications for token ${progressToken} on session ${sessionId}`,
      );
      progressInterval = setInterval(async () => {
        if (!sessions[sessionId]) {
          clearInterval(progressInterval!);
          return;
        }
        Logger.log("Sending progress notification", progress);
        await sessions[sessionId].server.server.notification({
          method: "notifications/progress",
          params: {
            progress,
            progressToken,
          },
        });
        progress++;
      }, 1000);
    }

    Logger.log("Handling StreamableHTTP request");
    await transport.handleRequest(req, res, req.body);

    if (progressInterval) {
      clearInterval(progressInterval);
    }
    Logger.log("StreamableHTTP request handled");
  });

  // Handle GET/DELETE requests for StreamableHTTP sessions
  const handleSessionRequest = async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !sessions[sessionId]) {
      res.status(400).send("Invalid or missing session ID");
      return;
    }

    Logger.log(`Received session request for session ${sessionId}`);

    try {
      const transport = sessions[sessionId].transport as StreamableHTTPServerTransport;
      await transport.handleRequest(req, res);
    } catch (error) {
      Logger.error("Error handling session request:", error);
      if (!res.headersSent) {
        res.status(500).send("Error processing session request");
      }
    }
  };

  app.get("/mcp", handleSessionRequest);
  app.delete("/mcp", handleSessionRequest);

  app.get("/sse", async (_req, res) => {
    Logger.log("Establishing new SSE connection");
    const transport = new SSEServerTransport("/messages", res);
    Logger.log(`New SSE connection established for sessionId ${transport.sessionId}`);

    const mcpServer = createMcpServer();
    sessions[transport.sessionId] = { transport, server: mcpServer };
    res.on("close", () => {
      delete sessions[transport.sessionId];
    });

    await mcpServer.connect(transport);
  });

  app.post("/messages", async (req, res) => {
    const sessionId = req.query.sessionId as string;
    const session = sessions[sessionId];
    if (session) {
      Logger.log(`Received SSE message for sessionId ${sessionId}`);
      await (session.transport as SSEServerTransport).handlePostMessage(req, res);
    } else {
      res.status(400).send(`No transport found for sessionId ${sessionId}`);
      return;
    }
  });

  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => {
      Logger.log(`HTTP server listening on port ${port}`);
      Logger.log(`SSE endpoint available at http://${host}:${port}/sse`);
      Logger.log(`Message endpoint available at http://${host}:${port}/messages`);
      Logger.log(`StreamableHTTP endpoint available at http://${host}:${port}/mcp`);
      resolve(server);
    });
    server.once("error", (err) => {
      httpServer = null;
      reject(err);
    });
    httpServer = server;
  });
}

export async function stopHttpServer(): Promise<void> {
  if (!httpServer) {
    throw new Error("HTTP server is not running");
  }

  // Close all sessions FIRST so connections drain
  for (const sessionId in sessions) {
    try {
      await sessions[sessionId].transport.close();
      delete sessions[sessionId];
    } catch (error) {
      Logger.error(`Error closing session ${sessionId}:`, error);
    }
  }

  // Then close the HTTP server
  return new Promise((resolve, reject) => {
    httpServer!.close((err) => {
      httpServer = null;
      if (err) reject(err);
      else resolve();
    });
  });
}
