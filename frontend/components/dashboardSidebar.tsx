"use client";

import type React from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";
import { addBrowserLog } from "@/lib/browser-log";
import { AVATAR_UPDATED_EVENT } from "@/lib/local-avatar";
import {
  Bot,
  CreditCard,
  LayoutDashboard,
  LineChart,
  LogOut,
  Settings,
  Shield,
  UserPlus,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useTheme } from "next-themes";

type MenuItem = {
  id: string;
  label: string;
  icon: React.ElementType;
  href?: string;
};

type MenuSection = {
  section: string;
  items: MenuItem[];
};

type Props = {
  collapsed: boolean;
};

export function DashboardSidebar({ collapsed }: Props) {
  const { theme } = useTheme();
  const resolveAvatarSrc = (value: string | null | undefined): string | undefined => {
    if (!value) {
      return undefined;
    }

    const normalized = value.trim();
    if (!normalized || normalized === "/placeholder-user.jpg") {
      return undefined;
    }

    let resolved = normalized;
    if (typeof window !== "undefined") {
      if (resolved.includes("/media/profile-pictures/")) {
        const marker = "/media/profile-pictures/";
        const markerIndex = resolved.indexOf(marker);
        const rawPath = markerIndex >= 0 ? resolved.slice(markerIndex + marker.length) : "";
        const fileName = rawPath.split("/")[0].split("?")[0].trim();
        if (fileName) {
          return `/api/profile/avatar-file?file=${encodeURIComponent(fileName)}&v=${Date.now()}`;
        }
      }

      resolved = resolved
        .replace(/^https?:\/\/localhost:\d+/i, window.location.origin)
        .replace(/^https?:\/\/host\.docker\.internal:\d+/i, window.location.origin);
    }

    if (resolved.includes("/media/profile-pictures/")) {
      const separator = resolved.includes("?") ? "&" : "?";
      resolved = `${resolved}${separator}v=1`;
    }

    return resolved;
  };

  const pathname = usePathname();
  const [activeItem, setActiveItem] = useState("");
  const [sessionUser, setSessionUser] = useState<{
    first_name: string;
    last_name: string;
    username?: string;
    email?: string;
    avatar?: string;
    is_admin?: boolean;
  } | null>(null);
  const [avatarSrc, setAvatarSrc] = useState<string | null>(null);
  const [siteBranding, setSiteBranding] = useState({
    siteTitle: "DefibotX",
    tagline: "AI Trading",
    companyLogoLightUrl: "",
    companyLogoDarkUrl: "",
    faviconUrl: "",
    companyMainDomain: "",
    footerText: "",
  });

  // Set active item based on pathname
  useEffect(() => {
    if (pathname === "/") {
      setActiveItem("dashboard");
    } else if (pathname.startsWith("/my-bots") || pathname.startsWith("/my-analytics")) {
      setActiveItem("my-bots");
    } else if (pathname.startsWith("/invite-friends")) {
      setActiveItem("invite-friends");
    } else if (pathname.startsWith("/subscription")) {
      setActiveItem("subscription");
    } else if (pathname.startsWith("/admin")) {
      setActiveItem("admin");
    } else if (pathname.startsWith("/settings")) {
      setActiveItem("settings");
    } else if (pathname.startsWith("/profile") || pathname.startsWith("/settings?tab=profile")) {
      setActiveItem("profile");
    } else {
      // Extract the main path without subpaths
      const mainPath = pathname.split("/")[1];
      if (mainPath) {
        setActiveItem(mainPath);
      }
    }
  }, [pathname]);

  // Load current authenticated user for sidebar profile and auth actions
  useEffect(() => {
    let isMounted = true;

    async function loadSessionUser() {
      try {
        const response = await fetch("/api/auth/me", { cache: "no-store" });
        const payload = await response.json();
        if (!isMounted) {
          return;
        }

        if (response.ok && payload?.user) {
          setSessionUser(payload.user);
          setAvatarSrc(resolveAvatarSrc(typeof payload.user.avatar === "string" ? payload.user.avatar : null) ?? null);
        } else {
          setSessionUser(null);
          setAvatarSrc(null);
        }
      } catch {
        if (isMounted) {
          setSessionUser(null);
          setAvatarSrc(null);
        }
      }
    }

    loadSessionUser();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    const handleAvatarUpdate = (event: Event) => {
      const customEvent = event as CustomEvent<{ email?: string; avatarUrl?: string }>;
      const detailEmail = customEvent.detail?.email;

      if (detailEmail && detailEmail !== sessionUser?.email) {
        return;
      }

      if (typeof customEvent.detail?.avatarUrl === "string") {
        setAvatarSrc(resolveAvatarSrc(customEvent.detail.avatarUrl) ?? null);
      }
    };

    window.addEventListener(AVATAR_UPDATED_EVENT, handleAvatarUpdate);

    return () => {
      window.removeEventListener(AVATAR_UPDATED_EVENT, handleAvatarUpdate);
    };
  }, [sessionUser?.email]);

  useEffect(() => {
    let isMounted = true;

    async function loadSiteBranding() {
      try {
        const response = await fetch("/api/settings", { cache: "no-store" });
        const payload = await response.json();
        if (!isMounted || !response.ok) {
          return;
        }

        const adminSite = payload?.settings?.adminSite;
        if (!adminSite || typeof adminSite !== "object") {
          return;
        }

        setSiteBranding((prev) => ({
          siteTitle: typeof adminSite.siteTitle === "string" && adminSite.siteTitle.trim()
            ? adminSite.siteTitle.trim()
            : typeof adminSite.siteName === "string" && adminSite.siteName.trim()
              ? adminSite.siteName.trim()
              : prev.siteTitle,
          tagline: typeof adminSite.tagline === "string" ? adminSite.tagline.trim() : prev.tagline,
          companyLogoLightUrl: typeof adminSite.companyLogoLightUrl === "string" && adminSite.companyLogoLightUrl.trim()
            ? adminSite.companyLogoLightUrl.trim()
            : typeof adminSite.logoUrl === "string"
              ? adminSite.logoUrl.trim()
              : prev.companyLogoLightUrl,
          companyLogoDarkUrl: typeof adminSite.companyLogoDarkUrl === "string" && adminSite.companyLogoDarkUrl.trim()
            ? adminSite.companyLogoDarkUrl.trim()
            : typeof adminSite.logoUrl === "string"
              ? adminSite.logoUrl.trim()
              : prev.companyLogoDarkUrl,
          faviconUrl: typeof adminSite.faviconUrl === "string" ? adminSite.faviconUrl.trim() : prev.faviconUrl,
          companyMainDomain: typeof adminSite.companyMainDomain === "string" ? adminSite.companyMainDomain.trim() : prev.companyMainDomain,
          footerText: typeof adminSite.footerText === "string" ? adminSite.footerText.trim() : prev.footerText,
        }));
      } catch {
        // No-op: keep defaults when settings cannot be loaded.
      }
    }

    void loadSiteBranding();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const titleBase = siteBranding.siteTitle || "DefibotX";
    const titleSuffix = siteBranding.tagline ? ` - ${siteBranding.tagline}` : "";
    document.title = `${titleBase}${titleSuffix}`;

    if (!siteBranding.faviconUrl) {
      return;
    }

    const existing = document.querySelector('link[rel~="icon"]') as HTMLLinkElement | null;
    if (existing) {
      existing.href = siteBranding.faviconUrl;
      return;
    }

    const link = document.createElement("link");
    link.rel = "icon";
    link.href = siteBranding.faviconUrl;
    document.head.appendChild(link);
  }, [siteBranding.faviconUrl, siteBranding.siteTitle, siteBranding.tagline]);

  const activeLogoUrl = theme === "light"
    ? siteBranding.companyLogoLightUrl || siteBranding.companyLogoDarkUrl
    : siteBranding.companyLogoDarkUrl || siteBranding.companyLogoLightUrl;

  const menuItems: MenuSection[] = [
    {
      section: "Main",
      items: [
        { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, href: "/" },
        { id: "my-bots", label: "My Bots", icon: LineChart, href: "/my-bots" },
        { id: "invite-friends", label: "Invite Friends", icon: UserPlus, href: "/invite-friends" },
        { id: "subscription", label: "Subscription", icon: CreditCard, href: "/subscription" },
      ],
    },
  ];

  const footerItems = [
    ...(sessionUser?.is_admin
      ? [{ id: "admin", label: "Admin", icon: Shield, href: "/admin" }]
      : []),
    { id: "settings", label: "Settings", icon: Settings, href: "/settings" },
    { id: "logout", label: "Logout", icon: LogOut, href: "/api/auth/logout" },
  ];

  const displayName = sessionUser ? `${sessionUser.first_name} ${sessionUser.last_name}` : "Guest User";
  const initials = sessionUser
    ? `${sessionUser.first_name?.[0] ?? "G"}${sessionUser.last_name?.[0] ?? "U"}`.toUpperCase()
    : "GU";

  const handleLogout = () => {
    addBrowserLog("logout", sessionUser?.email ?? "unknown-user");
    window.location.href = "/api/auth/logout";
  };

  return (
    <>
      {/* Sidebar */}
      <aside className={cn("fixed flex h-full flex-col border-r border-border bg-card transition-all duration-300 ease-in-out z-40", collapsed ? "w-[72px]" : " left-0 w-[240px]")}>
        {/* Header */}
        <div className={cn("flex h-16 items-center py-4", collapsed ? "justify-center px-0" : "justify-center px-3")}>
          <div className="flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary">
              {activeLogoUrl ? (
                <img src={activeLogoUrl} alt={siteBranding.siteTitle || "Site logo"} className="h-7 w-7 object-contain" />
              ) : (
                <Bot className="h-6 w-6 text-primary-foreground" />
              )}
            </div>
            {!collapsed && (
              <div className="flex flex-col">
                <span className="text-lg font-semibold tracking-tight">{siteBranding.siteTitle || "DefibotX"}</span>
                <span className="text-xs text-muted-foreground">{siteBranding.tagline || "AI Trading"}</span>
              </div>
            )}
          </div>
        </div>

        {/* Wrap the entire sidebar content in a TooltipProvider */}
        <TooltipProvider delayDuration={0}>
          {/* Menu sections */}
          <div className="flex-1 overflow-auto py-2">
            {menuItems.map((section) => (
              <div key={section.section} className="px-3 py-2">
                {!collapsed && <div className="mb-2 px-2 text-xs font-medium text-muted-foreground">{section.section}</div>}
                <div className="space-y-1">
                  {section.items.map((item) => {
                    const Icon = item.icon;
                    const isActive = activeItem === item.id;

                    return (
                      <Tooltip key={item.id}>
                        <TooltipTrigger asChild>
                          {item.href ? (
                            <Button variant={isActive ? "secondary" : "ghost"} className={cn("w-full justify-start", collapsed ? "px-2 justify-center" : "px-4")} asChild>
                              <Link href={item.href}>
                                <Icon className={cn("h-5 w-5", collapsed ? "mr-0" : "mr-2")} />
                                {!collapsed && <span>{item.label}</span>}
                              </Link>
                            </Button>
                          ) : (
                            <Button variant={isActive ? "secondary" : "ghost"} className={cn("w-full justify-start", collapsed ? "px-2 justify-center" : "px-2")} onClick={() => setActiveItem(item.id)}>
                              <Icon className={cn("h-5 w-5", collapsed ? "mr-0" : "mr-2")} />
                              {!collapsed && <span>{item.label}</span>}
                            </Button>
                          )}
                        </TooltipTrigger>
                        {collapsed && (
                          <TooltipContent side="right" className="font-normal">
                            {item.label}
                          </TooltipContent>
                        )}
                      </Tooltip>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div className="mt-auto border-t border-border p-3">
            <div className="space-y-1">
              {footerItems.map((item) => {
                const Icon = item.icon;
                return (
                  <Tooltip key={item.id}>
                    <TooltipTrigger asChild>
                      {item.id === "logout" ? (
                        <Button variant="ghost" className={cn("w-full justify-start", collapsed ? "px-2 justify-center" : "px-2")} onClick={handleLogout}>
                          <Icon className={cn("h-5 w-5", collapsed ? "mr-0" : "mr-2")} />
                          {!collapsed && <span>{item.label}</span>}
                        </Button>
                      ) : item.href ? (
                        <Button variant="ghost" className={cn("w-full justify-start", collapsed ? "px-2 justify-center" : "px-2")} asChild>
                          <Link href={item.href}>
                            <Icon className={cn("h-5 w-5", collapsed ? "mr-0" : "mr-2")} />
                            {!collapsed && <span>{item.label}</span>}
                          </Link>
                        </Button>
                      ) : (
                        <Button variant="ghost" className={cn("w-full justify-start", collapsed ? "px-2 justify-center" : "px-2")} onClick={() => setActiveItem(item.id)}>
                          <Icon className={cn("h-5 w-5", collapsed ? "mr-0" : "mr-2")} />
                          {!collapsed && <span>{item.label}</span>}
                        </Button>
                      )}
                    </TooltipTrigger>
                    {collapsed && (
                      <TooltipContent side="right" className="font-normal">
                        {item.label}
                      </TooltipContent>
                    )}
                  </Tooltip>
                );
              })}
            </div>

            <div className="mt-2 flex justify-center">
              {collapsed ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div>
                      <ThemeToggle variant="ghost" className="h-9 w-9" />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="font-normal">
                    Theme (Light / Dark / System)
                  </TooltipContent>
                </Tooltip>
              ) : (
                <ThemeToggle variant="ghost" className="h-9 w-9" />
              )}
            </div>

            <Separator className="my-2" />

            <div className={cn("flex items-center", collapsed ? "justify-center" : "justify-between")}>
              {!collapsed && (
                <Link href="/settings?tab=profile" className="flex items-center gap-2">
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={resolveAvatarSrc(avatarSrc)} />
                    <AvatarFallback>{initials}</AvatarFallback>
                  </Avatar>
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">{displayName}</span>
                    <span className="text-xs text-muted-foreground">{sessionUser ? "Authenticated" : "Guest"}</span>
                  </div>
                </Link>
              )}

              {collapsed && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Link href="/settings?tab=profile" aria-label="Profile">
                      <Avatar className="h-8 w-8 cursor-pointer">
                        <AvatarImage src={resolveAvatarSrc(avatarSrc)} />
                        <AvatarFallback>{initials}</AvatarFallback>
                      </Avatar>
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="font-normal">
                    {displayName} ({sessionUser ? "Authenticated" : "Guest"})
                  </TooltipContent>
                </Tooltip>
              )}
            </div>

            {!collapsed && siteBranding.footerText && (
              <p className="mt-3 px-1 text-center text-[11px] text-muted-foreground">{siteBranding.footerText}</p>
            )}
          </div>
        </TooltipProvider>
      </aside>
    </>
  );
}
