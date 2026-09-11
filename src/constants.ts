import { createRequire } from "node:module";

const packageJson = createRequire(import.meta.url)("../package.json") as { name: string; version: string };

// Leído del package.json para que no exista una segunda fuente de verdad que
// pueda quedar desincronizada con la versión publicada.
export const SERVER_NAME = packageJson.name;
export const SERVER_VERSION = packageJson.version;
export const DEFAULT_PORT = 3000;
// Bind local por defecto: el endpoint MCP no tiene autenticación propia.
export const DEFAULT_HOST = "127.0.0.1";
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
