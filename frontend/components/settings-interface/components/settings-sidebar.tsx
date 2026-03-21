"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import * as Icons from "lucide-react";
import type React from "react";
import { SETTINGS_TABS } from "../constants";
import { createSettingsTranslator } from "../i18n";

interface SettingsSidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  hasUnsavedChanges: boolean;
  language: string;
  isAdmin: boolean;
}

export const SettingsSidebar: React.FC<SettingsSidebarProps> = ({ activeTab, onTabChange, hasUnsavedChanges, language, isAdmin }) => {
  const t = createSettingsTranslator(language);
  const visibleTabs = SETTINGS_TABS.filter((tab) => tab.id !== "admin" || isAdmin);

  return (
    <div className="md:w-64 md:border-r bg-muted/10">
      <div className="p-4">
        <h2 className="text-lg font-semibold">{t("settings.title")}</h2>
        {hasUnsavedChanges && <p className="text-sm text-orange-600 mt-1">{t("settings.unsaved")}</p>}
      </div>
      <div className="h-[calc(100vh-8rem)]">
        <div className="p-2 space-y-1">
          {visibleTabs.map((tab) => {
            const IconComponent = Icons[tab.icon as keyof typeof Icons] as React.ComponentType<{ className?: string }>;
            const labelKey = `tab.${tab.id}.label` as const;
            const descriptionKey = `tab.${tab.id}.description` as const;

            return (
              <Button
                key={tab.id}
                variant={activeTab === tab.id ? "secondary" : "ghost"}
                className={cn("w-full justify-start text-left h-auto p-3", activeTab === tab.id && "bg-secondary")}
                onClick={() => onTabChange(tab.id)}
              >
                <div className="flex items-start space-x-3">
                  <IconComponent className="h-5 w-5 mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium">{t(labelKey)}</div>
                    <div className="text-xs text-muted-foreground mt-1 whitespace-normal line-clamp-2">{t(descriptionKey)}</div>
                  </div>
                </div>
              </Button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
