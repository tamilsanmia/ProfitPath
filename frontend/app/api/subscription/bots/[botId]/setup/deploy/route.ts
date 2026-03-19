import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { fetchBackend } from "@/lib/backend-api";

export const runtime = "nodejs";

type SessionUser = {
  email?: string;
};

type Params = {
  params: Promise<{ botId: string }>;
};

type DeployBody = {
  strategyName?: string;
  strategyCode?: string;
  configOverride?: Record<string, unknown>;
  dryRun?: boolean | null;
  apiKey?: string;
  apiSecret?: string;
};

export async function POST(request: Request, { params }: Params) {
  const { botId } = await params;

  const cookieStore = await cookies();
  const rawUser = cookieStore.get("pp_user")?.value;
  const sessionToken = cookieStore.get("pp_session")?.value;

  if (!rawUser || !sessionToken) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  let email = "";
  try {
    const user = JSON.parse(rawUser) as SessionUser;
    email = String(user?.email ?? "").trim().toLowerCase();
  } catch {
    return NextResponse.json({ error: "Invalid user session" }, { status: 400 });
  }

  if (!email) {
    return NextResponse.json({ error: "Session email missing" }, { status: 400 });
  }

  let body: DeployBody = {};
  try {
    body = (await request.json()) as DeployBody;
  } catch {
    body = {};
  }

  try {
    const dryRun = typeof body.dryRun === "boolean" ? body.dryRun : null;
    const apiKey = String(body.apiKey ?? "").trim();
    const apiSecret = String(body.apiSecret ?? "").trim();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 300000); // 300 seconds

    try {
      const response = await fetchBackend(`/subscriptions/${encodeURIComponent(botId)}/setup/deploy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          session_token: sessionToken,
          strategy_name: String(body.strategyName ?? "SampleStrategy"),
          strategy_code: typeof body.strategyCode === "string" ? body.strategyCode : null,
          config_override: body.configOverride ?? null,
          dry_run: dryRun,
          api_key: apiKey || null,
          api_secret: apiSecret || null,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);


      const raw = await response.text();
      let payload: Record<string, unknown>;
      try {
        payload = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      } catch {
        payload = { error: raw || "Backend returned a non-JSON response" };
      }

      if (!response.ok) {
        const detail = String(payload.detail ?? payload.error ?? payload.message ?? "Bot deployment failed");
        return NextResponse.json({ error: detail, detail }, { status: response.status });
      }

      return NextResponse.json(payload, { status: response.status });
    } catch (err) {
      clearTimeout(timeoutId);
      const message = err instanceof Error ? err.message : "Failed to deploy bot";
      if (message.includes("abort")) {
        return NextResponse.json({ error: "Request timeout (300s)" }, { status: 504 });
      }
      return NextResponse.json({ error: message }, { status: 500 });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Request failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
