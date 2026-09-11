import type { CoverageReport, GeneratedFile, PaginatedBusinessRules } from "../types.js";
import type { BddGenerationResult } from "./bdd-generator.js";
import type { CodeGraphContextResult } from "./codegraph-client.js";
import type { EngramSaveResult, EngramSearchResult } from "./engram-client.js";
import type { PlaywrightGenerationResult } from "./playwright-generator.js";
import type { ScenarioMappingResult } from "./scenario-mapper.js";

/**
 * Resúmenes de ≤15 líneas para el formato `summary`. Nunca inlinean contenido
 * de archivo: para eso está `structuredContent`, que viaja en la misma respuesta.
 */

export function bddSummary(result: BddGenerationResult): string {
  return [
    `BDD generado: ${result.files.length} archivo(s).`,
    `Resumen del requerimiento: ${result.requirementSummary}`,
    `Reglas sugeridas: ${list(result.suggestedRuleIds)}`,
    ...fileLines(result.files),
    ...warningLines(result.warnings),
  ].join("\n");
}

export function playwrightSummary(result: PlaywrightGenerationResult): string {
  return [
    `Playwright BDD — ${result.featureName}: ${result.scenarioCount} escenario(s), ${result.stepCount} step(s).`,
    `Archivos generados: ${result.files.length}${
      result.omittedFiles.length > 0 ? ` (omitidos por include_files: ${list(result.omittedFiles)})` : ""
    }`,
    ...fileLines(result.files),
    `Selectores bloqueados: ${result.selectorProvenance.filter((item) => item.confidence === "blocked").length}`,
    ...warningLines(result.warnings),
    "Contenido completo en structuredContent; usá response_format='markdown' para verlo inline.",
  ].join("\n");
}

export function rulesSummary(result: PaginatedBusinessRules): string {
  return [
    `Reglas de negocio: página ${result.page}/${result.totalPages}, ${result.items.length} de ${result.total}.`,
    `IDs: ${list(result.items.map((rule) => rule.id))}`,
  ].join("\n");
}

export function mappingSummary(result: ScenarioMappingResult): string {
  return [
    `Escenarios mapeados: ${result.mappings.length}.`,
    `Reglas cubiertas: ${list(result.coveredRuleIds)}`,
    `Reglas sin cobertura: ${list(result.uncoveredRuleIds)}`,
    "Features etiquetados en structuredContent.features.",
  ].join("\n");
}

export function coverageSummary(report: CoverageReport): string {
  const failing = report.rules.filter((item) => item.status === "failing").map((item) => item.rule.id);
  const uncovered = report.rules.filter((item) => item.status === "uncovered").map((item) => item.rule.id);
  return [
    `Cobertura de ${report.projectId}: ${report.summary.coveragePercentage}% (${report.summary.coveredRules}/${report.summary.totalRules}).`,
    `Pasando: ${report.summary.passingRules} · Fallando: ${report.summary.failingRules} · Sin tests: ${report.summary.uncoveredRules}`,
    `Reglas fallando: ${list(failing, 10)}`,
    `Reglas sin cobertura: ${list(uncovered, 10)}`,
    `Features analizados: ${report.features.length}`,
  ].join("\n");
}

export function codeContextSummary(result: CodeGraphContextResult): string {
  return [
    `Contexto CodeGraph para: ${result.task}`,
    `Repositorio: ${result.projectPath}`,
    `Tamaño: ${result.context.length} caracteres${result.truncated ? " (truncado)" : ""}.`,
    "Contenido en structuredContent.context.",
  ].join("\n");
}

export function memorySearchSummary(result: EngramSearchResult): string {
  return [
    `Memoria de ${result.project} para: ${result.query}`,
    `Tamaño: ${result.memories.length} caracteres${result.truncated ? " (truncado)" : ""}.`,
    "Contenido en structuredContent.memories.",
  ].join("\n");
}

export function memorySaveSummary(result: EngramSaveResult): string {
  return `Memoria guardada en ${result.project} bajo topic_key '${result.topicKey}'.`;
}

function fileLines(files: GeneratedFile[]): string[] {
  return files.map((file) => `- ${file.path} (${file.bytes} bytes${file.truncated ? ", truncado" : ""})`);
}

function warningLines(warnings: string[]): string[] {
  return warnings.map((warning) => `! ${warning}`);
}

function list(values: string[], max = 20): string {
  if (values.length === 0) return "ninguna";
  if (values.length <= max) return values.join(", ");
  return `${values.slice(0, max).join(", ")} … (+${values.length - max})`;
}
