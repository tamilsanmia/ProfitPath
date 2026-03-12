import { NextResponse } from "next/server";
import { fetchBackend } from "@/lib/backend-api";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const response = await fetchBackend("/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const responsePayload = await response.json();

    if (!response.ok) {
      const backendError = responsePayload?.detail ?? responsePayload?.error ?? "Failed to process forgot password request.";
      return NextResponse.json({ error: backendError }, { status: response.status });
    }

    return NextResponse.json(responsePayload, { status: response.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to process forgot password request.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
