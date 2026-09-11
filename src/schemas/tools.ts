import { z } from "zod";

const ResponseFormatSchema = z
  .enum(["summary", "markdown", "json"])
  .default("summary")
  .describe("summary y json dejan el detalle en structuredContent; markdown lo inlinea en el texto.");

const RuleIdSchema = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "ID de regla inválido")
  .describe("ID de regla sin el prefijo @rule:, por ejemplo RN-014.");

export const GenerateBddInputObjectSchema = z.object({
    requirement_text: z
      .string()
      .min(20)
      .optional()
      .describe("Texto plano del requerimiento. Para PDFs, extraé el texto antes con un MCP de OCR."),
    requirement_id: z
      .string()
      .min(1)
      .optional()
      .describe("ID de un requerimiento existente en AIQUAA."),
    requirement_source: z
      .enum(["typed", "extracted_from_pdf"])
      .default("typed")
      .describe("Origen del texto; extracted_from_pdf activa los guardrails de OCR."),
    project_id: z.string().min(1).describe("ID del proyecto AIQUAA."),
    language: z.enum(["es", "en"]).default("es").describe("Idioma de los escenarios Gherkin."),
    response_format: ResponseFormatSchema,
  }).strict();

export const GenerateBddInputSchema = GenerateBddInputObjectSchema
  .superRefine((value, context) => {
    const provided = Number(Boolean(value.requirement_text)) + Number(Boolean(value.requirement_id));
    if (provided !== 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Proporcioná exactamente uno de requirement_text o requirement_id.",
        path: ["requirement_text"],
      });
    }
    if (value.requirement_source === "extracted_from_pdf" && !value.requirement_text) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "requirement_source='extracted_from_pdf' requiere requirement_text.",
        path: ["requirement_source"],
      });
    }
  });

const PlaywrightAuthSchema = z
  .object({
    mode: z
      .enum(["password", "passwordless", "otp"])
      .default("password")
      .describe("passwordless omite el campo de contraseña; otp agrega un paso de código."),
    login_path: z.string().min(1).default("/login").describe("Ruta relativa de login."),
    username_label: z.string().min(1).default("Email").describe("Label accesible del usuario/email."),
    password_label: z
      .string()
      .min(1)
      .default("Contraseña")
      .describe("Label accesible de la contraseña; se ignora si mode no es password."),
    submit_name: z.string().min(1).default("Iniciar sesión").describe("Nombre accesible del botón de login."),
    success_url_pattern: z
      .string()
      .min(1)
      .default("dashboard|home|inicio")
      .describe("RegExp de la URL posterior al login. Si la app vuelve a la raíz, usá ^/$."),
    username_env: z.string().min(1).default("TEST_USER").describe("Variable de entorno del usuario."),
    password_env: z.string().min(1).default("TEST_PASSWORD").describe("Variable de entorno de la contraseña."),
    otp_env: z.string().min(1).optional().describe("Variable de entorno del código OTP de pruebas."),
  })
  .strict();

const ExternalValidationSchema = z
  .object({
    type: z.enum(["sms", "email", "push", "db_state", "other"]).describe("Tipo de validación externa."),
    api_url_env: z.string().min(1).default("NOTIFICATION_API_URL").describe("Env var con la URL de consulta."),
    api_token_env: z.string().min(1).default("NOTIFICATION_API_TOKEN").describe("Env var con el Bearer token."),
    response_field: z.string().min(1).describe("Campo en dot notation a extraer, por ejemplo data.code."),
    timeout_ms: z.number().int().min(1_000).max(120_000).default(15_000),
    poll_interval_ms: z.number().int().min(250).max(10_000).default(2_000),
  })
  .strict();

const DomContextSchema = z
  .object({
    test_ids: z.array(z.string().min(1)).max(200).optional().describe("data-testid confirmados en la app."),
    roles: z
      .array(z.object({ role: z.string().min(1), name: z.string().min(1) }).strict())
      .max(200)
      .optional()
      .describe("Pares rol/nombre accesible verificados."),
    labels: z.array(z.string().min(1)).max(200).optional().describe("Labels de formulario verificados."),
  })
  .strict();

export const GeneratedFileKindSchema = z.enum([
  "steps",
  "hooks",
  "reporter",
  "config",
  "auth",
  "notification",
  "github_actions",
  "azure_pipelines",
]);

export const GeneratePlaywrightInputObjectSchema = z.object({
    feature_content: z.string().min(20).optional().describe("Contenido Gherkin completo de un .feature."),
    feature_id: z.string().min(1).optional().describe("ID de un feature guardado en AIQUAA."),
    base_url: z.string().url().optional().describe("URL base de la aplicación."),
    app_context: z.string().max(10_000).optional().describe("Contexto libre: rutas, roles, labels y test IDs."),
    dom_context: DomContextSchema
      .optional()
      .describe("Selectores verificados. Obligatorio cuando selector_source es provided_*."),
    selector_source: z
      .enum(["provided_dom", "provided_component", "provided_test_ids", "estimated"])
      .default("estimated")
      .describe("Origen verificable de los selectores. Los provided_* exigen dom_context."),
    auth: PlaywrightAuthSchema.optional().describe("Genera auth.setup.ts sin credenciales hardcodeadas."),
    external_validation: ExternalValidationSchema
      .optional()
      .describe("Genera un helper de polling para OTP, email, push o estado de negocio."),
    browsers: z.array(z.enum(["chromium", "firefox", "webkit"])).min(1).default(["chromium"]),
    ci_targets: z
      .array(z.enum(["github_actions", "azure_pipelines"]))
      .min(1)
      .default(["github_actions", "azure_pipelines"]),
    include_files: z
      .array(GeneratedFileKindSchema)
      .min(1)
      .optional()
      .describe("Devuelve solo estos artefactos. Sin este campo se devuelven todos."),
    max_file_bytes: z
      .number()
      .int()
      .min(500)
      .max(200_000)
      .default(20_000)
      .describe("Trunca cada archivo generado que supere este tamaño."),
    shards: z.number().int().min(1).max(20).default(1).describe("Shards de Playwright en los pipelines generados."),
    response_format: ResponseFormatSchema,
  }).strict();

export const GeneratePlaywrightInputSchema = GeneratePlaywrightInputObjectSchema
  .superRefine((value, context) => {
    const provided = Number(Boolean(value.feature_content)) + Number(Boolean(value.feature_id));
    if (provided !== 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Proporcioná exactamente uno de feature_content o feature_id.",
        path: ["feature_content"],
      });
    }
    if (value.selector_source !== "estimated" && !hasDomContext(value.dom_context)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "selector_source declara selectores verificados: pasá dom_context con test_ids, roles o labels reales, o usá selector_source='estimated'.",
        path: ["dom_context"],
      });
    }
  });

function hasDomContext(value: z.infer<typeof DomContextSchema> | undefined): boolean {
  if (!value) return false;
  return Boolean(value.test_ids?.length || value.roles?.length || value.labels?.length);
}

export const ListBusinessRulesInputSchema = z
  .object({
    project_id: z.string().min(1).describe("ID del proyecto AIQUAA."),
    query: z.string().max(200).optional().describe("Filtra por ID, título o descripción."),
    status: z.string().max(50).optional().describe("Estado de regla a filtrar."),
    priority: z.string().max(50).optional().describe("Prioridad a filtrar."),
    page: z.number().int().min(1).default(1),
    page_size: z.number().int().min(1).max(100).default(20),
    response_format: ResponseFormatSchema,
  })
  .strict();

const ScenarioRuleAssignmentSchema = z
  .object({
    scenario: z.string().min(1).describe("Nombre exacto del escenario."),
    rule_ids: z.array(RuleIdSchema).min(1),
  })
  .strict();

export const MapScenariosInputSchema = z
  .object({
    feature_contents: z.array(z.string().min(20)).min(1).describe("Uno o más archivos .feature como texto."),
    rule_ids: z.array(RuleIdSchema).min(1).describe("Universo de reglas que se desea cubrir."),
    assignments: z
      .array(ScenarioRuleAssignmentSchema)
      .default([])
      .describe("Mapeo explícito. Sin él, se distribuyen las reglas aún no etiquetadas."),
    response_format: ResponseFormatSchema,
  })
  .strict();

export const GenerateCoverageReportInputSchema = z
  .object({
    playwright_results: z
      .union([z.string().min(2), z.record(z.unknown())])
      .describe("JSON reporter de Playwright, como texto u objeto."),
    project_id: z.string().min(1).describe("ID del proyecto AIQUAA."),
    business_rules: z
      .array(
        z
          .object({
            id: RuleIdSchema,
            title: z.string().min(1),
            description: z.string().default(""),
            status: z.string().optional(),
            priority: z.string().optional(),
          })
          .strict(),
      )
      .optional()
      .describe("Snapshot de reglas; evita consultar AIQUAA y permite uso offline."),
    detail: z
      .enum(["summary", "full"])
      .default("summary")
      .describe("summary: conteos y hasta 3 tests fallidos por regla. full: todos los tests."),
    response_format: ResponseFormatSchema,
  })
  .strict();

export const GetCodeContextInputSchema = z
  .object({
    project_path: z.string().min(1).describe("Ruta absoluta del repositorio, dentro de CODEGRAPH_ALLOWED_ROOTS."),
    task: z.string().min(3).max(1_000).describe("Tarea concreta para enfocar el contexto estructural."),
    max_nodes: z.number().int().min(1).max(50).default(15),
    max_code_blocks: z.number().int().min(0).max(20).default(6),
    include_code: z.boolean().default(true),
    max_output_bytes: z.number().int().min(1_000).max(200_000).default(40_000),
    response_format: ResponseFormatSchema,
  })
  .strict();

export const SearchProjectMemoryInputSchema = z
  .object({
    project_id: z.string().min(1).describe("ID que aísla la memoria del proyecto."),
    query: z.string().min(2).max(500).describe("Decisión, patrón o problema a recuperar."),
    limit: z.number().int().min(1).max(20).default(5),
    max_output_bytes: z.number().int().min(1_000).max(200_000).default(40_000),
    response_format: ResponseFormatSchema,
  })
  .strict();

export const SaveProjectMemoryInputSchema = z
  .object({
    project_id: z.string().min(1).describe("ID que aísla la memoria del proyecto."),
    title: z.string().min(3).max(200),
    content: z
      .string()
      .min(10)
      .max(20_000)
      .describe("Memoria curada: qué ocurrió, por qué, dónde aplica y qué se aprendió."),
    type: z
      .enum(["decision", "architecture", "bugfix", "pattern", "config", "discovery", "learning"])
      .default("learning"),
    topic_key: z
      .string()
      .min(3)
      .max(200)
      .regex(/^[a-z0-9][a-z0-9._/-]*$/, "Usá una clave estable en minúsculas, por ejemplo decision/selectors.")
      .describe("Clave estable que hace idempotente el guardado."),
    response_format: ResponseFormatSchema,
  })
  .strict();

export type GeneratedFileKind = z.infer<typeof GeneratedFileKindSchema>;
export type DomContext = z.infer<typeof DomContextSchema>;
export type GenerateBddInput = z.infer<typeof GenerateBddInputSchema>;
export type GeneratePlaywrightInput = z.infer<typeof GeneratePlaywrightInputSchema>;
export type ListBusinessRulesInput = z.infer<typeof ListBusinessRulesInputSchema>;
export type MapScenariosInput = z.infer<typeof MapScenariosInputSchema>;
export type GenerateCoverageReportInput = z.infer<typeof GenerateCoverageReportInputSchema>;
