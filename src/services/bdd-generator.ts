import type { BusinessRule, GeneratedFile } from "../types.js";

export interface BddGenerationResult {
  requirementSummary: string;
  suggestedRuleIds: string[];
  files: GeneratedFile[];
  warnings: string[];
}

export function generateBdd(
  requirementText: string,
  projectId: string,
  language: "es" | "en",
  rules: BusinessRule[],
): BddGenerationResult {
  const clean = requirementText.replace(/\s+/g, " ").trim();
  const sentences = clean
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.replace(/[.!?]+$/, "").trim())
    .filter((sentence) => sentence.length >= 8);
  const summary = (sentences[0] ?? clean).slice(0, 180);
  const suggestedRules = rankRules(clean, rules).slice(0, 3);
  const tags = suggestedRules.map((rule) => `@rule:${rule.id}`).join(" ");
  const title = makeTitle(summary);
  const fileName = `${slugify(title) || "generated-requirement"}.feature`;
  const feature = language === "es"
    ? spanishFeature(title, summary, sentences, tags, projectId)
    : englishFeature(title, summary, sentences, tags, projectId);

  const warnings: string[] = [];
  if (rules.length === 0) {
    warnings.push(
      "No se consultaron o no existen reglas de negocio; usá aiquaa_map_scenarios_to_rules cuando tengas los IDs.",
    );
  } else if (suggestedRules.length === 0) {
    warnings.push("No hubo coincidencias suficientemente claras con reglas existentes; revisá el mapeo manualmente.");
  } else {
    warnings.push("Las reglas sugeridas se basan en similitud léxica y requieren validación humana.");
  }

  return {
    requirementSummary: summary,
    suggestedRuleIds: suggestedRules.map((rule) => rule.id),
    files: [{ path: `features/${fileName}`, language: "gherkin", content: feature }],
    warnings,
  };
}

function spanishFeature(
  title: string,
  summary: string,
  sentences: string[],
  tags: string,
  projectId: string,
): string {
  const outcome = sentences[1] ?? "la operación se completa según el requerimiento";
  return [
    "# language: es",
    `# Proyecto AIQUAA: ${projectId}`,
    `Característica: ${title}`,
    `  Como usuario autorizado`,
    `  Quiero ${lowerFirst(summary)}`,
    `  Para obtener el resultado de negocio esperado`,
    "",
    ...(tags ? [`  ${tags}`] : []),
    "  Escenario: Flujo exitoso",
    "    Dado que el usuario cumple las precondiciones del requerimiento",
    `    Cuando solicita ${lowerFirst(summary)}`,
    `    Entonces ${lowerFirst(outcome)}`,
    "",
    ...(tags ? [`  ${tags}`] : []),
    "  Escenario: Validación de datos obligatorios",
    "    Dado que el usuario inicia la operación",
    "    Cuando omite un dato obligatorio",
    "    Entonces el sistema rechaza la operación con un mensaje accionable",
    "    Y no persiste cambios parciales",
    "",
    ...(tags ? [`  ${tags}`] : []),
    "  Escenario: Manejo seguro de un error",
    "    Dado que ocurre un error al procesar la operación",
    "    Cuando el sistema informa el resultado",
    "    Entonces no expone información sensible",
    "    Y permite al usuario volver a intentar de forma segura",
    "",
  ].join("\n");
}

function englishFeature(
  title: string,
  summary: string,
  sentences: string[],
  tags: string,
  projectId: string,
): string {
  const outcome = sentences[1] ?? "the operation completes according to the requirement";
  return [
    `# AIQUAA project: ${projectId}`,
    `Feature: ${title}`,
    "  As an authorized user",
    `  I want ${lowerFirst(summary)}`,
    "  So that I get the expected business outcome",
    "",
    ...(tags ? [`  ${tags}`] : []),
    "  Scenario: Successful flow",
    "    Given the user meets the requirement preconditions",
    `    When the user requests ${lowerFirst(summary)}`,
    `    Then ${lowerFirst(outcome)}`,
    "",
    ...(tags ? [`  ${tags}`] : []),
    "  Scenario: Required data validation",
    "    Given the user starts the operation",
    "    When the user omits required data",
    "    Then the system rejects the operation with an actionable message",
    "    And no partial changes are persisted",
    "",
    ...(tags ? [`  ${tags}`] : []),
    "  Scenario: Safe error handling",
    "    Given an error occurs while processing the operation",
    "    When the system reports the outcome",
    "    Then it does not expose sensitive information",
    "    And the user can retry safely",
    "",
  ].join("\n");
}

function rankRules(text: string, rules: BusinessRule[]): BusinessRule[] {
  const words = tokens(text);
  return rules
    .map((rule) => ({
      rule,
      score: [...tokens(`${rule.id} ${rule.title} ${rule.description}`)].filter((word) => words.has(word)).length,
    }))
    .filter((item) => item.score >= 2)
    .sort((a, b) => b.score - a.score || a.rule.id.localeCompare(b.rule.id))
    .map((item) => item.rule);
}

function tokens(text: string): Set<string> {
  const ignored = new Set(["para", "como", "cuando", "donde", "desde", "with", "that", "this", "from", "the"]);
  return new Set(
    text
      .toLocaleLowerCase()
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length >= 4 && !ignored.has(word)),
  );
}

function makeTitle(summary: string): string {
  return summary.replace(/^(como|as)\s+[^,]+,?\s*(quiero|i want)\s+/i, "").slice(0, 90);
}

function slugify(value: string): string {
  return value
    .toLocaleLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

function lowerFirst(value: string): string {
  return value ? `${value[0]?.toLocaleLowerCase()}${value.slice(1)}` : value;
}
