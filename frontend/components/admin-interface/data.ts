import type { AdminPortalSettings, AdminSection } from "./types";

const DEFAULT_EMAIL_TEMPLATE_HEADER = `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width" />
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <style>
    body {
      background-color: #f6f6f6;
      font-family: sans-serif;
      -webkit-font-smoothing: antialiased;
      font-size: 14px;
      line-height: 1.4;
      margin: 0;
      padding: 0;
      -ms-text-size-adjust: 100%;
      -webkit-text-size-adjust: 100%;
    }
    table {
      border-collapse: separate;
      mso-table-lspace: 0pt;
      mso-table-rspace: 0pt;
      width: 100%;
    }
    table td {
      font-family: sans-serif;
      font-size: 14px;
      vertical-align: top;
    }
    .body {
      background-color: #f6f6f6;
      width: 100%;
    }
    .container {
      display: block;
      margin: 0 auto !important;
      max-width: 680px;
      padding: 10px;
      width: 680px;
    }
    .content {
      box-sizing: border-box;
      display: block;
      margin: 0 auto;
      max-width: 680px;
      padding: 10px;
    }
    .main {
      background: #fff;
      border-radius: 3px;
      width: 100%;
    }
    .header {
      text-align: center;
      padding: 10px;
      border-radius: 8px 8px 0 0;
      background: transparent;
    }
    .header img {
      max-width: 150px;
    }
    .wrapper {
      box-sizing: border-box;
      padding: 20px;
      color: #222222;
    }
    .footer {
      clear: both;
      padding-top: 10px;
      text-align: center;
      width: 100%;
    }
    .footer td, .footer p, .footer span, .footer a {
      color: #999999;
      font-size: 12px;
      text-align: center;
    }
    hr {
      border: 0;
      border-bottom: 1px solid #f6f6f6;
      margin: 20px 0;
    }
    @media only screen and (max-width: 620px) {
      table[class=body] .content {
        padding: 0 !important;
      }
      table[class=body] .container {
        padding: 0 !important;
        width: 100% !important;
      }
      table[class=body] .main {
        border-left-width: 0 !important;
        border-radius: 0 !important;
        border-right-width: 0 !important;
      }
    }
  </style>
</head>
<body>
  <table border="0" cellpadding="0" cellspacing="0" class="body">
    <tr>
      <td>&nbsp;</td>
      <td class="container">
        <div class="content">
          <div class="header">
            <table border="0" cellpadding="0" cellspacing="0">
              <tr>
                <td class="header">
                  <img src="{logo_url}" alt="{companyname} Logo">
                </td>
              </tr>
            </table>
          </div>
          <table class="main">
            <tr>
              <td class="wrapper">
                <table border="0" cellpadding="0" cellspacing="0">
                  <tr>
                    <td>`;

const DEFAULT_EMAIL_TEMPLATE_FOOTER = `</td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
          <div class="footer">
            <table border="0" cellpadding="0" cellspacing="0">
              <tr>
                <td class="content-block">
                  <span>&copy; 2025 {companyname}. All rights reserved.</span>
                </td>
              </tr>
            </table>
          </div>
        </div>
      </td>
      <td>&nbsp;</td>
    </tr>
  </table>
</body>
</html>`;

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
    siteTitle: "BotPrimeX",
    tagline: "AI Trading",
    companyName: "BotPrimeX",
    companyMainDomain: "https://snowsig.com/",
    companyLogoLightUrl: "",
    companyLogoDarkUrl: "",
    faviconUrl: "",
    allowedFileTypes: ".png, .jpg, .jpeg, .svg, .webp, .ico",
  },
  companyInformation: {
    companyName: "BotPrimeX",
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
    fromName: "BotPrimeX",
    fromEmail: "support@botprimex.com",
    replyTo: "support@botprimex.com",
    smtpHost: "",
    smtpPort: 587,
    smtpProtocol: "SMTP",
    smtpEncryption: "TLS",
    smtpUsername: "",
    smtpPassword: "",
    emailCharset: "UTF-8",
    predefinedHeader: DEFAULT_EMAIL_TEMPLATE_HEADER,
    predefinedFooter: DEFAULT_EMAIL_TEMPLATE_FOOTER,
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
