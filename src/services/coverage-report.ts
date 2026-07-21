import { RULE_ANNOTATION_TYPE, RULE_TAG_PREFIX } from "../constants.js";
import type {
  BusinessRule,
  CoverageReport,
  NormalizedTestResult,
  RuleCoverageItem,
  TestStatus,
} from "../types.js";

export function parsePlaywrightResults(input: string | Record<string, unknown>): NormalizedTestResult[] {
  let value: unknown = input;
  if (typeof input === "string") {
    try {
      value = JSON.parse(input) as unknown;
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`playwright_results no es JSON válido. Corregí el contenido y reintentá. Detalle: ${detail}`);
    }
  }
  const root = asRecord(value);
  const custom = parseCustomReporter(root);
  if (custom.length > 0) return deduplicate(custom);

  const normalized: NormalizedTestResult[] = [];
  const suites = arrayValue(root.suites);
  for (const suite of suites) walkSuite(suite, "", normalized);
  if (normalized.length === 0) {
    throw new Error(
      "No se encontraron tests en el JSON. Usá el JSON reporter de Playwright o el aiquaa-rule-reporter generado.",
    );
  }
  return deduplicate(normalized);
}

export function buildCoverageReport(
  projectId: string,
  rules: BusinessRule[],
  tests: NormalizedTestResult[],
): CoverageReport {
  const ruleItems: RuleCoverageItem[] = rules.map((rule) => {
    const ruleTests = tests.filter((test) => test.ruleIds.includes(rule.id));
    return { rule, status: coverageStatus(ruleTests), tests: ruleTests };
  });
  const coveredRules = ruleItems.filter((item) => item.tests.length > 0).length;
  const passingRules = ruleItems.filter((item) => item.status === "passed").length;
  const failingRules = ruleItems.filter((item) => item.status === "failing").length;
  const uncoveredRules = ruleItems.filter((item) => item.status === "uncovered").length;
  const featureMap = new Map<string, NormalizedTestResult[]>();
  for (const test of tests) {
    const items = featureMap.get(test.feature) ?? [];
    items.push(test);
    featureMap.set(test.feature, items);
  }
  const features = [...featureMap.entries()].map(([name, featureTests]) => ({
    name,
    tests: featureTests.length,
    passed: featureTests.filter((test) => test.status === "passed").length,
    failed: featureTests.filter((test) => isFailure(test.status)).length,
    ruleIds: unique(featureTests.flatMap((test) => test.ruleIds)),
  }));
  return {
    projectId,
    generatedAt: new Date().toISOString(),
    summary: {
      totalRules: rules.length,
      coveredRules,
      passingRules,
      failingRules,
      uncoveredRules,
      coveragePercentage: rules.length === 0 ? 0 : round((coveredRules / rules.length) * 100),
    },
    rules: ruleItems,
    features,
  };
}

export function coverageReportToMarkdown(report: CoverageReport): string {
  const lines = [
    `# Cobertura de reglas de negocio — ${report.projectId}`,
    "",
    `- Cobertura: **${report.summary.coveragePercentage}%** (${report.summary.coveredRules}/${report.summary.totalRules})`,
    `- Reglas con tests pasando: **${report.summary.passingRules}**`,
    `- Reglas con tests fallando: **${report.summary.failingRules}**`,
    `- Reglas sin escenario/test: **${report.summary.uncoveredRules}**`,
    "",
    "| Regla | Título | Estado | Tests |",
    "|---|---|---:|---:|",
    ...report.rules.map((item) =>
      `| ${escapeCell(item.rule.id)} | ${escapeCell(item.rule.title)} | ${item.status} | ${item.tests.length} |`,
    ),
    "",
    "## Desglose por feature",
    "",
    "| Feature | Tests | Pasaron | Fallaron | Reglas |",
    "|---|---:|---:|---:|---|",
    ...report.features.map((feature) =>
      `| ${escapeCell(feature.name)} | ${feature.tests} | ${feature.passed} | ${feature.failed} | ${feature.ruleIds.join(", ") || "—"} |`,
    ),
  ];
  return lines.join("\n");
}

function walkSuite(value: unknown, parentFeature: string, output: NormalizedTestResult[]): void {
  const suite = asRecord(value);
  const suiteTitle = stringValue(suite.title) ?? parentFeature;
  const specs = arrayValue(suite.specs);
  for (const rawSpec of specs) {
    const spec = asRecord(rawSpec);
    const title = stringValue(spec.title) ?? "Test sin título";
    const specRuleIds = extractRuleIds(spec);
    for (const rawTest of arrayValue(spec.tests)) {
      const test = asRecord(rawTest);
      const testRuleIds = unique([...specRuleIds, ...extractRuleIds(test)]);
      const results = arrayValue(test.results);
      const lastResult = results.at(-1);
      const resultRecord = asRecord(lastResult);
      const ruleIds = unique([...testRuleIds, ...extractRuleIds(resultRecord), ...ruleIdsFromText(title)]);
      output.push({
        title,
        feature: suiteTitle || stringValue(spec.file) || "Feature desconocido",
        status: normalizeStatus(stringValue(resultRecord.status)),
        ruleIds,
      });
    }
  }
  for (const child of arrayValue(suite.suites)) walkSuite(child, suiteTitle, output);
}

function parseCustomReporter(root: Record<string, unknown>): NormalizedTestResult[] {
  const coverage = asRecord(root.businessRuleCoverage);
  const output: NormalizedTestResult[] = [];
  for (const rawRule of arrayValue(coverage.rules)) {
    const rule = asRecord(rawRule);
    const ruleId = stringValue(rule.ruleId);
    if (!ruleId) continue;
    for (const rawTest of arrayValue(rule.tests)) {
      const test = asRecord(rawTest);
      output.push({
        title: stringValue(test.title) ?? "Test sin título",
        feature: stringValue(test.feature) ?? "Feature desconocido",
        status: normalizeStatus(stringValue(test.status)),
        ruleIds: [ruleId],
      });
    }
  }
  return output;
}

function extractRuleIds(record: Record<string, unknown>): string[] {
  const fromTags = arrayValue(record.tags)
    .map(stringValue)
    .filter((value): value is string => Boolean(value))
    .flatMap(ruleIdsFromText);
  const fromAnnotations = arrayValue(record.annotations).flatMap((value) => {
    const annotation = asRecord(value);
    const type = stringValue(annotation.type);
    const description = stringValue(annotation.description);
    if (type === RULE_ANNOTATION_TYPE && description) return [description];
    return description ? ruleIdsFromText(description) : [];
  });
  return unique([...fromTags, ...fromAnnotations]);
}

function ruleIdsFromText(value: string): string[] {
  const pattern = new RegExp(`${RULE_TAG_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([A-Za-z0-9._-]+)`, "gi");
  return [...value.matchAll(pattern)].map((match) => match[1]).filter((id): id is string => Boolean(id));
}

function coverageStatus(tests: NormalizedTestResult[]): RuleCoverageItem["status"] {
  if (tests.length === 0) return "uncovered";
  if (tests.some((test) => isFailure(test.status))) return "failing";
  if (tests.some((test) => test.status === "passed")) return "passed";
  return "not_run";
}

function normalizeStatus(value?: string): TestStatus {
  if (value === "passed" || value === "failed" || value === "skipped" || value === "timedOut" || value === "interrupted") {
    return value;
  }
  return "unknown";
}

function isFailure(status: TestStatus): boolean {
  return status === "failed" || status === "timedOut" || status === "interrupted";
}

function deduplicate(tests: NormalizedTestResult[]): NormalizedTestResult[] {
  const merged = new Map<string, NormalizedTestResult>();
  for (const test of tests) {
    const key = `${test.feature}\u0000${test.title}\u0000${test.status}`;
    const existing = merged.get(key);
    merged.set(key, existing ? { ...existing, ruleIds: unique([...existing.ruleIds, ...test.ruleIds]) } : test);
  }
  return [...merged.values()];
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}
