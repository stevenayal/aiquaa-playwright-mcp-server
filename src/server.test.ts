import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { createAiquaaMcpServer } from "./server.js";

test("expone cinco tools anotadas y ejecuta un mapeo sin acceso externo", async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createAiquaaMcpServer();
  const client = new Client({ name: "integration-test", version: "1.0.0" });
  await server.connect(serverTransport as unknown as Transport);
  await client.connect(clientTransport as unknown as Transport);
  try {
    const listed = await client.listTools();
    assert.equal(listed.tools.length, 5);
    assert.ok(listed.tools.every((tool) => tool.name.startsWith("aiquaa_")));
    assert.ok(listed.tools.every((tool) => tool.annotations?.readOnlyHint === true));

    const result = await client.callTool({
      name: "aiquaa_map_scenarios_to_rules",
      arguments: {
        feature_contents: [
          "Feature: Pago\nScenario: Pago aprobado\nGiven una compra\nWhen se aprueba\nThen se confirma",
        ],
        rule_ids: ["RN-014"],
        assignments: [{ scenario: "Pago aprobado", rule_ids: ["RN-014"] }],
        response_format: "json",
      },
    });
    assert.notEqual(result.isError, true);
    assert.match(JSON.stringify(result.structuredContent), /RN-014/);
  } finally {
    await client.close();
    await server.close();
  }
});
