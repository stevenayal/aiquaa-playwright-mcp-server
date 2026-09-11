import { spawn } from "node:child_process";

export interface CommandRequest {
  command: string;
  args: string[];
  cwd?: string;
  timeoutMs?: number;
  /**
   * Contenido que se escribe por stdin. Los payloads grandes no pueden ir como
   * argv: hay un límite de ~32 KB por línea de comando en Windows y todo lo que
   * viaja en argv queda visible en la lista de procesos del host.
   */
  stdin?: string;
}

export type CommandRunner = (request: CommandRequest) => Promise<string>;

const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

export const runCommand: CommandRunner = async (request) => new Promise((resolve, reject) => {
  const child = spawn(request.command, request.args, {
    ...(request.cwd ? { cwd: request.cwd } : {}),
    windowsHide: true,
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  let settled = false;
  const timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    child.kill("SIGKILL");
    reject(new Error(`${request.command} superó el timeout de ${request.timeoutMs ?? 30_000} ms.`));
  }, request.timeoutMs ?? 30_000);

  const finish = (error?: Error, value?: string): void => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    if (error) reject(error);
    else resolve(value ?? "");
  };

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    if (stdout.length < MAX_OUTPUT_BYTES) stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    if (stderr.length < MAX_OUTPUT_BYTES) stderr += chunk;
  });

  child.on("error", (error) => finish(new Error(`${request.command} falló: ${error.message}`)));
  child.on("close", (code) => {
    if (code === 0) finish(undefined, stdout.trim());
    else finish(new Error(`${request.command} falló: ${stderr.trim() || `código de salida ${code}`}`));
  });

  child.stdin.on("error", () => {
    // El proceso puede cerrar stdin antes de que terminemos de escribir; el
    // resultado real llega por 'close'.
  });
  if (request.stdin !== undefined) child.stdin.write(request.stdin);
  child.stdin.end();
});
