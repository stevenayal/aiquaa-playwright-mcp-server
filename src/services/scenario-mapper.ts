import type { ScenarioRuleMapping } from "../types.js";
import { addRuleTagsToFeature, extractRuleIds, parseFeature } from "./gherkin.js";

export interface ScenarioMappingResult {
  features: string[];
  mappings: ScenarioRuleMapping[];
  coveredRuleIds: string[];
  uncoveredRuleIds: string[];
}

export function mapScenariosToRules(
  featureContents: string[],
  ruleIds: string[],
  explicitAssignments: Array<{ scenario: string; rule_ids: string[] }>,
): ScenarioMappingResult {
  const assignmentMap = new Map(explicitAssignments.map((item) => [item.scenario, item.rule_ids]));
  const coveredBefore = new Set<string>();
  const parsedFeatures = featureContents.map((content) => {
    const parsed = parseFeature(content);
    for (const scenario of parsed.scenarios) {
      for (const ruleId of extractRuleIds(scenario.tags)) coveredBefore.add(ruleId);
    }
    return { content, parsed };
  });
  const explicitlyCovered = new Set(explicitAssignments.flatMap((item) => item.rule_ids));
  const unassigned = ruleIds.filter((ruleId) => !coveredBefore.has(ruleId) && !explicitlyCovered.has(ruleId));
  let cursor = 0;
  const mappings: ScenarioRuleMapping[] = [];
  const updatedFeatures = parsedFeatures.map(({ content, parsed }) => {
    const perFeature = new Map<string, readonly string[]>();
    for (const scenario of parsed.scenarios) {
      const existing = extractRuleIds(scenario.tags);
      const explicit = assignmentMap.get(scenario.name);
      const nextRuleId = !explicit ? unassigned[cursor] : undefined;
      const automatic = nextRuleId ? [nextRuleId] : [];
      if (!explicit && automatic.length > 0) cursor += 1;
      const assigned = unique([...existing, ...(explicit ?? automatic)]).filter((id) => ruleIds.includes(id));
      if (assigned.length > 0) perFeature.set(scenario.name, assigned);
      mappings.push({ feature: parsed.name, scenario: scenario.name, ruleIds: assigned });
    }
    return addRuleTagsToFeature(content, perFeature);
  });
  const coveredRuleIds = unique(mappings.flatMap((mapping) => mapping.ruleIds));
  return {
    features: updatedFeatures,
    mappings,
    coveredRuleIds,
    uncoveredRuleIds: ruleIds.filter((ruleId) => !coveredRuleIds.includes(ruleId)),
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
