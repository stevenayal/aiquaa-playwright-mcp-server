import { execFile } from "node:child_process";

export interface CommandRequest {
  command: string;
  args: string[];
  cwd?: string;
  timeoutMs?: number;
}

export type CommandRunner = (request: CommandRequest) => Promise<string>;

export const runCommand: CommandRunner = async (request) => new Promise((resolve, reject) => {
  execFile(
    request.command,
    request.args,
    {
      ...(request.cwd ? { cwd: request.cwd } : {}),
      timeout: request.timeoutMs ?? 30_000,
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true,
      shell: false,
      encoding: "utf8",
    },
    (error, stdout, stderr) => {
      if (error) {
        const detail = stderr.trim() || error.message;
        reject(new Error(`${request.command} falló: ${detail}`));
        return;
      }
      resolve(stdout.trim());
    },
  );
});
