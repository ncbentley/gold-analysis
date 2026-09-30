import type { Metadata } from "next";
import { Cinzel, Geist, Geist_Mono, Montserrat } from "next/font/google";
import { BrandDefs } from "@/components/brand";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const montserrat = Montserrat({ variable: "--font-montserrat", subsets: ["latin"] });
const cinzel = Cinzel({ variable: "--font-cinzel", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Gold Intelligence Gateway — Gold signal intelligence", template: "%s · Gold Intelligence Gateway" },
  description:
    "Every third-party gold signal recorded, replayed against minute data, and measured. Source track records, outcomes and analysis for XAU/USD.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`dark ${geistSans.variable} ${geistMono.variable} ${montserrat.variable} ${cinzel.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <BrandDefs />
        <TooltipProvider>{children}</TooltipProvider>
        <Toaster theme="dark" position="top-right" />
      </body>
    </html>
  );
}
