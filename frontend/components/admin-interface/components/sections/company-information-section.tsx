"use client";

import type React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AdminPortalSettings } from "../../types";

interface CompanyInformationSectionProps {
  value: AdminPortalSettings["companyInformation"];
  onChange: (updates: Partial<AdminPortalSettings["companyInformation"]>) => void;
}

const TEMPLATE_VARIABLES = [
  "{company_name}",
  "{address}",
  "{city}",
  "{state}",
  "{zip_code}",
  "{country_code}",
  "{phone}",
  "{vat_number}",
  "{vat_number_with_label}",
];

export const CompanyInformationSection: React.FC<CompanyInformationSectionProps> = ({ value, onChange }) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Company Information</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300">
          These information will be displayed on invoices/estimates/payments and other PDF documents where company info is required
        </div>

        <div className="space-y-2">
          <Label htmlFor="ci-company-name">Company Name</Label>
          <Input id="ci-company-name" value={value.companyName} onChange={(e) => onChange({ companyName: e.target.value })} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="ci-address">Address</Label>
          <Input id="ci-address" value={value.address} onChange={(e) => onChange({ address: e.target.value })} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="ci-city">City</Label>
          <Input id="ci-city" value={value.city} onChange={(e) => onChange({ city: e.target.value })} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="ci-state">State</Label>
          <Input id="ci-state" value={value.state} onChange={(e) => onChange({ state: e.target.value })} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="ci-country-code">Country Code</Label>
          <Input id="ci-country-code" value={value.countryCode} onChange={(e) => onChange({ countryCode: e.target.value })} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="ci-zip-code">Zip Code</Label>
          <Input id="ci-zip-code" value={value.zipCode} onChange={(e) => onChange({ zipCode: e.target.value })} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="ci-phone">Phone</Label>
          <Input id="ci-phone" value={value.phone} onChange={(e) => onChange({ phone: e.target.value })} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="ci-vat-number">VAT Number</Label>
          <Input id="ci-vat-number" value={value.vatNumber} onChange={(e) => onChange({ vatNumber: e.target.value })} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="ci-format">Company Information Format (PDF and HTML)</Label>
          <Textarea
            id="ci-format"
            rows={6}
            value={value.companyInfoFormat}
            onChange={(e) => onChange({ companyInfoFormat: e.target.value })}
          />
          <div className="flex flex-wrap gap-x-2 gap-y-1 text-xs text-blue-500">
            {TEMPLATE_VARIABLES.map((v) => (
              <span key={v}>{v}</span>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
