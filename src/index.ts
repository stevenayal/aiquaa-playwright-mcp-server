#!/usr/bin/env node
import express, { type Request, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { DEFAULT_MCP_PATH, DEFAULT_PORT, SERVER_NAME, SERVER_VERSION } from "./constants.js";
import { createAiquaaMcpServer } from "./server.js";

const port = parsePort(process.env.PORT);
const mcpPath = normalizePath(process.env.MCP_PATH ?? DEFAULT_MCP_PATH);
const app = express();
app.use(express.json({ limit: "10mb" }));

app.get("/health", (_request: Request, response: Response) => {
  response.json({ status: "ok", name: SERVER_NAME, version: SERVER_VERSION, transport: "streamable-http" });
});

app.post(mcpPath, async (request: Request, response: Response) => {
  const accessToken = bearerToken(request.header("authorization"));
  const server = createAiquaaMcpServer(accessToken ? { accessToken } : {});
  const transport = new StreamableHTTPServerTransport({});
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

app.all(mcpPath, (_request: Request, response: Response) => {
  response.status(405).set("Allow", "POST").json({
    error: "Este servidor usa Streamable HTTP sin estado; enviá solicitudes MCP por POST.",
  });
});

app.listen(port, () => {
  process.stderr.write(`${SERVER_NAME} ${SERVER_VERSION} escuchando en http://localhost:${port}${mcpPath}\n`);
});

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
