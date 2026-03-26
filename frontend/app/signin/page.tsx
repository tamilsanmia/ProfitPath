
"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link"
import { useRouter } from "next/navigation";
import { addBrowserLog } from "@/lib/browser-log";
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type GoogleCredentialResponse = {
  credential?: string;
};

type GooglePromptMomentNotification = {
  isNotDisplayed?: () => boolean;
  isSkippedMoment?: () => boolean;
};

type GoogleAccounts = {
  id: {
    initialize: (options: {
      client_id: string;
      callback: (response: GoogleCredentialResponse) => void;
    }) => void;
    renderButton: (
      parent: HTMLElement,
      options: {
        theme?: "outline" | "filled_blue" | "filled_black";
        size?: "large" | "medium" | "small";
        text?: "signin_with" | "signup_with" | "continue_with";
        shape?: "rectangular" | "pill" | "circle" | "square";
        width?: number;
      },
    ) => void;
    prompt: (listener?: (notification: GooglePromptMomentNotification) => void) => void;
  };
};

function getGoogleAccounts(): GoogleAccounts | null {
  if (typeof window === "undefined") {
    return null;
  }

  const value = (window as Window & { google?: { accounts: GoogleAccounts } }).google;
  return value?.accounts ?? null;
}

function GoogleMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 18 18" className="h-[18px] w-[18px]" focusable="false">
      <path fill="#EA4335" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.57 2.7-3.88 2.7-6.62Z" />
      <path fill="#4285F4" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.83.86-3.06.86-2.35 0-4.35-1.58-5.06-3.7H.96v2.33A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.94 10.72A5.4 5.4 0 0 1 3.66 9c0-.6.1-1.2.28-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.82.96 4.05l2.98-2.33Z" />
      <path fill="#34A853" d="M9 3.58c1.32 0 2.5.46 3.44 1.36l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l2.98 2.33c.71-2.12 2.71-3.7 5.06-3.7Z" />
    </svg>
  );
}

function detectBrowser(ua: string): string {
  const lower = ua.toLowerCase();
  if (lower.includes("edg/")) return "Edge";
  if (lower.includes("chrome/") && lower.includes("safari/")) return "Chrome";
  if (lower.includes("safari/") && !lower.includes("chrome/")) return "Safari";
  if (lower.includes("firefox/")) return "Firefox";
  return "Unknown Browser";
}

function detectOs(ua: string, platform: string): string {
  const lower = ua.toLowerCase();
  const platformLower = platform.toLowerCase();
  if (lower.includes("windows") || platformLower.includes("win")) return "Windows";
  if (lower.includes("mac os") || lower.includes("macintosh") || platformLower.includes("mac")) return "macOS";
  if (lower.includes("android")) return "Android";
  if (lower.includes("iphone") || lower.includes("ipad") || lower.includes("ios")) return "iOS";
  if (lower.includes("linux") || platformLower.includes("linux")) return "Linux";
  return platform || "Unknown OS";
}

function detectDeviceClass(ua: string): string {
  const lower = ua.toLowerCase();
  if (lower.includes("ipad") || lower.includes("tablet")) return "Tablet";
  if (lower.includes("iphone") || lower.includes("android") || lower.includes("mobile")) return "Mobile";
  return "Desktop";
}

export default function SigninPage() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleSubmitting, setIsGoogleSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [requires2fa, setRequires2fa] = useState(false);
  const [otpDigits, setOtpDigits] = useState(["", "", "", "", "", ""]);
  const [backupCodeChars, setBackupCodeChars] = useState(["", "", "", "", "", "", "", ""]);
  const [googleCredentialFor2fa, setGoogleCredentialFor2fa] = useState("");
  const [pendingEmail, setPendingEmail] = useState("");
  const [pendingPassword, setPendingPassword] = useState("");
  const [showBackupCodeInput, setShowBackupCodeInput] = useState(false);
  const [clientPublicIp, setClientPublicIp] = useState("");
  const [clientLocation, setClientLocation] = useState("");
  const [clientDevice, setClientDevice] = useState("Unknown Device");
  const [preloader, setPreloader] = useState<{ status: "loading" | "error"; detail: string } | null>(null);
  const [preloaderCountdown, setPreloaderCountdown] = useState(3);
  const googleButtonRef = useRef<HTMLDivElement | null>(null);
  const otpInputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const backupCodeInputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const formRef = useRef<HTMLFormElement | null>(null);
  const router = useRouter();
  const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";
  const isGoogleTwoFactorFlow = requires2fa && Boolean(googleCredentialFor2fa);
  const isEmailTwoFactorFlow = requires2fa && !googleCredentialFor2fa;
  const otpCode = otpDigits.join("");
  const backupCode = `${backupCodeChars.slice(0, 4).join("")}${backupCodeChars.slice(4).some(Boolean) ? `-${backupCodeChars.slice(4).join("")}` : ""}`;
  const controlClass = "h-[36px] w-full max-w-[384px] rounded-[8px] border-[#314261] bg-[#1c2a45] px-4 text-[14px] text-white placeholder:text-[#8fa0c3] placeholder:text-[14px]";
  const buttonClass = "h-[36px] w-full max-w-[384px] rounded-[8px] bg-[#3d63e6] hover:bg-[#4a70f0] text-[14px] font-semibold";

  function resetTwoFactorFlow() {
    setRequires2fa(false);
    setGoogleCredentialFor2fa("");
    setPendingEmail("");
    setPendingPassword("");
    setShowBackupCodeInput(false);
    setOtpDigits(["", "", "", "", "", ""]);
    setBackupCodeChars(["", "", "", "", "", "", "", ""]);
    setMessage("");
  }

  function handleOtpDigitChange(index: number, nextValue: string) {
    const digitsOnly = nextValue.replace(/\D/g, "");
    if (!digitsOnly) {
      setOtpDigits((current) => {
        const next = [...current];
        next[index] = "";
        return next;
      });
      return;
    }

    setOtpDigits((current) => {
      const next = [...current];
      for (let offset = 0; offset < digitsOnly.length && index + offset < next.length; offset += 1) {
        next[index + offset] = digitsOnly[offset] ?? "";
      }
      return next;
    });

    const targetIndex = Math.min(index + digitsOnly.length, otpInputRefs.current.length - 1);
    otpInputRefs.current[targetIndex]?.focus();
    otpInputRefs.current[targetIndex]?.select();
  }

  function handleOtpKeyDown(index: number, event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Backspace" && !otpDigits[index] && index > 0) {
      otpInputRefs.current[index - 1]?.focus();
      return;
    }

    if (event.key === "ArrowLeft" && index > 0) {
      event.preventDefault();
      otpInputRefs.current[index - 1]?.focus();
      return;
    }

    if (event.key === "ArrowRight" && index < otpInputRefs.current.length - 1) {
      event.preventDefault();
      otpInputRefs.current[index + 1]?.focus();
    }
  }

  function handleOtpPaste(event: React.ClipboardEvent<HTMLInputElement>) {
    event.preventDefault();
    const pastedDigits = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (!pastedDigits) {
      return;
    }

    setOtpDigits((current) => {
      const next = [...current];
      pastedDigits.split("").forEach((digit, index) => {
        next[index] = digit;
      });
      return next;
    });

    const focusIndex = Math.min(pastedDigits.length, otpInputRefs.current.length) - 1;
    otpInputRefs.current[Math.max(focusIndex, 0)]?.focus();
  }

  function handleBackupCodeChange(index: number, nextValue: string) {
    const normalizedChars = nextValue.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!normalizedChars) {
      setBackupCodeChars((current) => {
        const next = [...current];
        next[index] = "";
        return next;
      });
      return;
    }

    setBackupCodeChars((current) => {
      const next = [...current];
      for (let offset = 0; offset < normalizedChars.length && index + offset < next.length; offset += 1) {
        next[index + offset] = normalizedChars[offset] ?? "";
      }
      return next;
    });

    const targetIndex = Math.min(index + normalizedChars.length, backupCodeInputRefs.current.length - 1);
    backupCodeInputRefs.current[targetIndex]?.focus();
    backupCodeInputRefs.current[targetIndex]?.select();
  }

  function handleBackupCodeKeyDown(index: number, event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Backspace" && !backupCodeChars[index] && index > 0) {
      backupCodeInputRefs.current[index - 1]?.focus();
      return;
    }

    if (event.key === "ArrowLeft" && index > 0) {
      event.preventDefault();
      backupCodeInputRefs.current[index - 1]?.focus();
      return;
    }

    if (event.key === "ArrowRight" && index < backupCodeInputRefs.current.length - 1) {
      event.preventDefault();
      backupCodeInputRefs.current[index + 1]?.focus();
    }
  }

  function handleBackupCodePaste(event: React.ClipboardEvent<HTMLInputElement>) {
    event.preventDefault();
    const pastedChars = event.clipboardData.getData("text").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
    if (!pastedChars) {
      return;
    }

    setBackupCodeChars((current) => {
      const next = [...current];
      pastedChars.split("").forEach((char, index) => {
        next[index] = char;
      });
      return next;
    });

    const focusIndex = Math.min(pastedChars.length, backupCodeInputRefs.current.length) - 1;
    backupCodeInputRefs.current[Math.max(focusIndex, 0)]?.focus();
  }

  useEffect(() => {
    if (!requires2fa) {
      setOtpDigits(["", "", "", "", "", ""]);
      setBackupCodeChars(["", "", "", "", "", "", "", ""]);
      return;
    }

    if (!showBackupCodeInput) {
      requestAnimationFrame(() => {
        otpInputRefs.current[0]?.focus();
      });
      return;
    }

    requestAnimationFrame(() => {
      backupCodeInputRefs.current[0]?.focus();
    });
  }, [requires2fa, showBackupCodeInput]);

  useEffect(() => {
    if (!preloader || preloader.status !== "error") {
      setPreloaderCountdown(3);
      return;
    }
    if (preloaderCountdown <= 0) {
      setPreloader(null);
      setPreloaderCountdown(3);
      return;
    }
    const timer = setTimeout(() => setPreloaderCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [preloader, preloaderCountdown]);

  async function submitGoogleSignIn(credential: string, otpCode = "", backupCode = "") {
    setPreloader({ status: "loading", detail: "Please wait..." });
    addBrowserLog("google_signin_attempt", "signin");
    const authResponse = await fetch("/api/auth/google", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        credential,
        otp_code: otpCode,
        backup_code: backupCode,
        client_public_ip: clientPublicIp,
        client_location: clientLocation,
        client_device: clientDevice,
      }),
    });

    let result: Record<string, unknown> = {};
    try {
      const raw = await authResponse.text();
      result = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    } catch {
      result = {};
    }

    if (!authResponse.ok) {
      const requiresTwoFactor = Boolean(result?.requires2fa);
      if (requiresTwoFactor) {
        setRequires2fa(true);
        setGoogleCredentialFor2fa(credential);
        setShowBackupCodeInput(false);
        setPendingEmail("");
        setPendingPassword("");
        setPreloader(null);
      } else {
        setPreloader({ status: "error", detail: String(result?.error ?? "Authentication error") });
      }
      addBrowserLog("google_signin_failed", String(result?.error ?? "unknown"));
      setMessage(String(result?.error ?? "Google sign-in failed."));
      return false;
    }

    setGoogleCredentialFor2fa("");
    const googleUserEmail =
      typeof result?.user === "object" && result.user !== null && "email" in result.user
        ? String((result.user as { email?: unknown }).email ?? "signin")
        : "signin";
    addBrowserLog("google_signin_success", googleUserEmail);
    router.push("/");
    router.refresh();
    return true;
  }

  useEffect(() => {
    let mounted = true;

    async function loadDeviceIdentity() {
      if (typeof window === "undefined") {
        return;
      }

      const ua = window.navigator.userAgent || "";
      const platform = window.navigator.platform || "Unknown Platform";
      const browser = detectBrowser(ua);
      const os = detectOs(ua, platform);
      const deviceClass = detectDeviceClass(ua);

      const navigatorAny = window.navigator as Navigator & {
        userAgentData?: {
          platform?: string;
          mobile?: boolean;
          getHighEntropyValues?: (hints: string[]) => Promise<Record<string, unknown>>;
        };
      };

      let model = "";
      try {
        const highEntropy = await navigatorAny.userAgentData?.getHighEntropyValues?.(["model", "platformVersion"]);
        model = String(highEntropy?.model ?? "").trim();
      } catch {
        model = "";
      }

      if (!mounted) {
        return;
      }

      const deviceDescriptor = [deviceClass, model].filter(Boolean).join(" ").trim();
      setClientDevice(`${deviceDescriptor || deviceClass} (${browser} on ${os})`);
    }

    async function loadNetworkIdentity() {
      try {
        const response = await fetch("https://ipapi.co/json/", { cache: "no-store" });
        const payload = await response.json();
        if (!mounted) {
          return;
        }

        const ip = String(payload?.ip ?? "").trim();
        const city = String(payload?.city ?? "").trim();
        const region = String(payload?.region ?? "").trim();
        const country = String(payload?.country_name ?? "").trim();
        const location = [city, region, country].filter(Boolean).join(", ");

        setClientPublicIp(ip);
        setClientLocation(location || "Unknown");
      } catch {
        if (mounted) {
          setClientPublicIp("");
          setClientLocation("Unknown");
        }
      }
    }

    void loadNetworkIdentity();
    void loadDeviceIdentity();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!googleClientId || typeof window === "undefined") {
      return;
    }

    let active = true;
    const scriptId = "google-identity-script";
    let resizeObserver: ResizeObserver | null = null;

    const setupGoogleButton = () => {
      const googleAccounts = getGoogleAccounts();
      if (!active || !googleAccounts || !googleButtonRef.current) {
        return;
      }

      const renderGoogleButton = () => {
        const container = googleButtonRef.current;
        if (!container) {
          return;
        }

        container.innerHTML = "";
        const requestedWidth = Math.min(container.clientWidth || 384, 400);
        googleAccounts.id.renderButton(container, {
          theme: "filled_black",
          size: "large",
          text: "continue_with",
          shape: "rectangular",
          width: requestedWidth,
        });

        requestAnimationFrame(() => {
          const renderedRoot = container.firstElementChild as HTMLElement | null;
          if (!renderedRoot) {
            return;
          }

          const renderedWidth = renderedRoot.offsetWidth || requestedWidth || 1;
          const renderedHeight = renderedRoot.offsetHeight || 40;
          const scaleX = (container.clientWidth || renderedWidth) / renderedWidth;
          const scaleY = (container.clientHeight || renderedHeight) / renderedHeight;

          renderedRoot.style.transformOrigin = "top left";
          renderedRoot.style.transform = `scale(${scaleX}, ${scaleY})`;
          renderedRoot.style.width = `${renderedWidth}px`;
          renderedRoot.style.height = `${renderedHeight}px`;
          renderedRoot.style.opacity = "0.01";
          renderedRoot.style.pointerEvents = "auto";
          renderedRoot.style.cursor = "pointer";
        });
      };

      googleAccounts.id.initialize({
        client_id: googleClientId,
        callback: async (response) => {
          const credential = response?.credential;
          if (!credential) {
            setMessage("Google authentication failed. Please try again.");
            return;
          }

          setMessage("");
          setIsGoogleSubmitting(true);

          try {
            await submitGoogleSignIn(credential);
          } catch {
            setPreloader({ status: "error", detail: "Network error. Please try again." });
            setMessage("Network error while signing in with Google.");
          } finally {
            setIsGoogleSubmitting(false);
          }
        },
      });

      renderGoogleButton();

      if (typeof ResizeObserver !== "undefined") {
        resizeObserver = new ResizeObserver(() => renderGoogleButton());
        resizeObserver.observe(googleButtonRef.current);
      }
    };

    if (getGoogleAccounts()) {
      setupGoogleButton();
      return () => {
        active = false;
      };
    }

    const existingScript = document.getElementById(scriptId) as HTMLScriptElement | null;
    if (existingScript) {
      existingScript.addEventListener("load", setupGoogleButton);
      return () => {
        active = false;
        existingScript.removeEventListener("load", setupGoogleButton);
      };
    }

    const script = document.createElement("script");
    script.id = scriptId;
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = setupGoogleButton;
    document.head.appendChild(script);

    return () => {
      active = false;
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      script.onload = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientDevice, clientLocation, clientPublicIp, googleClientId, router]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setIsSubmitting(true);
    setPreloader({ status: "loading", detail: "Please wait..." });

    const formData = new FormData(event.currentTarget);
    const submittedEmail = String(formData.get("email") ?? "");
    const submittedPassword = String(formData.get("password") ?? "");
    const payload = {
      email: isEmailTwoFactorFlow ? pendingEmail : submittedEmail,
      password: isEmailTwoFactorFlow ? pendingPassword : submittedPassword,
      otp_code: showBackupCodeInput ? "" : otpCode,
      backup_code: showBackupCodeInput ? backupCode : String(formData.get("backup_code") ?? ""),
      client_public_ip: clientPublicIp,
      client_location: clientLocation,
      client_device: clientDevice,
    };

    try {
      addBrowserLog("signin_attempt", payload.email);
      const response = await fetch("/api/auth/signin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const result = await response.json();

      if (!response.ok) {
        addBrowserLog("signin_failed", result.error ?? payload.email);
        const requiresTwoFactor = Boolean(result?.requires2fa);
        if (requiresTwoFactor) {
          setRequires2fa(true);
          setPendingEmail(payload.email);
          setPendingPassword(payload.password);
          setGoogleCredentialFor2fa("");
          setShowBackupCodeInput(false);
          setOtpDigits(["", "", "", "", "", ""]);
          setBackupCodeChars(["", "", "", "", "", "", "", ""]);
          setPreloader(null);
        } else {
          setPreloader({ status: "error", detail: result.error ?? "Authentication error" });
        }
        setMessage(result.error ?? "Failed to sign in.");
        return;
      }

      const firstName = result?.user?.first_name ?? result?.user?.firstName ?? "Trader";
      setPendingEmail("");
      setPendingPassword("");
      addBrowserLog("signin_success", payload.email);
      router.push("/");
      router.refresh();
    } catch {
      addBrowserLog("signin_network_error", payload.email);
      setPreloader({ status: "error", detail: "Network error. Please try again." });
      setMessage("Network error while signing in. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div data-name="page-auth-signin" className="min-h-screen bg-[#111827] text-white px-4 py-10 flex items-center justify-center">
      {preloader && (
        <div data-name="signin-preloader-overlay" className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#111827] px-4">
          <p className="mb-8 text-[35px] font-bold tracking-tight text-white">BotPrimeX</p>
          <div className="mb-8 h-8 w-8 animate-spin rounded-full border-[3px] border-white/20 border-t-white" />
          {preloader.status === "error" && (
            <div className="w-full max-w-[384px] rounded-[12px] border border-[#f59e0b]/40 bg-[#1e1a0a] px-5 py-4">
              <div className="mb-2 flex items-center gap-2.5">
                <svg className="h-5 w-5 shrink-0 text-[#f59e0b]" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                </svg>
                <p className="text-[16px] font-semibold text-[#f59e0b]">Something went wrong</p>
              </div>
              <p className="pl-[29px] text-[14px] text-[#e0b84d]">{preloader.detail}</p>
              <p className="pl-[29px] mt-1 text-[14px] text-[#e0b84d]">Redirecting in {preloaderCountdown} seconds...</p>
            </div>
          )}
        </div>
      )}
      <div data-name="signin-container" className="mx-auto w-full max-w-[384px]">
        <div data-name="signin-brand-header" className="mb-9 text-center">
          <p className="text-[35px] leading-none font-bold tracking-tight text-white">BotPrimeX</p>
        </div>

        <Card data-name="signin-card" className="border-0 bg-transparent shadow-none">
          <CardHeader className="px-0 pt-0">
            <CardTitle className="pb-[5px] text-[20px] leading-none font-semibold tracking-tight text-white text-center">
              {requires2fa && !showBackupCodeInput ? "One Time Password" : requires2fa ? "Backup Recovery Code" : "Sign in to your account"}
            </CardTitle>
          </CardHeader>
          <CardContent data-name="signin-card-content" className="px-0">
            <form data-name="signin-form" className={requires2fa ? "grid gap-6" : "grid gap-5"} onSubmit={onSubmit} ref={formRef}>
            {!requires2fa && (
              <>
                <div className="grid gap-2">
                  <Label htmlFor="email" className="text-[14px] font-semibold text-[#e7ecfa]">Email address</Label>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    placeholder="name@example.com"
                    className={controlClass}
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="password" className="text-[14px] font-semibold text-[#e7ecfa]">Password</Label>
                  <Input
                    id="password"
                    name="password"
                    type="password"
                    placeholder="Enter your password"
                    className={controlClass}
                    required
                  />
                </div>

                <div className="flex items-center justify-between text-[14px]">
                  <label className="flex items-center gap-2 text-[14px] text-[#d5dff6]">
                    <input type="checkbox" className="h-4 w-4 rounded border-slate-600 bg-slate-800" />
                    Remember Me
                  </label>
                  <Link
                    href="/forgot-password"
                    className="text-[14px] text-[#4d79ff] hover:text-[#6a90ff]"
                  >
                    Forgot Password?
                  </Link>
                </div>
              </>
            )}
            {requires2fa && (
              <>
                {!showBackupCodeInput ? (
                  <>
                    <input type="hidden" name="otp_code" value={otpCode} />
                    <div className="grid gap-4">
                      <div className="grid grid-cols-6 gap-2.5">
                        {otpDigits.map((digit, index) => (
                          <input
                            key={index}
                            ref={(element) => {
                              otpInputRefs.current[index] = element;
                            }}
                            type="text"
                            inputMode="numeric"
                            autoComplete={index === 0 ? "one-time-code" : "off"}
                            pattern="[0-9]*"
                            maxLength={1}
                            value={digit}
                            onChange={(event) => handleOtpDigitChange(index, event.target.value)}
                            onKeyDown={(event) => handleOtpKeyDown(index, event)}
                            onPaste={handleOtpPaste}
                            className="h-[62px] w-full rounded-[10px] border border-[#314261] bg-[#182540] text-center text-[30px] font-semibold text-white outline-none transition focus:border-[#4d79ff] focus:ring-2 focus:ring-[#4d79ff]/25"
                            aria-label={`OTP digit ${index + 1}`}
                          />
                        ))}
                      </div>
                      <button
                        type="button"
                        className="text-center text-[14px] text-[#95a6cb] hover:text-[#d5dff6]"
                        onClick={() => {
                          setShowBackupCodeInput(true);
                          setOtpDigits(["", "", "", "", "", ""]);
                          setMessage("");
                        }}
                      >
                        Use backup recovery code instead
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="grid gap-2">
                    <input type="hidden" name="backup_code" value={backupCode} />
                    <div className="grid grid-cols-[repeat(4,minmax(0,1fr))_18px_repeat(4,minmax(0,1fr))] gap-2">
                      {backupCodeChars.slice(0, 4).map((char, index) => (
                        <input
                          key={`backup-left-${index}`}
                          ref={(element) => {
                            backupCodeInputRefs.current[index] = element;
                          }}
                          type="text"
                          inputMode="text"
                          autoCapitalize="characters"
                          autoComplete={index === 0 ? "one-time-code" : "off"}
                          maxLength={1}
                          value={char}
                          onChange={(event) => handleBackupCodeChange(index, event.target.value)}
                          onKeyDown={(event) => handleBackupCodeKeyDown(index, event)}
                          onPaste={handleBackupCodePaste}
                          className="h-[62px] w-full rounded-[10px] border border-[#314261] bg-[#182540] text-center text-[28px] font-semibold uppercase text-white outline-none transition focus:border-[#4d79ff] focus:ring-2 focus:ring-[#4d79ff]/25"
                          aria-label={`Backup code character ${index + 1}`}
                        />
                      ))}
                      <div className="flex items-center justify-center text-[26px] font-semibold text-[#95a6cb]">-</div>
                      {backupCodeChars.slice(4).map((char, offset) => {
                        const index = offset + 4;
                        return (
                          <input
                            key={`backup-right-${index}`}
                            ref={(element) => {
                              backupCodeInputRefs.current[index] = element;
                            }}
                            type="text"
                            inputMode="text"
                            autoCapitalize="characters"
                            autoComplete="off"
                            maxLength={1}
                            value={char}
                            onChange={(event) => handleBackupCodeChange(index, event.target.value)}
                            onKeyDown={(event) => handleBackupCodeKeyDown(index, event)}
                            onPaste={handleBackupCodePaste}
                            className="h-[62px] w-full rounded-[10px] border border-[#314261] bg-[#182540] text-center text-[28px] font-semibold uppercase text-white outline-none transition focus:border-[#4d79ff] focus:ring-2 focus:ring-[#4d79ff]/25"
                            aria-label={`Backup code character ${index + 1}`}
                          />
                        );
                      })}
                    </div>
                    <button
                      type="button"
                      className="text-center text-[14px] text-[#95a6cb] hover:text-[#d5dff6]"
                      onClick={() => {
                        setShowBackupCodeInput(false);
                        setBackupCodeChars(["", "", "", "", "", "", "", ""]);
                        setMessage("");
                      }}
                    >
                      Use authenticator code instead
                    </button>
                  </div>
                )}
                {googleCredentialFor2fa && (
                  <Button
                    type="button"
                    className={buttonClass}
                    variant="secondary"
                    disabled={isGoogleSubmitting}
                    onClick={async () => {
                      const formElement = formRef.current;
                      if (!formElement) {
                        return;
                      }

                      const formData = new FormData(formElement);
                      const currentOtpCode = showBackupCodeInput ? "" : otpCode;
                      const currentBackupCode = showBackupCodeInput ? backupCode : String(formData.get("backup_code") ?? "").trim();

                      setIsGoogleSubmitting(true);
                      setMessage("");
                      try {
                        await submitGoogleSignIn(googleCredentialFor2fa, currentOtpCode, currentBackupCode);
                      } catch {
                        setMessage("Network error while signing in with Google.");
                      } finally {
                        setIsGoogleSubmitting(false);
                      }
                    }}
                  >
                    {isGoogleSubmitting ? "Verifying..." : "Verify"}
                  </Button>
                )}
                {isEmailTwoFactorFlow && (
                  <Button type="submit" className={buttonClass} disabled={isSubmitting || (!showBackupCodeInput && otpCode.length !== 6) || (showBackupCodeInput && backupCodeChars.join("").length !== 8)}>
                    {isSubmitting ? "Verifying..." : "Verify"}
                  </Button>
                )}
                <div className="text-center text-[14px] text-[#95a6cb]">
                  Wrong account? {" "}
                  <button
                    type="button"
                    onClick={resetTwoFactorFlow}
                    className="font-semibold text-[#4d79ff] hover:text-[#6a90ff]"
                  >
                    Sign in
                  </button>
                </div>
              </>
            )}
            {!requires2fa && (
              <>
                <Button type="submit" className={buttonClass} disabled={isSubmitting}>
                  {isSubmitting ? "Signing in..." : "Sign in"}
                </Button>

                <div className="relative py-1 text-center text-[14px] uppercase tracking-wide text-[#95a6cb]">
                  <span className="bg-transparent px-2">Or</span>
                </div>

                {googleClientId ? (
                  <div className="relative h-[36px] w-full max-w-[384px]">
                    <div
                      aria-hidden="true"
                      className="pointer-events-none flex h-[36px] w-full items-center justify-center rounded-[8px] border border-[#314261] bg-[#1a2235] px-4 text-[14px] font-semibold text-white"
                    >
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-white">
                        <GoogleMark />
                      </span>
                      <span>Continue with Google</span>
                    </div>
                    <div
                      className="absolute inset-0 z-10 overflow-hidden rounded-[8px] opacity-[0.01] cursor-pointer"
                      ref={googleButtonRef}
                      aria-label="Google sign-in button"
                    />
                  </div>
                ) : (
                  <p className="text-xs text-[#95a6cb]">Google sign-in is unavailable. Set NEXT_PUBLIC_GOOGLE_CLIENT_ID to enable it.</p>
                )}
              </>
            )}
            {isGoogleSubmitting && <p className="text-sm text-center text-[#d2dced]">Signing in...</p>}
            {message && (!requires2fa || showBackupCodeInput || message !== "Two-factor or backup code required") && (
              <p className="text-sm text-center text-[#d2dced]">{message}</p>
            )}
          </form>

          {!requires2fa && (
            <div className="mt-8 text-center text-[14px] text-[#d5dff6]">
              Ready to trade? {" "}
              <Link href="/signup" className="text-[14px] font-semibold text-[#4d79ff] hover:text-[#6a90ff]">
                Create your account
              </Link>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  </div>
  )
}
