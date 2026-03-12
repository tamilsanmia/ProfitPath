import { redirect } from "next/navigation";

type InvitePageProps = {
  params: Promise<{
    username: string;
  }>;
};

export default async function InviteUsernamePage({ params }: InvitePageProps) {
  const resolved = await params;
  const ref = encodeURIComponent(resolved.username ?? "");
  redirect(`/signup?ref=${ref}`);
}
