export type ResponseFormat = "summary" | "markdown" | "json";

export interface BusinessRule {
  id: string;
  title: string;
  description: string;
  status?: string;
  priority?: string;
}

export interface PaginatedBusinessRules {
  items: BusinessRule[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface GeneratedFile {
  path: string;
  language: string;
  content: string;
  bytes: number;
  truncated?: boolean;
}

export interface ScenarioRuleMapping {
  feature: string;
  scenario: string;
  ruleIds: string[];
}

export type TestStatus = "passed" | "failed" | "skipped" | "timedOut" | "interrupted" | "unknown";

export interface NormalizedTestResult {
  title: string;
  feature: string;
  status: TestStatus;
  ruleIds: string[];
}

export interface RuleCoverageItem {
  rule: BusinessRule;
  status: "passed" | "failing" | "not_run" | "uncovered";
  testCount: number;
  /** Solo en `detail: "full"`. */
  tests?: NormalizedTestResult[];
  /** Solo en `detail: "summary"`: títulos de hasta 3 tests fallidos. */
  failedTests?: string[];
}

export interface CoverageReport {
  projectId: string;
  generatedAt: string;
  summary: {
    totalRules: number;
    coveredRules: number;
    passingRules: number;
    failingRules: number;
    uncoveredRules: number;
    coveragePercentage: number;
  };
  warnings: string[];
  rules: RuleCoverageItem[];
  features: Array<{
    name: string;
    tests: number;
    passed: number;
    failed: number;
    ruleIds: string[];
  }>;
}
