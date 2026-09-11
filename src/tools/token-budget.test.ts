import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { createAiquaaMcpServer } from "../server.js";

/**
 * Presupuesto de tokens. Los umbrales son bytes de JSON serializado; se fijaron
 * midiendo la implementación actual con ~15% de margen. Si un cambio los supera,
 * es una decisión consciente que debe quedar registrada acá, no un descuido.
 */
const TOOLS_LIST_MAX_BYTES = 21_500;
const SUMMARY_TEXT_MAX_BYTES = 1_500;
const SUMMARY_TOTAL_MAX_BYTES = 11_500;

const FEATURE = `Feature: Login del sandbox
Scenario: Acceso valido
Given el usuario esta en la pagina de login
When ingresa "Email" y "admin@aiquaa.com"
When hace clic en "Ingresar"
Then ve "Bienvenido"
Scenario: Busqueda de usuario
Given el usuario esta en la pagina principal
When hace clic en "Buscar"
Then ve "Resultados"`;

async function withClient<T>(action: (client: Client) => Promise<T>): Promise<T> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createAiquaaMcpServer();
  const client = new Client({ name: "token-budget", version: "1.0.0" });
  await server.connect(serverTransport as unknown as Transport);
  await client.connect(clientTransport as unknown as Transport);
  try {
    return await action(client);
  } finally {
    await client.close();
    await server.close();
  }
}

function callPlaywright(client: Client, responseFormat: string) {
  return client.callTool({
    name: "qa_pruebas",
    arguments: {
      feature_content: FEATURE,
      base_url: "https://aiquaa-sandbox-web.vercel.app",
      response_format: responseFormat,
    },
  });
}

test("el costo fijo de tools/list se mantiene dentro del presupuesto", async () => {
  await withClient(async (client) => {
    const listed = await client.listTools();
    const bytes = JSON.stringify(listed).length;
    assert.ok(
      bytes <= TOOLS_LIST_MAX_BYTES,
      `tools/list ocupa ${bytes} bytes y el presupuesto es ${TOOLS_LIST_MAX_BYTES}.`,
    );
  });
});

test("summary es el formato más barato y json no repite el payload en el texto", async () => {
  await withClient(async (client) => {
    const summary = await callPlaywright(client, "summary");
    const markdown = await callPlaywright(client, "markdown");
    const json = await callPlaywright(client, "json");

    const size = (result: Awaited<ReturnType<typeof callPlaywright>>) =>
      JSON.stringify(result.content).length + JSON.stringify(result.structuredContent ?? {}).length;

    const summaryText = JSON.stringify(summary.content).length;
    assert.ok(
      summaryText <= SUMMARY_TEXT_MAX_BYTES,
      `El texto de summary ocupa ${summaryText} bytes y el presupuesto es ${SUMMARY_TEXT_MAX_BYTES}.`,
    );
    assert.ok(
      size(summary) <= SUMMARY_TOTAL_MAX_BYTES,
      `La respuesta summary ocupa ${size(summary)} bytes y el presupuesto es ${SUMMARY_TOTAL_MAX_BYTES}.`,
    );
    // El texto de json es un puntero: nunca debe crecer con el payload.
    assert.ok(JSON.stringify(json.content).length < 200);
    assert.ok(size(json) < size(markdown));
  });
});

test("ninguna respuesta repite el contenido de un archivo en el texto y en structuredContent", async () => {
  await withClient(async (client) => {
    for (const format of ["summary", "markdown", "json"]) {
      const result = await callPlaywright(client, format);
      const text = JSON.stringify(result.content);
      const structured = result.structuredContent as { files?: Array<{ content?: string }> } | undefined;
      for (const file of structured?.files ?? []) {
        if (!file.content) continue;
        const marker = file.content.slice(0, 60);
        assert.ok(
          !text.includes(JSON.stringify(marker).slice(1, -1)),
          `El formato ${format} devuelve el mismo contenido de archivo dos veces.`,
        );
      }
    }
  });
});
