"use client";
import React from "react";
import { AnnouncementBanner } from "./announcement-banner";
import { DashboardSidebar } from "./dashboardSidebar";

const DashboardSidebarTopbar = ({ children }: { children: React.ReactNode }) => {
  const collapsed = true;

  return (
    <div className=" h-screen w-full bg-background relative">
      <DashboardSidebar collapsed={collapsed} />

      <div className="duration-300 translate-x-[72px] max-w-[calc(100%-72px)]">
        <AnnouncementBanner />
        <main className="p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
};

export default DashboardSidebarTopbar;
