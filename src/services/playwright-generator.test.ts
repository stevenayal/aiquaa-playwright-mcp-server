import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import ts from "typescript";
import { generatePlaywrightArtifacts } from "./playwright-generator.js";

const feature = `Feature: Acceso seguro

  @rule:RN-014
  Scenario: Login válido
    Given el usuario está en la página de login
    When hace clic en "Ingresar"
    Then ve "Dashboard"
    And la sesión queda protegida
`;

test("genera auth, validación externa y pipelines válidos sin hardcodear credenciales", () => {
  const result = generatePlaywrightArtifacts(feature, {
    baseUrl: "https://staging.example.com",
    selectorSource: "provided_component",
    browsers: ["chromium", "firefox"],
    ciTargets: ["github_actions", "azure_pipelines"],
    auth: {
      mode: "password" as const,
      loginPath: "/login",
      usernameLabel: "Correo",
      passwordLabel: "Contraseña",
      submitName: "Ingresar",
      successUrlPattern: "dashboard",
      usernameEnv: "TEST_USER",
      passwordEnv: "TEST_PASSWORD",
    },
    externalValidation: {
      type: "sms",
      apiUrlEnv: "NOTIFICATION_API_URL",
      apiTokenEnv: "NOTIFICATION_API_TOKEN",
      responseField: "data.code",
      timeoutMs: 15_000,
      pollIntervalMs: 1_000,
    },
  });

  const byPath = new Map(result.files.map((file) => [file.path, file.content]));
  assert.ok(byPath.has("features/support/auth.setup.ts"));
  assert.ok(byPath.has("features/support/notification-helper.ts"));
  assert.match(byPath.get("playwright.config.aiquaa.ts") ?? "", /Desktop Firefox/);
  assert.match(byPath.get("features/support/auth.setup.ts") ?? "", /Falta el secret TEST_USER/);
  assert.doesNotMatch(byPath.get("features/support/auth.setup.ts") ?? "", /TestPass|testuser@/);

  const github = byPath.get(".github/workflows/playwright.yml") ?? "";
  const azure = byPath.get("azure-pipelines.playwright.yml") ?? "";
  assert.doesNotThrow(() => parseYaml(github));
  assert.doesNotThrow(() => parseYaml(azure));
  assert.match(github, /npx bddgen/);
  assert.match(azure, /PublishTestResults@2/);

  const unresolved = result.selectorProvenance.find((item) => item.strategy === "unresolved");
  assert.equal(unresolved?.confidence, "blocked");
  assert.match(byPath.get("features/steps/generated.steps.ts") ?? "", /TODO selector\/acción sin fuente verificable/);

  for (const file of result.files.filter((item) => item.language === "typescript")) {
    const transpiled = ts.transpileModule(file.content, {
      fileName: file.path,
      reportDiagnostics: true,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    });
    const syntaxErrors = (transpiled.diagnostics ?? []).filter(
      (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
    );
    assert.deepEqual(syntaxErrors, [], file.path);
  }
});

test("los ejemplos estáticos de GitHub Actions y Azure Pipelines son YAML válido", () => {
  const paths = [
    ".github/workflows/ci.yml",
    ".github/workflows/codeql.yml",
    ".github/workflows/e2e-sandbox.yml",
    ".github/workflows/publish-npm.yml",
    ".github/workflows/release-please.yml",
    ".github/dependabot.yml",
    "examples/ci/github-actions-playwright.yml",
    "examples/ci/azure-pipelines-playwright.yml",
  ];
  for (const path of paths) {
    assert.doesNotThrow(() => parseYaml(readFileSync(path, "utf8")), path);
  }
});

test("el workflow con sharding es YAML válido y trae el job de merge", () => {
  const result = generatePlaywrightArtifacts(feature, {
    shards: 4,
    ciTargets: ["github_actions"],
    includeFiles: ["github_actions"],
  });
  const workflow = result.files[0]?.content ?? "";
  const parsed = parseYaml(workflow) as {
    jobs: Record<string, { strategy?: { matrix?: { shard?: number[] } } }>;
  };
  assert.deepEqual(parsed.jobs.test?.strategy?.matrix?.shard, [1, 2, 3, 4]);
  assert.ok(parsed.jobs["merge-reports"], "con shards hace falta un job que combine los reportes");
  assert.match(workflow, /--shard=\$\{\{ matrix\.shard \}\}\/4/);
});

test("los workflows del repo pinean cada action por SHA", () => {
  const workflows = [
    ".github/workflows/ci.yml",
    ".github/workflows/codeql.yml",
    ".github/workflows/e2e-sandbox.yml",
    ".github/workflows/publish-npm.yml",
    ".github/workflows/release-please.yml",
  ];
  for (const path of workflows) {
    const content = readFileSync(path, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/uses:\s+(\S+)/);
      if (!match?.[1]) continue;
      assert.match(match[1], /@[0-9a-f]{40}$/, `${path}: ${match[1]} no está pineada por SHA`);
    }
  }
});
