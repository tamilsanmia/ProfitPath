"use client";

import type React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SettingsSection } from "@/components/settings-interface/components/shared/settings-section";
import type { AdminPortalSettings } from "../../types";

interface SystemServerInformationSectionProps {
  value: AdminPortalSettings["systemServerInformation"];
  onChange: (updates: Partial<AdminPortalSettings["systemServerInformation"]>) => void;
}

export const SystemServerInformationSection: React.FC<SystemServerInformationSectionProps> = ({ value, onChange }) => {
  return (
    <SettingsSection title="System/Server Information" description="Operational server metadata and runtime controls">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2"><Label htmlFor="environment">Environment</Label><Input id="environment" value={value.environment} onChange={(e) => onChange({ environment: e.target.value })} /></div>
        <div className="space-y-2"><Label htmlFor="region">Region</Label><Input id="region" value={value.region} onChange={(e) => onChange({ region: e.target.value })} /></div>
        <div className="space-y-2"><Label htmlFor="app-version">App Version</Label><Input id="app-version" value={value.appVersion} onChange={(e) => onChange({ appVersion: e.target.value })} /></div>
        <div className="space-y-2"><Label htmlFor="maintenance-window">Maintenance Window</Label><Input id="maintenance-window" value={value.maintenanceWindow} onChange={(e) => onChange({ maintenanceWindow: e.target.value })} /></div>
        <div className="md:col-span-2 flex items-center justify-between rounded-md border p-3">
          <div>
            <p className="text-sm font-medium">Read-only API</p>
            <p className="text-xs text-muted-foreground">Disable write operations for maintenance or incidents.</p>
          </div>
          <Switch checked={value.readOnlyApi} onCheckedChange={(checked) => onChange({ readOnlyApi: checked })} />
        </div>
      </div>
    </SettingsSection>
  );
};
