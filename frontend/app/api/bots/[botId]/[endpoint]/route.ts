import { NextResponse, type NextRequest } from "next/server";
import { fetchBackend } from "@/lib/backend-api";

export const runtime = "nodejs";

type Params = { params: Promise<{ botId: string }> };

async function proxy(botId: string, path: string, options?: { searchParams?: URLSearchParams; method?: string; body?: unknown }) {
  const method = options?.method ?? "GET";
  const body = options?.body;
  const searchParams = options?.searchParams;
  const qs = searchParams?.toString() ? `?${searchParams.toString()}` : "";
  const res = await fetchBackend(`/api/bots/${botId}/${path}${qs}`, {
    cache: "no-store",
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data: unknown = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  return NextResponse.json(data, { status: res.status });
}

// GET /api/bots/[botId]/stats
export async function GET(req: NextRequest, { params }: Params) {
  try {
    const { botId } = await params;
    const path = req.nextUrl.pathname.split(`/api/bots/${botId}/`)[1] ?? "stats";
    return proxy(botId, path, { searchParams: req.nextUrl.searchParams });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Bot API error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { botId } = await params;
    const path = req.nextUrl.pathname.split(`/api/bots/${botId}/`)[1] ?? "stats";
    const body = await req.json().catch(() => undefined);
    return proxy(botId, path, { method: "POST", body });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Bot API error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
