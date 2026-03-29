"use client";
import { ThemeProvider as NextThemeProvider } from "next-themes";

const ThemeProvider = ({ children }: { children: React.ReactNode }) => {
  return (
    <NextThemeProvider
      enableSystem={false}
      defaultTheme="dark"
      attribute="class"
      disableTransitionOnChange={false}
      storageKey="theme"
    >
      {children}
    </NextThemeProvider>
  );
};

export default ThemeProvider;
