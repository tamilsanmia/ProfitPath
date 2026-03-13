import { NextResponse } from "next/server";
import { fetchBackend } from "@/lib/backend-api";

export const runtime = "nodejs";

export async function GET() {
  try {
    const res = await fetchBackend("/api/bots", { cache: "no-store" });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to list bots";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
