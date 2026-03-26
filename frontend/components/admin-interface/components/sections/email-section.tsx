"use client";

import type React from "react";
import { useMemo, useRef, useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { SettingsSection } from "@/components/settings-interface/components/shared/settings-section";
import { toast } from "sonner";
import type { AdminPortalSettings } from "../../types";

interface EmailSectionProps {
  value: AdminPortalSettings["email"];
  onChange: (updates: Partial<AdminPortalSettings["email"]>) => void;
}

const ENCRYPTION_OPTIONS = [
  { value: "None", label: "None" },
  { value: "TLS", label: "TLS" },
  { value: "SSL", label: "SSL" },
];

const CHARSET_OPTIONS = [
  { value: "UTF-8", label: "UTF-8" },
  { value: "ISO-8859-1", label: "ISO-8859-1" },
  { value: "ASCII", label: "ASCII" },
];

export const EmailSection: React.FC<EmailSectionProps> = ({ value, onChange }) => {
  const [sendingTestEmail, setSendingTestEmail] = useState(false);
  const [testEmailAddress, setTestEmailAddress] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const previewHtml = useMemo(() => {
    const sampleContent = `
    <p style="margin:0 0 12px; text-align:center; font-size:18px; font-weight:600; color:#111827;">Hi John Doe</p>
    <hr style="border:0; border-bottom:1px solid #e5e7eb; margin:16px 0 22px;">
    <h1 style="margin:0 0 16px; font-size:32px; line-height:1.15; color:#0f172a; font-weight:700; text-align:center;">Notification Title</h1>
    <p style="margin:0 0 14px; font-size:16px; line-height:1.7; color:#334155;">This is a sample notification email. The actual content will be inserted here dynamically for each notification type.</p>
    <p style="margin:0 0 14px; font-size:16px; line-height:1.7; color:#334155;">If you need assistance, please contact our support team.</p>
    <p style="margin:20px 0 10px; text-align:center;">
      <a href="#" style="display:inline-block; background:#0b63f6; color:#ffffff; text-decoration:none; padding:10px 18px; border-radius:6px; font-weight:600;">Action Button</a>
    </p>
    <p style="margin:0 0 14px; font-size:16px; line-height:1.7; color:#334155;">Kind regards,<br><strong>${value.fromName || "BotPrimeX"} Team</strong></p>
  `;
    const header = value.predefinedHeader || "";
    const footer = value.predefinedFooter || "";
    return header + sampleContent + footer;
  }, [value.predefinedHeader, value.predefinedFooter, value.fromName]);

  useEffect(() => {
    if (!showPreview || !iframeRef.current) return;
    const doc = iframeRef.current.contentDocument;
    if (!doc) return;
    doc.open();
    doc.write(previewHtml);
    doc.close();
  }, [previewHtml, showPreview]);

  const handleSendTestEmail = async () => {
    if (!testEmailAddress.trim()) {
      toast.error("Please enter an email address to send test email");
      return;
    }

    if (!value.fromEmail.trim()) {
      toast.error("Please configure 'From Email' before sending a test email");
      return;
    }

    if (!value.smtpHost.trim()) {
      toast.error("Please configure 'SMTP Host' before sending a test email");
      return;
    }

    setSendingTestEmail(true);
    try {
      const response = await fetch("/api/admin/email/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toEmail: testEmailAddress,
          smtpConfig: {
            host: value.smtpHost,
            port: value.smtpPort,
            encryption: value.smtpEncryption,
            username: value.smtpUsername,
            password: value.smtpPassword,
            fromEmail: value.fromEmail,
            fromName: value.fromName,
            charset: value.emailCharset,
            predefinedHeader: value.predefinedHeader,
            predefinedFooter: value.predefinedFooter,
          },
        }),
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(result.error || result.detail || "Failed to send test email");
      }

      toast.success("Test email sent successfully!");
      setTestEmailAddress("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to send test email");
    } finally {
      setSendingTestEmail(false);
    }
  };

  return (
    <SettingsSection title="Email" description="Outgoing email defaults and SMTP settings">
      <div className="space-y-6">
        {/* Basic Settings */}
        <div>
          <h3 className="text-sm font-semibold mb-4">Basic Settings</h3>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="email-provider">Provider</Label>
              <Input
                id="email-provider"
                value={value.provider}
                onChange={(e) => onChange({ provider: e.target.value })}
                placeholder="e.g., SMTP"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="from-name">From Name</Label>
              <Input
                id="from-name"
                value={value.fromName}
                onChange={(e) => onChange({ fromName: e.target.value })}
                placeholder="e.g., BotPrimeX"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="from-email">From Email</Label>
              <Input
                id="from-email"
                type="email"
                value={value.fromEmail}
                onChange={(e) => onChange({ fromEmail: e.target.value })}
                placeholder="e.g., support@example.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reply-to">Reply To</Label>
              <Input
                id="reply-to"
                type="email"
                value={value.replyTo}
                onChange={(e) => onChange({ replyTo: e.target.value })}
                placeholder="e.g., support@example.com"
              />
            </div>
          </div>
        </div>

        {/* SMTP Configuration */}
        <div>
          <h3 className="text-sm font-semibold mb-4">SMTP Configuration</h3>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="smtp-host">SMTP Host</Label>
              <Input
                id="smtp-host"
                value={value.smtpHost}
                onChange={(e) => onChange({ smtpHost: e.target.value })}
                placeholder="e.g., smtp.gmail.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="smtp-port">SMTP Port</Label>
              <Input
                id="smtp-port"
                type="number"
                value={value.smtpPort}
                onChange={(e) => onChange({ smtpPort: Number(e.target.value || 0) })}
                placeholder="e.g., 587"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="smtp-encryption">Email Encryption</Label>
              <Select value={value.smtpEncryption} onValueChange={(val) => onChange({ smtpEncryption: val })}>
                <SelectTrigger id="smtp-encryption">
                  <SelectValue placeholder="Select encryption method" />
                </SelectTrigger>
                <SelectContent>
                  {ENCRYPTION_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="email-charset">Email Charset</Label>
              <Select value={value.emailCharset} onValueChange={(val) => onChange({ emailCharset: val })}>
                <SelectTrigger id="email-charset">
                  <SelectValue placeholder="Select charset" />
                </SelectTrigger>
                <SelectContent>
                  {CHARSET_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* SMTP Credentials */}
        <div>
          <h3 className="text-sm font-semibold mb-4">SMTP Credentials</h3>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="smtp-username">SMTP Username</Label>
              <Input
                id="smtp-username"
                value={value.smtpUsername}
                onChange={(e) => onChange({ smtpUsername: e.target.value })}
                placeholder="e.g., your-email@gmail.com"
                autoComplete="off"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="smtp-password">SMTP Password</Label>
              <Input
                id="smtp-password"
                type="password"
                value={value.smtpPassword}
                onChange={(e) => onChange({ smtpPassword: e.target.value })}
                placeholder="Enter your SMTP password"
                autoComplete="off"
              />
            </div>
          </div>
        </div>

        {/* Test Email */}
        <div className="border-t pt-6">
          <h3 className="text-sm font-semibold mb-4">Send Test Email</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Send a test email to verify that your SMTP settings are configured correctly.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-end">
            <div className="flex-1 space-y-2 min-w-0">
              <Label htmlFor="test-email-address">Test Email Address</Label>
              <Input
                id="test-email-address"
                type="email"
                value={testEmailAddress}
                onChange={(e) => setTestEmailAddress(e.target.value)}
                placeholder="Enter recipient email address"
              />
            </div>
            <Button
              onClick={handleSendTestEmail}
              disabled={sendingTestEmail}
              className="whitespace-nowrap"
            >
              {sendingTestEmail ? "Sending..." : "Send Test Email"}
            </Button>
          </div>
        </div>

        {/* Email Template */}
        <div className="border-t pt-6">
          <h3 className="text-sm font-semibold mb-4">Email Template</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Use these wrappers for all HTML emails. The content body is inserted between header and footer.
          </p>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email-predefined-header">Predefined Header</Label>
              <Textarea
                id="email-predefined-header"
                value={value.predefinedHeader}
                onChange={(e) => onChange({ predefinedHeader: e.target.value })}
                rows={12}
                className="font-mono text-xs"
                placeholder="<!DOCTYPE html>..."
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email-predefined-footer">Predefined Footer</Label>
              <Textarea
                id="email-predefined-footer"
                value={value.predefinedFooter}
                onChange={(e) => onChange({ predefinedFooter: e.target.value })}
                rows={12}
                className="font-mono text-xs"
                placeholder="</td>..."
              />
            </div>
          </div>
        </div>

        {/* Email Template Preview */}
        <div className="border-t pt-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold">Email Preview</h3>
              <p className="text-sm text-muted-foreground">
                Live preview of header + sample content + footer
              </p>
            </div>
            <Button
              variant={showPreview ? "default" : "outline"}
              size="sm"
              onClick={() => setShowPreview((prev) => !prev)}
            >
              {showPreview ? "Hide Preview" : "Show Preview"}
            </Button>
          </div>
          {showPreview && (
            <div className="rounded-lg border bg-muted/30 overflow-hidden">
              <iframe
                ref={iframeRef}
                title="Email Template Preview"
                sandbox="allow-same-origin"
                className="w-full border-0"
                style={{ height: 700 }}
              />
            </div>
          )}
        </div>
      </div>
    </SettingsSection>
  );
};
