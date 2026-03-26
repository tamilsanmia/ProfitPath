import "@/app/globals.css";
import CurrencyRuntime from "@/components/currency-runtime";
import ThemeProvider from "@/components/theme-provider";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import type React from "react";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "BotPrimeX - AI Crypto Trading Platform",
  description: "Advanced AI-powered crypto trading",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning data-name="root-html">
      <body className={inter.className} suppressHydrationWarning data-name="root-body">
        <ThemeProvider>
          <CurrencyRuntime />
          <div data-name="app-root-content">{children}</div>
        </ThemeProvider>
      </body>
    </html>
  );
}
