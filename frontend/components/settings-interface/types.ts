export interface UserProfile {
  id: string
  title: string
  firstName: string
  lastName: string
  dateOfBirth: string
  email: string
  phone: string
  timezone: string
  avatar: string
  streetAddress: string
  city: string
  state: string
  postalCode: string
  countryCode: string
  country: string
}

export interface SecuritySettings {
  twoFactorEnabled: boolean
  emailNotifications: boolean
  smsNotifications: boolean
  loginAlerts: boolean
  sessionTimeout: number
}

export interface NotificationSettings {
  email: {
    trading: boolean
    bots: boolean
    account: boolean
    marketing: boolean
    security: boolean
  }
  push: {
    trading: boolean
    bots: boolean
    account: boolean
    priceAlerts: boolean
  }
  sms: {
    security: boolean
    criticalAlerts: boolean
  }
  inApp: {
    all: boolean
    trading: boolean
    bots: boolean
    system: boolean
  }
}

export interface AppearanceSettings {
  theme: "light" | "dark" | "system"
  density: "compact" | "comfortable" | "spacious"
  language: string
  dateFormat: string
  timeFormat: "12h" | "24h"
  timezone: string
  accessibility: {
    highContrast: boolean
    reducedMotion: boolean
    largeText: boolean
    screenReader: boolean
  }
}

export interface TradingSettings {
  defaultExchange: string
  defaultTradingPair: string
  orderDefaults: {
    orderType: "market" | "limit" | "stop"
    timeInForce: "GTC" | "IOC" | "FOK"
    postOnly: boolean
    reduceOnly: boolean
  }
  riskManagement: {
    maxPositionSize: number
    stopLossPercentage: number
    takeProfitPercentage: number
    maxDailyLoss: number
    maxOpenPositions: number
  }
  chartPreferences: {
    defaultTimeframe: string
    chartType: "candlestick" | "line" | "area"
    indicators: string[]
    theme: "light" | "dark"
  }
}

export interface BotSettings {
  defaultParameters: {
    maxInvestment: number
    riskLevel: "low" | "medium" | "high"
    tradingPairs: string[]
    stopLoss: number
    takeProfit: number
  }
  riskManagement: {
    maxConcurrentBots: number
    maxDailyTrades: number
    emergencyStop: boolean
    drawdownLimit: number
  }
  behavior: {
    autoStart: boolean
    autoRestart: boolean
    pauseOnLoss: boolean
    adaptiveParameters: boolean
  }
  monitoring: {
    performanceAlerts: boolean
    errorNotifications: boolean
    dailyReports: boolean
    weeklyAnalysis: boolean
  }
}

export interface PrivacySettings {
  dataSharing: {
    analytics: boolean
    marketing: boolean
    thirdParty: boolean
    research: boolean
  }
  profilePrivacy: {
    publicProfile: boolean
    showTradingStats: boolean
    showPortfolio: boolean
    allowMessages: boolean
  }
  cookiesTracking: {
    essential: boolean
    analytics: boolean
    marketing: boolean
    preferences: boolean
  }
  securityPrivacy: {
    loginHistory: boolean
    deviceTracking: boolean
    locationTracking: boolean
    biometricData: boolean
  }
}

export interface DataSettings {
  retention: {
    tradingHistory: number
    botLogs: number
    personalData: number
    analyticsData: number
  }
  export: {
    format: "json" | "csv" | "xlsx"
    includePersonalData: boolean
    includeTradingData: boolean
    includeBotData: boolean
  }
}

export interface Connection {
  id: string
  name: string
  type: "exchange" | "wallet" | "service"
  exchange?: "binance_futures" | "bybit_futures"
  status: "connected" | "disconnected" | "error"
  lastSync: string
  permissions: string[]
  icon: string
  apiKey?: string
  apiSecret?: string
}

export interface Session {
  id: string
  device: string
  location: string
  ip: string
  lastActive: string
  current: boolean
  browser: string
  os: string
}

export interface LoginHistory {
  id: string
  timestamp: string
  ip: string
  location: string
  device: string
  success: boolean
  method: string
}

export interface SettingsTab {
  id: string
  label: string
  icon: string
  description: string
}

export interface SettingsState {
  profile: UserProfile
  security: SecuritySettings
  notifications: NotificationSettings
  appearance: AppearanceSettings
  trading: TradingSettings
  bots: BotSettings
  privacy: PrivacySettings
  data: DataSettings
  connections: Connection[]
  sessions: Session[]
  loginHistory: LoginHistory[]
  activeTab: string
  isLoading: boolean
  hasUnsavedChanges: boolean
}
