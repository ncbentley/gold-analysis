import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = { title: "Terms of Service" };

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      updated="27 September 2026"
      sections={[
        {
          heading: "What the service is",
          body: [
            "Gold Intelligence Gateway aggregates trading signals published by third-party sources, records them, and measures them against historical market data. We do not create the signals and we do not place trades on your behalf.",
            "All content is general information made available identically to every member of a subscription tier. It is not personal financial, investment, tax or legal advice, and it does not take your circumstances into account.",
          ],
        },
        {
          heading: "Risk",
          body: [
            "Trading gold and other leveraged products carries a high risk of loss, and you can lose more than your initial deposit. Historical results, statistics and AI-generated summaries describe the past and do not predict or guarantee future performance.",
            "Recorded outcomes are computed with published, deterministic rules using minute-level data. Real executions may differ because of spreads, slippage, broker pricing and timing.",
          ],
        },
        {
          heading: "Accounts",
          body: [
            "You must provide a valid email address and keep your credentials secure. Accounts are personal; sharing access or redistributing content is not permitted.",
            "We may suspend accounts that abuse the service, attempt to bypass access controls or scrape content.",
          ],
        },
        {
          heading: "Subscriptions and billing",
          body: [
            "Paid plans are billed weekly, monthly or annually in advance and renew automatically until cancelled. You can cancel at any time from the billing page; access continues until the end of the period you have paid for.",
            "Plan features and history windows are described on the pricing page and may change with reasonable notice. Refunds are handled according to applicable consumer law.",
          ],
        },
        {
          heading: "Third-party sources and brokers",
          body: [
            "Signals remain the responsibility of the sources that publish them. Links to brokers are affiliate links: we may be paid if you open an account. Access to Gold Intelligence Gateway never depends on opening a broker account.",
          ],
        },
        {
          heading: "Liability",
          body: [
            "The service is provided as is. To the extent permitted by law, we are not liable for trading losses or for decisions made using information from the service.",
          ],
        },
      ]}
    />
  );
}
