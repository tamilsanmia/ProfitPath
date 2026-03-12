"use client";

import { useEffect, useState } from "react";
import { addBrowserLog } from "@/lib/browser-log";
import { AVATAR_UPDATED_EVENT } from "@/lib/local-avatar";
import { ThemeToggle } from "@/components/theme-toggle";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Bell, ChevronDown, LogOut, Settings, User } from "lucide-react";
import Link from "next/link";

type BackendUser = {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  avatar?: string;
};

type ReferralRecord = {
  id: number;
  invite_name: string;
  status: "active" | "pending";
  created_at: string;
};

type TopbarNotification = {
  id: string;
  title: string;
  message: string;
  time: string;
  unread: boolean;
};

type NotificationPreferences = {
  readIds: string[];
  dismissedIds: string[];
};

function getNotificationPrefsKey(email?: string): string {
  return `pp_notifications:${email ?? "guest"}`;
}

function loadNotificationPreferences(email?: string): NotificationPreferences {
  if (typeof window === "undefined") {
    return { readIds: [], dismissedIds: [] };
  }

  try {
    const raw = window.localStorage.getItem(getNotificationPrefsKey(email));
    if (!raw) {
      return { readIds: [], dismissedIds: [] };
    }

    const parsed = JSON.parse(raw) as Partial<NotificationPreferences>;
    return {
      readIds: Array.isArray(parsed.readIds) ? parsed.readIds : [],
      dismissedIds: Array.isArray(parsed.dismissedIds) ? parsed.dismissedIds : [],
    };
  } catch {
    return { readIds: [], dismissedIds: [] };
  }
}

function saveNotificationPreferences(email: string | undefined, preferences: NotificationPreferences): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(getNotificationPrefsKey(email), JSON.stringify(preferences));
}

export function Topbar() {
  const resolveAvatarSrc = (value: string | null | undefined): string | undefined => {
    if (!value) {
      return undefined;
    }

    const normalized = value.trim();
    if (!normalized || normalized === "/placeholder-user.jpg") {
      return undefined;
    }

    return normalized;
  };

  const [latestUser, setLatestUser] = useState<BackendUser | null>(null);
  const [avatarSrc, setAvatarSrc] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<TopbarNotification[]>([]);

  useEffect(() => {
    let isMounted = true;

    const toRelativeTime = (value: string): string => {
      const timestamp = new Date(value).getTime();
      if (Number.isNaN(timestamp)) {
        return "Now";
      }

      const diffMs = Date.now() - timestamp;
      const minutes = Math.floor(diffMs / 60000);
      const hours = Math.floor(diffMs / 3600000);
      const days = Math.floor(diffMs / 86400000);

      if (minutes < 1) return "Now";
      if (minutes < 60) return `${minutes} min ago`;
      if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
      return `${days} day${days === 1 ? "" : "s"} ago`;
    };

    async function loadTopbarData() {
      try {
        const [meResponse, healthResponse, referralsResponse] = await Promise.all([
          fetch("/api/auth/me", { cache: "no-store" }),
          fetch("/api/system/health", { cache: "no-store" }),
          fetch("/api/referrals", { cache: "no-store" }),
        ]);

        const mePayload = await meResponse.json();
        await healthResponse.json();
        const referralsPayload = await referralsResponse.json();

        if (!isMounted) {
          return;
        }

        if (meResponse.ok && mePayload?.user) {
          setLatestUser(mePayload.user);
          setAvatarSrc(resolveAvatarSrc(typeof mePayload.user.avatar === "string" ? mePayload.user.avatar : null) ?? null);
        }

        const preferenceEmail = meResponse.ok && mePayload?.user?.email ? String(mePayload.user.email) : undefined;
        const preferences = loadNotificationPreferences(preferenceEmail);

        const referralNotifications: TopbarNotification[] = Array.isArray(referralsPayload?.referrals)
          ? (referralsPayload.referrals as ReferralRecord[])
              .slice(0, 5)
              .map((referral) => ({
                id: `referral-${referral.id}`,
                title: referral.status === "active" ? "Referral Joined" : "Referral Invite",
                message:
                  referral.status === "active"
                    ? `${referral.invite_name} signed up using your referral link.`
                    : `${referral.invite_name} is pending from your referral invite.`,
                time: toRelativeTime(referral.created_at),
                unread: true,
              }))
          : [];

        const seededNotifications: TopbarNotification[] = [
          {
            id: "security-tip",
            title: "Security Tip",
            message: "Enable strong passwords and rotate bot API keys monthly.",
            time: "Today",
            unread: true,
          },
        ];

        if (meResponse.ok && mePayload?.user) {
          seededNotifications.unshift({
            id: "welcome-user",
            title: "Welcome Back",
            message: `Signed in as ${mePayload.user.first_name} ${mePayload.user.last_name}`,
            time: "Now",
            unread: true,
          });
        }

        const mergedNotifications = [...referralNotifications, ...seededNotifications]
          .filter((item) => !preferences.dismissedIds.includes(item.id))
          .map((item) => ({
            ...item,
            unread: !preferences.readIds.includes(item.id),
          }));

        setNotifications(mergedNotifications);
      } catch {
        if (isMounted) {
          const preferences = loadNotificationPreferences(undefined);
          setNotifications([
            {
              id: "backend-error",
              title: "System Warning",
              message: "Unable to load topbar status. Please check backend connectivity.",
              time: "Now",
              unread: !preferences.readIds.includes("backend-error"),
            },
          ].filter((item) => !preferences.dismissedIds.includes(item.id)));
        }
      }
    }

    loadTopbarData();

    return () => {
      isMounted = false;
    };
  }, []);

  const displayName = latestUser ? `${latestUser.first_name} ${latestUser.last_name}` : "Guest User";
  const initials = latestUser
    ? `${latestUser.first_name[0] ?? "G"}${latestUser.last_name[0] ?? "U"}`.toUpperCase()
    : "GU";

  useEffect(() => {
    const handleAvatarUpdate = (event: Event) => {
      const customEvent = event as CustomEvent<{ email?: string; avatarUrl?: string }>;
      const detailEmail = customEvent.detail?.email;

      if (detailEmail && detailEmail !== latestUser?.email) {
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
  }, [latestUser?.email]);

  const handleLogout = () => {
    addBrowserLog("logout", latestUser?.email ?? "unknown-user");
    window.location.href = "/api/auth/logout";
  };

  const unreadCount = notifications.filter((item) => item.unread).length;

  const markAllNotificationsRead = () => {
    setNotifications((prev) => {
      const updated = prev.map((item) => ({ ...item, unread: false }));
      const preferences = loadNotificationPreferences(latestUser?.email);
      const mergedReadIds = Array.from(new Set([...preferences.readIds, ...updated.map((item) => item.id)]));
      saveNotificationPreferences(latestUser?.email, {
        ...preferences,
        readIds: mergedReadIds,
      });
      return updated;
    });
  };

  const dismissNotification = (notificationId: string) => {
    setNotifications((prev) => {
      const preferences = loadNotificationPreferences(latestUser?.email);
      const dismissedIds = Array.from(new Set([...preferences.dismissedIds, notificationId]));
      const readIds = Array.from(new Set([...preferences.readIds, notificationId]));
      saveNotificationPreferences(latestUser?.email, {
        readIds,
        dismissedIds,
      });
      return prev.filter((item) => item.id !== notificationId);
    });
  };

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-background px-4 lg:h-16 lg:px-6">
      {/* Left section */}
      <div className="flex items-center gap-4" />

      {/* Right section */}
      <div className="flex items-center gap-2">
        <ThemeToggle variant="ghost" className="hidden sm:flex" />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" className="relative">
              <Bell className="h-4 w-4" />
              {unreadCount > 0 && <Badge className="absolute -right-1 flex items-center justify-center -top-1 h-4 min-w-4 px-1 text-[10px]">{unreadCount > 9 ? "9+" : unreadCount}</Badge>}
              <span className="sr-only">Notifications</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-[300px]">
            <DropdownMenuLabel className="flex items-center justify-between">
              <span>Notifications</span>
              {notifications.length > 0 && (
                <button
                  type="button"
                  className="text-xs font-medium text-primary"
                  onClick={markAllNotificationsRead}
                >
                  Mark all read
                </button>
              )}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {notifications.length === 0 ? (
              <DropdownMenuItem className="cursor-default justify-center text-sm text-muted-foreground">No notifications</DropdownMenuItem>
            ) : (
              notifications.map((item) => (
                <NotificationItem key={item.id} title={item.title} message={item.message} time={item.time} unread={item.unread} onDismiss={() => dismissNotification(item.id)} />
              ))
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-2">
              <Avatar className="h-6 w-6">
                <AvatarImage src={resolveAvatarSrc(avatarSrc)} />
                <AvatarFallback>{initials}</AvatarFallback>
              </Avatar>
              <span className="hidden md:inline-flex">{displayName}</span>
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>My Account</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem>
              <Settings className="mr-2 h-4 w-4" />
              <Link href="/settings">Settings</Link>
            </DropdownMenuItem>
            {!latestUser && (
              <>
                <DropdownMenuItem>
                  <User className="mr-2 h-4 w-4" />
                  <Link href="/signin">Signin</Link>
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <User className="mr-2 h-4 w-4" />
                  <Link href="/signup">Sign Up</Link>
                </DropdownMenuItem>
              </>
            )}
            {latestUser && (
              <>
                <DropdownMenuItem>
                  <LogOut className="mr-2 h-4 w-4" />
                  <button type="button" onClick={handleLogout} className="w-full text-left">
                    Logout
                  </button>
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuSeparator className="sm:hidden" />
            <div className="px-2 py-1.5 sm:hidden">
              <ThemeToggle className="w-full" />
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

function NotificationItem({
  title,
  message,
  time,
  unread,
  onDismiss,
}: {
  title: string;
  message: string;
  time: string;
  unread: boolean;
  onDismiss: () => void;
}) {
  return (
    <DropdownMenuItem className="flex cursor-default flex-col items-start gap-1 py-2">
      <div className="flex w-full items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          {unread && <span className="h-2 w-2 rounded-full bg-primary" />}
          <span className="font-medium">{title}</span>
        </div>
        <span className="text-xs text-muted-foreground">{time}</span>
      </div>
      <span className="text-xs">{message}</span>
      <button type="button" className="text-xs font-medium text-primary" onClick={onDismiss}>
        Dismiss
      </button>
    </DropdownMenuItem>
  );
}
