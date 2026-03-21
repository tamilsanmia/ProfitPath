"use client";

import type React from "react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { SettingsSection } from "@/components/settings-interface/components/shared/settings-section";
import type { AdminPortalSettings } from "../../types";

interface PaymentGatewaysSectionProps {
  value: AdminPortalSettings["paymentGateways"];
  onChange: (updates: Partial<AdminPortalSettings["paymentGateways"]>) => void;
}

export const PaymentGatewaysSection: React.FC<PaymentGatewaysSectionProps> = ({ value, onChange }) => {
  return (
    <SettingsSection title="Payment Gateways" description="Gateway availability and routing preferences">
      <div className="space-y-4">
        <div className="max-w-sm space-y-2">
          <Label>Default Gateway</Label>
          <Select value={value.defaultGateway} onValueChange={(next) => onChange({ defaultGateway: next })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="stripe">Stripe</SelectItem>
              <SelectItem value="paypal">PayPal</SelectItem>
              <SelectItem value="razorpay">Razorpay</SelectItem>
              <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="flex items-center justify-between rounded-md border p-3"><span className="text-sm">Stripe</span><Switch checked={value.stripeEnabled} onCheckedChange={(checked) => onChange({ stripeEnabled: checked })} /></div>
          <div className="flex items-center justify-between rounded-md border p-3"><span className="text-sm">PayPal</span><Switch checked={value.paypalEnabled} onCheckedChange={(checked) => onChange({ paypalEnabled: checked })} /></div>
          <div className="flex items-center justify-between rounded-md border p-3"><span className="text-sm">Razorpay</span><Switch checked={value.razorpayEnabled} onCheckedChange={(checked) => onChange({ razorpayEnabled: checked })} /></div>
          <div className="flex items-center justify-between rounded-md border p-3"><span className="text-sm">Bank Transfer</span><Switch checked={value.bankTransferEnabled} onCheckedChange={(checked) => onChange({ bankTransferEnabled: checked })} /></div>
        </div>
      </div>
    </SettingsSection>
  );
};
