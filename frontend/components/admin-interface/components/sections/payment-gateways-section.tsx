"use client";

import type React from "react";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SettingsSection } from "@/components/settings-interface/components/shared/settings-section";
import type { AdminPortalSettings } from "../../types";

interface PaymentGatewaysSectionProps {
  value: AdminPortalSettings["paymentGateways"];
  onChange: (updates: Partial<AdminPortalSettings["paymentGateways"]>) => void;
}

export const PaymentGatewaysSection: React.FC<PaymentGatewaysSectionProps> = ({ value, onChange }) => {
  const [showApiKey, setShowApiKey] = useState(false);
  const [showPublicKey, setShowPublicKey] = useState(false);
  const [showIpnSecret, setShowIpnSecret] = useState(false);

  return (
    <SettingsSection title="Payment Gateways" description="Configure NOWPayments crypto payment gateway">
      <div className="space-y-6">
        {/* Enable toggle */}
        <div className="flex items-center justify-between rounded-md border p-4">
          <div className="space-y-0.5">
            <span className="text-sm font-medium">NOWPayments</span>
            <p className="text-xs text-muted-foreground">Accept crypto payments via NOWPayments</p>
          </div>
          <Switch
            checked={value.nowpaymentsEnabled}
            onCheckedChange={(checked) => onChange({ nowpaymentsEnabled: checked })}
          />
        </div>

        {value.nowpaymentsEnabled && (
          <div className="space-y-4 rounded-md border p-4">
            {/* API Key */}
            <div className="space-y-2">
              <Label htmlFor="np-api-key">API Key</Label>
              <div className="relative">
                <Input
                  id="np-api-key"
                  type={showApiKey ? "text" : "password"}
                  placeholder="Enter your NOWPayments API key"
                  value={value.nowpaymentsApiKey}
                  onChange={(e) => onChange({ nowpaymentsApiKey: e.target.value })}
                  className="pr-16"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground"
                >
                  {showApiKey ? "Hide" : "Show"}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                Found in your NOWPayments dashboard under Store Settings &gt; API Keys.
              </p>
            </div>

            {/* Public Key */}
            <div className="space-y-2">
              <Label htmlFor="np-public-key">Public Key</Label>
              <div className="relative">
                <Input
                  id="np-public-key"
                  type={showPublicKey ? "text" : "password"}
                  placeholder="Enter your NOWPayments public key"
                  value={value.nowpaymentsPublicKey}
                  onChange={(e) => onChange({ nowpaymentsPublicKey: e.target.value })}
                  className="pr-16"
                />
                <button
                  type="button"
                  onClick={() => setShowPublicKey((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground"
                >
                  {showPublicKey ? "Hide" : "Show"}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                Found in your NOWPayments dashboard under Store Settings &gt; API Keys.
              </p>
            </div>

            {/* IPN Secret */}
            <div className="space-y-2">
              <Label htmlFor="np-ipn-secret">IPN Secret Key</Label>
              <div className="relative">
                <Input
                  id="np-ipn-secret"
                  type={showIpnSecret ? "text" : "password"}
                  placeholder="Enter your IPN secret key"
                  value={value.nowpaymentsIpnSecret}
                  onChange={(e) => onChange({ nowpaymentsIpnSecret: e.target.value })}
                  className="pr-16"
                />
                <button
                  type="button"
                  onClick={() => setShowIpnSecret((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground"
                >
                  {showIpnSecret ? "Hide" : "Show"}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                Used to verify IPN webhook callbacks. Found under Store Settings &gt; IPN.
              </p>
            </div>

            {/* Sandbox toggle */}
            <div className="flex items-center justify-between rounded-md border p-3">
              <div className="space-y-0.5">
                <span className="text-sm">Sandbox Mode</span>
                <p className="text-xs text-muted-foreground">Use NOWPayments sandbox for testing</p>
              </div>
              <Switch
                checked={value.nowpaymentsSandbox}
                onCheckedChange={(checked) => onChange({ nowpaymentsSandbox: checked })}
              />
            </div>
          </div>
        )}
      </div>
    </SettingsSection>
  );
};
