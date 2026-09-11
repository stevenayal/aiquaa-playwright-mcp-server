import { z } from "zod";

/**
 * Output schemas por tool. El SDK valida `structuredContent` contra ellos y los
 * publica en cada `tools/list`, así que cada byte se paga una vez por sesión:
 * se declaran las claves que un cliente necesita para navegar el resultado y se
 * usa `.passthrough()` en los objetos anidados en vez de repetir su forma completa.
 */

const loose = <T extends z.ZodRawShape>(shape: T) => z.object(shape).passthrough();

const FileOutputSchema = loose({
  path: z.string(),
  language: z.string(),
  // Ausente cuando el contenido ya viaja en el markdown de la respuesta.
  content: z.string().optional(),
  bytes: z.number(),
});

export const GenerateBddOutputSchema = z.object({
  requirementSummary: z.string(),
  suggestedRuleIds: z.array(z.string()),
  files: z.array(FileOutputSchema),
  warnings: z.array(z.string()),
});

export const GeneratePlaywrightOutputSchema = z.object({
  featureName: z.string(),
  scenarioCount: z.number(),
  stepCount: z.number(),
  selectorProvenance: z.array(loose({ step: z.string(), confidence: z.string() })),
  files: z.array(FileOutputSchema),
  omittedFiles: z.array(z.string()),
  instructions: z.array(z.string()),
  warnings: z.array(z.string()),
});

export const ListBusinessRulesOutputSchema = z.object({
  items: z.array(loose({ id: z.string(), title: z.string() })),
  page: z.number(),
  pageSize: z.number(),
  total: z.number(),
  totalPages: z.number(),
});

export const MapScenariosOutputSchema = z.object({
  features: z.array(z.string()).optional(),
  mappings: z.array(loose({ scenario: z.string(), ruleIds: z.array(z.string()) })),
  coveredRuleIds: z.array(z.string()),
  uncoveredRuleIds: z.array(z.string()),
});

export const CoverageReportOutputSchema = z.object({
  projectId: z.string(),
  generatedAt: z.string(),
  summary: loose({ totalRules: z.number(), coveredRules: z.number(), coveragePercentage: z.number() }),
  rules: z.array(loose({ status: z.string(), testCount: z.number() })),
  features: z.array(loose({ name: z.string(), tests: z.number() })),
});

export const CodeContextOutputSchema = z.object({
  provider: z.string(),
  projectPath: z.string(),
  task: z.string(),
  context: z.string().optional(),
  truncated: z.boolean(),
});

export const SearchMemoryOutputSchema = z.object({
  provider: z.string(),
  project: z.string(),
  query: z.string(),
  memories: z.string().optional(),
  truncated: z.boolean(),
});

export const SaveMemoryOutputSchema = z.object({
  provider: z.string(),
  project: z.string(),
  topicKey: z.string(),
  status: z.string(),
});
