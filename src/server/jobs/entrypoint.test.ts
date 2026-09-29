import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

function run(file: string) {
  return spawnSync("sh", [path.join(process.cwd(), "docker/entrypoint.sh"), "node", "-e", "process.stdout.write(process.env.APP_SECRET ?? '')"], {
    encoding: "utf8",
    env: { ...process.env, APP_SECRET: "", APP_SECRET_FILE: file },
  });
}

describe("APP_SECRET entrypoint", () => {
  it("generates a secret only when it is missing and never rotates it", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "app-secret-"));
    const file = path.join(dir, "app-secret");
    const first = run(file);
    const second = run(file);
    expect(first.status).toBe(0);
    expect(second.status).toBe(0);
    expect(first.stderr).toContain("APP_SECRET generated.");
    expect(second.stderr).toContain("APP_SECRET reused.");
    expect(first.stdout).toMatch(/^[a-f0-9]{64}$/);
    expect(createHash("sha256").update(second.stdout).digest("hex")).toBe(createHash("sha256").update(first.stdout).digest("hex"));
    expect(readFileSync(file, "utf8").trim()).toBe(first.stdout);
  });
});
