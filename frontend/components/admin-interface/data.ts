import type { AdminPortalSettings, AdminSection } from "./types";

export const ADMIN_SECTIONS: AdminSection[] = [
  {
    id: "general",
    label: "General",
    icon: "Settings2",
    description: "Global branding, media assets, and platform identity defaults",
  },
  {
    id: "companyInformation",
    label: "Company Information",
    icon: "Building2",
    description: "Legal details, support contacts, and company profile data",
  },
  {
    id: "localization",
    label: "Localization",
    icon: "Globe2",
    description: "Default language, timezone, date format, and currency",
  },
  {
    id: "email",
    label: "Email",
    icon: "Mail",
    description: "SMTP provider setup and default sender configuration",
  },
  {
    id: "systemServerInformation",
    label: "System/Server Information",
    icon: "ServerCog",
    description: "Runtime environment, version info, and operational flags",
  },
  {
    id: "invoices",
    label: "Invoices",
    icon: "ReceiptText",
    description: "Invoice numbering, VAT settings, and billing document notes",
  },
  {
    id: "subscriptions",
    label: "Subscriptions",
    icon: "BadgeDollarSign",
    description: "Trial periods, renewals, and subscription lifecycle defaults",
  },
  {
    id: "paymentGateways",
    label: "Payment Gateways",
    icon: "CreditCard",
    description: "Gateway routing and payment provider availability controls",
  },
];

export const DEFAULT_ADMIN_PORTAL_SETTINGS: AdminPortalSettings = {
  general: {
    siteTitle: "DefibotX",
    tagline: "AI Trading",
    companyName: "DefibotX",
    companyMainDomain: "https://snowsig.com/",
    companyLogoLightUrl: "",
    companyLogoDarkUrl: "",
    faviconUrl: "",
    allowedFileTypes: ".png, .jpg, .jpeg, .svg, .webp, .ico",
  },
  companyInformation: {
    companyName: "DefibotX",
    address: "",
    city: "",
    state: "",
    countryCode: "",
    zipCode: "",
    phone: "",
    vatNumber: "",
    companyInfoFormat: "{company_name}\n    {address}\n    {city} {state}\n    {country_code} {zip_code}\n    {vat_number_with_label}",
  },
  localization: {
    language: "en",
    timezone: "UTC",
    dateFormat: "MM/DD/YYYY",
    currency: "USD",
  },
  email: {
    provider: "smtp",
    fromName: "DefibotX",
    fromEmail: "support@defibotx.com",
    replyTo: "support@defibotx.com",
    smtpHost: "",
    smtpPort: 587,
    smtpProtocol: "SMTP",
    smtpEncryption: "TLS",
    smtpUsername: "",
    smtpPassword: "",
    emailCharset: "UTF-8",
  },
  systemServerInformation: {
    environment: "production",
    region: "global",
    appVersion: "1.0.0",
    maintenanceWindow: "Sunday 02:00-03:00 UTC",
    readOnlyApi: false,
  },
  invoices: {
    prefix: "INV",
    nextNumber: 1001,
    vatRate: 0,
    autoSendInvoices: true,
    invoiceFooter: "Thank you for your business.",
  },
  subscriptions: {
    trialDays: 7,
    gracePeriodDays: 3,
    defaultPlan: "starter",
    allowDowngrade: true,
    autoRenewDefault: true,
  },
  paymentGateways: {
    defaultGateway: "stripe",
    stripeEnabled: true,
    paypalEnabled: false,
    razorpayEnabled: false,
    bankTransferEnabled: false,
  },
};

export function mergeAdminSettings(incoming: unknown): AdminPortalSettings {
  if (!incoming || typeof incoming !== "object") {
    return DEFAULT_ADMIN_PORTAL_SETTINGS;
  }

  const candidate = incoming as Partial<AdminPortalSettings> & {
    general?: Partial<AdminPortalSettings["general"]> & {
      siteName?: string;
      logoUrl?: string;
    };
  };

  const general: Partial<AdminPortalSettings["general"]> & {
    siteName?: string;
    logoUrl?: string;
  } = candidate.general ?? {};
  return {
    general: {
      ...DEFAULT_ADMIN_PORTAL_SETTINGS.general,
      ...general,
      siteTitle: typeof general.siteTitle === "string" && general.siteTitle.trim()
        ? general.siteTitle
        : typeof general.siteName === "string" && general.siteName.trim()
          ? general.siteName
          : DEFAULT_ADMIN_PORTAL_SETTINGS.general.siteTitle,
      companyLogoLightUrl: typeof general.companyLogoLightUrl === "string" && general.companyLogoLightUrl.trim()
        ? general.companyLogoLightUrl
        : typeof general.logoUrl === "string"
          ? general.logoUrl
          : DEFAULT_ADMIN_PORTAL_SETTINGS.general.companyLogoLightUrl,
    },
    companyInformation: (() => {
      const raw = (candidate.companyInformation ?? {}) as Partial<AdminPortalSettings["companyInformation"]> & { supportPhone?: string; taxId?: string; legalName?: string; supportEmail?: string };
      const merged = { ...DEFAULT_ADMIN_PORTAL_SETTINGS.companyInformation, ...raw };
      if (!merged.phone && raw.supportPhone) merged.phone = raw.supportPhone;
      if (!merged.vatNumber && raw.taxId) merged.vatNumber = raw.taxId;
      return merged;
    })(),
    localization: (() => {
      const merged = { ...DEFAULT_ADMIN_PORTAL_SETTINGS.localization, ...(candidate.localization ?? {}) };
      if (!String(merged.currency || "").trim()) {
        merged.currency = "USD";
      }
      return merged;
    })(),
    email: { ...DEFAULT_ADMIN_PORTAL_SETTINGS.email, ...(candidate.email ?? {}) },
    systemServerInformation: { ...DEFAULT_ADMIN_PORTAL_SETTINGS.systemServerInformation, ...(candidate.systemServerInformation ?? {}) },
    invoices: { ...DEFAULT_ADMIN_PORTAL_SETTINGS.invoices, ...(candidate.invoices ?? {}) },
    subscriptions: { ...DEFAULT_ADMIN_PORTAL_SETTINGS.subscriptions, ...(candidate.subscriptions ?? {}) },
    paymentGateways: { ...DEFAULT_ADMIN_PORTAL_SETTINGS.paymentGateways, ...(candidate.paymentGateways ?? {}) },
  };
}
