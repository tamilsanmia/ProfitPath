"use client";

import type React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { SettingsSection } from "@/components/settings-interface/components/shared/settings-section";
import type { AdminPortalSettings } from "../../types";

interface InvoicesSectionProps {
  value: AdminPortalSettings["invoices"];
  onChange: (updates: Partial<AdminPortalSettings["invoices"]>) => void;
}

export const InvoicesSection: React.FC<InvoicesSectionProps> = ({ value, onChange }) => {
  return (
    <SettingsSection title="Invoices" description="Invoice numbering and billing document defaults">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2"><Label htmlFor="invoice-prefix">Invoice Prefix</Label><Input id="invoice-prefix" value={value.prefix} onChange={(e) => onChange({ prefix: e.target.value })} /></div>
        <div className="space-y-2"><Label htmlFor="next-number">Next Invoice Number</Label><Input id="next-number" type="number" value={value.nextNumber} onChange={(e) => onChange({ nextNumber: Number(e.target.value || 0) })} /></div>
        <div className="space-y-2"><Label htmlFor="vat-rate">VAT Rate (%)</Label><Input id="vat-rate" type="number" step="0.01" value={value.vatRate} onChange={(e) => onChange({ vatRate: Number(e.target.value || 0) })} /></div>
        <div className="flex items-center justify-between rounded-md border p-3">
          <div>
            <p className="text-sm font-medium">Auto Send Invoices</p>
            <p className="text-xs text-muted-foreground">Automatically email invoice PDFs after payment.</p>
          </div>
          <Switch checked={value.autoSendInvoices} onCheckedChange={(checked) => onChange({ autoSendInvoices: checked })} />
        </div>
        <div className="md:col-span-2 space-y-2"><Label htmlFor="invoice-footer">Invoice Footer</Label><Textarea id="invoice-footer" value={value.invoiceFooter} onChange={(e) => onChange({ invoiceFooter: e.target.value })} rows={3} /></div>
      </div>
    </SettingsSection>
  );
};
