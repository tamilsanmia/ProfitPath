"use client"

import type React from "react"
import { useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { AlertTriangle, CheckCircle, Download } from "lucide-react"
import type { LoginHistory } from "../../types"
import { formatDate, formatTime, exportToCsv } from "../../utils"
import { createSettingsTranslator } from "../../i18n"

interface LoginHistorySectionProps {
  loginHistory: LoginHistory[]
  language: string
}

export const LoginHistorySection: React.FC<LoginHistorySectionProps> = ({ loginHistory, language }) => {
  const t = createSettingsTranslator(language)

  const [isExporting, setIsExporting] = useState(false)

  const formatMethodLabel = (method: string) => method.replace(/_/g, " ")

  const handleExportHistory = async () => {
    setIsExporting(true)
    try {
      // Simulate processing
      await new Promise((resolve) => setTimeout(resolve, 1000))

      const exportData = loginHistory.map((entry) => ({
        timestamp: entry.timestamp,
        ip: entry.ip,
        location: entry.location,
        device: entry.device,
        success: entry.success ? t("security.history.success") : t("security.history.failed"),
        method: entry.method,
      }))

      exportToCsv(exportData, "login-history")
    } catch (error) {
      console.error("Failed to export login history:", error)
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-medium">{t("security.history.heading")}</h3>
          <p className="text-sm text-muted-foreground">{t("security.history.subheading")}</p>
        </div>

        <Button variant="outline" onClick={handleExportHistory} disabled={isExporting}>
          <Download className="mr-2 h-4 w-4" />
          {isExporting ? t("security.history.exporting") : t("security.history.export")}
        </Button>
      </div>

      {loginHistory.length > 0 ? (
        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("security.history.dateTime")}</TableHead>
                <TableHead>{t("security.history.location")}</TableHead>
                <TableHead>{t("security.history.device")}</TableHead>
                <TableHead>{t("security.history.ip")}</TableHead>
                <TableHead>{t("security.history.method")}</TableHead>
                <TableHead>{t("security.history.status")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loginHistory.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell>
                    <div className="space-y-1">
                      <div className="font-medium">{formatDate(entry.timestamp)}</div>
                      <div className="text-sm text-muted-foreground">{formatTime(entry.timestamp)}</div>
                    </div>
                  </TableCell>
                  <TableCell>{entry.location}</TableCell>
                  <TableCell>{entry.device}</TableCell>
                  <TableCell>
                    <code className="text-sm">{entry.ip}</code>
                  </TableCell>
                  <TableCell className="capitalize">{formatMethodLabel(entry.method)}</TableCell>
                  <TableCell>
                    <div className="flex items-center space-x-2">
                      {entry.success ? (
                        <>
                          <CheckCircle className="h-4 w-4 text-green-500" />
                          <Badge variant="default" className="bg-green-100 text-green-800">
                            {t("security.history.success")}
                          </Badge>
                        </>
                      ) : (
                        <>
                          <AlertTriangle className="h-4 w-4 text-red-500" />
                          <Badge variant="destructive">{t("security.history.failed")}</Badge>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="text-center py-8 text-muted-foreground">
          <p>{t("security.history.none")}</p>
        </div>
      )}
    </div>
  )
}
