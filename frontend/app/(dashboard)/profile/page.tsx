import { cookies } from "next/headers";

type SessionUser = {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  phone?: string | null;
  country?: string | null;
  created_at?: string;
};

export const metadata = {
  title: "Profile | DefibotX",
  description: "Your account profile details",
};

export default async function ProfilePage() {
  const cookieStore = await cookies();
  const rawUser = cookieStore.get("pp_user")?.value;

  let user: SessionUser | null = null;
  try {
    user = rawUser ? (JSON.parse(rawUser) as SessionUser) : null;
  } catch {
    user = null;
  }

  return (
    <div data-name="page-dashboard-profile" className="space-y-4">
      <div data-name="profile-header">
        <h1 className="text-2xl font-semibold">Profile</h1>
        <p className="text-muted-foreground">View your current logged-in account details.</p>
      </div>

      <div data-name="profile-details-card" className="rounded-md border p-4">
        {user ? (
          <dl data-name="profile-details-grid" className="grid gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-foreground">First Name</dt>
              <dd className="text-sm font-medium">{user.first_name}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Last Name</dt>
              <dd className="text-sm font-medium">{user.last_name}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Email</dt>
              <dd className="text-sm font-medium">{user.email}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Country</dt>
              <dd className="text-sm font-medium">{user.country || "-"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Phone</dt>
              <dd className="text-sm font-medium">{user.phone || "-"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Member Since</dt>
              <dd className="text-sm font-medium">{user.created_at ? new Date(user.created_at).toLocaleDateString() : "-"}</dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">No active profile data found. Please sign in again.</p>
        )}
      </div>
    </div>
  );
}
