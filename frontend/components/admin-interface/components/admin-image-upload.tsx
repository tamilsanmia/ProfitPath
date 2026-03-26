"use client";

import type React from "react";
import Image from "next/image";
import Image from "next/image";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ImagePlus, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";

interface AdminImageUploadProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  allowedFileTypes: string;
  helperText?: string;
}

const DEFAULT_ACCEPT = ".png,.jpg,.jpeg,.svg,.webp,.ico";
const MAX_FILE_SIZE = 2 * 1024 * 1024;

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

export const AdminImageUpload: React.FC<AdminImageUploadProps> = ({
  id,
  label,
  value,
  onChange,
  placeholder,
  allowedFileTypes,
  helperText,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const hasValue = value.trim().length > 0;

  const handlePickFile = () => {
    fileInputRef.current?.click();
  };

  const handleRemove = () => {
    onChange("");
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file.");
      event.target.value = "";
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      toast.error("Image must be smaller than 2MB.");
      event.target.value = "";
      return;
    }

    setIsProcessing(true);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      onChange(dataUrl);
      toast.success(`${label} updated.`);
    } catch {
      toast.error(`Failed to update ${label.toLowerCase()}.`);
    } finally {
      setIsProcessing(false);
      event.target.value = "";
    }
  };

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="space-y-2">
        <Label htmlFor={id}>{label}</Label>
        <div className="flex items-center gap-4">
          <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-lg border bg-muted/30">
            {hasValue ? (
              <Image src={value} alt={label} width={80} height={80} className="h-full w-full object-contain" unoptimized />
            ) : (
              <ImagePlus className="h-8 w-8 text-muted-foreground" />
            )}
          </div>
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={handlePickFile} disabled={isProcessing}>
                {isProcessing ? <Upload className="mr-2 h-4 w-4 animate-pulse" /> : <Upload className="mr-2 h-4 w-4" />}
                {hasValue ? "Change image" : "Upload image"}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={handleRemove} disabled={isProcessing || !hasValue}>
                <Trash2 className="mr-2 h-4 w-4" />
                Remove
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{helperText ?? `Allowed file types: ${allowedFileTypes || DEFAULT_ACCEPT}`}</p>
          </div>
        </div>
        <Input id={id} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
      </div>
      <input ref={fileInputRef} type="file" accept={allowedFileTypes || DEFAULT_ACCEPT} onChange={handleFileSelect} className="hidden" />
    </div>
  );
};