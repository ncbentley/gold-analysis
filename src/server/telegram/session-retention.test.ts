import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("telegram session retention", () => {
  it("does not delete the stored login or call logOut when connecting", () => {
    const src = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
    const connect = src.slice(src.indexOf("export async function connectTelegram"), src.indexOf("export interface ResolvedChannel"));
    expect(connect).not.toContain("deleteSetting");
    expect(connect).not.toContain("LogOut");
    expect(connect).not.toMatch(/\.checkAuthorization\s*\(/);
    expect(connect).toContain("GetState");
    expect(connect).toContain("setSetting(SETTING_KEYS.telegramSession");
  });

  it("still removes the session only from the explicit sign-out path", () => {
    const src = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
    const signOut = src.slice(src.indexOf("export async function signOutTelegram"), src.indexOf("export async function connectTelegram"));
    expect(signOut).toContain("Api.auth.LogOut");
    expect(signOut).toContain("deleteSetting(SETTING_KEYS.telegramSession)");
  });
});
