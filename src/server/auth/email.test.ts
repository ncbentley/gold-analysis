import { afterEach, describe, expect, it } from "vitest";
import { EMAIL_FROM_ADDRESS, emailFrom, usesResend } from "./email";

const originalFrom = process.env.EMAIL_FROM;
const originalKey = process.env.RESEND_API_KEY;

afterEach(() => {
  if (originalFrom === undefined) delete process.env.EMAIL_FROM;
  else process.env.EMAIL_FROM = originalFrom;
  if (originalKey === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = originalKey;
});

describe("email delivery", () => {
  it("sends from the verified domain, including when the old test sender is still configured", () => {
    delete process.env.EMAIL_FROM;
    expect(emailFrom()).toBe(EMAIL_FROM_ADDRESS);
    process.env.EMAIL_FROM = "Gold Intelligence Gateway <onboarding@resend.dev>";
    expect(emailFrom()).toBe(EMAIL_FROM_ADDRESS);
    process.env.EMAIL_FROM = "Gold Intelligence Gateway <hello@goldintelligencegateway.com>";
    expect(emailFrom()).toBe("Gold Intelligence Gateway <hello@goldintelligencegateway.com>");
  });

  it("keeps tests on the local mailbox even when a key is present", () => {
    process.env.RESEND_API_KEY = "re_test";
    expect(usesResend()).toBe(false);
  });
});
