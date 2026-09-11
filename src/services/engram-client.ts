import { runCommand, type CommandRunner } from "./command-runner.js";
import { truncateText } from "./response.js";

export interface EngramSearchResult {
  provider: "engram";
  project: string;
  query: string;
  memories: string;
  truncated: boolean;
}

export interface EngramSaveOptions {
  projectId: string;
  title: string;
  content: string;
  type: string;
  topicKey: string;
}

export interface EngramSaveResult {
  provider: "engram";
  project: string;
  topicKey: string;
  status: string;
}

export class EngramClient {
  constructor(
    private readonly runner: CommandRunner = runCommand,
    private readonly binary = process.env.ENGRAM_BIN?.trim() || "engram",
    private readonly projectPrefix = process.env.ENGRAM_PROJECT_PREFIX?.trim() || "aiquaa-",
  ) {}

  async search(
    projectId: string,
    query: string,
    limit: number,
    maxOutputBytes: number,
  ): Promise<EngramSearchResult> {
    const project = this.projectName(projectId);
    const raw = await this.runner({
      command: this.binary,
      args: ["search", query, "--project", project, "--scope", "project", "--limit", String(limit)],
      timeoutMs: 15_000,
    });
    const { text, truncated } = truncateText(raw, maxOutputBytes);
    return { provider: "engram", project, query, memories: text, truncated };
  }

  async save(options: EngramSaveOptions): Promise<EngramSaveResult> {
    const project = this.projectName(options.projectId);
    // El contenido va por stdin: hasta 20 000 caracteres no caben de forma
    // confiable en argv y quedarían visibles en la lista de procesos.
    const status = await this.runner({
      command: this.binary,
      args: [
        "save",
        options.title,
        "-",
        "--type",
        options.type,
        "--project",
        project,
        "--scope",
        "project",
        "--topic",
        options.topicKey,
      ],
      stdin: options.content,
      timeoutMs: 15_000,
    });
    return { provider: "engram", project, topicKey: options.topicKey, status };
  }

  private projectName(projectId: string): string {
    return `${this.projectPrefix}${projectId}`.trim().toLowerCase();
  }
}
