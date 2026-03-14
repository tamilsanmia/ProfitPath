import { NextResponse } from "next/server";
import { fetchBackend } from "@/lib/backend-api";

export const runtime = "nodejs";

function extractFilename(raw: string): string {
  const value = String(raw || "").trim();
  if (!value) return "";

  const marker = "/media/profile-pictures/";
  if (value.includes(marker)) {
    const after = value.split(marker, 2)[1] || "";
    return after.split("/")[0].split("?")[0].trim();
  }

  return value.split("/")[0].split("?")[0].trim();
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const raw = url.searchParams.get("file") || "";
  const filename = extractFilename(raw);

  if (!filename || filename.includes("..")) {
    return NextResponse.json({ error: "Invalid avatar file" }, { status: 400 });
  }

  try {
    const backendResponse = await fetchBackend(`/media/profile-pictures/${encodeURIComponent(filename)}`, {
      method: "GET",
      cache: "no-store",
    });

    if (!backendResponse.ok) {
      return NextResponse.json({ error: "Avatar not found" }, { status: backendResponse.status });
    }

    const contentType = backendResponse.headers.get("content-type") || "image/png";
    const bytes = await backendResponse.arrayBuffer();

    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "Failed to load avatar" }, { status: 500 });
  }
}
