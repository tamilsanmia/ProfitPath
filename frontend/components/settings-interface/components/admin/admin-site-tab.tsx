"use client"

import type React from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Shield, Wrench, BellRing, ImageIcon } from "lucide-react"
import { SettingsToggle } from "../shared/settings-toggle"
import type { AdminSiteSettings } from "../../types"

interface AdminSiteTabProps {
  adminSite: AdminSiteSettings
  onAdminSiteChange: (updates: Partial<AdminSiteSettings>) => void
}

export const AdminSiteTab: React.FC<AdminSiteTabProps> = ({ adminSite, onAdminSiteChange }) => {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Site Management</h2>
        <p className="text-muted-foreground">Admin controls for platform-wide operational behavior</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ImageIcon className="h-5 w-5" />
            <span>Site Branding</span>
          </CardTitle>
          <CardDescription>Manage core brand settings used across the site</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="admin-site-name">Site Name</Label>
            <Input
              id="admin-site-name"
              value={adminSite.siteName}
              onChange={(event) => onAdminSiteChange({ siteName: event.target.value })}
              placeholder="DefibotX"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="admin-site-tagline">Tagline</Label>
            <Input
              id="admin-site-tagline"
              value={adminSite.tagline}
              onChange={(event) => onAdminSiteChange({ tagline: event.target.value })}
              placeholder="AI Trading"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="admin-site-logo-url">Logo URL</Label>
            <Input
              id="admin-site-logo-url"
              value={adminSite.logoUrl}
              onChange={(event) => onAdminSiteChange({ logoUrl: event.target.value })}
              placeholder="https://cdn.example.com/logo.svg"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="admin-site-favicon-url">Favicon URL</Label>
            <Input
              id="admin-site-favicon-url"
              value={adminSite.faviconUrl}
              onChange={(event) => onAdminSiteChange({ faviconUrl: event.target.value })}
              placeholder="https://cdn.example.com/favicon.ico"
            />
          </div>

          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="admin-site-footer-text">Footer Text</Label>
            <Textarea
              id="admin-site-footer-text"
              value={adminSite.footerText}
              onChange={(event) => onAdminSiteChange({ footerText: event.target.value })}
              placeholder="Trade smarter with DefibotX."
              rows={2}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            <span>Platform Controls</span>
          </CardTitle>
          <CardDescription>Enable or disable key site operations</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <SettingsToggle
            id="admin-registrations-open"
            label="Allow New Registrations"
            description="Toggle whether new users can sign up."
            checked={adminSite.registrationsOpen}
            onCheckedChange={(checked) => onAdminSiteChange({ registrationsOpen: checked })}
          />

          <SettingsToggle
            id="admin-subscriptions-open"
            label="Allow New Subscriptions"
            description="Toggle whether users can start new subscription plans."
            checked={adminSite.subscriptionsOpen}
            onCheckedChange={(checked) => onAdminSiteChange({ subscriptionsOpen: checked })}
          />

          <SettingsToggle
            id="admin-readonly-api"
            label="Read-only API Mode"
            description="Toggle read-only mode for management workflows during incident response."
            checked={adminSite.readOnlyApi}
            onCheckedChange={(checked) => onAdminSiteChange({ readOnlyApi: checked })}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BellRing className="h-5 w-5" />
            <span>Site Announcement</span>
          </CardTitle>
          <CardDescription>Broadcast operational messages for users</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <SettingsToggle
            id="admin-announcement-enabled"
            label="Enable Announcement Banner"
            description="Enable a global announcement message configuration."
            checked={adminSite.announcementEnabled}
            onCheckedChange={(checked) => onAdminSiteChange({ announcementEnabled: checked })}
          />

          <div className="space-y-2">
            <Label htmlFor="admin-announcement-message">Announcement Message</Label>
            <Textarea
              id="admin-announcement-message"
              value={adminSite.announcementMessage}
              onChange={(event) => onAdminSiteChange({ announcementMessage: event.target.value })}
              placeholder="Example: Scheduled maintenance on Saturday 02:00 UTC"
              disabled={!adminSite.announcementEnabled}
              rows={3}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wrench className="h-5 w-5" />
            <span>Operational Defaults</span>
          </CardTitle>
          <CardDescription>Set baseline values used by site operators</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="admin-support-email">Support Contact Email</Label>
            <Input
              id="admin-support-email"
              type="email"
              value={adminSite.supportEmail}
              onChange={(event) => onAdminSiteChange({ supportEmail: event.target.value })}
              placeholder="support@defibotx.com"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="admin-max-bots">Max Bots Per User</Label>
            <Input
              id="admin-max-bots"
              type="number"
              min={1}
              max={100}
              value={adminSite.maxBotsPerUser}
              onChange={(event) => onAdminSiteChange({ maxBotsPerUser: Math.max(1, Number(event.target.value || 1)) })}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
