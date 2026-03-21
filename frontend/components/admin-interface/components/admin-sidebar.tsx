"use client";

import type React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import * as Icons from "lucide-react";
import type { AdminSection } from "../types";

interface AdminSidebarProps {
  sections: AdminSection[];
  activeSection: AdminSection["id"];
  onSectionChange: (id: AdminSection["id"]) => void;
}

export const AdminSidebar: React.FC<AdminSidebarProps> = ({ sections, activeSection, onSectionChange }) => {
  return (
    <div className="md:w-64 md:border-r bg-muted/10">
      <div className="p-4">
        <h2 className="text-lg font-semibold">Admin</h2>
        <p className="text-sm text-muted-foreground">Site management</p>
      </div>
      <div className="h-[calc(100vh-8rem)] overflow-auto p-2 space-y-1">
        {sections.map((section) => {
          const IconComponent = Icons[section.icon as keyof typeof Icons] as React.ComponentType<{ className?: string }>;

          return (
            <Button
              key={section.id}
              variant={activeSection === section.id ? "secondary" : "ghost"}
              className={cn("h-auto w-full justify-start p-3 text-left", activeSection === section.id && "bg-secondary")}
              onClick={() => onSectionChange(section.id)}
            >
              <div className="flex items-start space-x-3">
                <IconComponent className="h-5 w-5 mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium whitespace-normal leading-snug">{section.label}</div>
                  <div className="text-xs text-muted-foreground mt-1 whitespace-normal line-clamp-2">{section.description}</div>
                </div>
              </div>
            </Button>
          );
        })}
      </div>
    </div>
  );
};
