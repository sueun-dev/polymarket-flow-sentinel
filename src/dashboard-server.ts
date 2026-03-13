import fs from "node:fs/promises";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createFlowSentinelApp } from "./create-sentinel-app.js";
import { resolvePublicAssetPath } from "./static-asset-path.js";

import type { MonitorSnapshot, PublishedMonitorAlert } from "./types.js";

interface RuntimeBrokerTarget {
  on(eventName: "snapshot", listener: (snapshot: MonitorSnapshot) => void): unknown;
  on(eventName: "alert", listener: (alert: PublishedMonitorAlert) => void): unknown;
  getSnapshot(): MonitorSnapshot;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "../public");

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

function sendJson(
  response: ServerResponse<IncomingMessage>,
  statusCode: number,
  payload: unknown,
  headOnly = false
): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(headOnly ? undefined : JSON.stringify(payload));
}

async function serveStatic(
  requestPath: string,
  response: ServerResponse<IncomingMessage>,
  headOnly = false
): Promise<void> {
  const resolvedPath = resolvePublicAssetPath(publicDir, requestPath);

  if (!resolvedPath) {
    sendJson(response, 403, { error: "Forbidden" }, headOnly);
    return;
  }

  try {
    const body = await fs.readFile(resolvedPath);
    const contentType = CONTENT_TYPES[path.extname(resolvedPath)] ?? "application/octet-stream";
    const cachePath =
      requestPath === "/"
        ? "/index.html"
        : requestPath === "/favicon.ico"
          ? "/favicon.svg"
          : requestPath;

    response.writeHead(200, {
      "content-type": contentType,
      "cache-control": cachePath === "/index.html" ? "no-cache" : "public, max-age=60"
    });
    response.end(headOnly ? undefined : body);
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      sendJson(response, 404, { error: "Not found" }, headOnly);
      return;
    }

    sendJson(response, 500, { error: "Failed to read asset." }, headOnly);
  }
}

function createSseBroker(runtime: RuntimeBrokerTarget): {
  addClient(response: ServerResponse<IncomingMessage>): void;
} {
  const clients = new Set<ServerResponse<IncomingMessage>>();

  function broadcast(
    event: "snapshot" | "alert",
    payload: MonitorSnapshot | PublishedMonitorAlert
  ): void {
    const body = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;

    for (const client of clients) {
      client.write(body);
    }
  }

  runtime.on("snapshot", (snapshot: MonitorSnapshot) => broadcast("snapshot", snapshot));
  runtime.on("alert", (alert: PublishedMonitorAlert) => broadcast("alert", alert));

  return {
    addClient(response: ServerResponse<IncomingMessage>): void {
      response.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive"
      });
      response.write(`event: snapshot\ndata: ${JSON.stringify(runtime.getSnapshot())}\n\n`);

      const heartbeat = setInterval(() => {
        response.write(": heartbeat\n\n");
      }, 15_000);

      clients.add(response);

      response.on("close", () => {
        clearInterval(heartbeat);
        clients.delete(response);
      });
    }
  };
}

async function main(): Promise<void> {
  const { config, runtime } = createFlowSentinelApp([]);
  await runtime.initialize();
  runtime.start();

  const sseBroker = createSseBroker(runtime);
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    const headOnly = request.method === "HEAD";
    const isGetLike = request.method === "GET" || headOnly;

    if (isGetLike && url.pathname === "/api/health") {
      sendJson(response, 200, { ok: true, timestamp: new Date().toISOString() }, headOnly);
      return;
    }

    if (isGetLike && url.pathname === "/api/dashboard") {
      sendJson(response, 200, runtime.getSnapshot(), headOnly);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/events") {
      sseBroker.addClient(response);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/runtime/scan") {
      try {
        await runtime.scanNow("manual");
        sendJson(response, 200, runtime.getSnapshot());
      } catch (error: unknown) {
        sendJson(response, 500, {
          error: error instanceof Error ? error.message : String(error),
          snapshot: runtime.getSnapshot()
        });
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/runtime/start") {
      runtime.start();
      sendJson(response, 200, runtime.getSnapshot());
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/runtime/stop") {
      runtime.stop();
      sendJson(response, 200, runtime.getSnapshot());
      return;
    }

    if (isGetLike) {
      await serveStatic(url.pathname, response, headOnly);
      return;
    }

    sendJson(response, 405, { error: "Method not allowed" });
  });

  server.listen(config.port, config.host, () => {
    console.info(`Dashboard running at http://${config.host}:${config.port}`);
  });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
