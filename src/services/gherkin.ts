import { RULE_TAG_PREFIX } from "../constants.js";

export interface ParsedStep {
  keyword: "Given" | "When" | "Then" | "And" | "But";
  text: string;
}

export interface ParsedScenario {
  name: string;
  lineIndex: number;
  tags: string[];
  steps: ParsedStep[];
}

export interface ParsedFeature {
  name: string;
  scenarios: ParsedScenario[];
}

const FEATURE_PATTERN = /^\s*(?:Feature|Característica|Caracteristica):\s*(.+)$/i;
const SCENARIO_PATTERN = /^\s*(?:Scenario(?: Outline)?|Escenario(?: esquema)?):\s*(.+)$/i;
const STEP_PATTERN = /^\s*(Given|When|Then|And|But|Dado|Dada|Dados|Dadas|Cuando|Entonces|Y|Pero)\s+(.+)$/i;

export function parseFeature(content: string): ParsedFeature {
  const lines = content.split(/\r?\n/);
  let featureName = "Feature";
  let pendingTags: string[] = [];
  const scenarios: ParsedScenario[] = [];

  lines.forEach((line, lineIndex) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("@")) {
      pendingTags.push(...trimmed.split(/\s+/).filter((token) => token.startsWith("@")));
      return;
    }
    const featureMatch = line.match(FEATURE_PATTERN);
    if (featureMatch?.[1]) {
      featureName = featureMatch[1].trim();
      pendingTags = [];
      return;
    }
    const scenarioMatch = line.match(SCENARIO_PATTERN);
    if (scenarioMatch?.[1]) {
      scenarios.push({
        name: scenarioMatch[1].trim(),
        lineIndex,
        tags: [...pendingTags],
        steps: [],
      });
      pendingTags = [];
      return;
    }
    const stepMatch = line.match(STEP_PATTERN);
    const current = scenarios.at(-1);
    if (stepMatch?.[1] && stepMatch[2] && current) {
      current.steps.push({ keyword: normalizeKeyword(stepMatch[1]), text: stepMatch[2].trim() });
    }
    if (trimmed && !trimmed.startsWith("#")) pendingTags = [];
  });

  if (scenarios.length === 0) {
    throw new Error("El contenido no tiene ningún 'Scenario:' o 'Escenario:' reconocible.");
  }
  return { name: featureName, scenarios };
}

export function extractRuleIds(tags: string[]): string[] {
  return unique(
    tags
      .filter((tag) => tag.toLowerCase().startsWith(RULE_TAG_PREFIX))
      .map((tag) => tag.slice(RULE_TAG_PREFIX.length))
      .filter(Boolean),
  );
}

export function addRuleTagsToFeature(
  content: string,
  assignments: ReadonlyMap<string, readonly string[]>,
): string {
  const parsed = parseFeature(content);
  const lines = content.split(/\r?\n/);
  const insertions = parsed.scenarios
    .map((scenario) => {
      const existing = new Set(extractRuleIds(scenario.tags));
      const desired = assignments.get(scenario.name) ?? [];
      const missing = desired.filter((ruleId) => !existing.has(ruleId));
      return { lineIndex: scenario.lineIndex, missing };
    })
    .filter((item) => item.missing.length > 0)
    .sort((a, b) => b.lineIndex - a.lineIndex);

  for (const insertion of insertions) {
    const scenarioLine = lines[insertion.lineIndex] ?? "";
    const indentation = scenarioLine.match(/^\s*/)?.[0] ?? "";
    lines.splice(
      insertion.lineIndex,
      0,
      `${indentation}${insertion.missing.map((id) => `${RULE_TAG_PREFIX}${id}`).join(" ")}`,
    );
  }
  return lines.join("\n");
}

function normalizeKeyword(keyword: string): ParsedStep["keyword"] {
  const normalized = keyword.toLowerCase();
  if (["given", "dado", "dada", "dados", "dadas"].includes(normalized)) return "Given";
  if (["when", "cuando"].includes(normalized)) return "When";
  if (["then", "entonces"].includes(normalized)) return "Then";
  if (["but", "pero"].includes(normalized)) return "But";
  return "And";
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
