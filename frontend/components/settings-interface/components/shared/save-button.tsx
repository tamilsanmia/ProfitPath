"use client"

import type React from "react"
import { Button } from "@/components/ui/button"
import { Loader2, Save } from "lucide-react"

interface SaveButtonProps {
  onSave: () => void
  isSaving: boolean
  hasUnsavedChanges: boolean
  disabled?: boolean
  saveLabel?: string
  savingLabel?: string
}

export const SaveButton: React.FC<SaveButtonProps> = ({
  onSave,
  isSaving,
  hasUnsavedChanges,
  disabled = false,
  saveLabel = "Save Changes",
  savingLabel = "Saving...",
}) => {
  return (
    <Button onClick={onSave} disabled={disabled || isSaving || !hasUnsavedChanges} className="min-w-[120px]">
      {isSaving ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          {savingLabel}
        </>
      ) : (
        <>
          <Save className="mr-2 h-4 w-4" />
          {saveLabel}
        </>
      )}
    </Button>
  )
}
