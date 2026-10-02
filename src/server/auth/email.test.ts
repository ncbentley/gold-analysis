import { afterEach, describe, expect, it } from "vitest";
import { DEV_EMAIL_FROM, emailFrom, usesResend } from "./email";

const originalFrom = process.env.EMAIL_FROM;
const originalKey = process.env.RESEND_API_KEY;

afterEach(() => {
  if (originalFrom === undefined) delete process.env.EMAIL_FROM;
  else process.env.EMAIL_FROM = originalFrom;
  if (originalKey === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = originalKey;
});

describe("email delivery", () => {
  it("sends from the Resend dev address until a real domain is set", () => {
    delete process.env.EMAIL_FROM;
    expect(emailFrom()).toBe(DEV_EMAIL_FROM);
    process.env.EMAIL_FROM = "Gold Intelligence Gateway <noreply@example.com>";
    expect(emailFrom()).toBe("Gold Intelligence Gateway <noreply@example.com>");
  });

  it("keeps tests on the local mailbox even when a key is present", () => {
    process.env.RESEND_API_KEY = "re_test";
    expect(usesResend()).toBe(false);
  });
});
