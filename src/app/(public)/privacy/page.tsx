import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = { title: "Privacy Policy" };

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      updated="4 October 2026"
      sections={[
        {
          heading: "Data we collect",
          body: [
            "Account data: your email address, a salted hash of your password, email verification status and acceptance of the terms.",
            "Billing data: your plan, billing period and subscription status. Card details are handled by our payment processor and never reach our servers.",
            "Usage data: product events such as page views of signals, upgrade clicks and affiliate clicks, used to improve the service.",
            "Attribution data: the page you landed on, the site that referred you, and campaign parameters on the link you opened (such as utm_source or an ad click id). This is used to see which campaigns lead to signups and subscriptions.",
          ],
        },
        {
          heading: "How we use it",
          body: [
            "To provide the service, enforce plan access, process payments, send account emails and prevent abuse. We do not sell personal data.",
          ],
        },
        {
          heading: "Processors",
          body: [
            "We use a payment processor for subscriptions, an email provider for account messages, a market data provider, and an AI provider for signal analysis. AI requests contain market facts and signal data, not your personal data.",
            "We use PostHog to understand how the product is used and which campaigns lead to subscriptions. Those events can include an account email, pages opened, product actions, and how you arrived. They are not shared with advertising networks.",
          ],
        },
        {
          heading: "Cookies",
          body: [
            "We use a first-party session cookie to keep you signed in. It is HTTP-only.",
            "We also store two first-party cookies that remember an anonymous visitor id and how you arrived (campaign parameters and referrer). They are HTTP-only, are not shared with advertising networks, and are not used to advertise to you on other sites.",
          ],
        },
        {
          heading: "Retention and your rights",
          body: [
            "We keep account data while your account is open and billing records as long as the law requires. You may request access to, correction of or deletion of your personal data by contacting support.",
          ],
        },
      ]}
    />
  );
}
