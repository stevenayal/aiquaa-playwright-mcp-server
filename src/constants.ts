export const SERVER_NAME = "aiquaa-playwright-mcp-server";
export const SERVER_VERSION = "0.2.0";
export const DEFAULT_PORT = 3000;
export const DEFAULT_MCP_PATH = "/mcp";
export const RULE_TAG_PREFIX = "@rule:";
export const RULE_ANNOTATION_TYPE = "business-rule";

export const AIQUAA_ENDPOINTS = {
  businessRules: (projectId: string) =>
    `/projects/${encodeURIComponent(projectId)}/business-rules`,
  requirement: (projectId: string, requirementId: string) =>
    `/projects/${encodeURIComponent(projectId)}/requirements/${encodeURIComponent(requirementId)}`,
  feature: (featureId: string) => `/features/${encodeURIComponent(featureId)}`,
} as const;
