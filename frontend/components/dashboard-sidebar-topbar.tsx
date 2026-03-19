"use client";
import React from "react";
import { AnnouncementBanner } from "./announcement-banner";
import { DashboardSidebar } from "./dashboardSidebar";

const DashboardSidebarTopbar = ({ children }: { children: React.ReactNode }) => {
  const collapsed = true;

  return (
    <div data-name="dashboard-shell" className=" h-screen w-full bg-background relative">
      <DashboardSidebar collapsed={collapsed} />

      <div data-name="dashboard-main-area" className="duration-300 translate-x-[72px] max-w-[calc(100%-72px)]">
        <AnnouncementBanner />
        <main data-name="dashboard-content">{children}</main>
      </div>
    </div>
  );
};

export default DashboardSidebarTopbar;
