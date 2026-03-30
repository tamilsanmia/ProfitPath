"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { DEFAULT_ADMIN_PORTAL_SETTINGS, mergeAdminSettings } from "../data";
import type { AdminPortalSettings, SessionUser } from "../types";

export function useAdminSettings() {
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [settingsEnvelope, setSettingsEnvelope] = useState<Record<string, unknown>>({});
  const [settings, setSettings] = useState<AdminPortalSettings>(DEFAULT_ADMIN_PORTAL_SETTINGS);
  const [originalSettings, setOriginalSettings] = useState<AdminPortalSettings>(DEFAULT_ADMIN_PORTAL_SETTINGS);
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadAdminSettings() {
      setIsLoading(true);
      try {
        const [meResponse, settingsResponse, pgResponse] = await Promise.all([
          fetch("/api/auth/me", { cache: "no-store" }),
          fetch("/api/settings", { cache: "no-store" }),
          fetch("/api/admin/payment-gateway", { cache: "no-store" }),
        ]);

        const mePayload = (await meResponse.json().catch(() => ({}))) as { user?: SessionUser | null };
        const settingsPayload = (await settingsResponse.json().catch(() => ({}))) as { settings?: Record<string, unknown> };
        const pgPayload = pgResponse.ok
          ? ((await pgResponse.json().catch(() => ({}))) as Record<string, unknown>)
          : {};

        if (cancelled) return;

        const admin = Boolean(mePayload?.user?.is_admin);
        setIsAdmin(admin);

        const envelope = settingsPayload?.settings && typeof settingsPayload.settings === "object"
          ? settingsPayload.settings
          : {};
        setSettingsEnvelope(envelope);

        const adminPortal = mergeAdminSettings((envelope as Record<string, unknown>).adminPortal);

        // Override paymentGateways from backend payment-gateway endpoint
        if (pgPayload && typeof pgPayload === "object") {
          adminPortal.paymentGateways = {
            nowpaymentsEnabled: Boolean(pgPayload.nowpayments_enabled),
            nowpaymentsApiKey: String(pgPayload.nowpayments_api_key ?? ""),
            nowpaymentsPublicKey: String(pgPayload.nowpayments_public_key ?? ""),
            nowpaymentsIpnSecret: String(pgPayload.nowpayments_ipn_secret ?? ""),
            nowpaymentsSandbox: Boolean(pgPayload.nowpayments_sandbox),
          };
        }

        setSettings(adminPortal);
        setOriginalSettings(adminPortal);
        setIsDirty(false);
      } catch {
        if (cancelled) return;
        setIsAdmin(false);
        setSettings(DEFAULT_ADMIN_PORTAL_SETTINGS);
        setOriginalSettings(DEFAULT_ADMIN_PORTAL_SETTINGS);
        setIsDirty(false);
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadAdminSettings();
    return () => {
      cancelled = true;
    };
  }, []);

  const updateSection = <K extends keyof AdminPortalSettings>(key: K, updates: Partial<AdminPortalSettings[K]>) => {
    setSettings((prev) => ({
      ...prev,
      [key]: {
        ...prev[key],
        ...updates,
      },
    }));
    setIsDirty(true);
  };

  const save = async () => {
    setIsSaving(true);
    try {
      const nextEnvelope: Record<string, unknown> = {
        ...settingsEnvelope,
        adminPortal: settings,
        adminSite: {
          ...(typeof settingsEnvelope.adminSite === "object" && settingsEnvelope.adminSite ? settingsEnvelope.adminSite : {}),
          siteTitle: settings.general.siteTitle,
          siteName: settings.general.siteTitle,
          tagline: settings.general.tagline,
          companyName: settings.general.companyName,
          companyMainDomain: settings.general.companyMainDomain,
          companyLogoLightUrl: settings.general.companyLogoLightUrl,
          companyLogoDarkUrl: settings.general.companyLogoDarkUrl,
          logoUrl: settings.general.companyLogoDarkUrl || settings.general.companyLogoLightUrl,
          faviconUrl: settings.general.faviconUrl,
          allowedFileTypes: settings.general.allowedFileTypes,
          address: settings.companyInformation.address,
          city: settings.companyInformation.city,
          state: settings.companyInformation.state,
          countryCode: settings.companyInformation.countryCode,
          zipCode: settings.companyInformation.zipCode,
          phone: settings.companyInformation.phone,
          vatNumber: settings.companyInformation.vatNumber,
          companyInfoFormat: settings.companyInformation.companyInfoFormat,
          readOnlyApi: settings.systemServerInformation.readOnlyApi,
        },
      };

      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: nextEnvelope }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(String(payload?.error || "Failed to save admin settings"));
      }

      // Sync payment gateway keys to backend
      await fetch("/api/admin/payment-gateway", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nowpayments_enabled: settings.paymentGateways.nowpaymentsEnabled,
          nowpayments_api_key: settings.paymentGateways.nowpaymentsApiKey,
          nowpayments_public_key: settings.paymentGateways.nowpaymentsPublicKey,
          nowpayments_ipn_secret: settings.paymentGateways.nowpaymentsIpnSecret,
          nowpayments_sandbox: settings.paymentGateways.nowpaymentsSandbox,
        }),
      }).catch(() => {});

      const savedEnvelope = payload?.settings && typeof payload.settings === "object"
        ? payload.settings
        : nextEnvelope;
      const merged = mergeAdminSettings((savedEnvelope as Record<string, unknown>).adminPortal);

      setSettingsEnvelope(savedEnvelope as Record<string, unknown>);
      setSettings(merged);
      setOriginalSettings(merged);
      setIsDirty(false);
      toast.success("Admin settings saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save admin settings");
    } finally {
      setIsSaving(false);
    }
  };

  const discard = () => {
    setSettings(originalSettings);
    setIsDirty(false);
  };

  return {
    isLoading,
    isSaving,
    isAdmin,
    settings,
    isDirty,
    updateSection,
    save,
    discard,
  };
}
