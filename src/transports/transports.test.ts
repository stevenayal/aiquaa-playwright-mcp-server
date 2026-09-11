import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { request as httpRequest } from "node:http";
import { startHttpServer, readHttpConfig } from "./http.js";

const INITIALIZE = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "transport-test", version: "1.0.0" },
  },
};

async function withServer<T>(action: (baseUrl: string, port: number) => Promise<T>): Promise<T> {
  const config = { ...readHttpConfig({} as NodeJS.ProcessEnv), port: 0 };
  const server = startHttpServer(config);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    return await action(`http://127.0.0.1:${port}`, port);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("el servidor HTTP responde initialize como JSON, sin abrir un stream SSE", async () => {
  await withServer(async (baseUrl, port) => {
    const response = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        host: `127.0.0.1:${port}`,
      },
      body: JSON.stringify(INITIALIZE),
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /application\/json/);
    const body = await response.json() as { result?: { serverInfo?: { name?: string } } };
    assert.equal(body.result?.serverInfo?.name, "aiquaa-playwright-mcp-server");
  });
});

/**
 * `fetch` no deja fijar el header Host (es un forbidden header name), así que
 * el escenario de DNS rebinding se reproduce con una request HTTP cruda.
 */
function postWithHost(port: number, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(INITIALIZE);
    const request = httpRequest(
      {
        host: "127.0.0.1",
        port,
        path: "/mcp",
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "content-length": Buffer.byteLength(body),
          host,
        },
      },
      (response) => {
        response.resume();
        response.on("end", () => resolve(response.statusCode ?? 0));
      },
    );
    request.on("error", reject);
    request.end(body);
  });
}

test("la protección DNS rebinding rechaza un Host no declarado", async () => {
  await withServer(async (_baseUrl, port) => {
    assert.equal(await postWithHost(port, "atacante.example.com"), 403);
    assert.equal(await postWithHost(port, `127.0.0.1:${port}`), 200);
  });
});

test("health expone la versión real del paquete", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/health`);
    const body = await response.json() as { version?: string; status?: string };
    assert.equal(body.status, "ok");
    const { version } = await import("node:fs").then(async (fs) =>
      JSON.parse(fs.readFileSync("package.json", "utf8")) as { version: string },
    );
    assert.equal(body.version, version, "SERVER_VERSION debe salir del package.json");
  });
});

test("el binario por defecto escucha solo en loopback", () => {
  const config = readHttpConfig({} as NodeJS.ProcessEnv);
  assert.equal(config.host, "127.0.0.1");
  assert.ok(config.allowedHosts.includes("127.0.0.1:3000"));
});
