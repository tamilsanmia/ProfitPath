import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { fetchBackend } from "@/lib/backend-api";

export const runtime = "nodejs";

type SessionUser = { email?: string };

async function getSessionEmail(): Promise<string | null> {
  const cookieStore = await cookies();
  const rawUser = cookieStore.get("pp_user")?.value;
  if (!rawUser) {
    return null;
  }

  try {
    const user = JSON.parse(rawUser) as SessionUser;
    return user?.email ?? null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const email = await getSessionEmail();
  if (!email) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  try {
    const incoming = await request.formData();
    const fileEntry = incoming.get("file");
    if (!(fileEntry instanceof File) && !(fileEntry instanceof Blob)) {
      return NextResponse.json({ error: "No image selected" }, { status: 400 });
    }

    const file =
      fileEntry instanceof File
        ? fileEntry
        : new File([fileEntry], "avatar-upload", {
            type: fileEntry.type || "application/octet-stream",
          });

    const form = new FormData();
    form.append("email", email);
    form.append("file", file);

    const response = await fetchBackend("/profile/avatar", {
      method: "POST",
      body: form,
    });

    const payload = await response.json();
    if (!response.ok) {
      return NextResponse.json({ error: payload?.detail ?? "Failed to upload avatar" }, { status: response.status });
    }

    const avatarUrl = String(payload?.avatar_url ?? "");
    const responseOut = NextResponse.json({ avatarUrl }, { status: 200 });
    const cookieStore = await cookies();
    const rawUser = cookieStore.get("pp_user")?.value;
    if (rawUser) {
      try {
        const parsedUser = JSON.parse(rawUser) as Record<string, unknown>;
        parsedUser.avatar = avatarUrl;
        responseOut.cookies.set("pp_user", JSON.stringify(parsedUser), {
          httpOnly: true,
          sameSite: "lax",
          secure: process.env.NODE_ENV === "production",
          path: "/",
          maxAge: 60 * 60 * 24 * 7,
        });
      } catch {
        // Ignore malformed cookie payload.
      }
    }

    return responseOut;
  } catch {
    return NextResponse.json({ error: "Failed to upload avatar" }, { status: 500 });
  }
}

export async function DELETE() {
  const email = await getSessionEmail();
  if (!email) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  try {
    const response = await fetchBackend("/profile/avatar", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });

    const payload = await response.json();
    if (!response.ok) {
      return NextResponse.json({ error: payload?.detail ?? "Failed to remove avatar" }, { status: response.status });
    }

    const avatarUrl = String(payload?.avatar_url ?? "");
    const responseOut = NextResponse.json({ avatarUrl }, { status: 200 });
    const cookieStore = await cookies();
    const rawUser = cookieStore.get("pp_user")?.value;
    if (rawUser) {
      try {
        const parsedUser = JSON.parse(rawUser) as Record<string, unknown>;
        parsedUser.avatar = avatarUrl;
        responseOut.cookies.set("pp_user", JSON.stringify(parsedUser), {
          httpOnly: true,
          sameSite: "lax",
          secure: process.env.NODE_ENV === "production",
          path: "/",
          maxAge: 60 * 60 * 24 * 7,
        });
      } catch {
        // Ignore malformed cookie payload.
      }
    }

    return responseOut;
  } catch {
    return NextResponse.json({ error: "Failed to remove avatar" }, { status: 500 });
  }
}
