import { NextResponse } from "next/server";
import { fetchBackend } from "@/lib/backend-api";

export const runtime = "nodejs";

export async function GET() {
  try {
    const response = await fetchBackend("/health", { cache: "no-store" });
    const payload = await response.json();
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch backend health.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
