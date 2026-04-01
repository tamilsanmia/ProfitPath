export type AdminPortalSettings = {
  general: {
    siteTitle: string;
    tagline: string;
    companyName: string;
    companyMainDomain: string;
    companyLogoLightUrl: string;
    companyLogoDarkUrl: string;
    faviconUrl: string;
    allowedFileTypes: string;
  };
  companyInformation: {
    companyName: string;
    address: string;
    city: string;
    state: string;
    countryCode: string;
    zipCode: string;
    phone: string;
    vatNumber: string;
    companyInfoFormat: string;
  };
  localization: {
    language: string;
    timezone: string;
    dateFormat: string;
    currency: string;
  };
  email: {
    provider: string;
    fromName: string;
    fromEmail: string;
    replyTo: string;
    smtpHost: string;
    smtpPort: number;
    smtpProtocol: string;
    smtpEncryption: string;
    smtpUsername: string;
    smtpPassword: string;
    emailCharset: string;
    predefinedHeader: string;
    predefinedFooter: string;
  };
  systemServerInformation: {
    environment: string;
    region: string;
    appVersion: string;
    maintenanceWindow: string;
    readOnlyApi: boolean;
  };
  invoices: {
    prefix: string;
    nextNumber: number;
    vatRate: number;
    autoSendInvoices: boolean;
    invoiceFooter: string;
  };
  subscriptions: {
    monthlyServerFee: number;
    setupCharge: number;
    trialDays: number;
    gracePeriodDays: number;
    defaultPlan: string;
    allowDowngrade: boolean;
    autoRenewDefault: boolean;
  };
  paymentGateways: {
    nowpaymentsEnabled: boolean;
    nowpaymentsApiKey: string;
    nowpaymentsPublicKey: string;
    nowpaymentsIpnSecret: string;
    nowpaymentsSandbox: boolean;
  };
};

export type AdminSection = {
  id:
    | "general"
    | "companyInformation"
    | "localization"
    | "email"
    | "systemServerInformation"
    | "invoices"
    | "subscriptions"
    | "paymentGateways"
    | "freqtrade";
  label: string;
  icon: string;
  description: string;
};

export type SessionUser = {
  email?: string;
  is_admin?: boolean;
};
