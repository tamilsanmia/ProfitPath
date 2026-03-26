import { AdminInterface } from "@/components/admin-interface";

export const metadata = {
  title: "Admin | BotPrimeX",
  description: "Admin site management",
};

export default function AdminPage() {
  return (
    <section data-name="page-dashboard-admin">
      <AdminInterface />
    </section>
  );
}
