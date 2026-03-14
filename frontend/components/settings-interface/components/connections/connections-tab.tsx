"use client"

import type React from "react"
import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Link, Plus, Trash2, CheckCircle, XCircle, AlertTriangle, Building } from "lucide-react"
import type { Connection } from "../../types"
import { getRelativeTime } from "../../utils"
import { toast } from "sonner"
import { createSettingsTranslator } from "../../i18n"

interface ConnectionsTabProps {
  connections: Connection[]
  onConnectionsPersist: (connections: Connection[]) => Promise<{ success: boolean; error?: string }>
  language: string
}

export const ConnectionsTab: React.FC<ConnectionsTabProps> = ({
  connections,
  onConnectionsPersist,
  language,
}) => {
  const t = createSettingsTranslator(language)

  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
  const [newConnection, setNewConnection] = useState({
    name: "",
    exchange: "binance_futures" as NonNullable<Connection["exchange"]>,
    apiKey: "",
    apiSecret: "",
    permissions: ["read", "trade"] as string[],
  })
  const [isConnecting, setIsConnecting] = useState(false)

  const handleConnect = async (connectionId: string) => {
    setIsConnecting(true)
    try {
      const nextConnections = connections.map((conn): Connection =>
        conn.id === connectionId ? { ...conn, status: "connected", lastSync: new Date().toISOString() } : conn,
      )
      const result = await onConnectionsPersist(nextConnections)
      if (!result.success) {
        throw new Error(result.error || t("connections.error.connectFailed"))
      }

      toast.success(t("connections.success.connected"))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("connections.error.connectFailed"))
    } finally {
      setIsConnecting(false)
    }
  }

  const handleDisconnect = async (connectionId: string) => {
    try {
      const nextConnections = connections.map((conn): Connection =>
        conn.id === connectionId ? { ...conn, status: "disconnected" } : conn,
      )
      const result = await onConnectionsPersist(nextConnections)
      if (!result.success) {
        throw new Error(result.error || t("connections.error.disconnectFailed"))
      }

      toast.success(t("connections.success.disconnected"))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("connections.error.disconnectFailed"))
    }
  }

  const handleRemoveConnection = async (connectionId: string) => {
    try {
      const nextConnections = connections.filter((conn) => conn.id !== connectionId)
      const result = await onConnectionsPersist(nextConnections)
      if (!result.success) {
        throw new Error(result.error || t("connections.error.removeFailed"))
      }

      toast.success(t("connections.success.removed"))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("connections.error.removeFailed"))
    }
  }

  const handleAddConnection = async () => {
    if (!newConnection.apiKey || !newConnection.apiSecret) {
      toast.error(t("connections.error.required"))
      return
    }
    if (newConnection.permissions.length === 0) {
      toast.error(t("connections.permission.minOne"))
      return
    }

    setIsConnecting(true)
    try {
      const connection: Connection = {
        id: Date.now().toString(),
        name:
          newConnection.name.trim() ||
          (newConnection.exchange === "binance_futures"
            ? t("connections.exchange.binanceFutures")
            : t("connections.exchange.bybitFutures")),
        type: "exchange",
        exchange: newConnection.exchange,
        status: "connected",
        lastSync: new Date().toISOString(),
        permissions: newConnection.permissions,
        icon: "/placeholder.svg?height=32&width=32",
        apiKey: newConnection.apiKey,
        apiSecret: newConnection.apiSecret,
      }

      const nextConnections = [...connections, connection]
      const result = await onConnectionsPersist(nextConnections)
      if (!result.success) {
        throw new Error(result.error || t("connections.error.addFailed"))
      }

      setNewConnection({
        name: "",
        exchange: "binance_futures",
        apiKey: "",
        apiSecret: "",
        permissions: ["read", "trade"],
      })
      setIsAddDialogOpen(false)

      toast.success(t("connections.success.added"))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("connections.error.addFailed"))
    } finally {
      setIsConnecting(false)
    }
  }

  const handlePermissionChange = (permission: string, checked: boolean) => {
    if (checked) {
      setNewConnection((prev) => ({
        ...prev,
        permissions: [...prev.permissions, permission],
      }))
    } else {
      setNewConnection((prev) => ({
        ...prev,
        permissions: prev.permissions.filter((p) => p !== permission),
      }))
    }
  }

  const getConnectionIcon = (type: Connection["type"]) => {
    switch (type) {
      case "exchange":
        return Building
      default:
        return Link
    }
  }

  const getStatusColor = (status: Connection["status"]) => {
    switch (status) {
      case "connected":
        return "text-green-600"
      case "disconnected":
        return "text-gray-600"
      case "error":
        return "text-red-600"
      default:
        return "text-gray-600"
    }
  }

  const getStatusIcon = (status: Connection["status"]) => {
    switch (status) {
      case "connected":
        return CheckCircle
      case "disconnected":
        return XCircle
      case "error":
        return AlertTriangle
      default:
        return XCircle
    }
  }

  const availablePermissions = [
    { id: "read", label: t("connections.permission.read"), description: t("connections.permission.readDesc") },
    { id: "trade", label: t("connections.permission.trade"), description: t("connections.permission.tradeDesc") },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold">{t("connections.title")}</h2>
          <p className="text-muted-foreground">{t("connections.subtitle")}</p>
        </div>

        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              {t("connections.add")}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("connections.addNew")}</DialogTitle>
              <DialogDescription>{t("connections.addDesc")}</DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="connection-name">{t("connections.name")}</Label>
                <Input
                  id="connection-name"
                  value={newConnection.name}
                  onChange={(e) => setNewConnection((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder={t("connections.namePlaceholder")}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="connection-exchange">{t("connections.exchange.label")}</Label>
                <select
                  id="connection-exchange"
                  value={newConnection.exchange}
                  onChange={(e) =>
                    setNewConnection((prev) => ({ ...prev, exchange: e.target.value as NonNullable<Connection["exchange"]> }))
                  }
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="binance_futures">{t("connections.exchange.binanceFutures")}</option>
                  <option value="bybit_futures">{t("connections.exchange.bybitFutures")}</option>
                </select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="api-key">{t("connections.apiKey")}</Label>
                <Input
                  id="api-key"
                  type="password"
                  value={newConnection.apiKey}
                  onChange={(e) => setNewConnection((prev) => ({ ...prev, apiKey: e.target.value }))}
                  placeholder={t("connections.apiKeyPlaceholder")}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="api-secret">{t("connections.apiSecret")}</Label>
                <Input
                  id="api-secret"
                  type="password"
                  value={newConnection.apiSecret}
                  onChange={(e) => setNewConnection((prev) => ({ ...prev, apiSecret: e.target.value }))}
                  placeholder={t("connections.apiSecretPlaceholder")}
                />
              </div>

              <div className="space-y-3">
                <Label>{t("connections.permissions")}</Label>
                {availablePermissions.map((permission) => (
                  <div key={permission.id} className="flex items-start space-x-3">
                    <Checkbox
                      id={permission.id}
                      checked={newConnection.permissions.includes(permission.id)}
                      onCheckedChange={(checked) => handlePermissionChange(permission.id, checked as boolean)}
                    />
                    <div className="space-y-1">
                      <Label htmlFor={permission.id} className="font-medium">
                        {permission.label}
                      </Label>
                      <p className="text-sm text-muted-foreground">{permission.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button onClick={handleAddConnection} disabled={isConnecting}>
                {isConnecting ? t("connections.connecting") : t("connections.add")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          {t("connections.securityNotice")}
        </AlertDescription>
      </Alert>

      {/* Connections List */}
      <div className="grid gap-4">
        {connections.map((connection) => {
          const IconComponent = getConnectionIcon(connection.type)
          const StatusIcon = getStatusIcon(connection.status)

          return (
            <Card key={connection.id}>
              <CardContent className="p-6">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center space-x-4">
                    <div className="flex items-center flex-wrap gap-3">
                      <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
                        <IconComponent className="h-5 w-5" />
                      </div>
                      <div>
                        <h3 className="font-medium">{connection.name}</h3>
                        <div className="flex items-center space-x-2 text-sm text-muted-foreground">
                          <StatusIcon className={`h-4 w-4 ${getStatusColor(connection.status)}`} />
                          <span className="capitalize">{connection.status}</span>
                          <span>•</span>
                          <span className="capitalize">
                            {connection.type === "exchange"
                              ? t("connections.exchange")
                              : connection.type === "wallet"
                                ? t("connections.wallet")
                                : t("connections.service")}
                          </span>
                          {connection.exchange && (
                            <>
                              <span>•</span>
                              <span>
                                {connection.exchange === "binance_futures"
                                  ? t("connections.exchange.binanceFutures")
                                  : t("connections.exchange.bybitFutures")}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2">
                    <div className="text-right text-sm">
                      <div className="text-muted-foreground">{t("connections.lastSync")}</div>
                      <div>{getRelativeTime(connection.lastSync)}</div>
                    </div>

                    <div className="flex space-x-1">
                      {connection.status === "connected" ? (
                        <Button variant="outline" size="sm" onClick={() => handleDisconnect(connection.id)}>
                          {t("connections.disconnect")}
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleConnect(connection.id)}
                          disabled={isConnecting}
                        >
                          {isConnecting ? t("connections.connecting") : t("connections.connect")}
                        </Button>
                      )}

                      <Button variant="ghost" size="sm" onClick={() => handleRemoveConnection(connection.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex items-center space-x-4">
                  <div>
                    <span className="text-sm text-muted-foreground">{t("connections.permissions")}: </span>
                    <div className="flex space-x-1 mt-1">
                      {connection.permissions.map((permission) => (
                        <Badge key={permission} variant="secondary" className="text-xs">
                          {permission}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {connections.length === 0 && (
        <Card>
          <CardContent className="p-12 text-center">
            <Link className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">{t("connections.noConnections")}</h3>
            <p className="text-muted-foreground mb-4">{t("connections.noConnectionsDesc")}</p>
            <Button onClick={() => setIsAddDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              {t("connections.addFirst")}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Connection Summary */}
      {connections.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t("connections.summary")}</CardTitle>
            <CardDescription>{t("connections.summaryDesc")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-600">{connections.length}</div>
                <div className="text-sm text-muted-foreground">{t("connections.total")}</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600">
                  {connections.filter((c) => c.status === "connected").length}
                </div>
                <div className="text-sm text-muted-foreground">{t("connections.active")}</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-orange-600">
                  {connections.filter((c) => c.type === "exchange").length}
                </div>
                <div className="text-sm text-muted-foreground">{t("connections.exchanges")}</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-purple-600">
                  {connections.filter((c) => c.permissions.includes("trade")).length}
                </div>
                <div className="text-sm text-muted-foreground">{t("connections.permission.trade")}</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
