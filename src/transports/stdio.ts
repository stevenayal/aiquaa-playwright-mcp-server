import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { SERVER_NAME, SERVER_VERSION } from "../constants.js";
import { createAiquaaMcpServer } from "../server.js";

/**
 * Transporte stdio: un proceso por cliente, sin puerto abierto ni superficie de
 * red. Es lo que esperan Claude Code, Claude Desktop y la mayoría de los
 * clientes MCP locales.
 */
export async function startStdioServer(): Promise<void> {
  const server = createAiquaaMcpServer(
    process.env.AIQUAA_ACCESS_TOKEN ? { accessToken: process.env.AIQUAA_ACCESS_TOKEN } : {},
  );
  const transport = new StdioServerTransport();

  const shutdown = (): void => {
    void transport.close();
    void server.close();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  await server.connect(transport as unknown as Transport);
  // stdout es el canal del protocolo: cualquier log tiene que ir a stderr.
  process.stderr.write(`${SERVER_NAME} ${SERVER_VERSION} escuchando por stdio\n`);
}
