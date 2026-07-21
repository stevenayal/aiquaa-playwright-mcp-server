import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FullResult, Reporter, TestCase, TestResult } from "@playwright/test/reporter";
import { RULE_ANNOTATION_TYPE, RULE_TAG_PREFIX } from "../constants.js";

interface ReporterOptions {
  outputFile?: string;
}

interface RuleTestResult {
  title: string;
  feature: string;
  status: string;
  duration: number;
  retry: number;
}

interface RuleAggregate {
  ruleId: string;
  status: "passed" | "failed" | "skipped";
  tests: RuleTestResult[];
}

export default class AiquaaRuleReporter implements Reporter {
  private readonly outputFile: string;
  private readonly rules = new Map<string, RuleTestResult[]>();

  public constructor(options: ReporterOptions = {}) {
    this.outputFile = options.outputFile ?? "test-results/aiquaa-rule-results.json";
  }

  public onTestEnd(test: TestCase, result: TestResult): void {
    const annotations = [
      ...test.annotations,
      ...(result.annotations ?? []),
    ];
    const annotationRuleIds = annotations
      .filter((annotation) => annotation.type === RULE_ANNOTATION_TYPE)
      .map((annotation) => annotation.description)
      .filter((value): value is string => Boolean(value));
    const tagRuleIds = test.tags
      .filter((tag) => tag.toLowerCase().startsWith(RULE_TAG_PREFIX))
      .map((tag) => tag.slice(RULE_TAG_PREFIX.length));
    const ruleIds = [...new Set([...annotationRuleIds, ...tagRuleIds])];
    const titlePath = test.titlePath();
    const item: RuleTestResult = {
      title: test.title,
      feature: titlePath.at(-2) ?? test.location.file,
      status: result.status,
      duration: result.duration,
      retry: result.retry,
    };
    for (const ruleId of ruleIds) {
      const tests = this.rules.get(ruleId) ?? [];
      tests.push(item);
      this.rules.set(ruleId, tests);
    }
  }

  public async onEnd(result: FullResult): Promise<void> {
    const rules: RuleAggregate[] = [...this.rules.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([ruleId, tests]) => ({ ruleId, status: aggregateStatus(tests), tests }));
    const output = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      runStatus: result.status,
      businessRuleCoverage: {
        rulesWithTests: rules.length,
        passed: rules.filter((rule) => rule.status === "passed").length,
        failed: rules.filter((rule) => rule.status === "failed").length,
        skipped: rules.filter((rule) => rule.status === "skipped").length,
        rules,
      },
    };
    await mkdir(path.dirname(this.outputFile), { recursive: true });
    await writeFile(this.outputFile, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  }

  public printsToStdio(): boolean {
    return false;
  }
}

function aggregateStatus(tests: RuleTestResult[]): RuleAggregate["status"] {
  if (tests.some((test) => ["failed", "timedOut", "interrupted"].includes(test.status))) return "failed";
  if (tests.some((test) => test.status === "passed")) return "passed";
  return "skipped";
}
