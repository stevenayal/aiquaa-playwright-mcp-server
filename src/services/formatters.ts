import type { PaginatedBusinessRules } from "../types.js";
import type { BddGenerationResult } from "./bdd-generator.js";
import type { PlaywrightGenerationResult } from "./playwright-generator.js";
import type { ScenarioMappingResult } from "./scenario-mapper.js";

export function bddToMarkdown(result: BddGenerationResult): string {
  return [
    "# Escenarios BDD generados",
    "",
    `Reglas sugeridas: ${result.suggestedRuleIds.join(", ") || "ninguna"}`,
    "",
    ...result.files.flatMap((file) => [
      `## ${file.path}`,
      "",
      "```gherkin",
      file.content,
      "```",
      "",
    ]),
    ...result.warnings.map((warning) => `> ${warning}`),
  ].join("\n");
}

export function playwrightToMarkdown(result: PlaywrightGenerationResult): string {
  return [
    `# Playwright BDD — ${result.featureName}`,
    "",
    `${result.scenarioCount} escenarios y ${result.stepCount} definiciones de step.`,
    "",
    ...result.files.flatMap((file) => [
      `## ${file.path}`,
      "",
      `\`\`\`${file.language}`,
      file.content,
      "```",
      "",
    ]),
    "## Uso",
    "",
    ...result.instructions.map((instruction, index) => `${index + 1}. ${instruction}`),
  ].join("\n");
}

export function rulesToMarkdown(result: PaginatedBusinessRules): string {
  return [
    `# Reglas de negocio — página ${result.page}/${result.totalPages}`,
    "",
    `Total: ${result.total}`,
    "",
    "| ID | Título | Estado | Prioridad |",
    "|---|---|---|---|",
    ...result.items.map((rule) =>
      `| ${cell(rule.id)} | ${cell(rule.title)} | ${cell(rule.status ?? "—")} | ${cell(rule.priority ?? "—")} |`,
    ),
  ].join("\n");
}

export function mappingToMarkdown(result: ScenarioMappingResult): string {
  return [
    "# Escenarios mapeados a reglas",
    "",
    "| Feature | Escenario | Reglas |",
    "|---|---|---|",
    ...result.mappings.map((mapping) =>
      `| ${cell(mapping.feature)} | ${cell(mapping.scenario)} | ${mapping.ruleIds.join(", ") || "—"} |`,
    ),
    "",
    `Reglas sin cobertura: ${result.uncoveredRuleIds.join(", ") || "ninguna"}`,
    "",
    ...result.features.flatMap((feature, index) => [
      `## feature-${index + 1}.feature`,
      "",
      "```gherkin",
      feature,
      "```",
      "",
    ]),
  ].join("\n");
}

function cell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}
