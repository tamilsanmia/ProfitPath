"use client";

import type React from "react";
import { toast } from "sonner";
import { AppearanceTab } from "./components/appearance/appearance-tab";
import { ConnectionsTab } from "./components/connections/connections-tab";
import { ProfileTab } from "./components/profile/profile-tab";
import { SecurityTab } from "./components/security/security-tab";
import { SettingsSidebar } from "./components/settings-sidebar";
import { SaveButton } from "./components/shared/save-button";
import { useSettings } from "@/components/settings-interface/hooks/use-settings";
import { createSettingsTranslator } from "@/components/settings-interface/i18n";

export const SettingsInterface: React.FC = () => {
  const {
    settings,
    isLoading,
    isSaving,
    updateProfile,
    updateSecurity,
    updateAppearance,
    persistConnections,
    updateSessions,
    updateLoginHistory,
    setActiveTab,
    saveSettings,
    resetSettings,
  } = useSettings();

  const t = createSettingsTranslator(settings.appearance.language);

  const handleSave = async () => {
    const result = await saveSettings();
    if (result.success) {
      toast.success(t("settings.saveSuccess"));
    } else {
      toast.error(result.error || t("settings.saveFailed"));
    }
  };

  const renderActiveTab = () => {
    switch (settings.activeTab) {
      case "profile":
        return (
          <ProfileTab
            profile={settings.profile}
            onProfileChange={updateProfile}
            language={settings.appearance.language}
          />
        );

      case "security":
        return (
          <SecurityTab
            security={settings.security}
            sessions={settings.sessions}
            loginHistory={settings.loginHistory}
            onSecurityChange={updateSecurity}
            onSessionsChange={updateSessions}
            onLoginHistoryChange={updateLoginHistory}
            language={settings.appearance.language}
          />
        );

      case "appearance":
        return <AppearanceTab appearance={settings.appearance} onAppearanceChange={updateAppearance} />;

      case "connections":
        return (
          <ConnectionsTab
            connections={settings.connections}
            onConnectionsPersist={persistConnections}
            language={settings.appearance.language}
          />
        );

      default:
        return (
          <div className="flex items-center justify-center h-64">
            <div className="text-center space-y-2">
              <h3 className="text-lg font-medium">{t("settings.tabTitle")}</h3>
              <p className="text-muted-foreground">{t("settings.selectCategory")}</p>
            </div>
          </div>
        );
    }
  };

  if (isLoading) {
    return (
      <div data-name="settings-loading" className="flex items-center justify-center h-64">
        <div data-name="settings-loading-content" className="text-center space-y-2">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
          <p className="text-muted-foreground">{t("settings.loading")}</p>
        </div>
      </div>
    );
  }

  return (
    <div data-name="settings-interface" className="flex max-md:flex-col h-screen bg-background w-full">
      <SettingsSidebar
        activeTab={settings.activeTab}
        onTabChange={setActiveTab}
        hasUnsavedChanges={settings.hasUnsavedChanges}
        language={settings.appearance.language}
      />

      <div data-name="settings-main-content" className="flex-1 flex flex-col">
        <div data-name="settings-tab-panel" className="flex-1 overflow-auto">
          <div data-name="settings-tab-content" className="p-6">{renderActiveTab()}</div>
        </div>

        {settings.hasUnsavedChanges && (
          <div data-name="settings-unsaved-bar" className="border-t bg-background p-4">
            <div data-name="settings-unsaved-actions" className="flex items-center justify-between gap-3 flex-wrap">
              <p className="text-sm text-muted-foreground">{t("settings.unsaved")}</p>
              <div className="flex space-x-2">
                <SaveButton
                  onSave={handleSave}
                  isSaving={isSaving}
                  hasUnsavedChanges={settings.hasUnsavedChanges}
                  saveLabel={t("settings.save")}
                  savingLabel={t("settings.saving")}
                />
                <button onClick={resetSettings} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground">
                  {t("settings.discard")}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
