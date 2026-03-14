
"use client";

import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useRouter } from "next/navigation";
import Link from "next/link"
import { addBrowserLog } from "@/lib/browser-log";
import { detectClientGeo } from "@/lib/client-geo"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type GoogleCredentialResponse = {
  credential?: string;
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
  };
};

function getGoogleAccounts(): GoogleAccounts | null {
  if (typeof window === "undefined") {
    return null;
  }

  const value = (window as Window & { google?: { accounts: GoogleAccounts } }).google;
  return value?.accounts ?? null;
}

type CountryOption = {
  code: string;
  name: string;
  dialCode: string;
};

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

const COUNTRY_OPTIONS: CountryOption[] = [
  { code: "US", name: "United States", dialCode: "+1" },
  { code: "CA", name: "Canada", dialCode: "+1" },
  { code: "GB", name: "United Kingdom", dialCode: "+44" },
  { code: "IN", name: "India", dialCode: "+91" },
  { code: "AU", name: "Australia", dialCode: "+61" },
  { code: "DE", name: "Germany", dialCode: "+49" },
  { code: "FR", name: "France", dialCode: "+33" },
  { code: "ES", name: "Spain", dialCode: "+34" },
  { code: "IT", name: "Italy", dialCode: "+39" },
  { code: "NL", name: "Netherlands", dialCode: "+31" },
  { code: "CH", name: "Switzerland", dialCode: "+41" },
  { code: "SE", name: "Sweden", dialCode: "+46" },
  { code: "NO", name: "Norway", dialCode: "+47" },
  { code: "DK", name: "Denmark", dialCode: "+45" },
  { code: "FI", name: "Finland", dialCode: "+358" },
  { code: "IE", name: "Ireland", dialCode: "+353" },
  { code: "PT", name: "Portugal", dialCode: "+351" },
  { code: "PL", name: "Poland", dialCode: "+48" },
  { code: "CZ", name: "Czechia", dialCode: "+420" },
  { code: "AT", name: "Austria", dialCode: "+43" },
  { code: "BE", name: "Belgium", dialCode: "+32" },
  { code: "RO", name: "Romania", dialCode: "+40" },
  { code: "HU", name: "Hungary", dialCode: "+36" },
  { code: "GR", name: "Greece", dialCode: "+30" },
  { code: "TR", name: "Turkey", dialCode: "+90" },
  { code: "AE", name: "United Arab Emirates", dialCode: "+971" },
  { code: "SA", name: "Saudi Arabia", dialCode: "+966" },
  { code: "QA", name: "Qatar", dialCode: "+974" },
  { code: "KW", name: "Kuwait", dialCode: "+965" },
  { code: "BH", name: "Bahrain", dialCode: "+973" },
  { code: "OM", name: "Oman", dialCode: "+968" },
  { code: "IL", name: "Israel", dialCode: "+972" },
  { code: "EG", name: "Egypt", dialCode: "+20" },
  { code: "ZA", name: "South Africa", dialCode: "+27" },
  { code: "NG", name: "Nigeria", dialCode: "+234" },
  { code: "KE", name: "Kenya", dialCode: "+254" },
  { code: "GH", name: "Ghana", dialCode: "+233" },
  { code: "MA", name: "Morocco", dialCode: "+212" },
  { code: "JP", name: "Japan", dialCode: "+81" },
  { code: "KR", name: "South Korea", dialCode: "+82" },
  { code: "CN", name: "China", dialCode: "+86" },
  { code: "HK", name: "Hong Kong", dialCode: "+852" },
  { code: "SG", name: "Singapore", dialCode: "+65" },
  { code: "MY", name: "Malaysia", dialCode: "+60" },
  { code: "TH", name: "Thailand", dialCode: "+66" },
  { code: "VN", name: "Vietnam", dialCode: "+84" },
  { code: "ID", name: "Indonesia", dialCode: "+62" },
  { code: "PH", name: "Philippines", dialCode: "+63" },
  { code: "NZ", name: "New Zealand", dialCode: "+64" },
  { code: "BR", name: "Brazil", dialCode: "+55" },
  { code: "MX", name: "Mexico", dialCode: "+52" },
  { code: "AR", name: "Argentina", dialCode: "+54" },
  { code: "CL", name: "Chile", dialCode: "+56" },
  { code: "CO", name: "Colombia", dialCode: "+57" },
  { code: "PE", name: "Peru", dialCode: "+51" },
  { code: "VE", name: "Venezuela", dialCode: "+58" },
  { code: "UY", name: "Uruguay", dialCode: "+598" },
  { code: "PY", name: "Paraguay", dialCode: "+595" },
  { code: "BO", name: "Bolivia", dialCode: "+591" },
  { code: "RU", name: "Russia", dialCode: "+7" },
  { code: "UA", name: "Ukraine", dialCode: "+380" },
  { code: "BG", name: "Bulgaria", dialCode: "+359" },
  { code: "HR", name: "Croatia", dialCode: "+385" },
  { code: "RS", name: "Serbia", dialCode: "+381" },
];

export default function SignupPage() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleSubmitting, setIsGoogleSubmitting] = useState(false);
  const [isAgeCertified, setIsAgeCertified] = useState(false);
  const [message, setMessage] = useState("");
  const [countryCode, setCountryCode] = useState("US");
  const [phoneCode, setPhoneCode] = useState("+1");
  const [detectedState, setDetectedState] = useState("")
  const [detectedTimezone, setDetectedTimezone] = useState("")
  const [preloader, setPreloader] = useState<{ status: "loading" | "error"; detail: string } | null>(null);
  const [preloaderCountdown, setPreloaderCountdown] = useState(3);
  const googleButtonRef = useRef<HTMLDivElement | null>(null);
  const searchParams = useSearchParams();
  const router = useRouter();
  const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";
  const controlClass = "h-[36px] w-full rounded-[8px] border-[#314261] bg-[#1c2a45] px-4 text-[14px] text-white placeholder:text-[#8fa0c3] placeholder:text-[14px]";
  const buttonClass = "h-[36px] w-full rounded-[8px] bg-[#3d63e6] hover:bg-[#4a70f0] text-[14px] font-semibold";

  const selectedCountry = useMemo(
    () => COUNTRY_OPTIONS.find((option) => option.code === countryCode) ?? COUNTRY_OPTIONS[0],
    [countryCode],
  );

  useEffect(() => {
    let active = true;

    async function runAutoDetect() {
      const geo = await detectClientGeo()
      const detectedRegion = geo.countryCode || "US"
      if (!active) {
        return;
      }

      const detectedCountry = COUNTRY_OPTIONS.find((option) => option.code === detectedRegion) ?? COUNTRY_OPTIONS[0];
      setCountryCode(detectedCountry.code);
      setPhoneCode(detectedCountry.dialCode);
      setDetectedState(geo.state)
      setDetectedTimezone(geo.timezone)
    }

    void runAutoDetect();

    return () => {
      active = false;
    };
  }, []);

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
        const requestedWidth = Math.min(container.clientWidth || 448, 400);
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

          if (!isAgeCertified) {
            setMessage("Please certify you are 18+ and agree to the policy terms before continuing.");
            return;
          }

          setMessage("");
          setIsGoogleSubmitting(true);
          setPreloader({ status: "loading", detail: "Please wait..." });

          try {
            addBrowserLog("google_signup_attempt", "signup");
            const authResponse = await fetch("/api/auth/google", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ credential }),
            });

            const result = await authResponse.json();
            if (!authResponse.ok) {
              addBrowserLog("google_signup_failed", String(result?.error ?? "unknown"));
              setPreloader({ status: "error", detail: String(result?.error ?? "Authentication error") });
              setMessage(String(result?.error ?? "Google sign-up failed."));
              return;
            }

            addBrowserLog("google_signup_success", String(result?.user?.email ?? "signup"));
            router.push("/");
            router.refresh();
          } catch {
            setPreloader({ status: "error", detail: "Network error. Please try again." });
            setMessage("Network error while signing up with Google.");
          } finally {
            setIsGoogleSubmitting(false);
          }
        },
      });

      renderGoogleButton();
      requestAnimationFrame(() => renderGoogleButton());

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
  }, [googleClientId, isAgeCertified, router]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setIsSubmitting(true);
    setPreloader({ status: "loading", detail: "Please wait..." });

    const formElement = event.currentTarget;
    const formData = new FormData(formElement);
    const phoneInput = String(formData.get("phone") ?? "").trim();
    const phonePayload = phoneInput ? `${phoneCode} ${phoneInput}` : "";
    const password = String(formData.get("password") ?? "");
    const confirmPassword = String(formData.get("confirmPassword") ?? "");
    const acceptedCertification = String(formData.get("ageCertification") ?? "") === "on";
    if (!acceptedCertification) {
      setMessage("Please certify you are 18+ and agree to the policy terms before continuing.");
      setIsSubmitting(false);
      setPreloader(null);
      return;
    }

    if (password !== confirmPassword) {
      setMessage("Password and confirm password must match.");
      setIsSubmitting(false);
      setPreloader(null);
      return;
    }

    const referralCodeInput = String(formData.get("referralCode") ?? "").trim();
    const payload = {
      firstName: String(formData.get("firstName") ?? ""),
      lastName: String(formData.get("lastName") ?? ""),
      email: String(formData.get("email") ?? ""),
      password,
      referralUsername: referralCodeInput || String(searchParams.get("ref") ?? ""),
      phone: phonePayload,
      country: selectedCountry.name,
      countryCode,
      state: detectedState,
      timezone: detectedTimezone,
    };

    try {
      addBrowserLog("signup_attempt", payload.email);
      const response = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      let result: Record<string, unknown> = {};
      try {
        const raw = await response.text();
        result = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      } catch {
        result = {};
      }

      if (!response.ok) {
        const errorMessage = typeof result.error === "string" ? result.error : "Failed to create account.";
        addBrowserLog("signup_failed", errorMessage);
        setPreloader({ status: "error", detail: errorMessage });
        setMessage(errorMessage);
        return;
      }

      const signInResponse = await fetch("/api/auth/signin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: payload.email,
          password: payload.password,
        }),
      });

      let signInResult: Record<string, unknown> = {};
      try {
        const rawSignIn = await signInResponse.text();
        signInResult = rawSignIn ? (JSON.parse(rawSignIn) as Record<string, unknown>) : {};
      } catch {
        signInResult = {};
      }

      if (!signInResponse.ok) {
        const signInError = typeof signInResult.error === "string" ? signInResult.error : "Account created, but automatic sign-in failed. Please sign in manually.";
        addBrowserLog("signup_success_signin_failed", payload.email);
        setPreloader({ status: "error", detail: signInError });
        setMessage(signInError);
        return;
      }

      formElement.reset();
      const geo = await detectClientGeo()
      const detectedRegion = geo.countryCode || "US"
      const detectedCountry = COUNTRY_OPTIONS.find((option) => option.code === detectedRegion) ?? COUNTRY_OPTIONS[0];
      setCountryCode(detectedCountry.code);
      setPhoneCode(detectedCountry.dialCode);
      setDetectedState(geo.state)
      setDetectedTimezone(geo.timezone)
      addBrowserLog("signup_success", payload.email);
      router.replace("/");
      router.refresh();
    } catch (error) {
      addBrowserLog("signup_network_error", payload.email);
      console.error("Signup failed:", error);
      setPreloader({ status: "error", detail: "Network error. Please try again." });
      setMessage("Network error while creating account. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div data-name="page-auth-signup" className="min-h-screen bg-[#111827] text-white px-4 py-10 flex items-center justify-center">
      {preloader && (
        <div data-name="signup-preloader-overlay" className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#111827] px-4">
          <p className="mb-8 text-[35px] font-bold tracking-tight text-white">ProfitPath</p>
          <div className="mb-8 h-8 w-8 animate-spin rounded-full border-[3px] border-white/20 border-t-white" />
          {preloader.status === "error" && (
            <div className="w-full max-w-[448px] rounded-[12px] border border-[#f59e0b]/40 bg-[#1e1a0a] px-5 py-4">
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
      <div data-name="signup-container" className="mx-auto w-full max-w-[448px]">
        <div data-name="signup-brand-header" className="mb-9 text-center">
          <p className="text-[35px] leading-none font-bold tracking-tight text-white">ProfitPath</p>
        </div>

      <Card data-name="signup-card" className="border-0 bg-transparent shadow-none">
        <CardHeader className="px-0 pt-0">
          <CardTitle className="pb-[5px] text-[20px] leading-none font-semibold tracking-tight text-white text-center">Create your account</CardTitle>
        </CardHeader>
        <CardContent data-name="signup-card-content" className="px-0">
          <form data-name="signup-form" className="grid gap-4" onSubmit={onSubmit}>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="first-name" className="text-[14px] font-semibold text-[#e7ecfa]">First name</Label>
                <Input id="first-name" name="firstName" placeholder="First name" required className={controlClass} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="last-name" className="text-[14px] font-semibold text-[#e7ecfa]">Last name</Label>
                <Input id="last-name" name="lastName" placeholder="Last name" required className={controlClass} />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="title" className="text-[14px] font-semibold text-[#e7ecfa]">Title</Label>
                <select
                  id="title"
                  name="title"
                  className="flex h-[36px] w-full rounded-[8px] border border-[#314261] bg-[#1c2a45] px-4 text-[14px] text-white"
                  defaultValue=""
                >
                  <option value="" disabled>Select title</option>
                  <option value="mr">Mr</option>
                  <option value="ms">Ms</option>
                  <option value="mrs">Mrs</option>
                  <option value="dr">Dr</option>
                </select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="dob" className="text-[14px] font-semibold text-[#e7ecfa]">Date Of Birth</Label>
                <Input id="dob" name="dateOfBirth" type="date" className={controlClass} />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="country" className="text-[14px] font-semibold text-[#e7ecfa]">Country</Label>
              <select
                id="country"
                name="country"
                value={countryCode}
                onChange={(event) => {
                  const nextCode = event.target.value;
                  setCountryCode(nextCode);
                  const nextCountry = COUNTRY_OPTIONS.find((option) => option.code === nextCode);
                  if (nextCountry) {
                    setPhoneCode(nextCountry.dialCode);
                  }
                }}
                className="flex h-[36px] w-full rounded-[8px] border border-[#314261] bg-[#1c2a45] px-4 text-[14px] text-white"
              >
                {COUNTRY_OPTIONS.map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.name}
                  </option>
                ))}
              </select>
            </div>
            <input type="hidden" name="state" value={detectedState} readOnly />
            <input type="hidden" name="timezone" value={detectedTimezone} readOnly />
            <div className="grid gap-2">
              <Label htmlFor="email" className="text-[14px] font-semibold text-[#e7ecfa]">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                placeholder="Email"
                className={controlClass}
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="phone" className="text-[14px] font-semibold text-[#e7ecfa]">Phone Number</Label>
              <div className="grid grid-cols-[160px_1fr] gap-2">
                <select
                  id="phone-code"
                  name="phoneCode"
                  value={phoneCode}
                  onChange={(event) => setPhoneCode(event.target.value)}
                  className="flex h-[36px] w-full rounded-[8px] border border-[#314261] bg-[#1c2a45] px-4 text-[14px] text-white"
                >
                  {Array.from(new Map(COUNTRY_OPTIONS.map((option) => [option.dialCode, option])).values()).map((option) => (
                    <option key={option.dialCode} value={option.dialCode}>
                      {option.dialCode}
                    </option>
                  ))}
                </select>
                <Input id="phone" name="phone" placeholder="Phone number" className={controlClass} />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="password" className="text-[14px] font-semibold text-[#e7ecfa]">Password</Label>
                <Input id="password" name="password" type="password" minLength={6} required className={controlClass} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="confirm-password" className="text-[14px] font-semibold text-[#e7ecfa]">Confirm Password</Label>
                <Input id="confirm-password" name="confirmPassword" type="password" minLength={6} required className={controlClass} />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="referral-code" className="text-[14px] font-semibold text-[#e7ecfa]">Referral Code (Optional)</Label>
              <Input id="referral-code" name="referralCode" placeholder="Enter referral code" className={controlClass} />
            </div>
            <label className="mt-2 flex items-start gap-3 text-[14px] text-[#e7ecfa] leading-6">
              <input
                id="age-certification"
                name="ageCertification"
                type="checkbox"
                checked={isAgeCertified}
                onChange={(event) => setIsAgeCertified(event.target.checked)}
                className="mt-[3px] h-4 w-4 rounded border-[#314261] bg-[#1c2a45]"
                required
              />
              <span>
                I certify that I am 18 years of age or older, agree to the User Agreement, and acknowledge the Privacy policy.
              </span>
            </label>
            <Button type="submit" className={buttonClass} disabled={isSubmitting}>
              {isSubmitting ? "Creating account..." : "Create an account"}
            </Button>

            <div className="relative py-1 text-center text-[14px] uppercase tracking-wide text-[#95a6cb]">
              <span className="bg-transparent px-2">Or</span>
            </div>

            {googleClientId ? (
              <div className="relative h-[36px] w-full">
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
                  aria-label="Google sign-up button"
                />
              </div>
            ) : (
              <p className="text-xs text-[#95a6cb]">Google sign-up is unavailable. Set NEXT_PUBLIC_GOOGLE_CLIENT_ID to enable it.</p>
            )}
            {isGoogleSubmitting && <p className="text-sm text-center text-[#d2dced]">Signing up with Google...</p>}
            {message && <p className="text-sm text-center text-[#d2dced]">{message}</p>}
          </form>
          <div className="mt-8 text-center text-[14px] text-[#d5dff6]">
            Already have an account?{" "}
            <Link href="/signin" className="text-[14px] font-semibold text-[#4d79ff] hover:text-[#6a90ff]">
              Sign in
            </Link>
          </div>
        </CardContent>
      </Card>
      </div>
    </div>
  )
}
