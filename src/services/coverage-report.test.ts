import test from "node:test";
import assert from "node:assert/strict";
import { buildCoverageReport, parsePlaywrightResults } from "./coverage-report.js";

test("cruza anotaciones Playwright con reglas de negocio", () => {
  const tests = parsePlaywrightResults({
    suites: [{
      title: "Login",
      specs: [{
        title: "permite iniciar sesión",
        tests: [{
          annotations: [{ type: "business-rule", description: "RN-001" }],
          results: [{ status: "passed" }],
        }],
      }],
    }],
  });
  const report = buildCoverageReport(
    "project-1",
    [
      { id: "RN-001", title: "Login", description: "" },
      { id: "RN-002", title: "Bloqueo", description: "" },
    ],
    tests,
  );
  assert.equal(report.summary.coveragePercentage, 50);
  assert.equal(report.summary.passingRules, 1);
  assert.equal(report.summary.uncoveredRules, 1);
});
