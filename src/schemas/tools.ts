import { z } from "zod";

const ResponseFormatSchema = z
  .enum(["markdown", "json"])
  .default("markdown")
  .describe("Formato de respuesta. Ejemplo: 'markdown'.");

const RuleIdSchema = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "El ID de regla contiene caracteres no permitidos")
  .describe("ID de regla sin el prefijo @rule:. Ejemplo: RN-014.");

export const GenerateBddInputObjectSchema = z.object({
    requirement_text: z
      .string()
      .min(20)
      .optional()
      .describe(
        "Texto plano del requerimiento. Si viene de un PDF, extraelo primero con un MCP de OCR/PDF y pasá el texto acá. Ejemplo: 'Como cliente quiero recuperar mi contraseña...'.",
      ),
    requirement_id: z
      .string()
      .min(1)
      .optional()
      .describe("ID de un requerimiento existente en AIQUAA. Ejemplo: REQ-102."),
    requirement_source: z
      .enum(["typed", "extracted_from_pdf"])
      .default("typed")
      .describe("Indica si el texto fue tipeado directamente o extraído vía OCR de un PDF."),
    project_id: z.string().min(1).describe("ID del proyecto AIQUAA. Ejemplo: prj_123."),
    language: z
      .enum(["es", "en"])
      .default("es")
      .describe("Idioma de los escenarios Gherkin. Ejemplo: 'es'."),
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
    login_path: z.string().min(1).default("/login").describe("Ruta relativa de login."),
    username_label: z.string().min(1).default("Email").describe("Label accesible del usuario/email."),
    password_label: z.string().min(1).default("Contraseña").describe("Label accesible de la contraseña."),
    submit_name: z.string().min(1).default("Iniciar sesión").describe("Nombre accesible del botón de login."),
    success_url_pattern: z
      .string()
      .min(1)
      .default("dashboard|home|inicio")
      .describe("Patrón RegExp de la URL posterior al login."),
    username_env: z.string().min(1).default("TEST_USER").describe("Variable de entorno para el usuario."),
    password_env: z.string().min(1).default("TEST_PASSWORD").describe("Variable de entorno para la contraseña."),
  })
  .strict();

const ExternalValidationSchema = z
  .object({
    type: z.enum(["sms", "email", "push", "db_state", "other"]).describe("Tipo de validación externa."),
    api_url_env: z
      .string()
      .min(1)
      .default("NOTIFICATION_API_URL")
      .describe("Variable de entorno que contiene la URL de consulta."),
    api_token_env: z
      .string()
      .min(1)
      .default("NOTIFICATION_API_TOKEN")
      .describe("Variable de entorno que contiene el Bearer token."),
    response_field: z
      .string()
      .min(1)
      .describe("Campo en dot notation que debe extraerse. Ejemplo: data.code."),
    timeout_ms: z.number().int().min(1_000).max(120_000).default(15_000),
    poll_interval_ms: z.number().int().min(250).max(10_000).default(2_000),
  })
  .strict();

export const GeneratePlaywrightInputObjectSchema = z.object({
    feature_content: z
      .string()
      .min(20)
      .optional()
      .describe("Contenido Gherkin completo de un .feature."),
    feature_id: z
      .string()
      .min(1)
      .optional()
      .describe("ID de un feature guardado en AIQUAA. Ejemplo: feat_456."),
    base_url: z
      .string()
      .url()
      .optional()
      .describe("URL base de la aplicación. Ejemplo: https://staging.example.com."),
    app_context: z
      .string()
      .max(10_000)
      .optional()
      .describe("Contexto adicional: rutas, roles, labels y test IDs conocidos."),
    selector_source: z
      .enum(["provided_dom", "provided_component", "provided_test_ids", "estimated"])
      .default("estimated")
      .describe("Origen verificable de los selectores. Usá estimated si no se inspeccionó DOM/código."),
    auth: PlaywrightAuthSchema
      .optional()
      .describe("Si se proporciona, genera auth.setup.ts sin credenciales hardcodeadas."),
    external_validation: ExternalValidationSchema
      .optional()
      .describe("Genera un helper de polling para OTP, email, push o estado de negocio."),
    browsers: z
      .array(z.enum(["chromium", "firefox", "webkit"]))
      .min(1)
      .default(["chromium"])
      .describe("Browsers que se configurarán. Ejemplo: ['chromium']."),
    ci_targets: z
      .array(z.enum(["github_actions", "azure_pipelines"]))
      .min(1)
      .default(["github_actions", "azure_pipelines"])
      .describe("Pipelines que se devolverán como artefactos."),
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
  });

export const ListBusinessRulesInputSchema = z
  .object({
    project_id: z.string().min(1).describe("ID del proyecto AIQUAA. Ejemplo: prj_123."),
    query: z.string().max(200).optional().describe("Texto para filtrar por ID, título o descripción."),
    status: z.string().max(50).optional().describe("Estado de regla a filtrar. Ejemplo: active."),
    priority: z.string().max(50).optional().describe("Prioridad a filtrar. Ejemplo: high."),
    page: z.number().int().min(1).default(1).describe("Página, comenzando en 1."),
    page_size: z.number().int().min(1).max(100).default(20).describe("Resultados por página; máximo 100."),
    response_format: ResponseFormatSchema,
  })
  .strict();

const ScenarioRuleAssignmentSchema = z
  .object({
    scenario: z.string().min(1).describe("Nombre exacto del escenario."),
    rule_ids: z.array(RuleIdSchema).min(1).describe("Reglas que cubre el escenario."),
  })
  .strict();

export const MapScenariosInputSchema = z
  .object({
    feature_contents: z
      .array(z.string().min(20))
      .min(1)
      .describe("Uno o más archivos .feature como texto."),
    rule_ids: z.array(RuleIdSchema).min(1).describe("Universo de reglas que se desea cubrir."),
    assignments: z
      .array(ScenarioRuleAssignmentSchema)
      .default([])
      .describe("Mapeo explícito opcional. Sin él, se distribuyen reglas aún no etiquetadas por escenario."),
    response_format: ResponseFormatSchema,
  })
  .strict();

export const GenerateCoverageReportInputSchema = z
  .object({
    playwright_results: z
      .union([z.string().min(2), z.record(z.unknown())])
      .describe("JSON reporter output de Playwright, como texto JSON u objeto ya parseado."),
    project_id: z.string().min(1).describe("ID del proyecto AIQUAA. Ejemplo: prj_123."),
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
      .describe("Snapshot opcional de reglas; evita consultar AIQUAA y facilita uso offline."),
    response_format: ResponseFormatSchema,
  })
  .strict();

export type GenerateBddInput = z.infer<typeof GenerateBddInputSchema>;
export type GeneratePlaywrightInput = z.infer<typeof GeneratePlaywrightInputSchema>;
export type ListBusinessRulesInput = z.infer<typeof ListBusinessRulesInputSchema>;
export type MapScenariosInput = z.infer<typeof MapScenariosInputSchema>;
export type GenerateCoverageReportInput = z.infer<typeof GenerateCoverageReportInputSchema>;
