"use client";

import { type FormEvent, useState } from "react";
import Link from "next/link";
import { addBrowserLog } from "@/lib/browser-log";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function ForgotPasswordPage() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const controlClass = "h-[36px] w-full max-w-[384px] rounded-[8px] border-[#314261] bg-[#1c2a45] px-4 text-[14px] text-white placeholder:text-[#8fa0c3] placeholder:text-[14px]";
  const buttonClass = "h-[36px] w-full max-w-[384px] rounded-[8px] bg-[#3d63e6] hover:bg-[#4a70f0] text-[14px] font-semibold";

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setIsSubmitting(true);

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "");

    try {
      addBrowserLog("forgot_password_attempt", email);
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const result = await response.json();
      if (!response.ok) {
        addBrowserLog("forgot_password_failed", result.error ?? email);
        setMessage(result.error ?? "Failed to send reset email.");
        return;
      }

      addBrowserLog("forgot_password_sent", email);
      setMessage(result.message ?? "If an account exists for this email, a reset link has been sent.");
    } catch {
      addBrowserLog("forgot_password_network_error", email);
      setMessage("Network error while requesting password reset.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div data-name="page-auth-forgot-password" className="min-h-screen bg-[#111827] text-white px-4 py-10 flex items-center justify-center">
      <div data-name="forgot-password-container" className="mx-auto w-full max-w-[384px]">
      <div data-name="forgot-password-brand-header" className="mb-9 text-center">
        <p className="text-[35px] leading-none font-bold tracking-tight text-white">BotPrimeX</p>
      </div>
      <Card data-name="forgot-password-card" className="border-0 bg-transparent shadow-none">
        <CardHeader className="px-0 pt-0">
          <CardTitle className="pb-[5px] text-[20px] leading-none font-semibold tracking-tight text-white text-center">Forgot Password</CardTitle>
        </CardHeader>
        <CardContent data-name="forgot-password-card-content" className="px-0">
          <form data-name="forgot-password-form" className="grid gap-4" onSubmit={onSubmit}>
            <div className="grid gap-2">
              <Label htmlFor="email" className="text-[14px] font-semibold text-[#e7ecfa]">Email address</Label>
              <Input id="email" name="email" type="email" placeholder="" className={controlClass} required />
            </div>
            <Button type="submit" className={buttonClass} disabled={isSubmitting}>
              {isSubmitting ? "Sending..." : "Send Reset Link"}
            </Button>
            {message && <p className="text-sm text-center text-[#d2dced]">{message}</p>}
          </form>
          <div className="mt-8 text-center text-[14px] text-[#d5dff6]">
            Remembered your password?{" "}
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
