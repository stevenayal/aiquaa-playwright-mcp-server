import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { createAiquaaMcpServer } from "../server.js";
import { generatePlaywrightArtifacts } from "./playwright-generator.js";

/**
 * Contrato de procedencia: `provided_*` significa "verificado contra la app real".
 * Sin dom_context no hay nada que verificar, así que la tool debe rechazar el
 * pedido en vez de etiquetar una inferencia como si estuviera confirmada.
 *
 * Los test IDs y el flujo passwordless provienen del sandbox real
 * (https://aiquaa-sandbox-web.vercel.app): login en /auth/login, solo email.
 */

const FEATURE = `Feature: Acceso al sandbox
Scenario: Login passwordless
Given el usuario esta en la pagina de login
When ingresa "auth-login-field-email" y "admin@aiquaa.com"
When hace clic en "auth-login-submit"
Then ve "Bienvenido"`;

const SANDBOX_DOM = {
  testIds: ["auth-login-form", "auth-login-field-email", "auth-login-submit", "nav-logout"],
};

test("selector_source provided_* sin dom_context es rechazado por la tool", async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createAiquaaMcpServer();
  const client = new Client({ name: "provenance-test", version: "1.0.0" });
  await server.connect(serverTransport as unknown as Transport);
  await client.connect(clientTransport as unknown as Transport);
  try {
    const result = await client.callTool({
      name: "qa_pruebas",
      arguments: {
        feature_content: FEATURE,
        selector_source: "provided_test_ids",
        response_format: "summary",
      },
    });
    assert.equal(result.isError, true);
    assert.match(JSON.stringify(result.content), /dom_context/);
  } finally {
    await client.close();
    await server.close();
  }
});

test("con dom_context los selectores salen de los test IDs reales y quedan como provided", () => {
  const result = generatePlaywrightArtifacts(FEATURE, {
    selectorSource: "provided_test_ids",
    domContext: SANDBOX_DOM,
    ciTargets: ["github_actions"],
  });
  const steps = result.files.find((file) => file.path.endsWith("generated.steps.ts"))?.content ?? "";
  assert.match(steps, /getByTestId\('auth-login-field-email'\)|getByTestId\("auth-login-field-email"\)/);
  assert.match(steps, /getByTestId\('auth-login-submit'\)|getByTestId\("auth-login-submit"\)/);

  const resolved = result.selectorProvenance.filter((item) => item.confidence === "provided");
  assert.ok(resolved.length >= 2, "los steps cubiertos por dom_context deben quedar como provided");
  // Lo que dom_context no cubre queda bloqueado, no estimado a la ligera.
  const unmatched = result.selectorProvenance.find((item) => item.step.includes("Bienvenido"));
  assert.equal(unmatched?.confidence, "blocked");
});

test("el modo passwordless no exige TEST_PASSWORD y usa el login real del sandbox", () => {
  const result = generatePlaywrightArtifacts(FEATURE, {
    selectorSource: "provided_test_ids",
    domContext: SANDBOX_DOM,
    ciTargets: ["github_actions"],
    auth: {
      mode: "passwordless",
      loginPath: "/auth/login",
      usernameLabel: "Email",
      passwordLabel: "Contraseña",
      submitName: "Ingresar",
      successUrlPattern: "^/$",
      usernameEnv: "TEST_USER",
      passwordEnv: "TEST_PASSWORD",
    },
  });
  const setup = result.files.find((file) => file.path.endsWith("auth.setup.ts"))?.content ?? "";
  assert.match(setup, /\/auth\/login/);
  assert.match(setup, /getByTestId\("auth-login-field-email"\)/);
  assert.doesNotMatch(setup, /TEST_PASSWORD/);

  const workflow = result.files.find((file) => file.path.endsWith("playwright.yml"))?.content ?? "";
  assert.match(workflow, /TEST_USER/);
  assert.doesNotMatch(workflow, /TEST_PASSWORD/);
});

test("un success_url_pattern inválido falla al generar, no en runtime del test", () => {
  assert.throws(
    () =>
      generatePlaywrightArtifacts(FEATURE, {
        auth: {
          mode: "passwordless",
          loginPath: "/auth/login",
          usernameLabel: "Email",
          passwordLabel: "Contraseña",
          submitName: "Ingresar",
          successUrlPattern: "([unclosed",
          usernameEnv: "TEST_USER",
          passwordEnv: "TEST_PASSWORD",
        },
      }),
    /success_url_pattern no es una RegExp válida/,
  );
});

test("include_files devuelve solo lo pedido y reporta lo omitido", () => {
  const result = generatePlaywrightArtifacts(FEATURE, { includeFiles: ["config"] });
  assert.deepEqual(result.files.map((file) => file.path), ["playwright.config.aiquaa.ts"]);
  assert.ok(result.omittedFiles.includes("steps"));
  assert.ok(result.omittedFiles.includes("github_actions"));
});

test("max_file_bytes trunca y lo deja explícito", () => {
  const result = generatePlaywrightArtifacts(FEATURE, { includeFiles: ["config"], maxFileBytes: 500 });
  const file = result.files[0];
  assert.equal(file?.truncated, true);
  assert.ok((file?.bytes ?? 0) > 500);
  assert.match(file?.content ?? "", /truncado/);
});
