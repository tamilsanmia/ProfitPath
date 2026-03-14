"use client"

import type React from "react"
import { useState, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Upload, Camera, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { createSettingsTranslator } from "../../i18n"

interface AvatarUploadProps {
  currentAvatar: string
  userName: string
  onAvatarChange: (avatar: string) => void
  language: string
}

export const AvatarUpload: React.FC<AvatarUploadProps> = ({ currentAvatar, userName, onAvatarChange, language }) => {
  const t = createSettingsTranslator(language)
  const hasAvatar = currentAvatar.trim() !== "" && currentAvatar.trim() !== "/placeholder-user.jpg"

    const resolveAvatarSrc = (value: string): string | undefined => {
      const normalized = value.trim()
      if (!normalized) {
        return undefined
      }

      if (normalized === "/placeholder-user.jpg") {
        return undefined
      }

      let resolved = normalized
      if (typeof window !== "undefined") {
        if (resolved.includes("/media/profile-pictures/")) {
          const marker = "/media/profile-pictures/"
          const markerIndex = resolved.indexOf(marker)
          const rawPath = markerIndex >= 0 ? resolved.slice(markerIndex + marker.length) : ""
          const fileName = rawPath.split("/")[0].split("?")[0].trim()
          if (fileName) {
            return `/api/profile/avatar-file?file=${encodeURIComponent(fileName)}&v=${Date.now()}`
          }

          try {
            const parsed = new URL(resolved)
            resolved = `${window.location.origin}${parsed.pathname}`
          } catch {
            if (markerIndex >= 0) {
              resolved = `${window.location.origin}${resolved.slice(markerIndex)}`
            }
          }
        }

        resolved = resolved
          .replace(/^https?:\/\/localhost:\d+/i, window.location.origin)
          .replace(/^https?:\/\/host\.docker\.internal:\d+/i, window.location.origin)
      }

      if (resolved.includes("/media/profile-pictures/")) {
        const separator = resolved.includes("?") ? "&" : "?"
        resolved = `${resolved}${separator}v=1`
      }

      return resolved
    }

  const [isUploading, setIsUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    // Validate file type
    if (!file.type.startsWith("image/")) {
      toast.error(t("profile.avatar.invalidFile"))
      return
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast.error(t("profile.avatar.maxSize"))
      return
    }

    setIsUploading(true)
    try {
      const formData = new FormData()
      formData.append("file", file)

      const controller = new AbortController()
      const timeout = window.setTimeout(() => controller.abort(), 20_000)

      const response = await fetch("/api/profile/avatar", {
        method: "POST",
        body: formData,
        signal: controller.signal,
      })
      window.clearTimeout(timeout)
      const payload = await response.json()
      if (!response.ok) {
        toast.error(payload?.error ?? t("profile.avatar.uploadFailed"))
        return
      }

      onAvatarChange(String(payload?.avatarUrl ?? ""))

      toast.success(t("profile.avatar.updated"))
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        toast.error("Avatar upload timed out. Please try again.")
      } else {
        toast.error(t("profile.avatar.uploadFailed"))
      }
    } finally {
      setIsUploading(false)
    }
  }

  const handleUploadClick = () => {
    fileInputRef.current?.click()
  }

  const handleRemoveAvatar = async () => {
    if (!hasAvatar) return

    setIsUploading(true)
    try {
      const response = await fetch("/api/profile/avatar", { method: "DELETE" })
      const payload = await response.json()
      if (!response.ok) {
        toast.error(payload?.error ?? t("profile.avatar.removeFailed"))
        return
      }

      onAvatarChange(String(payload?.avatarUrl ?? ""))
      toast.success(t("profile.avatar.removed"))
    } catch {
      toast.error(t("profile.avatar.removeFailed"))
    } finally {
      setIsUploading(false)
    }
  }

  const getInitials = (name: string) => {
    const parts = name
      .split(" ")
      .map((part) => part.trim())
      .filter(Boolean)

    if (parts.length === 0) {
      return "U"
    }

    const first = parts[0]?.[0] ?? ""
    const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : ""
    const initials = `${first}${last}`.toUpperCase()
    return initials || "U"
  }

  return (
    <div className="flex items-center space-x-4">
      <Avatar className="h-20 w-20">
        <AvatarImage src={resolveAvatarSrc(currentAvatar)} alt={userName} />
        <AvatarFallback className="text-lg">{getInitials(userName)}</AvatarFallback>
      </Avatar>

      <div className="space-y-2">
        <div className="flex space-x-2">
          <Button variant="outline" size="sm" onClick={handleUploadClick} disabled={isUploading}>
            {isUploading ? (
              <>
                <Upload className="mr-2 h-4 w-4 animate-pulse" />
                {t("profile.avatar.uploading")}
              </>
            ) : (
              <>
                <Camera className="mr-2 h-4 w-4" />
                {hasAvatar ? t("profile.avatar.change") : t("profile.avatar.upload")}
              </>
            )}
          </Button>

          <Button variant="outline" size="sm" onClick={handleRemoveAvatar} disabled={isUploading || !hasAvatar}>
            <Trash2 className="mr-2 h-4 w-4" />
            {t("profile.avatar.remove")}
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">{t("profile.avatar.hint")}</p>
      </div>

      <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileSelect} className="hidden" />
    </div>
  )
}
