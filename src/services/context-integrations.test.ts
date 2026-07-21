import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { CodeGraphClient, resolveAllowedProjectPath } from "./codegraph-client.js";
import { EngramClient } from "./engram-client.js";
import type { CommandRequest } from "./command-runner.js";

test("CodeGraph limita rutas y usa argumentos sin shell", async () => {
  const root = path.resolve("C:/work");
  assert.throws(() => resolveAllowedProjectPath("C:/secret", [root]), /no está dentro/);

  let request: CommandRequest | undefined;
  const client = new CodeGraphClient(async (value) => {
    request = value;
    return "# Focused context";
  }, "codegraph-test", [root]);

  const result = await client.buildContext({
    projectPath: "C:/work/app",
    task: "localizar el login",
    maxNodes: 12,
    maxCodeBlocks: 4,
    includeCode: false,
  });
  assert.equal(result.context, "# Focused context");
  assert.equal(request?.command, "codegraph-test");
  assert.deepEqual(request?.args.slice(0, 2), ["context", "localizar el login"]);
  assert.ok(request?.args.includes("--no-code"));
});

test("Engram fuerza scope project y topic key idempotente", async () => {
  const calls: CommandRequest[] = [];
  const client = new EngramClient(async (request) => {
    calls.push(request);
    return request.args[0] === "save" ? "Memory saved: #1" : "Found 1 memories";
  }, "engram-test", "tenant-");

  const saved = await client.save({
    projectId: "PRJ-123",
    title: "Decisión de selectores",
    content: "Usar getByRole",
    type: "decision",
    topicKey: "decision/selectors",
  });
  const found = await client.search("PRJ-123", "selectores", 3);

  assert.equal(saved.project, "tenant-prj-123");
  assert.equal(found.project, "tenant-prj-123");
  assert.deepEqual(calls[0]?.args.slice(-4), ["--scope", "project", "--topic", "decision/selectors"]);
  assert.deepEqual(calls[1]?.args.slice(-4), ["--scope", "project", "--limit", "3"]);
});
