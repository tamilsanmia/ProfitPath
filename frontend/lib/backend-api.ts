const DEFAULT_BACKEND_URL = "http://localhost:8000";

export function getBackendUrl(): string {
  return process.env.BACKEND_URL ?? DEFAULT_BACKEND_URL;
}

export async function fetchBackend(path: string, init?: RequestInit): Promise<Response> {
  const backendUrl = getBackendUrl();
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = `${backendUrl}${normalizedPath}`;

  return fetch(url, init);
}
