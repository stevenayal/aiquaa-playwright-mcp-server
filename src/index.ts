#!/usr/bin/env node
import { startHttpServer } from "./transports/http.js";
import { startStdioServer } from "./transports/stdio.js";

const useStdio = process.argv.includes("--stdio") || process.env.MCP_TRANSPORT === "stdio";

if (useStdio) {
  await startStdioServer();
} else {
  startHttpServer();
}
