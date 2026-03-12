"use client"

import { useState, useCallback } from "react"
import { validatePassword, getPasswordStrength } from "../utils"

export const usePassword = () => {
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showPasswords, setShowPasswords] = useState({
    current: false,
    new: false,
    confirm: false,
  })
  const [isChanging, setIsChanging] = useState(false)

  const passwordValidation = validatePassword(newPassword)
  const passwordStrength = getPasswordStrength(passwordValidation.score)

  const togglePasswordVisibility = useCallback((field: "current" | "new" | "confirm") => {
    setShowPasswords((prev) => ({
      ...prev,
      [field]: !prev[field],
    }))
  }, [])

  const validateForm = useCallback(() => {
    const errors: string[] = []

    if (!currentPassword) {
      errors.push("Current password is required")
    }

    if (!newPassword) {
      errors.push("New password is required")
    } else if (!passwordValidation.isValid) {
      errors.push(...passwordValidation.feedback)
    }

    if (newPassword !== confirmPassword) {
      errors.push("Passwords do not match")
    }

    if (currentPassword === newPassword) {
      errors.push("New password must be different from current password")
    }

    return errors
  }, [currentPassword, newPassword, confirmPassword, passwordValidation])

  const changePassword = useCallback(async () => {
    const errors = validateForm()
    if (errors.length > 0) {
      return { success: false, errors }
    }

    setIsChanging(true)
    try {
      const response = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword,
          newPassword,
        }),
      })

      const payload = await response.json()
      if (!response.ok) {
        return { success: false, errors: [payload?.error ?? "Failed to change password"] }
      }

      // Reset form
      setCurrentPassword("")
      setNewPassword("")
      setConfirmPassword("")

      return { success: true }
    } catch (error) {
      return { success: false, errors: ["Failed to change password"] }
    } finally {
      setIsChanging(false)
    }
  }, [currentPassword, newPassword, validateForm])

  const reset = useCallback(() => {
    setCurrentPassword("")
    setNewPassword("")
    setConfirmPassword("")
    setShowPasswords({ current: false, new: false, confirm: false })
  }, [])

  return {
    currentPassword,
    setCurrentPassword,
    newPassword,
    setNewPassword,
    confirmPassword,
    setConfirmPassword,
    showPasswords,
    togglePasswordVisibility,
    passwordValidation,
    passwordStrength,
    isChanging,
    validateForm,
    changePassword,
    reset,
  }
}
