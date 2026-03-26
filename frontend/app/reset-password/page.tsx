"use client";

import { type FormEvent, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { addBrowserLog } from "@/lib/browser-log";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function ResetPasswordPage() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const controlClass = "h-[36px] w-full max-w-[384px] rounded-[8px] border-[#314261] bg-[#1c2a45] px-4 text-[14px] text-white placeholder:text-[#8fa0c3] placeholder:text-[14px]";
  const buttonClass = "h-[36px] w-full max-w-[384px] rounded-[8px] bg-[#3d63e6] hover:bg-[#4a70f0] text-[14px] font-semibold";

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");

    if (!token) {
      setMessage("Missing reset token.");
      return;
    }

    const formData = new FormData(event.currentTarget);
    const password = String(formData.get("password") ?? "");
    const confirmPassword = String(formData.get("confirmPassword") ?? "");

    if (password !== confirmPassword) {
      setMessage("Passwords do not match.");
      return;
    }

    setIsSubmitting(true);

    try {
      addBrowserLog("reset_password_attempt", token.slice(0, 8));
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });

      const result = await response.json();
      if (!response.ok) {
        addBrowserLog("reset_password_failed", result.error ?? "invalid-token");
        setMessage(result.error ?? "Failed to reset password.");
        return;
      }

      addBrowserLog("reset_password_success", "password-updated");
      setMessage(result.message ?? "Password has been reset successfully.");
      event.currentTarget.reset();
    } catch {
      addBrowserLog("reset_password_network_error", "request-failed");
      setMessage("Network error while resetting password.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div data-name="page-auth-reset-password" className="min-h-screen bg-[#111827] text-white px-4 py-10 flex items-center justify-center">
      <div data-name="reset-password-container" className="mx-auto w-full max-w-[384px]">
      <div data-name="reset-password-brand-header" className="mb-9 text-center">
        <p className="text-[35px] leading-none font-bold tracking-tight text-white">BotPrimeX</p>
      </div>
      <Card data-name="reset-password-card" className="border-0 bg-transparent shadow-none">
        <CardHeader className="px-0 pt-0">
          <CardTitle className="pb-[5px] text-[20px] leading-none font-semibold tracking-tight text-white text-center">Reset Password</CardTitle>
          <CardDescription className="text-center text-[14px] text-[#95a6cb]">Enter a new password for your account.</CardDescription>
        </CardHeader>
        <CardContent data-name="reset-password-card-content" className="px-0">
          <form data-name="reset-password-form" className="grid gap-4" onSubmit={onSubmit}>
            <div className="grid gap-2">
              <Label htmlFor="password" className="text-[14px] font-semibold text-[#e7ecfa]">New Password</Label>
              <Input id="password" name="password" type="password" minLength={6} className={controlClass} required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="confirmPassword" className="text-[14px] font-semibold text-[#e7ecfa]">Confirm Password</Label>
              <Input id="confirmPassword" name="confirmPassword" type="password" minLength={6} className={controlClass} required />
            </div>
            <Button type="submit" className={buttonClass} disabled={isSubmitting}>
              {isSubmitting ? "Updating..." : "Reset Password"}
            </Button>
            {message && <p className="text-sm text-center text-[#d2dced]">{message}</p>}
          </form>
          <div className="mt-8 text-center text-[14px] text-[#d5dff6]">
            Back to{" "}
            <Link href="/signin" className="text-[14px] font-semibold text-[#4d79ff] hover:text-[#6a90ff]">
              Sign in
            </Link>
          </div>
        </CardContent>
      </Card>
      </div>
    </div>
  );
}
