import { describe, expect, it } from "vitest";
import { freeAccess } from "@/server/entitlements/access";
import { resolveSignalFilters, signalVisibleToViewer } from "./queries";

const now = new Date("2026-10-02T00:00:00Z");

describe("resolveSignalFilters", () => {
  it("drops a free account's source filter and still applies a server source scope", () => {
    const access = freeAccess();
    expect(access.tier).toBeNull();
    expect(access.isAdmin).toBe(false);

    const member = resolveSignalFilters(access, { sourceId: "from-the-url" });
    expect(member.ignored).toContain("sourceId");
    expect(member.applied.sourceId).toBeUndefined();

    const scoped = resolveSignalFilters(access, { sourceId: "from-the-url" }, { sourceScope: "this-source" });
    expect(scoped.ignored).toContain("sourceId");
    expect(scoped.applied.sourceId).toBe("this-source");
  });
});

describe("signalVisibleToViewer", () => {
  it("omits a constituent older than the history cutoff", () => {
    const access = freeAccess();
    const older = new Date("2026-09-01T00:00:00Z");
    const inside = new Date("2026-10-01T00:00:00Z");
    expect(signalVisibleToViewer(access, { status: "ACTIVE", signalTime: older, sourceIsQa: false }, now)).toBe(false);
    expect(signalVisibleToViewer(access, { status: "ACTIVE", signalTime: inside, sourceIsQa: false }, now)).toBe(true);
  });

  it("omits invalid signals and QA sources for a non-admin", () => {
    const access = freeAccess();
    expect(signalVisibleToViewer(access, { status: "INVALID", signalTime: now, sourceIsQa: false }, now)).toBe(false);
    expect(signalVisibleToViewer(access, { status: "ACTIVE", signalTime: now, sourceIsQa: true }, now)).toBe(false);
    expect(signalVisibleToViewer({ ...access, isAdmin: true }, { status: "ACTIVE", signalTime: now, sourceIsQa: true }, now)).toBe(true);
  });
});
