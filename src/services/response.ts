import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ResponseFormat } from "../types.js";

export interface ToolResponseOptions<T> {
  format: ResponseFormat;
  /** Valor estructurado completo. Siempre se devuelve como `structuredContent`. */
  value: T;
  /** Resumen corto: el default. Nunca debe inlinear contenidos de archivo. */
  summary: (value: T) => string;
  /** Markdown completo. Solo se construye cuando el formato lo pide. */
  markdown: (value: T) => string;
  /**
   * Versión reducida del valor para el modo `markdown`, donde el contenido ya
   * viaja en el texto. Sin esto, la misma información se pagaría dos veces.
   */
  deduplicated?: (value: T) => unknown;
}

/**
 * Construye la respuesta de una tool emitiendo cada dato UNA sola vez.
 *
 * - `summary` (default): texto corto + `structuredContent` completo.
 * - `json`: puntero de una línea + `structuredContent` completo.
 * - `markdown`: markdown completo + `structuredContent` sin los contenidos que
 *   el markdown ya incluye.
 */
export function toolResult<T>(options: ToolResponseOptions<T>): CallToolResult {
  const { format, value } = options;
  if (format === "markdown") {
    const reduced = options.deduplicated ? options.deduplicated(value) : value;
    return {
      content: [{ type: "text", text: options.markdown(value) }],
      structuredContent: asRecord(reduced),
    };
  }
  const structuredContent = asRecord(value);
  const text = format === "json"
    ? jsonPointer(structuredContent)
    : options.summary(value);
  return { content: [{ type: "text", text }], structuredContent };
}

function jsonPointer(value: Record<string, unknown>): string {
  const bytes = JSON.stringify(value).length;
  return `Resultado en structuredContent (${Object.keys(value).length} campos, ${bytes} bytes).`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : { value };
}

/** Trunca texto largo dejando constancia explícita de cuánto se recortó. */
export function truncateText(value: string, maxBytes: number): { text: string; truncated: boolean } {
  if (value.length <= maxBytes) return { text: value, truncated: false };
  const omitted = value.length - maxBytes;
  return {
    text: `${value.slice(0, maxBytes)}\n… truncado: ${omitted} caracteres omitidos.`,
    truncated: true,
  };
}
