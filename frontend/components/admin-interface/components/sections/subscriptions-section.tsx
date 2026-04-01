"use client";

import type React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SettingsSection } from "@/components/settings-interface/components/shared/settings-section";
import type { AdminPortalSettings } from "../../types";

interface SubscriptionsSectionProps {
  value: AdminPortalSettings["subscriptions"];
  onChange: (updates: Partial<AdminPortalSettings["subscriptions"]>) => void;
}

export const SubscriptionsSection: React.FC<SubscriptionsSectionProps> = ({ value, onChange }) => {
  return (
    <SettingsSection title="Subscriptions" description="Pricing, plan behavior, and lifecycle defaults">
      {/* Pricing */}
      <div className="space-y-3">
        <Label className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Pricing</Label>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="monthly-fee">Monthly Server Fee (USD)</Label>
            <Input id="monthly-fee" type="number" min={0} step={0.01} value={value.monthlyServerFee} onChange={(e) => onChange({ monthlyServerFee: Number(e.target.value || 0) })} />
            <p className="text-xs text-muted-foreground">Recurring monthly fee charged per bot</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="setup-charge">Setup Charge (USD)</Label>
            <Input id="setup-charge" type="number" min={0} step={0.01} value={value.setupCharge} onChange={(e) => onChange({ setupCharge: Number(e.target.value || 0) })} />
            <p className="text-xs text-muted-foreground">One-time fee charged when a new bot is created</p>
          </div>
        </div>
      </div>

      {/* Lifecycle */}
      <div className="space-y-3 pt-4 border-t border-border/30">
        <Label className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Lifecycle</Label>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2"><Label htmlFor="trial-days">Trial Days</Label><Input id="trial-days" type="number" value={value.trialDays} onChange={(e) => onChange({ trialDays: Number(e.target.value || 0) })} /></div>
          <div className="space-y-2"><Label htmlFor="grace-days">Grace Period Days</Label><Input id="grace-days" type="number" value={value.gracePeriodDays} onChange={(e) => onChange({ gracePeriodDays: Number(e.target.value || 0) })} /></div>
          <div className="space-y-2"><Label htmlFor="default-plan">Default Plan</Label><Input id="default-plan" value={value.defaultPlan} onChange={(e) => onChange({ defaultPlan: e.target.value })} /></div>
          <div className="space-y-2"></div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <p className="text-sm font-medium">Allow Downgrade</p>
              <p className="text-xs text-muted-foreground">Allow users to downgrade plans instantly.</p>
            </div>
            <Switch checked={value.allowDowngrade} onCheckedChange={(checked) => onChange({ allowDowngrade: checked })} />
          </div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <p className="text-sm font-medium">Auto-renew by Default</p>
              <p className="text-xs text-muted-foreground">New subscriptions start with auto-renew enabled.</p>
            </div>
            <Switch checked={value.autoRenewDefault} onCheckedChange={(checked) => onChange({ autoRenewDefault: checked })} />
          </div>
        </div>
      </div>
    </SettingsSection>
  );
};
