export const AVATAR_STORAGE_PREFIX = "defibotx-avatar:"
export const AVATAR_UPDATED_EVENT = "pp:avatar-updated"

type AvatarUpdatedDetail = {
  email?: string
  avatarUrl?: string
}

export function getAvatarStorageKey(email?: string): string {
  return `${AVATAR_STORAGE_PREFIX}${email ?? "guest"}`
}

export function readLocalAvatar(email?: string): string | null {
  if (typeof window === "undefined") {
    return null
  }

  return window.localStorage.getItem(getAvatarStorageKey(email))
}

export function writeLocalAvatar(email: string | undefined, avatar: string | null, defaultAvatar?: string): void {
  if (typeof window === "undefined") {
    return
  }

  const avatarKey = getAvatarStorageKey(email)
  const shouldClear = !avatar || (defaultAvatar ? avatar === defaultAvatar : false)

  if (shouldClear) {
    window.localStorage.removeItem(avatarKey)
    return
  }

  window.localStorage.setItem(avatarKey, avatar)
}

export function emitAvatarUpdated(detail: AvatarUpdatedDetail): void {
  if (typeof window === "undefined") {
    return
  }

  window.dispatchEvent(new CustomEvent(AVATAR_UPDATED_EVENT, { detail }))
}
