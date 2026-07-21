import type { GeneratedFile } from "../types.js";
import { parseFeature, type ParsedStep } from "./gherkin.js";

export interface PlaywrightGenerationResult {
  featureName: string;
  scenarioCount: number;
  stepCount: number;
  files: GeneratedFile[];
  instructions: string[];
}

export function generatePlaywrightArtifacts(
  featureContent: string,
  baseUrl?: string,
  appContext?: string,
): PlaywrightGenerationResult {
  const parsed = parseFeature(featureContent);
  const uniqueSteps = new Map<string, ParsedStep>();
  for (const scenario of parsed.scenarios) {
    for (const step of scenario.steps) uniqueSteps.set(`${step.keyword}:${step.text}`, step);
  }
  const steps = [...uniqueSteps.values()];
  const files: GeneratedFile[] = [
    {
      path: "features/steps/generated.steps.ts",
      language: "typescript",
      content: renderSteps(steps, appContext),
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
      content: renderConfig(baseUrl),
    },
  ];
  return {
    featureName: parsed.name,
    scenarioCount: parsed.scenarios.length,
    stepCount: steps.length,
    files,
    instructions: [
      "Copiá el .feature y los archivos generados al proyecto Playwright.",
      "Revisá los TODO de selectores: el servidor no inspecciona ni ejecuta la aplicación.",
      "Instalá playwright-bdd y este paquete (o copiá la implementación exportada del reporter).",
      "Generá specs con `npx bddgen` y ejecutalos en tu CI con `npx playwright test`.",
    ],
  };
}

function renderSteps(steps: ParsedStep[], appContext?: string): string {
  const registrations = steps.map((step) => {
    const method = step.keyword === "And" || step.keyword === "But" ? "Then" : step.keyword;
    return `${method}(${JSON.stringify(step.text)}, async ({ page }) => {\n${renderStepBody(step)}\n});`;
  });
  return [
    "import { expect } from '@playwright/test';",
    "import { createBdd } from 'playwright-bdd';",
    "",
    "const { Given, When, Then } = createBdd();",
    ...(appContext ? ["", `// Contexto provisto: ${singleLineComment(appContext)}`] : []),
    "",
    ...registrations.flatMap((registration) => [registration, ""]),
  ].join("\n");
}

function renderStepBody(step: ParsedStep): string {
  const quoted = [...step.text.matchAll(/["“”']([^"“”']+)["“”']/g)].map((match) => match[1]).filter(Boolean);
  const normalized = step.text.toLocaleLowerCase();
  if (step.keyword === "Given" && /(página|pagina|page|sitio|website|aplicación|aplicacion)/.test(normalized)) {
    return "  await page.goto('/');";
  }
  if (step.keyword === "When" && /(clic|click|presiona|press)/.test(normalized) && quoted[0]) {
    return `  await page.getByRole('button', { name: ${JSON.stringify(quoted[0])} }).click();`;
  }
  if (step.keyword === "When" && /(ingresa|completa|escribe|fill|enter)/.test(normalized) && quoted[0] && quoted[1]) {
    return `  await page.getByLabel(${JSON.stringify(quoted[0])}).fill(${JSON.stringify(quoted[1])});`;
  }
  if (["Then", "And", "But"].includes(step.keyword) && quoted[0]) {
    return `  await expect(page.getByText(${JSON.stringify(quoted[0])})).toBeVisible();`;
  }
  return [
    `  // TODO: reemplazá este selector/resultado con la semántica real de: ${singleLineComment(step.text)}`,
    "  await expect(page.locator('body')).toBeVisible();",
  ].join("\n");
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

function renderConfig(baseUrl?: string): string {
  return `import { defineConfig } from '@playwright/test';
import { defineBddConfig } from 'playwright-bdd';

const testDir = defineBddConfig({
  features: 'features/**/*.feature',
  steps: ['features/steps/**/*.ts', 'features/support/**/*.ts'],
});

export default defineConfig({
  testDir,
  use: {
    baseURL: ${JSON.stringify(baseUrl ?? "http://localhost:3000")},
    trace: 'on-first-retry',
  },
  reporter: [
    ['html', { open: 'never' }],
    ['./reporters/aiquaa-rule-reporter.ts', { outputFile: 'test-results/aiquaa-rule-results.json' }],
    ['json', { outputFile: 'test-results/playwright-results.json' }],
  ],
});
`;
}

function singleLineComment(value: string): string {
  return value.replace(/[\r\n]+/g, " ").replace(/\*\//g, "* /").slice(0, 500);
}
