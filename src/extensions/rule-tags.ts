import type { TestInfo } from "@playwright/test";
import { RULE_ANNOTATION_TYPE, RULE_TAG_PREFIX } from "../constants.js";

export function ruleIdsFromTags(tags: readonly string[]): string[] {
  return [...new Set(
    tags
      .filter((tag) => tag.toLowerCase().startsWith(RULE_TAG_PREFIX))
      .map((tag) => tag.slice(RULE_TAG_PREFIX.length).trim())
      .filter(Boolean),
  )];
}

export function annotateRuleTags(testInfo: TestInfo): string[] {
  const ruleIds = ruleIdsFromTags(testInfo.tags);
  const annotated = new Set(
    testInfo.annotations
      .filter((annotation) => annotation.type === RULE_ANNOTATION_TYPE)
      .map((annotation) => annotation.description)
      .filter((value): value is string => Boolean(value)),
  );
  for (const ruleId of ruleIds) {
    if (!annotated.has(ruleId)) {
      testInfo.annotations.push({ type: RULE_ANNOTATION_TYPE, description: ruleId });
    }
  }
  return ruleIds;
}
