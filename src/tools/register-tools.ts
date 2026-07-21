import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  GenerateBddInputObjectSchema,
  GenerateBddInputSchema,
  GenerateCoverageReportInputSchema,
  GetCodeContextInputSchema,
  GeneratePlaywrightInputObjectSchema,
  GeneratePlaywrightInputSchema,
  ListBusinessRulesInputSchema,
  MapScenariosInputSchema,
  SaveProjectMemoryInputSchema,
  SearchProjectMemoryInputSchema,
} from "../schemas/tools.js";
import type { BusinessRule, ResponseFormat } from "../types.js";
import { AiquaaClient } from "../services/aiquaa-client.js";
import { generateBdd } from "../services/bdd-generator.js";
import {
  buildCoverageReport,
  coverageReportToMarkdown,
  parsePlaywrightResults,
} from "../services/coverage-report.js";
import {
  bddToMarkdown,
  mappingToMarkdown,
  playwrightToMarkdown,
  rulesToMarkdown,
} from "../services/formatters.js";
import { validateExtractedPdfText } from "../services/pdf-text-validator.js";
import { generatePlaywrightArtifacts } from "../services/playwright-generator.js";
import { mapScenariosToRules } from "../services/scenario-mapper.js";
import { CodeGraphClient } from "../services/codegraph-client.js";
import { EngramClient } from "../services/engram-client.js";

export interface ToolContext {
  accessToken?: string;
}

const generatedToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const remoteReadAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

const localReadAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const persistentWriteAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export function registerTools(server: McpServer, context: ToolContext): void {
  server.registerTool(
    "qa_bdd",
    {
      title: "Generar escenarios BDD de AIQUAA",
      description:
        "Genera uno o más .feature Gherkin desde texto o un requerimiento AIQUAA. No hace OCR ni ejecuta tests.",
      inputSchema: GenerateBddInputObjectSchema.shape,
      annotations: remoteReadAnnotations,
    },
    async (rawInput) => safeToolCall(async () => {
      const input = GenerateBddInputSchema.parse(rawInput);
      let requirementText = input.requirement_text;
      let rules: BusinessRule[] = [];
      const warnings: string[] = [];
      if (input.requirement_id) {
        const client = createClient(context);
        requirementText = await client.getRequirementText(input.project_id, input.requirement_id);
      }
      if (!requirementText) throw new Error("No se pudo resolver el texto del requerimiento.");
      if (input.requirement_source === "extracted_from_pdf") {
        const validation = validateExtractedPdfText(requirementText);
        if (!validation.valid) {
          throw new Error(
            `El texto extraído del PDF parece incompleto o mal formado (posible error de OCR: ${validation.reasons.join(
              ", ",
            )}). Verificá la extracción antes de continuar — no se generaron escenarios.`,
          );
        }
      }
      if (hasRemoteConfiguration(context)) {
        try {
          rules = await createClient(context).getAllBusinessRules(input.project_id);
        } catch (error: unknown) {
          warnings.push(
            `No fue posible sugerir reglas desde AIQUAA: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      const result = generateBdd(requirementText, input.project_id, input.language, rules);
      result.warnings.push(...warnings);
      return successResult(input.response_format, result, bddToMarkdown(result));
    }),
  );

  server.registerTool(
    "qa_pruebas",
    {
      title: "Generar tests Playwright BDD",
      description:
        "Genera definiciones de steps, hook de reglas, reporter y configuración compatibles con playwright-bdd. No ejecuta tests.",
      inputSchema: GeneratePlaywrightInputObjectSchema.shape,
      annotations: remoteReadAnnotations,
    },
    async (rawInput) => safeToolCall(async () => {
      const input = GeneratePlaywrightInputSchema.parse(rawInput);
      const featureContent = input.feature_content ?? await createClient(context).getFeatureContent(input.feature_id ?? "");
      const result = generatePlaywrightArtifacts(featureContent, {
        ...(input.base_url ? { baseUrl: input.base_url } : {}),
        ...(input.app_context ? { appContext: input.app_context } : {}),
        selectorSource: input.selector_source,
        browsers: input.browsers,
        ciTargets: input.ci_targets,
        ...(input.auth
          ? {
              auth: {
                loginPath: input.auth.login_path,
                usernameLabel: input.auth.username_label,
                passwordLabel: input.auth.password_label,
                submitName: input.auth.submit_name,
                successUrlPattern: input.auth.success_url_pattern,
                usernameEnv: input.auth.username_env,
                passwordEnv: input.auth.password_env,
              },
            }
          : {}),
        ...(input.external_validation
          ? {
              externalValidation: {
                type: input.external_validation.type,
                apiUrlEnv: input.external_validation.api_url_env,
                apiTokenEnv: input.external_validation.api_token_env,
                responseField: input.external_validation.response_field,
                timeoutMs: input.external_validation.timeout_ms,
                pollIntervalMs: input.external_validation.poll_interval_ms,
              },
            }
          : {}),
      });
      return successResult(input.response_format, result, playwrightToMarkdown(result));
    }),
  );

  server.registerTool(
    "qa_reglas",
    {
      title: "Listar reglas de negocio de AIQUAA",
      description: "Lista reglas paginadas de un proyecto AIQUAA con filtros opcionales.",
      inputSchema: ListBusinessRulesInputSchema.shape,
      annotations: remoteReadAnnotations,
    },
    async (rawInput) => safeToolCall(async () => {
      const input = ListBusinessRulesInputSchema.parse(rawInput);
      const result = await createClient(context).listBusinessRules(input.project_id, {
        page: input.page,
        pageSize: input.page_size,
        ...(input.query ? { query: input.query } : {}),
        ...(input.status ? { status: input.status } : {}),
        ...(input.priority ? { priority: input.priority } : {}),
      });
      return successResult(input.response_format, result, rulesToMarkdown(result));
    }),
  );

  server.registerTool(
    "qa_mapear",
    {
      title: "Mapear escenarios a reglas",
      description:
        "Aplica tags @rule:<ID> a escenarios Gherkin y devuelve las reglas que permanecen sin cobertura.",
      inputSchema: MapScenariosInputSchema.shape,
      annotations: generatedToolAnnotations,
    },
    async (rawInput) => safeToolCall(async () => {
      const input = MapScenariosInputSchema.parse(rawInput);
      const result = mapScenariosToRules(input.feature_contents, input.rule_ids, input.assignments);
      return successResult(input.response_format, result, mappingToMarkdown(result));
    }),
  );

  server.registerTool(
    "qa_cobertura",
    {
      title: "Generar reporte de cobertura de reglas",
      description:
        "Cruza resultados JSON de Playwright con reglas AIQUAA y reporta cobertura, fallas y reglas sin tests.",
      inputSchema: GenerateCoverageReportInputSchema.shape,
      annotations: remoteReadAnnotations,
    },
    async (rawInput) => safeToolCall(async () => {
      const input = GenerateCoverageReportInputSchema.parse(rawInput);
      const rules: BusinessRule[] = input.business_rules
        ? input.business_rules.map((rule) => ({
            id: rule.id,
            title: rule.title,
            description: rule.description,
            ...(rule.status ? { status: rule.status } : {}),
            ...(rule.priority ? { priority: rule.priority } : {}),
          }))
        : await createClient(context).getAllBusinessRules(input.project_id);
      const tests = parsePlaywrightResults(input.playwright_results);
      const result = buildCoverageReport(input.project_id, rules, tests);
      return successResult(input.response_format, result, coverageReportToMarkdown(result));
    }),
  );

  server.registerTool(
    "qa_contexto",
    {
      title: "Obtener contexto de código con CodeGraph",
      description:
        "Construye contexto estructural enfocado desde un repositorio local indexado por CodeGraph. Requiere CODEGRAPH_ALLOWED_ROOTS y codegraph init previo.",
      inputSchema: GetCodeContextInputSchema.shape,
      annotations: localReadAnnotations,
    },
    async (rawInput) => safeToolCall(async () => {
      const input = GetCodeContextInputSchema.parse(rawInput);
      const result = await new CodeGraphClient().buildContext({
        projectPath: input.project_path,
        task: input.task,
        maxNodes: input.max_nodes,
        maxCodeBlocks: input.max_code_blocks,
        includeCode: input.include_code,
      });
      const markdown = ["# Contexto estructural (CodeGraph)", "", result.context].join("\n");
      return successResult(input.response_format, result, markdown);
    }),
  );

  server.registerTool(
    "qa_memoria",
    {
      title: "Buscar memoria persistente del proyecto",
      description:
        "Recupera decisiones, patrones y aprendizajes persistidos en Engram, siempre limitados al project_id indicado.",
      inputSchema: SearchProjectMemoryInputSchema.shape,
      annotations: localReadAnnotations,
    },
    async (rawInput) => safeToolCall(async () => {
      const input = SearchProjectMemoryInputSchema.parse(rawInput);
      const result = await new EngramClient().search(input.project_id, input.query, input.limit);
      const markdown = ["# Memoria del proyecto (Engram)", "", result.memories].join("\n");
      return successResult(input.response_format, result, markdown);
    }),
  );

  server.registerTool(
    "qa_recordar",
    {
      title: "Guardar memoria persistente del proyecto",
      description:
        "Guarda o revisa una memoria curada en Engram. topic_key hace idempotentes los reintentos y scope queda fijado a project.",
      inputSchema: SaveProjectMemoryInputSchema.shape,
      annotations: persistentWriteAnnotations,
    },
    async (rawInput) => safeToolCall(async () => {
      const input = SaveProjectMemoryInputSchema.parse(rawInput);
      const result = await new EngramClient().save({
        projectId: input.project_id,
        title: input.title,
        content: input.content,
        type: input.type,
        topicKey: input.topic_key,
      });
      const markdown = ["# Memoria guardada (Engram)", "", result.status].join("\n");
      return successResult(input.response_format, result, markdown);
    }),
  );
}

async function safeToolCall(action: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await action();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      isError: true,
      content: [{ type: "text", text: `No se pudo completar la operación: ${message}` }],
    };
  }
}

function successResult(format: ResponseFormat, value: unknown, markdown: string): CallToolResult {
  const structuredContent = toRecord(value);
  return {
    content: [{
      type: "text",
      text: format === "json" ? JSON.stringify(value, null, 2) : markdown,
    }],
    structuredContent,
  };
}

function createClient(context: ToolContext): AiquaaClient {
  return new AiquaaClient({
    ...(context.accessToken ? { accessToken: context.accessToken } : {}),
  });
}

function hasRemoteConfiguration(context: ToolContext): boolean {
  return Boolean(process.env.AIQUAA_API_BASE_URL && (context.accessToken || process.env.AIQUAA_ACCESS_TOKEN));
}

function toRecord(value: unknown): Record<string, unknown> {
  const normalized = JSON.parse(JSON.stringify(value)) as unknown;
  return typeof normalized === "object" && normalized !== null && !Array.isArray(normalized)
    ? normalized as Record<string, unknown>
    : { value: normalized };
}
