"use client";

import type React from "react";
import { AdminImageUpload } from "../admin-image-upload";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SettingsSection } from "@/components/settings-interface/components/shared/settings-section";
import type { AdminPortalSettings } from "../../types";

interface GeneralSectionProps {
  value: AdminPortalSettings["general"];
  onChange: (updates: Partial<AdminPortalSettings["general"]>) => void;
}

export const GeneralSection: React.FC<GeneralSectionProps> = ({ value, onChange }) => {
  return (
    <SettingsSection title="General" description="Global branding and high-level site controls">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="site-title">Site Title</Label>
          <Input id="site-title" value={value.siteTitle} onChange={(e) => onChange({ siteTitle: e.target.value })} placeholder="SnowSig" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="site-tagline">Tagline</Label>
          <Input id="site-tagline" value={value.tagline} onChange={(e) => onChange({ tagline: e.target.value })} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="company-name">Company Name</Label>
          <Input id="company-name" value={value.companyName} onChange={(e) => onChange({ companyName: e.target.value })} placeholder="SnowSig Technologies" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="company-main-domain">Company Main Domain</Label>
          <Input id="company-main-domain" value={value.companyMainDomain} onChange={(e) => onChange({ companyMainDomain: e.target.value })} placeholder="https://snowsig.com/" />
        </div>
        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="allowed-file-types">Allowed file types</Label>
          <Input
            id="allowed-file-types"
            value={value.allowedFileTypes}
            onChange={(e) => onChange({ allowedFileTypes: e.target.value })}
            placeholder=".png, .jpg, .jpeg, .svg, .webp, .ico"
          />
          <p className="text-xs text-muted-foreground">These extensions are shown in the branding uploader hints.</p>
        </div>
        <div className="md:col-span-2 grid gap-4 xl:grid-cols-3">
          <AdminImageUpload
            id="company-logo-light"
            label="Company Logo Light"
            value={value.companyLogoLightUrl}
            onChange={(nextValue) => onChange({ companyLogoLightUrl: nextValue })}
            placeholder="https://cdn.example.com/logo-light.svg"
            allowedFileTypes={value.allowedFileTypes}
            helperText="Used on light surfaces and when a bright logo is needed."
          />
          <AdminImageUpload
            id="company-logo-dark"
            label="Company Logo Dark"
            value={value.companyLogoDarkUrl}
            onChange={(nextValue) => onChange({ companyLogoDarkUrl: nextValue })}
            placeholder="https://cdn.example.com/logo-dark.svg"
            allowedFileTypes={value.allowedFileTypes}
            helperText="Used on dark surfaces, including the dashboard sidebar in dark theme."
          />
          <AdminImageUpload
            id="company-favicon"
            label="Favicon"
            value={value.faviconUrl}
            onChange={(nextValue) => onChange({ faviconUrl: nextValue })}
            placeholder="https://cdn.example.com/favicon.ico"
            allowedFileTypes={value.allowedFileTypes}
            helperText="Recommended square icon for browser tabs and bookmarks."
          />
        </div>
      </div>
    </SettingsSection>
  );
};
