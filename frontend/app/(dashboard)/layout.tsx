import "@/app/globals.css";
import DashboardSidebarTopbar from "@/components/dashboard-sidebar-topbar";
import type React from "react";

export default function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <section data-name="layout-dashboard-route">
      <DashboardSidebarTopbar>{children}</DashboardSidebarTopbar>
    </section>
  );
}
