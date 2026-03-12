export type BrowserLogEntry = {
  event: string;
  details?: string;
  timestamp: string;
};

const STORAGE_KEY = "pp_browser_logs";

export function addBrowserLog(event: string, details?: string): void {
  if (typeof window === "undefined") {
    return;
  }

  const entry: BrowserLogEntry = {
    event,
    details,
    timestamp: new Date().toISOString(),
  };

  try {
    const existing = window.localStorage.getItem(STORAGE_KEY);
    const parsed: BrowserLogEntry[] = existing ? JSON.parse(existing) : [];
    parsed.unshift(entry);
    const trimmed = parsed.slice(0, 200);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // Ignore localStorage failures silently.
  }
}
