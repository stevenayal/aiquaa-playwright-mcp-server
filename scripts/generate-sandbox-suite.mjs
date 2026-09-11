#!/usr/bin/env node
/**
 * Genera una suite Playwright contra el sandbox público de AIQUAA usando las
 * tools del propio MCP, sin escribir a mano ninguno de los artefactos.
 *
 * Es la prueba de que el generador produce tests que realmente pasan: el
 * dom_context de acá son los data-testid reales del sandbox, y el login es
 * passwordless (solo email) en /auth/login, con la app volviendo a la raíz.
 *
 * Uso: node scripts/generate-sandbox-suite.mjs <directorio-destino>
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createAiquaaMcpServer } from "../dist/server.js";

const targetDir = process.argv[2];
if (!targetDir) {
  console.error("Falta el directorio destino: node scripts/generate-sandbox-suite.mjs <dir>");
  process.exit(1);
}

const BASE_URL = process.env.SANDBOX_BASE_URL ?? "https://aiquaa-sandbox-web.vercel.app";

const FEATURE = `# language: es
Característica: Sandbox AIQUAA

  @rule:RN-SANDBOX-01
  Escenario: El usuario autenticado llega al inicio
    Dado que el usuario abre la pagina principal
    Entonces ve "nav-logout"

  @rule:RN-SANDBOX-02
  Escenario: Buscar un usuario desde el inicio
    Dado que el usuario abre la pagina principal
    Cuando ingresa "home-buscar-usuario-input" y "admin@aiquaa.com"
    Cuando hace clic en "home-buscar-usuario-submit"
    Entonces ve "home-buscar-usuario"
`;

const DOM_CONTEXT = {
  test_ids: [
    "auth-login-form",
    "auth-login-field-email",
    "auth-login-submit",
    "nav",
    "nav-logout",
    "home-buscar-usuario",
    "home-buscar-usuario-input",
    "home-buscar-usuario-submit",
  ],
};

const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
const server = createAiquaaMcpServer();
const client = new Client({ name: "sandbox-suite", version: "1.0.0" });
await server.connect(serverTransport);
await client.connect(clientTransport);

const result = await client.callTool({
  name: "qa_pruebas",
  arguments: {
    feature_content: FEATURE,
    base_url: BASE_URL,
    selector_source: "provided_test_ids",
    dom_context: DOM_CONTEXT,
    ci_targets: ["github_actions"],
    auth: {
      mode: "passwordless",
      login_path: "/auth/login",
      username_label: "Email",
      submit_name: "Ingresar",
      success_url_pattern: "^https?://[^/]+/$",
      username_env: "TEST_USER",
    },
    response_format: "json",
  },
});

if (result.isError) {
  console.error(JSON.stringify(result.content, null, 2));
  process.exit(1);
}

const generated = result.structuredContent;
await mkdir(path.join(targetDir, "features"), { recursive: true });
await writeFile(path.join(targetDir, "features", "sandbox.feature"), FEATURE, "utf8");

for (const file of generated.files) {
  const destination = path.join(targetDir, file.path);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, file.content, "utf8");
  console.log(`escrito ${file.path} (${file.bytes} bytes)`);
}

const blocked = generated.selectorProvenance.filter((item) => item.confidence === "blocked");
if (blocked.length > 0) {
  console.error(`Hay ${blocked.length} step(s) sin selector verificable:`);
  for (const item of blocked) console.error(`  - ${item.step}`);
  process.exit(1);
}

await client.close();
await server.close();
console.log(`Suite generada en ${targetDir} contra ${BASE_URL}.`);
