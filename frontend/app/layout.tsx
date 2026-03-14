import "@/app/globals.css";
import ThemeProvider from "@/components/theme-provider";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import type React from "react";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "ProfitPath - AI Crypto Trading Platform",
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
          <div data-name="app-root-content">{children}</div>
        </ThemeProvider>
      </body>
    </html>
  );
}
