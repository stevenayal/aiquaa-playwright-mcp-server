# aiquaa-playwright-mcp-server

Servidor MCP remoto en TypeScript que **genera** escenarios BDD, definiciones Playwright compatibles con `playwright-bdd`, trazabilidad `@rule:<ID>` y reportes de cobertura de reglas de negocio. No abre navegadores ni ejecuta tests: los artefactos se copian al proyecto Playwright del usuario y se ejecutan allí.

## Investigación y decisión de extensión

La investigación se realizó sobre `playwright-bdd` 9.2.0. Su flujo público convierte `.feature` a tests Playwright nativos con `defineBddConfig` y `bddgen`; las definiciones se registran mediante `createBdd`, y los tags Gherkin llegan a los tests generados. La estructura upstream separa `src/config`, `src/gherkin`, `src/generate`, `src/steps`, `src/runtime` y reporters. Véanse el [repositorio y estructura upstream](https://github.com/vitalets/playwright-bdd), su [documentación de cómo genera tests](https://vitalets.github.io/playwright-bdd/) y el [paquete publicado](https://www.npmjs.com/package/playwright-bdd).

La extensión de AIQUAA se apoya deliberadamente en puntos públicos y no reemplaza el runner:

- `defineBddConfig`/`bddgen` siguen siendo responsables de `.feature → .features-gen/*.spec.js`.
- Un hook `Before` de `createBdd` toma los tags `@rule:*` preservados por el generador y los agrega a `test.info().annotations` como `business-rule`. Playwright documenta que las anotaciones en runtime quedan disponibles para reporters ([anotaciones](https://playwright.dev/docs/test-annotations), [TestResult.annotations](https://playwright.dev/docs/api/class-testresult)).
- `AiquaaRuleReporter` implementa la API `Reporter`, agrega resultados por rule ID en `onTestEnd` y escribe un JSON al finalizar, compatible con los reporters estándar ([reporters personalizados](https://playwright.dev/docs/test-reporters)).
- El servidor genera steps y configuración para el paquete upstream/fork sin modificar su generación estándar. Las extensiones también se exportan como `aiquaa-playwright-mcp-server/rule-tags` y `aiquaa-playwright-mcp-server/rule-reporter`, de modo que un fork corporativo puede incorporarlas directamente.

Este diseño es la capa mantenible del fork: el código específico de AIQUAA queda aislado de los internals de `playwright-bdd`, conservando compatibilidad con nuevas versiones. Si AIQUAA publica un fork npm propio, basta reemplazar el import `playwright-bdd` por el nombre de ese paquete; no cambia el contrato MCP.

El transporte es Streamable HTTP sin estado, recomendado para servidores remotos por la [guía oficial del SDK TypeScript](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md). Cada POST crea contexto aislado y puede hacer passthrough del Bearer JWT de esa solicitud.

## Tools

| Tool | Función | Acceso externo |
|---|---|---|
| `aiquaa_generate_bdd_scenarios` | Genera `.feature` desde texto o `requirement_id`; valida OCR de PDF | Solo al resolver IDs o sugerir reglas |
| `aiquaa_generate_playwright_tests` | Genera steps, procedencia de selectores, auth, helper externo, reporter, config y CI | Solo con `feature_id` |
| `aiquaa_list_business_rules` | Lista reglas con filtros y paginación | Sí |
| `aiquaa_map_scenarios_to_rules` | Agrega `@rule:` y lista reglas no cubiertas | No |
| `aiquaa_generate_coverage_report` | Cruza JSON Playwright con reglas y desglosa por feature | Evitable con `business_rules` offline |
| `aiquaa_get_code_context` | Obtiene contexto estructural enfocado desde un índice local CodeGraph | Binario y repositorio montado |
| `aiquaa_search_project_memory` | Busca decisiones y aprendizajes persistentes del proyecto | Binario local Engram |
| `aiquaa_save_project_memory` | Guarda o revisa memoria curada por `topic_key` | Binario local Engram |

Todos los inputs son Zod strict. Las tools de generación devuelven contenido, nunca escriben artefactos ni ejecutan tests. La única escritura nueva es explícita: `aiquaa_save_project_memory` persiste en Engram. Todas declaran `readOnlyHint`, `destructiveHint`, `idempotentHint` y `openWorldHint` de acuerdo con su comportamiento.

## Requisitos y setup

- Node.js 20 o superior.
- Para las operaciones remotas: un backend AIQUAA accesible y un Bearer token válido aceptado por ese backend.
- Para generación offline, CodeGraph y Engram no se requieren `AIQUAA_API_BASE_URL` ni `AIQUAA_ACCESS_TOKEN`.

```bash
npm install
cp .env.example .env
npm run build
npm start
```

PowerShell:

```powershell
Copy-Item .env.example .env
$env:AIQUAA_API_BASE_URL="https://api.example.aiquaa.com"
$env:AIQUAA_ACCESS_TOKEN="<jwt-supabase>"
npm run build
npm start
```

El endpoint MCP queda en `http://localhost:3000/mcp` y el health check en `http://localhost:3000/health`. `PORT` y `MCP_PATH` son configurables.

## Contexto eficiente y memoria persistente

La integración toma dos ideas complementarias de [CodeGraph](https://github.com/stevenayal/codegraph) y [Engram](https://github.com/stevenayal/engram): recuperar solamente los símbolos relevantes antes de generar código y conservar decisiones curadas entre sesiones. CodeGraph puede bajar llamadas de exploración y tokens cuando el servidor comparte filesystem con el repositorio; no aporta ese beneficio si el MCP remoto no puede ver el proyecto. Engram persiste en SQLite y evita volver a descubrir decisiones, pero conviene guardar conclusiones útiles, no cada llamada de herramienta.

Ambas integraciones son opcionales. Sin los binarios o sus variables, las cinco tools originales continúan disponibles.

### CodeGraph

Instalá el CLI, inicializá cada repositorio permitido y exponé solamente raíces confiables:

```bash
npm install -g @colbymchenry/codegraph
cd /workspace/projects/checkout
codegraph init -i

export CODEGRAPH_BIN=codegraph
export CODEGRAPH_ALLOWED_ROOTS=/workspace/projects
```

En Windows, separá varias raíces con `;`; en Linux/macOS, con `:`. La tool ejecuta `codegraph context` sin shell, limita nodos/bloques de código y rechaza cualquier `project_path` fuera de `CODEGRAPH_ALLOWED_ROOTS`. En despliegues remotos, montá los repositorios como volúmenes de solo lectura cuando sea posible.

Flujo recomendado:

1. Llamar `aiquaa_get_code_context` con una tarea concreta, por ejemplo “localizar el formulario y sus selectores de login”.
2. Pasar el contexto enfocado a `app_context` de `aiquaa_generate_playwright_tests` y marcar el `selector_source` verificable correspondiente.

### Engram

Instalá el binario según la [guía de Engram](https://github.com/stevenayal/engram/blob/main/docs/INSTALLATION.md) y configurá:

```bash
export ENGRAM_BIN=engram
export ENGRAM_PROJECT_PREFIX=aiquaa-
```

`aiquaa_search_project_memory` fuerza `scope=project`. `aiquaa_save_project_memory` también fuerza ese scope y exige un `topic_key` estable; Engram usa esa clave para revisar la memoria existente en vez de crear duplicados en reintentos. El nombre interno se deriva como `<prefijo><project_id>`, en minúsculas, para aislar proyectos. No se exponen borrado, scope personal ni búsqueda global.

Guardá contenido curado con esta estructura:

```text
What: se eligió getByRole para acciones primarias.
Why: conserva semántica accesible y evita selectores CSS frágiles.
Where: features/steps/login.steps.ts.
Learned: data-testid queda reservado para controles sin nombre accesible estable.
```

En contenedores, montá el directorio de datos de Engram como volumen persistente. En runners CI efímeros, la memoria solo sobrevive si ese directorio se restaura desde un cache o volumen confiable; no publiques la base como artifact porque puede contener contexto sensible.

### Autenticación

La autenticación AIQUAA se aplica únicamente cuando una tool consulta el backend: resolver `requirement_id` o `feature_id`, listar reglas o generar cobertura sin un snapshot offline. No se exige para generación desde texto, mapeo local, CodeGraph ni Engram.

En desarrollo, `AIQUAA_ACCESS_TOKEN` es el fallback. En producción, enviá por cada request MCP:

```http
Authorization: Bearer <supabase-jwt-del-usuario>
```

El token de la solicitud tiene precedencia y se usa solo en ese contexto. Si falta, únicamente fallará la operación remota que lo necesite; los errores indican exactamente qué variable/header configurar. Nunca se registra el token.

No se recomienda permitir llamadas anónimas al backend AIQUAA. Si el endpoint MCP se publica en Internet, el passthrough del Bearer protege las llamadas al backend, pero no sustituye la autenticación y autorización del propio endpoint MCP en el proxy o gateway de entrada.

## Contratos AIQUAA pendientes de confirmar

El repositorio recibido no contiene el backend NestJS ni su OpenAPI. Por eso estas rutas son placeholders centralizados en `src/constants.ts`:

| Uso | Ruta asumida | Forma aceptada |
|---|---|---|
| Listar reglas | `GET /projects/:projectId/business-rules?page=&pageSize=&query=&status=&priority=` | `{ items, page, pageSize, total, totalPages }` o `{ data, ... }` |
| Obtener requerimiento | `GET /projects/:projectId/requirements/:requirementId` | `text`, `content`, `requirementText` o `description` |
| Obtener feature | `GET /features/:featureId` | `content`, `gherkin` o `featureContent` |

Antes de producción, sustituí las rutas por los endpoints reales y agregá contract tests contra el OpenAPI de AIQUAA. El cliente HTTP está centralizado en `src/services/aiquaa-client.ts` para que el cambio sea local.

## Guardrail de PDF/OCR

El servidor no incluye OCR. Primero extraé el PDF con una herramienta especializada y enviá:

```json
{
  "requirement_text": "texto extraído...",
  "requirement_source": "extracted_from_pdf",
  "project_id": "prj_123"
}
```

La validación rechaza textos demasiado cortos, con baja proporción alfanumérica, caracteres de reemplazo, palabras partidas o líneas anormalmente fragmentadas. Es una barrera contra basura obvia, no una garantía semántica: el usuario debe revisar el feature generado.

## Seguridad de selectores y credenciales

`aiquaa_generate_playwright_tests` acepta `selector_source` para registrar de dónde provienen los locators:

- `provided_dom`: HTML renderizado inspeccionado.
- `provided_component`: código React/Vue/Angular u otro componente real.
- `provided_test_ids`: inventario confirmado de `data-testid`.
- `estimated`: inferido únicamente del Gherkin; es el default y genera una advertencia.

Cada step devuelve una entrada en `selectorProvenance`. Si no existe información suficiente para implementar una acción o assertion, el código generado lanza un error `TODO` explícito; nunca produce un falso positivo comprobando solamente que la página existe.

La configuración opcional `auth` genera `features/support/auth.setup.ts` con `storageState`. Solo contiene nombres de variables de entorno: si los secrets faltan, falla con un mensaje accionable y no usa credenciales fallback.

La configuración `external_validation` genera un helper de polling para SMS, email, push o estados de negocio expuestos por una API interna. La URL y el token también se resuelven exclusivamente desde variables de entorno.

## Ejemplo end-to-end

### 1. Requerimiento → BDD

Invocá `aiquaa_generate_bdd_scenarios`:

```json
{
  "requirement_text": "Como cliente registrado quiero recuperar mi contraseña por correo para volver a acceder de forma segura sin contactar a soporte.",
  "requirement_source": "typed",
  "project_id": "prj_checkout",
  "language": "es",
  "response_format": "json"
}
```

La respuesta contiene uno o más archivos `features/*.feature`, escenarios positivo/validación/error y sugerencias de rule IDs si AIQUAA está configurado.

### 2. Mapear reglas

Pasá el feature a `aiquaa_map_scenarios_to_rules` junto con el universo de reglas:

```json
{
  "feature_contents": ["# language: es\nCaracterística: Recuperación..."],
  "rule_ids": ["RN-014", "RN-015", "RN-016"],
  "assignments": [
    { "scenario": "Flujo exitoso", "rule_ids": ["RN-014"] },
    { "scenario": "Validación de datos obligatorios", "rule_ids": ["RN-015"] }
  ],
  "response_format": "markdown"
}
```

La salida incluye el feature actualizado y `uncoveredRuleIds`.

### 3. Feature → Playwright

Invocá `aiquaa_generate_playwright_tests` con el feature mapeado:

```json
{
  "feature_content": "# language: es\nCaracterística: Recuperación...",
  "base_url": "https://staging.example.com",
  "app_context": "El botón de envío se llama Enviar enlace; el campo usa label Correo.",
  "selector_source": "provided_component",
  "auth": {
    "login_path": "/login",
    "username_label": "Correo",
    "password_label": "Contraseña",
    "submit_name": "Ingresar",
    "success_url_pattern": "dashboard",
    "username_env": "TEST_USER",
    "password_env": "TEST_PASSWORD"
  },
  "external_validation": {
    "type": "email",
    "api_url_env": "NOTIFICATION_API_URL",
    "api_token_env": "NOTIFICATION_API_TOKEN",
    "response_field": "data.resetLink",
    "timeout_ms": 30000,
    "poll_interval_ms": 2000
  },
  "browsers": ["chromium"],
  "ci_targets": ["github_actions", "azure_pipelines"],
  "response_format": "json"
}
```

Copiá los archivos devueltos. La respuesta incluye `.github/workflows/playwright.yml` y `azure-pipelines.playwright.yml` cuando se solicitan ambos targets.

En el proyecto de tests:

```bash
npm install -D @playwright/test playwright-bdd aiquaa-playwright-mcp-server
npx bddgen
npx playwright test
```

El reporter produce `test-results/aiquaa-rule-results.json`. Puede coexistir con `html` y `json`.

### CI/CD

El repositorio incluye un workflow real para compilar y probar el servidor:

- `.github/workflows/ci.yml`

También incluye ejemplos listos para adaptar en proyectos consumidores:

- `examples/ci/github-actions-playwright.yml`
- `examples/ci/azure-pipelines-playwright.yml`

Ambos ejecutan `bddgen` antes de Playwright, publican JUnit y conservan los reportes como artifacts. Configurá `BASE_URL` como variable y las credenciales/tokens como secrets del proveedor; nunca los escribas en YAML.

### 4. Resultados → cobertura de reglas

Pasá el JSON estándar de Playwright o el JSON del reporter a `aiquaa_generate_coverage_report`. Para trabajar offline incluí un snapshot:

```json
{
  "project_id": "prj_checkout",
  "playwright_results": {
    "businessRuleCoverage": {
      "rules": [
        { "ruleId": "RN-014", "tests": [{ "title": "Flujo exitoso", "feature": "Recuperación", "status": "passed" }] },
        { "ruleId": "RN-015", "tests": [{ "title": "Validación", "feature": "Recuperación", "status": "failed" }] }
      ]
    }
  },
  "business_rules": [
    { "id": "RN-014", "title": "Recuperación autenticada", "description": "" },
    { "id": "RN-015", "title": "Validación de correo", "description": "" },
    { "id": "RN-016", "title": "Límite de intentos", "description": "" }
  ],
  "response_format": "markdown"
}
```

El reporte diferencia `passed`, `failing`, `not_run` y `uncovered`, calcula el porcentaje sobre todas las reglas registradas y desglosa por feature.

## Desarrollo y verificación

```bash
npm run build
npm test
```

`evaluation.xml` contiene 10 preguntas que prueban generación BDD, rechazo de OCR roto, paginación, generación Playwright, mapeo, formatos de reporter y el pipeline completo. Las pruebas automatizadas también parsean los YAML generados y los ejemplos estáticos.

## Límites deliberados

- No OCR, browser automation ni ejecución de tests dentro del servidor.
- La generación determinista entrega una base revisable; no pretende conocer el DOM de la app.
- La sugerencia automática de reglas usa similitud léxica y se marca como sugerencia.
- No persiste features ni resultados; los IDs se resuelven en AIQUAA cuando se proveen.
- Los resultados de cobertura reflejan reglas registradas/suministradas; una regla omitida del snapshot no puede contarse como no cubierta.

## Licencia

MIT. `playwright-bdd` mantiene su propia licencia MIT y Playwright su licencia Apache-2.0.
