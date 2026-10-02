/** Resend's shared test sender. It delivers only to the Resend account address until a domain is verified. */
export const DEV_EMAIL_FROM = "Gold Intelligence Gateway <onboarding@resend.dev>";

export function emailFrom() {
  const from = process.env.EMAIL_FROM?.trim();
  return from || DEV_EMAIL_FROM;
}

/** Tests and local development keep the database mailbox. A key sends through Resend. */
export function usesResend() {
  return process.env.NODE_ENV !== "test" && Boolean(process.env.RESEND_API_KEY);
}

export async function deliverEmail(to: string, subject: string, body: string) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not set");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: emailFrom(), to: [to], subject, text: body }),
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const data = (await res.json()) as { message?: string };
      if (data.message) message = data.message;
    } catch {
      // The status is enough when the body is not JSON.
    }
    throw new Error(`Resend rejected the email (${res.status}): ${message}`);
  }
}
