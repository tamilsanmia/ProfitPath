"use client";

import { useState, type ReactNode } from "react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { SaveButton } from "@/components/settings-interface/components/shared/save-button";
import { ADMIN_SECTIONS } from "./data";
import { useAdminSettings } from "./hooks/use-admin-settings";
import { AdminSidebar } from "./components/admin-sidebar";
import { GeneralSection } from "./components/sections/general-section";
import { CompanyInformationSection } from "./components/sections/company-information-section";
import { LocalizationSection } from "./components/sections/localization-section";
import { EmailSection } from "./components/sections/email-section";
import { SystemServerInformationSection } from "./components/sections/system-server-information-section";
import { InvoicesSection } from "./components/sections/invoices-section";
import { SubscriptionsSection } from "./components/sections/subscriptions-section";
import { PaymentGatewaysSection } from "./components/sections/payment-gateways-section";
import type { AdminSection } from "./types";

export function AdminInterface() {
  const [activeSection, setActiveSection] = useState<AdminSection["id"]>("general");
  const { isLoading, isSaving, isAdmin, settings, isDirty, updateSection, save, discard } = useAdminSettings();

  const sectionContent: Record<AdminSection["id"], ReactNode> = {
    general: <GeneralSection value={settings.general} onChange={(updates) => updateSection("general", updates)} />,
    companyInformation: <CompanyInformationSection value={settings.companyInformation} onChange={(updates) => updateSection("companyInformation", updates)} />,
    localization: <LocalizationSection value={settings.localization} onChange={(updates) => updateSection("localization", updates)} />,
    email: <EmailSection value={settings.email} onChange={(updates) => updateSection("email", updates)} />,
    systemServerInformation: <SystemServerInformationSection value={settings.systemServerInformation} onChange={(updates) => updateSection("systemServerInformation", updates)} />,
    invoices: <InvoicesSection value={settings.invoices} onChange={(updates) => updateSection("invoices", updates)} />,
    subscriptions: <SubscriptionsSection value={settings.subscriptions} onChange={(updates) => updateSection("subscriptions", updates)} />,
    paymentGateways: <PaymentGatewaysSection value={settings.paymentGateways} onChange={(updates) => updateSection("paymentGateways", updates)} />,
  };

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-sm text-muted-foreground">Loading admin settings...</div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="p-6">
        <Card>
          <CardHeader>
            <CardTitle>Admin Access Required</CardTitle>
            <CardDescription>This page is available only for the configured admin user.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full max-md:flex-col bg-background">
      <AdminSidebar sections={ADMIN_SECTIONS} activeSection={activeSection} onSectionChange={setActiveSection} />

      <div className="flex-1 flex flex-col">
        <div className="flex-1 overflow-auto p-6">{sectionContent[activeSection]}</div>

        {isDirty && (
          <>
            <Separator />
            <div className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">You have unsaved admin changes</p>
                <div className="flex items-center gap-2">
                  <button className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground" onClick={discard}>Discard</button>
                  <SaveButton onSave={save} isSaving={isSaving} hasUnsavedChanges={isDirty} saveLabel="Save Changes" savingLabel="Saving..." />
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
