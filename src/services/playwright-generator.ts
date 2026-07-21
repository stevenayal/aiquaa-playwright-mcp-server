import type { GeneratedFile } from "../types.js";
import { parseFeature, type ParsedStep } from "./gherkin.js";

export type SelectorSource = "provided_dom" | "provided_component" | "provided_test_ids" | "estimated";
export type BrowserName = "chromium" | "firefox" | "webkit";
export type CiTarget = "github_actions" | "azure_pipelines";

export interface PlaywrightAuthOptions {
  loginPath: string;
  usernameLabel: string;
  passwordLabel: string;
  submitName: string;
  successUrlPattern: string;
  usernameEnv: string;
  passwordEnv: string;
}

export interface ExternalValidationOptions {
  type: "sms" | "email" | "push" | "db_state" | "other";
  apiUrlEnv: string;
  apiTokenEnv: string;
  responseField: string;
  timeoutMs: number;
  pollIntervalMs: number;
}

export interface PlaywrightGenerationOptions {
  baseUrl?: string;
  appContext?: string;
  selectorSource?: SelectorSource;
  auth?: PlaywrightAuthOptions;
  externalValidation?: ExternalValidationOptions;
  browsers?: BrowserName[];
  ciTargets?: CiTarget[];
}

export interface SelectorProvenance {
  step: string;
  source: SelectorSource;
  strategy: string;
  confidence: "provided" | "estimated" | "blocked";
}

export interface PlaywrightGenerationResult {
  featureName: string;
  scenarioCount: number;
  stepCount: number;
  selectorProvenance: SelectorProvenance[];
  files: GeneratedFile[];
  instructions: string[];
  warnings: string[];
}

export function generatePlaywrightArtifacts(
  featureContent: string,
  options: PlaywrightGenerationOptions = {},
): PlaywrightGenerationResult {
  const parsed = parseFeature(featureContent);
  const uniqueSteps = new Map<string, ParsedStep>();
  for (const scenario of parsed.scenarios) {
    for (const step of scenario.steps) uniqueSteps.set(`${step.keyword}:${step.text}`, step);
  }
  const steps = [...uniqueSteps.values()];
  const selectorSource = options.selectorSource ?? "estimated";
  const browsers = options.browsers ?? ["chromium"];
  const ciTargets = options.ciTargets ?? ["github_actions", "azure_pipelines"];
  const renderedSteps = renderSteps(steps, selectorSource, options.appContext);
  const files: GeneratedFile[] = [
    {
      path: "features/steps/generated.steps.ts",
      language: "typescript",
      content: renderedSteps.content,
    },
    {
      path: "features/support/rule-hooks.ts",
      language: "typescript",
      content: renderRuleHooks(),
    },
    {
      path: "reporters/aiquaa-rule-reporter.ts",
      language: "typescript",
      content: renderReporterAdapter(),
    },
    {
      path: "playwright.config.aiquaa.ts",
      language: "typescript",
      content: renderConfig(options.baseUrl, browsers, options.auth),
    },
  ];
  if (options.auth) {
    files.push({ path: "features/support/auth.setup.ts", language: "typescript", content: renderAuthSetup(options.auth) });
  }
  if (options.externalValidation) {
    files.push({
      path: "features/support/notification-helper.ts",
      language: "typescript",
      content: renderNotificationHelper(options.externalValidation),
    });
  }
  if (ciTargets.includes("github_actions")) {
    files.push({
      path: ".github/workflows/playwright.yml",
      language: "yaml",
      content: renderGithubActions(browsers, options.auth, options.externalValidation),
    });
  }
  if (ciTargets.includes("azure_pipelines")) {
    files.push({
      path: "azure-pipelines.playwright.yml",
      language: "yaml",
      content: renderAzurePipelines(browsers, options.auth, options.externalValidation),
    });
  }

  const blocked = renderedSteps.provenance.filter((item) => item.confidence === "blocked").length;
  const warnings = [
    ...(selectorSource === "estimated"
      ? ["Los selectores se derivaron del texto Gherkin y están marcados como estimados."]
      : []),
    ...(blocked > 0
      ? [`${blocked} step(s) quedaron bloqueados con un error TODO para evitar falsos positivos.`]
      : []),
  ];
  return {
    featureName: parsed.name,
    scenarioCount: parsed.scenarios.length,
    stepCount: steps.length,
    selectorProvenance: renderedSteps.provenance,
    files,
    instructions: [
      "Copiá el .feature y los archivos generados al proyecto Playwright.",
      "Revisá selectorProvenance y resolvé los TODO bloqueados con HTML, código del componente o codegen.",
      "Guardá credenciales y tokens únicamente como secrets del proveedor CI.",
      "Generá specs con `npx bddgen` y ejecutalos en tu CI con `npx playwright test`.",
    ],
    warnings,
  };
}

function renderSteps(
  steps: ParsedStep[],
  selectorSource: SelectorSource,
  appContext?: string,
): { content: string; provenance: SelectorProvenance[] } {
  const provenance: SelectorProvenance[] = [];
  const registrations = steps.map((step) => {
    const method = step.keyword === "And" || step.keyword === "But" ? "Then" : step.keyword;
    const rendered = renderStepBody(step, selectorSource);
    provenance.push({ step: step.text, source: selectorSource, ...rendered.provenance });
    return `${method}(${JSON.stringify(step.text)}, async ({ page }) => {\n${rendered.body}\n});`;
  });
  return {
    content: [
      "import { expect } from '@playwright/test';",
      "import { createBdd } from 'playwright-bdd';",
      "",
      "const { Given, When, Then } = createBdd();",
      ...(appContext ? ["", `// Contexto provisto: ${singleLineComment(appContext)}`] : []),
      "",
      ...registrations.flatMap((registration) => [registration, ""]),
    ].join("\n"),
    provenance,
  };
}

function renderStepBody(
  step: ParsedStep,
  selectorSource: SelectorSource,
): { body: string; provenance: Pick<SelectorProvenance, "strategy" | "confidence"> } {
  const quoted = [...step.text.matchAll(/["“”']([^"“”']+)["“”']/g)].map((match) => match[1]).filter(Boolean);
  const normalized = step.text.toLocaleLowerCase();
  const confidence = selectorSource === "estimated" ? "estimated" as const : "provided" as const;
  const provenanceComment = `  // Selector provenance: ${selectorSource}; confidence: ${confidence}`;
  if (step.keyword === "Given" && /(página|pagina|page|sitio|website|aplicación|aplicacion)/.test(normalized)) {
    return {
      body: `${provenanceComment}\n  await page.goto('/');`,
      provenance: { strategy: "navigation", confidence },
    };
  }
  if (step.keyword === "When" && /(clic|click|presiona|press)/.test(normalized) && quoted[0]) {
    return {
      body: `${provenanceComment}\n  await page.getByRole('button', { name: ${JSON.stringify(quoted[0])} }).click();`,
      provenance: { strategy: "getByRole(button)", confidence },
    };
  }
  if (step.keyword === "When" && /(ingresa|completa|escribe|fill|enter)/.test(normalized) && quoted[0] && quoted[1]) {
    return {
      body: `${provenanceComment}\n  await page.getByLabel(${JSON.stringify(quoted[0])}).fill(${JSON.stringify(quoted[1])});`,
      provenance: { strategy: "getByLabel", confidence },
    };
  }
  if (["Then", "And", "But"].includes(step.keyword) && quoted[0]) {
    return {
      body: `${provenanceComment}\n  await expect(page.getByText(${JSON.stringify(quoted[0])})).toBeVisible();`,
      provenance: { strategy: "getByText", confidence },
    };
  }
  return {
    body: [
      `  // TODO bloqueado: aportá HTML/componente/test-id para implementar: ${singleLineComment(step.text)}`,
      `  throw new Error(${JSON.stringify(`TODO selector/acción sin fuente verificable: ${step.text}`)});`,
    ].join("\n"),
    provenance: { strategy: "unresolved", confidence: "blocked" },
  };
}

function renderRuleHooks(): string {
  return `import { createBdd, test } from 'playwright-bdd';

const { Before } = createBdd();

Before(async () => {
  const info = test.info();
  const ruleIds = info.tags
    .filter((tag) => tag.toLowerCase().startsWith('@rule:'))
    .map((tag) => tag.slice('@rule:'.length));
  const existing = new Set(
    info.annotations
      .filter((annotation) => annotation.type === 'business-rule')
      .map((annotation) => annotation.description),
  );
  for (const ruleId of ruleIds) {
    if (!existing.has(ruleId)) {
      info.annotations.push({ type: 'business-rule', description: ruleId });
    }
  }
});
`;
}

function renderReporterAdapter(): string {
  return `export { default } from 'aiquaa-playwright-mcp-server/rule-reporter';\n`;
}

function renderConfig(baseUrl: string | undefined, browsers: BrowserName[], auth?: PlaywrightAuthOptions): string {
  const projects = [
    ...(auth
      ? ["    { name: 'setup', testDir: '.', testMatch: /features\\/support\\/auth\\.setup\\.ts/ },"]
      : []),
    ...browsers.map((browser) => renderBrowserProject(browser, Boolean(auth))),
  ].join("\n");
  return `import { defineConfig, devices } from '@playwright/test';
import { defineBddConfig } from 'playwright-bdd';

const bddTestDir = defineBddConfig({
  features: 'features/**/*.feature',
  steps: ['features/steps/**/*.ts', 'features/support/rule-hooks.ts'],
});

export default defineConfig({
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  use: {
    baseURL: process.env.BASE_URL ?? ${JSON.stringify(baseUrl ?? "http://localhost:3000")},
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
  },
  projects: [
${projects}
  ],
  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['junit', { outputFile: 'test-results/playwright-junit.xml' }],
    ['./reporters/aiquaa-rule-reporter.ts', { outputFile: 'test-results/aiquaa-rule-results.json' }],
    ['json', { outputFile: 'test-results/playwright-results.json' }],
  ],
});
`;
}

function renderBrowserProject(browser: BrowserName, authenticated: boolean): string {
  const device = browser === "chromium" ? "Desktop Chrome" : browser === "firefox" ? "Desktop Firefox" : "Desktop Safari";
  return `    {
      name: '${browser}',
      testDir: bddTestDir,
      use: {
        ...devices[${JSON.stringify(device)}],${authenticated ? "\n        storageState: 'playwright/.auth/user.json'," : ""}
      },${authenticated ? "\n      dependencies: ['setup']," : ""}
    },`;
}

function renderAuthSetup(auth: PlaywrightAuthOptions): string {
  return `import { test as setup, expect } from '@playwright/test';
import path from 'node:path';

const authFile = path.join(process.cwd(), 'playwright/.auth/user.json');

setup('autenticar usuario de prueba', async ({ page }) => {
  const username = process.env[${JSON.stringify(auth.usernameEnv)}];
  const password = process.env[${JSON.stringify(auth.passwordEnv)}];
  if (!username || !password) {
    throw new Error('Faltan secrets ${auth.usernameEnv} y/o ${auth.passwordEnv} para el setup de autenticación.');
  }
  await page.goto(${JSON.stringify(auth.loginPath)});
  await page.getByLabel(${JSON.stringify(auth.usernameLabel)}).fill(username);
  await page.getByLabel(${JSON.stringify(auth.passwordLabel)}).fill(password);
  await page.getByRole('button', { name: ${JSON.stringify(auth.submitName)} }).click();
  await expect(page).toHaveURL(new RegExp(${JSON.stringify(auth.successUrlPattern)}));
  await page.context().storageState({ path: authFile });
});
`;
}

function renderNotificationHelper(validation: ExternalValidationOptions): string {
  return `import type { APIRequestContext } from '@playwright/test';

export interface NotificationResult {
  found: boolean;
  value: string | null;
  raw: Record<string, unknown>;
}

export class NotificationHelper {
  public constructor(private readonly request: APIRequestContext) {}

  public async waitForValue(identifier: string): Promise<NotificationResult> {
    const apiUrl = process.env[${JSON.stringify(validation.apiUrlEnv)}];
    const token = process.env[${JSON.stringify(validation.apiTokenEnv)}];
    if (!apiUrl) throw new Error('Falta el secret ${validation.apiUrlEnv}.');
    const deadline = Date.now() + ${validation.timeoutMs};
    while (Date.now() < deadline) {
      const response = await this.request.get(apiUrl, {
        headers: token ? { Authorization: \`Bearer \${token}\` } : {},
        params: { identifier, type: ${JSON.stringify(validation.type)} },
      });
      if (response.ok()) {
        const body: unknown = await response.json();
        const record = asRecord(body);
        const value = extractField(record, ${JSON.stringify(validation.responseField)});
        if (value !== undefined && value !== null && value !== '') {
          return { found: true, value: String(value), raw: record };
        }
      }
      await new Promise((resolve) => setTimeout(resolve, ${validation.pollIntervalMs}));
    }
    return { found: false, value: null, raw: {} };
  }
}

function extractField(value: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => asRecord(current)[key], value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
`;
}

function renderGithubActions(
  browsers: BrowserName[],
  auth?: PlaywrightAuthOptions,
  validation?: ExternalValidationOptions,
): string {
  const secretLines = githubSecretLines(auth, validation);
  return [
    "name: Playwright BDD",
    "",
    "on:",
    "  push:",
    "    branches: [main]",
    "  pull_request:",
    "",
    "jobs:",
    "  test:",
    "    runs-on: ubuntu-latest",
    "    timeout-minutes: 60",
    "    steps:",
    "      - uses: actions/checkout@v5",
    "      - uses: actions/setup-node@v6",
    "        with:",
    "          node-version: 20",
    "          cache: npm",
    "      - run: npm ci",
    `      - run: npx playwright install --with-deps ${browsers.join(" ")}`,
    "      - run: npx bddgen --config playwright.config.aiquaa.ts",
    "      - name: Run Playwright",
    "        run: npx playwright test --config playwright.config.aiquaa.ts",
    ...(secretLines.length > 0 ? ["        env:", ...secretLines] : []),
    "      - name: Upload reports",
    "        if: ${{ !cancelled() }}",
    "        uses: actions/upload-artifact@v5",
    "        with:",
    "          name: playwright-results",
    "          path: |",
    "            playwright-report/",
    "            test-results/",
    "          retention-days: 30",
    "",
  ].join("\n");
}

function githubSecretLines(auth?: PlaywrightAuthOptions, validation?: ExternalValidationOptions): string[] {
  const names = [
    ...(auth ? [auth.usernameEnv, auth.passwordEnv] : []),
    ...(validation ? [validation.apiUrlEnv, validation.apiTokenEnv] : []),
  ];
  return [
    "          BASE_URL: ${{ vars.BASE_URL }}",
    ...[...new Set(names)].map((name) => `          ${name}: \${{ secrets.${name} }}`),
  ];
}

function renderAzurePipelines(
  browsers: BrowserName[],
  auth?: PlaywrightAuthOptions,
  validation?: ExternalValidationOptions,
): string {
  const envNames = [
    ...(auth ? [auth.usernameEnv, auth.passwordEnv] : []),
    ...(validation ? [validation.apiUrlEnv, validation.apiTokenEnv] : []),
  ];
  const envLines = [
    "      BASE_URL: $(BASE_URL)",
    ...[...new Set(envNames)].map((name) => `      ${name}: $(${name})`),
  ];
  return [
    "trigger:",
    "  branches:",
    "    include: [main]",
    "",
    "pr:",
    "  branches:",
    "    include: [main]",
    "",
    "pool:",
    "  vmImage: ubuntu-latest",
    "",
    "steps:",
    "  - task: NodeTool@0",
    "    inputs:",
    "      versionSpec: 20.x",
    "  - script: npm ci",
    "    displayName: Install dependencies",
    `  - script: npx playwright install --with-deps ${browsers.join(" ")}`,
    "    displayName: Install Playwright browsers",
    "  - script: npx bddgen --config playwright.config.aiquaa.ts",
    "    displayName: Generate BDD specs",
    "  - script: npx playwright test --config playwright.config.aiquaa.ts",
    "    displayName: Run Playwright",
    ...(envLines.length > 0 ? ["    env:", ...envLines] : []),
    "  - task: PublishTestResults@2",
    "    condition: always()",
    "    inputs:",
    "      testResultsFormat: JUnit",
    "      testResultsFiles: test-results/playwright-junit.xml",
    "      failTaskOnFailedTests: true",
    "      testRunTitle: Playwright BDD",
    "  - task: PublishPipelineArtifact@1",
    "    condition: always()",
    "    inputs:",
    "      targetPath: $(System.DefaultWorkingDirectory)/test-results",
    "      artifact: playwright-results",
    "",
  ].join("\n");
}

function singleLineComment(value: string): string {
  return value.replace(/[\r\n]+/g, " ").replace(/\*\//g, "* /").slice(0, 500);
}
