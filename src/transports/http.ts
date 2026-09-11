import express, { type Express, type Request, type Response } from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { DEFAULT_MCP_PATH, DEFAULT_HOST, DEFAULT_PORT, SERVER_NAME, SERVER_VERSION } from "../constants.js";
import { createAiquaaMcpServer } from "../server.js";

export interface HttpServerConfig {
  port: number;
  host: string;
  mcpPath: string;
  allowedHosts: string[];
  allowedOrigins: string[];
}

export function readHttpConfig(env: NodeJS.ProcessEnv = process.env): HttpServerConfig {
  const port = parsePort(env.PORT);
  const host = env.MCP_HOST?.trim() || DEFAULT_HOST;
  return {
    port,
    host,
    mcpPath: normalizePath(env.MCP_PATH ?? DEFAULT_MCP_PATH),
    allowedHosts: parseList(env.MCP_ALLOWED_HOSTS) ?? defaultAllowedHosts(host, port),
    allowedOrigins: parseList(env.MCP_ALLOWED_ORIGINS) ?? [],
  };
}

export function createHttpApp(config: HttpServerConfig): Express {
  const app = express();
  app.use(express.json({ limit: "10mb" }));

  app.get("/health", (_request: Request, response: Response) => {
    response.json({ status: "ok", name: SERVER_NAME, version: SERVER_VERSION, transport: "streamable-http" });
  });

  app.post(config.mcpPath, async (request: Request, response: Response) => {
    const accessToken = bearerToken(request.header("authorization"));
    const server = createAiquaaMcpServer(accessToken ? { accessToken } : {});
    const transport = new StreamableHTTPServerTransport({
      // Sin sessionIdGenerator el transport queda stateless: cada request trae
      // su propio contexto y su propio token. enableJsonResponse devuelve JSON
      // simple en vez de abrir un stream SSE por request.
      enableJsonResponse: true,
      enableDnsRebindingProtection: true,
      allowedHosts: config.allowedHosts,
      ...(config.allowedOrigins.length > 0 ? { allowedOrigins: config.allowedOrigins } : {}),
    });
    response.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      // SDK 1.29's Node transport uses optional callbacks that conflict with
      // exactOptionalPropertyTypes although it implements the runtime contract.
      await server.connect(transport as unknown as Transport);
      await transport.handleRequest(request, response, request.body);
    } catch (error: unknown) {
      if (!response.headersSent) {
        response.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: error instanceof Error ? error.message : "Internal server error" },
          id: null,
        });
      }
    }
  });

  app.all(config.mcpPath, (_request: Request, response: Response) => {
    response.status(405).set("Allow", "POST").json({
      error: "Este servidor usa Streamable HTTP sin estado; enviá solicitudes MCP por POST.",
    });
  });

  return app;
}

export function startHttpServer(config: HttpServerConfig = readHttpConfig()): Server {
  const app = createHttpApp(config);
  const server = app.listen(config.port, config.host, () => {
    // Con PORT=0 el puerto real solo se conoce acá; sin esto el allowlist de
    // Host quedaría apuntando al puerto 0 y rechazaría todas las requests.
    const address = server.address() as AddressInfo | null;
    const boundPort = address?.port ?? config.port;
    if (boundPort !== config.port) {
      config.allowedHosts.push(...defaultAllowedHosts(config.host, boundPort));
    }
    process.stderr.write(
      `${SERVER_NAME} ${SERVER_VERSION} escuchando en http://${config.host}:${boundPort}${config.mcpPath}\n`,
    );
  });

  // Sin esto, un contenedor que recibe SIGTERM mata las requests en vuelo.
  const shutdown = (signal: string): void => {
    process.stderr.write(`${SERVER_NAME}: ${signal} recibido, cerrando conexiones…\n`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 10_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  return server;
}

function bearerToken(header?: string): string | undefined {
  const match = header?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || undefined;
}

function parsePort(value?: string): number {
  const parsed = value ? Number(value) : DEFAULT_PORT;
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(`PORT inválido: ${value ?? ""}. Usá un entero entre 1 y 65535.`);
  }
  return parsed;
}

function normalizePath(value: string): string {
  return value.startsWith("/") ? value : `/${value}`;
}

function parseList(value?: string): string[] | undefined {
  if (!value?.trim()) return undefined;
  return value.split(",").map((entry) => entry.trim()).filter(Boolean);
}

/**
 * La protección DNS rebinding valida el header Host. Por defecto solo se acepta
 * el par host:puerto donde el servidor realmente escucha, más las formas
 * locales equivalentes; para exponerlo detrás de un proxy hay que declarar
 * MCP_ALLOWED_HOSTS explícitamente.
 */
function defaultAllowedHosts(host: string, port: number): string[] {
  const names = new Set([host, "localhost", "127.0.0.1", "[::1]"]);
  return [...names].flatMap((name) => [name, `${name}:${port}`]);
}
