import { AIQUAA_ENDPOINTS } from "../constants.js";
import type { BusinessRule, PaginatedBusinessRules } from "../types.js";

export interface BusinessRuleFilters {
  query?: string;
  status?: string;
  priority?: string;
  page: number;
  pageSize: number;
}

export class AiquaaClientError extends Error {
  public constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = "AiquaaClientError";
  }
}

export class AiquaaClient {
  private readonly baseUrl: string;
  private readonly accessToken: string;

  public constructor(options: { baseUrl?: string; accessToken?: string }) {
    const baseUrl = options.baseUrl ?? process.env.AIQUAA_API_BASE_URL;
    const accessToken = options.accessToken ?? process.env.AIQUAA_ACCESS_TOKEN;

    if (!baseUrl) {
      throw new AiquaaClientError(
        "Falta AIQUAA_API_BASE_URL. Configurá la URL del backend NestJS de AIQUAA antes de usar operaciones remotas.",
      );
    }
    if (!accessToken) {
      throw new AiquaaClientError(
        "Falta autenticación de AIQUAA. En desarrollo definí AIQUAA_ACCESS_TOKEN con un JWT válido de Supabase Auth; en producción enviá Authorization: Bearer <token> al endpoint MCP.",
      );
    }

    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.accessToken = accessToken;
  }

  public async listBusinessRules(
    projectId: string,
    filters: BusinessRuleFilters,
  ): Promise<PaginatedBusinessRules> {
    const params = new URLSearchParams({
      page: String(filters.page),
      pageSize: String(filters.pageSize),
    });
    if (filters.query) params.set("query", filters.query);
    if (filters.status) params.set("status", filters.status);
    if (filters.priority) params.set("priority", filters.priority);

    const value = await this.get(`${AIQUAA_ENDPOINTS.businessRules(projectId)}?${params}`);
    return parsePaginatedRules(value, filters.page, filters.pageSize);
  }

  public async getAllBusinessRules(projectId: string): Promise<BusinessRule[]> {
    const first = await this.listBusinessRules(projectId, { page: 1, pageSize: 100 });
    const items = [...first.items];
    for (let page = 2; page <= first.totalPages; page += 1) {
      const next = await this.listBusinessRules(projectId, { page, pageSize: 100 });
      items.push(...next.items);
    }
    return items;
  }

  public async getRequirementText(projectId: string, requirementId: string): Promise<string> {
    const value = await this.get(AIQUAA_ENDPOINTS.requirement(projectId, requirementId));
    const record = asRecord(value);
    const text = firstString(record, ["text", "content", "requirementText", "description"]);
    if (!text || text.length < 20) {
      throw new AiquaaClientError(
        `El requerimiento ${requirementId} no contiene texto suficiente para generar escenarios. Verificá el registro en AIQUAA.`,
      );
    }
    return text;
  }

  public async getFeatureContent(featureId: string): Promise<string> {
    const value = await this.get(AIQUAA_ENDPOINTS.feature(featureId));
    const record = asRecord(value);
    const content = firstString(record, ["content", "gherkin", "featureContent"]);
    if (!content) {
      throw new AiquaaClientError(
        `El feature ${featureId} no contiene Gherkin utilizable. Verificá el registro en AIQUAA.`,
      );
    }
    return content;
  }

  private async get(path: string): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.accessToken}`,
        },
      });
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new AiquaaClientError(
        `No se pudo conectar con AIQUAA en ${this.baseUrl}. Verificá AIQUAA_API_BASE_URL y la red. Detalle: ${detail}`,
      );
    }

    if (!response.ok) {
      const body = (await response.text()).slice(0, 500);
      const authHelp =
        response.status === 401 || response.status === 403
          ? " Renová AIQUAA_ACCESS_TOKEN o enviá un Bearer JWT válido de Supabase Auth."
          : "";
      throw new AiquaaClientError(
        `AIQUAA respondió ${response.status} ${response.statusText} para ${path}.${authHelp} ${body}`.trim(),
        response.status,
      );
    }

    try {
      return await response.json();
    } catch {
      throw new AiquaaClientError(`AIQUAA devolvió una respuesta no JSON para ${path}.`);
    }
  }
}

function parsePaginatedRules(value: unknown, fallbackPage: number, fallbackPageSize: number): PaginatedBusinessRules {
  const record = asRecord(value);
  const rawItems = Array.isArray(record.items)
    ? record.items
    : Array.isArray(record.data)
      ? record.data
      : Array.isArray(value)
        ? value
        : [];
  const items = rawItems.map(parseRule);
  const total = numberValue(record.total) ?? items.length;
  const page = numberValue(record.page) ?? fallbackPage;
  const pageSize = numberValue(record.pageSize) ?? numberValue(record.limit) ?? fallbackPageSize;
  const totalPages = numberValue(record.totalPages) ?? Math.max(1, Math.ceil(total / pageSize));
  return { items, page, pageSize, total, totalPages };
}

function parseRule(value: unknown): BusinessRule {
  const record = asRecord(value);
  const id = firstString(record, ["id", "ruleId", "code"]);
  if (!id) throw new AiquaaClientError("AIQUAA devolvió una regla sin id/ruleId/code.");
  const title = firstString(record, ["title", "name"]) ?? id;
  const description = firstString(record, ["description", "content", "text"]) ?? "";
  const status = firstString(record, ["status"]);
  const priority = firstString(record, ["priority"]);
  return {
    id,
    title,
    description,
    ...(status ? { status } : {}),
    ...(priority ? { priority } : {}),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function firstString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    if (typeof record[key] === "string" && record[key].trim()) return record[key].trim();
  }
  return undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
