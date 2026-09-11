import type { GeneratedFile } from "../types.js";
import { parseFeature, type ParsedStep } from "./gherkin.js";
import { truncateText } from "./response.js";

export type SelectorSource = "provided_dom" | "provided_component" | "provided_test_ids" | "estimated";
export type BrowserName = "chromium" | "firefox" | "webkit";
export type CiTarget = "github_actions" | "azure_pipelines";
export type AuthMode = "password" | "passwordless" | "otp";
export type GeneratedFileKind =
  | "steps"
  | "hooks"
  | "reporter"
  | "config"
  | "auth"
  | "notification"
  | "github_actions"
  | "azure_pipelines";

export interface DomContext {
  testIds?: string[];
  roles?: Array<{ role: string; name: string }>;
  labels?: string[];
}

export interface PlaywrightAuthOptions {
  mode: AuthMode;
  loginPath: string;
  usernameLabel: string;
  passwordLabel: string;
  submitName: string;
  successUrlPattern: string;
  usernameEnv: string;
  passwordEnv: string;
  otpEnv?: string;
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
  domContext?: DomContext;
  selectorSource?: SelectorSource;
  auth?: PlaywrightAuthOptions;
  externalValidation?: ExternalValidationOptions;
  browsers?: BrowserName[];
  ciTargets?: CiTarget[];
  includeFiles?: GeneratedFileKind[];
  maxFileBytes?: number;
  shards?: number;
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
  omittedFiles: GeneratedFileKind[];
  instructions: string[];
  warnings: string[];
}

interface Candidate {
  kind: GeneratedFileKind;
  path: string;
  language: string;
  content: () => string;
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
  const shards = Math.max(1, options.shards ?? 1);
  const maxFileBytes = options.maxFileBytes ?? 20_000;
  const renderedSteps = renderSteps(steps, selectorSource, options.domContext, options.appContext);

  if (options.auth) assertValidUrlPattern(options.auth.successUrlPattern);

  const candidates: Candidate[] = [
    {
      kind: "steps",
      path: "features/steps/generated.steps.ts",
      language: "typescript",
      content: () => renderedSteps.content,
    },
    { kind: "hooks", path: "features/support/rule-hooks.ts", language: "typescript", content: renderRuleHooks },
    {
      kind: "reporter",
      path: "reporters/aiquaa-rule-reporter.ts",
      language: "typescript",
      content: renderReporterAdapter,
    },
    {
      kind: "config",
      path: "playwright.config.aiquaa.ts",
      language: "typescript",
      content: () => renderConfig(options.baseUrl, browsers, options.auth),
    },
  ];
  if (options.auth) {
    const auth = options.auth;
    candidates.push({
      kind: "auth",
      path: "features/support/auth.setup.ts",
      language: "typescript",
      content: () => renderAuthSetup(auth, options.domContext),
    });
  }
  if (options.externalValidation) {
    const validation = options.externalValidation;
    candidates.push({
      kind: "notification",
      path: "features/support/notification-helper.ts",
      language: "typescript",
      content: () => renderNotificationHelper(validation),
    });
  }
  if (ciTargets.includes("github_actions")) {
    candidates.push({
      kind: "github_actions",
      path: ".github/workflows/playwright.yml",
      language: "yaml",
      content: () => renderGithubActions(browsers, shards, options.auth, options.externalValidation),
    });
  }
  if (ciTargets.includes("azure_pipelines")) {
    candidates.push({
      kind: "azure_pipelines",
      path: "azure-pipelines.playwright.yml",
      language: "yaml",
      content: () => renderAzurePipelines(browsers, options.auth, options.externalValidation),
    });
  }

  const requested = options.includeFiles;
  const selected = requested ? candidates.filter((item) => requested.includes(item.kind)) : candidates;
  const omittedFiles = candidates.filter((item) => !selected.includes(item)).map((item) => item.kind);
  const files: GeneratedFile[] = selected.map((candidate) => {
    const raw = candidate.content();
    const { text, truncated } = truncateText(raw, maxFileBytes);
    return {
      path: candidate.path,
      language: candidate.language,
      content: text,
      bytes: raw.length,
      ...(truncated ? { truncated: true } : {}),
    };
  });

  const blocked = renderedSteps.provenance.filter((item) => item.confidence === "blocked").length;
  const warnings = [
    ...(selectorSource === "estimated"
      ? ["Los selectores se derivaron del texto Gherkin y están marcados como estimados."]
      : []),
    ...(blocked > 0
      ? [`${blocked} step(s) quedaron bloqueados con un error TODO para evitar falsos positivos.`]
      : []),
    ...(files.some((file) => file.truncated)
      ? ["Algún archivo se truncó por max_file_bytes; pedilo solo con include_files para verlo completo."]
      : []),
    ...(shards > 1
      ? ["Con shards>1 cada shard escribe su propio aiquaa-rule-results; usá el JSON mergeado en qa_cobertura."]
      : []),
  ];
  return {
    featureName: parsed.name,
    scenarioCount: parsed.scenarios.length,
    stepCount: steps.length,
    selectorProvenance: renderedSteps.provenance,
    files,
    omittedFiles,
    instructions: [
      "Copiá el .feature y los archivos generados al proyecto Playwright.",
      "Revisá selectorProvenance y resolvé los TODO bloqueados con HTML, código del componente o codegen.",
      "Guardá credenciales y tokens únicamente como secrets del proveedor CI.",
      "Generá specs con `npx bddgen` y ejecutalos en tu CI con `npx playwright test`.",
    ],
    warnings,
  };
}

function assertValidUrlPattern(pattern: string): void {
  try {
    new RegExp(pattern);
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`auth.success_url_pattern no es una RegExp válida: ${detail}`);
  }
}

function renderSteps(
  steps: ParsedStep[],
  selectorSource: SelectorSource,
  domContext?: DomContext,
  appContext?: string,
): { content: string; provenance: SelectorProvenance[] } {
  const provenance: SelectorProvenance[] = [];
  const registrations = steps.map((step) => {
    const method = step.keyword === "And" || step.keyword === "But" ? "Then" : step.keyword;
    const rendered = renderStepBody(step, selectorSource, domContext);
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
  domContext?: DomContext,
): { body: string; provenance: Pick<SelectorProvenance, "strategy" | "confidence"> } {
  const quoted = [...step.text.matchAll(/["“”']([^"“”']+)["“”']/g)]
    .map((match) => match[1])
    .filter((value): value is string => Boolean(value));
  const normalized = step.text.toLocaleLowerCase();
  const isNavigation = step.keyword === "Given"
    && /(página|pagina|page|sitio|website|aplicación|aplicacion)/.test(normalized);
  const isClick = /(clic|click|presiona|press)/.test(normalized);
  const isFill = /(ingresa|completa|escribe|fill|enter)/.test(normalized);
  const isAssertion = ["Then", "And", "But"].includes(step.keyword);

  if (isNavigation) {
    return {
      body: `${comment(selectorSource, "provided")}\n  await page.goto('/');`,
      provenance: { strategy: "navigation", confidence: "provided" },
    };
  }

  // Los selectores verificados solo salen de dom_context. Nunca se etiqueta como
  // "provided" algo que en realidad se infirió del texto Gherkin.
  if (selectorSource !== "estimated") {
    const resolved = resolveFromDomContext(quoted, domContext, { isClick, isFill, isAssertion });
    if (resolved) {
      return { body: `${comment(selectorSource, "provided")}\n  ${resolved.code}`, provenance: resolved.provenance };
    }
    return blockedStep(step, "no hay entrada en dom_context que cubra este step");
  }

  if (isClick && quoted[0]) {
    return {
      body: `${comment(selectorSource, "estimated")}\n  await page.getByRole('button', { name: ${JSON.stringify(quoted[0])} }).click();`,
      provenance: { strategy: "getByRole(button)", confidence: "estimated" },
    };
  }
  if (isFill && quoted[0] && quoted[1]) {
    return {
      body: `${comment(selectorSource, "estimated")}\n  await page.getByLabel(${JSON.stringify(quoted[0])}).fill(${JSON.stringify(quoted[1])});`,
      provenance: { strategy: "getByLabel", confidence: "estimated" },
    };
  }
  if (isAssertion && quoted[0]) {
    return {
      body: `${comment(selectorSource, "estimated")}\n  await expect(page.getByText(${JSON.stringify(quoted[0])})).toBeVisible();`,
      provenance: { strategy: "getByText", confidence: "estimated" },
    };
  }
  return blockedStep(step, "falta HTML, componente o test-id para implementarlo");
}

function resolveFromDomContext(
  quoted: string[],
  domContext: DomContext | undefined,
  intent: { isClick: boolean; isFill: boolean; isAssertion: boolean },
): { code: string; provenance: Pick<SelectorProvenance, "strategy" | "confidence"> } | undefined {
  if (!domContext) return undefined;
  const target = quoted[0];
  if (!target) return undefined;

  const testId = matchTestId(target, domContext.testIds);
  if (testId) {
    const locator = `page.getByTestId(${JSON.stringify(testId)})`;
    if (intent.isFill && quoted[1]) {
      return {
        code: `await ${locator}.fill(${JSON.stringify(quoted[1])});`,
        provenance: { strategy: "getByTestId", confidence: "provided" },
      };
    }
    if (intent.isClick) {
      return { code: `await ${locator}.click();`, provenance: { strategy: "getByTestId", confidence: "provided" } };
    }
    return {
      code: `await expect(${locator}).toBeVisible();`,
      provenance: { strategy: "getByTestId", confidence: "provided" },
    };
  }

  const label = domContext.labels?.find((value) => equalsNormalized(value, target));
  if (label && intent.isFill && quoted[1]) {
    return {
      code: `await page.getByLabel(${JSON.stringify(label)}).fill(${JSON.stringify(quoted[1])});`,
      provenance: { strategy: "getByLabel", confidence: "provided" },
    };
  }

  const role = domContext.roles?.find((entry) => equalsNormalized(entry.name, target));
  if (role) {
    const locator = `page.getByRole(${JSON.stringify(role.role)}, { name: ${JSON.stringify(role.name)} })`;
    if (intent.isClick) {
      return { code: `await ${locator}.click();`, provenance: { strategy: "getByRole", confidence: "provided" } };
    }
    return { code: `await expect(${locator}).toBeVisible();`, provenance: { strategy: "getByRole", confidence: "provided" } };
  }
  return undefined;
}

function blockedStep(
  step: ParsedStep,
  reason: string,
): { body: string; provenance: Pick<SelectorProvenance, "strategy" | "confidence"> } {
  return {
    body: [
      `  // TODO bloqueado (${reason}): ${singleLineComment(step.text)}`,
      `  throw new Error(${JSON.stringify(`TODO selector/acción sin fuente verificable: ${step.text}`)});`,
    ].join("\n"),
    provenance: { strategy: "unresolved", confidence: "blocked" },
  };
}

function comment(source: SelectorSource, confidence: string): string {
  return `  // Selector provenance: ${source}; confidence: ${confidence}`;
}

function matchTestId(target: string, testIds?: string[]): string | undefined {
  if (!testIds?.length) return undefined;
  const slug = slugify(target);
  if (!slug) return undefined;
  return (
    testIds.find((id) => slugify(id) === slug) ??
    testIds.find((id) => slugify(id).endsWith(`-${slug}`)) ??
    testIds.find((id) => slugify(id).includes(slug))
  );
}

function equalsNormalized(left: string, right: string): boolean {
  return normalize(left) === normalize(right);
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function slugify(value: string): string {
  return normalize(value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
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

// Con sharding cada shard escribe su propio archivo de reglas y un reporte blob
// que el job de merge combina.
const shardSuffix = process.env.SHARD_INDEX ? \`-\${process.env.SHARD_INDEX}\` : '';

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
    process.env.PW_BLOB
      ? ['blob', { outputDir: 'blob-report' }]
      : ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['junit', { outputFile: \`test-results/playwright-junit\${shardSuffix}.xml\` }],
    ['./reporters/aiquaa-rule-reporter.ts', { outputFile: \`test-results/aiquaa-rule-results\${shardSuffix}.json\` }],
    ['json', { outputFile: \`test-results/playwright-results\${shardSuffix}.json\` }],
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

function renderAuthSetup(auth: PlaywrightAuthOptions, domContext?: DomContext): string {
  const header = `import { test as setup, expect } from '@playwright/test';
import path from 'node:path';

const authFile = path.join(process.cwd(), 'playwright/.auth/user.json');

setup('autenticar usuario de prueba', async ({ page }) => {
  const username = process.env[${JSON.stringify(auth.usernameEnv)}];
  if (!username) throw new Error('Falta el secret ${auth.usernameEnv} para el setup de autenticación.');`;

  const usernameField = authField(domContext, auth.usernameLabel, ["email", "usuario", "user"]);
  const submitAction = authSubmit(domContext, auth.submitName);
  const tail = `  await expect(page).toHaveURL(new RegExp(${JSON.stringify(auth.successUrlPattern)}));
  await page.context().storageState({ path: authFile });
});
`;

  if (auth.mode === "passwordless") {
    return [
      header,
      `  await page.goto(${JSON.stringify(auth.loginPath)});`,
      `  ${usernameField}.fill(username);`,
      `  ${submitAction}`,
      tail,
    ].join("\n");
  }

  if (auth.mode === "otp") {
    const otpEnv = auth.otpEnv;
    const otpField = matchTestId("otp", domContext?.testIds)
      ?? matchTestId("codigo", domContext?.testIds)
      ?? matchTestId("code", domContext?.testIds);
    const otpStep = otpEnv && otpField
      ? [
          `  const otp = process.env[${JSON.stringify(otpEnv)}];`,
          `  if (!otp) throw new Error('Falta el secret ${otpEnv} con el código OTP de pruebas.');`,
          `  await page.getByTestId(${JSON.stringify(otpField)}).fill(otp);`,
          `  ${submitAction}`,
        ].join("\n")
      : [
          "  // TODO bloqueado: pasá auth.otp_env y un dom_context con el test-id del campo OTP.",
          `  throw new Error('TODO: paso OTP sin fuente verificable para el selector del campo de código.');`,
        ].join("\n");
    return [
      header,
      `  await page.goto(${JSON.stringify(auth.loginPath)});`,
      `  ${usernameField}.fill(username);`,
      `  ${submitAction}`,
      otpStep,
      tail,
    ].join("\n");
  }

  const passwordField = authField(domContext, auth.passwordLabel, ["password", "contrasena", "clave"]);
  return [
    header,
    `  const password = process.env[${JSON.stringify(auth.passwordEnv)}];`,
    `  if (!password) throw new Error('Falta el secret ${auth.passwordEnv} para el setup de autenticación.');`,
    `  await page.goto(${JSON.stringify(auth.loginPath)});`,
    `  ${usernameField}.fill(username);`,
    `  ${passwordField}.fill(password);`,
    `  ${submitAction}`,
    tail,
  ].join("\n");
}

function authField(domContext: DomContext | undefined, label: string, hints: string[]): string {
  const byLabel = matchTestId(label, domContext?.testIds);
  const byHint = hints.map((hint) => matchTestId(hint, domContext?.testIds)).find(Boolean);
  const testId = byLabel ?? byHint;
  return testId
    ? `await page.getByTestId(${JSON.stringify(testId)})`
    : `await page.getByLabel(${JSON.stringify(label)})`;
}

function authSubmit(domContext: DomContext | undefined, submitName: string): string {
  const testId = matchTestId(submitName, domContext?.testIds) ?? matchTestId("submit", domContext?.testIds);
  return testId
    ? `await page.getByTestId(${JSON.stringify(testId)}).click();`
    : `await page.getByRole('button', { name: ${JSON.stringify(submitName)} }).click();`;
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
  shards: number,
  auth?: PlaywrightAuthOptions,
  validation?: ExternalValidationOptions,
): string {
  const secretLines = githubSecretLines(auth, validation);
  const sharded = shards > 1;
  const shardList = Array.from({ length: shards }, (_, index) => index + 1).join(", ");
  return [
    "name: Playwright BDD",
    "",
    "on:",
    "  push:",
    "    branches: [main]",
    "  pull_request:",
    "",
    "permissions:",
    "  contents: read",
    "",
    "concurrency:",
    "  group: playwright-${{ github.workflow }}-${{ github.ref }}",
    "  cancel-in-progress: true",
    "",
    "jobs:",
    "  test:",
    "    runs-on: ubuntu-latest",
    "    timeout-minutes: 60",
    ...(sharded
      ? [
          "    strategy:",
          "      fail-fast: false",
          "      matrix:",
          `        shard: [${shardList}]`,
        ]
      : []),
    "    steps:",
    "      - uses: actions/checkout@v5",
    "      - uses: actions/setup-node@v6",
    "        with:",
    "          node-version: 20",
    "          cache: npm",
    "      - run: npm ci",
    "      - name: Resolve Playwright version",
    "        id: pw",
    "        run: echo \"version=$(node -p \"require('@playwright/test/package.json').version\")\" >> \"$GITHUB_OUTPUT\"",
    "      - name: Cache Playwright browsers",
    "        id: pw-cache",
    "        uses: actions/cache@v4",
    "        with:",
    "          path: ~/.cache/ms-playwright",
    "          key: ms-playwright-${{ runner.os }}-${{ steps.pw.outputs.version }}",
    "      - name: Install Playwright browsers",
    "        if: steps.pw-cache.outputs.cache-hit != 'true'",
    `        run: npx playwright install --with-deps ${browsers.join(" ")}`,
    "      - name: Install system dependencies",
    "        if: steps.pw-cache.outputs.cache-hit == 'true'",
    `        run: npx playwright install-deps ${browsers.join(" ")}`,
    "      - run: npx bddgen --config playwright.config.aiquaa.ts",
    "      - name: Run Playwright",
    ...(sharded
      ? ["        run: npx playwright test --config playwright.config.aiquaa.ts --shard=${{ matrix.shard }}/" + String(shards)]
      : ["        run: npx playwright test --config playwright.config.aiquaa.ts"]),
    "        env:",
    ...secretLines,
    ...(sharded ? ["          PW_BLOB: \"1\"", "          SHARD_INDEX: ${{ matrix.shard }}"] : []),
    "      - name: Upload reports",
    "        if: ${{ !cancelled() }}",
    "        uses: actions/upload-artifact@v5",
    "        with:",
    ...(sharded
      ? ["          name: playwright-results-${{ matrix.shard }}"]
      : ["          name: playwright-results"]),
    "          path: |",
    ...(sharded ? ["            blob-report/"] : ["            playwright-report/"]),
    "            test-results/",
    "          retention-days: 30",
    ...(sharded
      ? [
          "",
          "  merge-reports:",
          "    if: ${{ !cancelled() }}",
          "    needs: test",
          "    runs-on: ubuntu-latest",
          "    timeout-minutes: 15",
          "    steps:",
          "      - uses: actions/checkout@v5",
          "      - uses: actions/setup-node@v6",
          "        with:",
          "          node-version: 20",
          "          cache: npm",
          "      - run: npm ci",
          "      - uses: actions/download-artifact@v5",
          "        with:",
          "          pattern: playwright-results-*",
          "          path: all-results",
          "      - name: Merge HTML report",
          "        run: npx playwright merge-reports --reporter html ./all-results",
          "      - name: Merge AIQUAA rule results",
          "        run: |",
          "          node -e \"const fs=require('fs');const g=require('node:child_process');const files=g.execSync('find all-results -name \\\"aiquaa-rule-results*.json\\\"').toString().trim().split('\\n').filter(Boolean);const rules=new Map();let runStatus='passed';for(const f of files){const d=JSON.parse(fs.readFileSync(f,'utf8'));if(d.runStatus&&d.runStatus!=='passed')runStatus=d.runStatus;for(const r of d.businessRuleCoverage?.rules??[]){const prev=rules.get(r.ruleId)??[];rules.set(r.ruleId,[...prev,...r.tests]);}}const merged=[...rules.entries()].sort().map(([ruleId,tests])=>({ruleId,status:tests.some(t=>['failed','timedOut','interrupted'].includes(t.status))?'failed':tests.some(t=>t.status==='passed')?'passed':'skipped',tests}));fs.mkdirSync('test-results',{recursive:true});fs.writeFileSync('test-results/aiquaa-rule-results.json',JSON.stringify({schemaVersion:1,generatedAt:new Date().toISOString(),runStatus,businessRuleCoverage:{rulesWithTests:merged.length,passed:merged.filter(r=>r.status==='passed').length,failed:merged.filter(r=>r.status==='failed').length,skipped:merged.filter(r=>r.status==='skipped').length,rules:merged}},null,2));\"",
          "      - uses: actions/upload-artifact@v5",
          "        with:",
          "          name: playwright-report-merged",
          "          path: |",
          "            playwright-report/",
          "            test-results/aiquaa-rule-results.json",
          "          retention-days: 30",
        ]
      : []),
    "",
  ].join("\n");
}

function githubSecretLines(auth?: PlaywrightAuthOptions, validation?: ExternalValidationOptions): string[] {
  const names = [
    ...(auth ? authSecretNames(auth) : []),
    ...(validation ? [validation.apiUrlEnv, validation.apiTokenEnv] : []),
  ];
  return [
    "          BASE_URL: ${{ vars.BASE_URL }}",
    ...[...new Set(names)].map((name) => `          ${name}: \${{ secrets.${name} }}`),
  ];
}

function authSecretNames(auth: PlaywrightAuthOptions): string[] {
  const names = [auth.usernameEnv];
  if (auth.mode === "password") names.push(auth.passwordEnv);
  if (auth.mode === "otp" && auth.otpEnv) names.push(auth.otpEnv);
  return names;
}

function renderAzurePipelines(
  browsers: BrowserName[],
  auth?: PlaywrightAuthOptions,
  validation?: ExternalValidationOptions,
): string {
  const envNames = [
    ...(auth ? authSecretNames(auth) : []),
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
    "      testResultsFiles: test-results/playwright-junit*.xml",
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
