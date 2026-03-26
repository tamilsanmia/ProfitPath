"use client";

import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { SettingsSection } from "@/components/settings-interface/components/shared/settings-section";
import type { AdminPortalSettings } from "../../types";

interface SystemServerInformationSectionProps {
  value: AdminPortalSettings["systemServerInformation"];
  onChange: (updates: Partial<AdminPortalSettings["systemServerInformation"]>) => void;
}

type ServerStatus = {
  system: {
    hostname: string;
    os: string;
    arch: string;
    python: string;
    cpuCount: number;
    loadAvg1m: number;
    loadAvg5m: number;
    loadAvg15m: number;
    uptimeSeconds: number | null;
  };
  memory: {
    totalBytes: number;
    usedBytes: number;
    availableBytes: number;
    usedPercent: number;
  };
  disk: {
    totalBytes: number;
    usedBytes: number;
    freeBytes: number;
    usedPercent: number;
  };
  services: {
    postgres: string;
    redis: string;
    docker: string;
    dockerMessage: string;
    backend: string;
  };
  containers: { id: string; name: string; status: string; image: string }[];
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / 1024 ** i).toFixed(1)} ${units[i]}`;
}

function formatUptime(seconds: number | null): string {
  if (!seconds) return "N/A";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(" ");
}

function StatusDot({ status }: { status: string }) {
  const color =
    status === "online" || status === "running"
      ? "bg-emerald-500"
      : status === "exited" || status === "offline"
        ? "bg-red-500"
        : "bg-yellow-500";
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${color}`} />;
}

function ProgressBar({ percent, color }: { percent: number; color: string }) {
  return (
    <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(percent, 100)}%` }} />
    </div>
  );
}

export const SystemServerInformationSection: React.FC<SystemServerInformationSectionProps> = ({ value, onChange }) => {
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/server-status", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to fetch");
      setStatus(await res.json());
    } catch {
      setError("Unable to reach server");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const memColor = (status?.memory.usedPercent ?? 0) > 85 ? "bg-red-500" : (status?.memory.usedPercent ?? 0) > 60 ? "bg-yellow-500" : "bg-emerald-500";
  const diskColor = (status?.disk.usedPercent ?? 0) > 85 ? "bg-red-500" : (status?.disk.usedPercent ?? 0) > 60 ? "bg-yellow-500" : "bg-emerald-500";

  return (
    <SettingsSection title="System/Server Information" description="Operational server metadata and runtime controls">
      <div className="space-y-6">
        {/* Live Server Status */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold">Live Server Status</h3>
              <p className="text-xs text-muted-foreground">Auto-refreshes every 30 seconds</p>
            </div>
            <Button variant="outline" size="sm" onClick={fetchStatus} disabled={loading}>
              {loading ? "Refreshing…" : "Refresh"}
            </Button>
          </div>

          {error && <p className="text-sm text-red-500 mb-4">{error}</p>}

          {status && (
            <div className="space-y-5">
              {/* System Info */}
              <div className="rounded-md border p-4">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">System</h4>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
                  <div><span className="text-muted-foreground">Hostname</span><p className="font-medium truncate">{status.system.hostname}</p></div>
                  <div><span className="text-muted-foreground">OS</span><p className="font-medium truncate">{status.system.os}</p></div>
                  <div><span className="text-muted-foreground">Arch</span><p className="font-medium">{status.system.arch}</p></div>
                  <div><span className="text-muted-foreground">Python</span><p className="font-medium">{status.system.python}</p></div>
                  <div><span className="text-muted-foreground">CPUs</span><p className="font-medium">{status.system.cpuCount}</p></div>
                  <div><span className="text-muted-foreground">Load (1/5/15m)</span><p className="font-medium">{status.system.loadAvg1m} / {status.system.loadAvg5m} / {status.system.loadAvg15m}</p></div>
                  <div><span className="text-muted-foreground">Uptime</span><p className="font-medium">{formatUptime(status.system.uptimeSeconds)}</p></div>
                </div>
              </div>

              {/* Memory & Disk */}
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-md border p-4">
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Memory</h4>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span>{formatBytes(status.memory.usedBytes)} / {formatBytes(status.memory.totalBytes)}</span>
                    <span className="font-semibold">{status.memory.usedPercent}%</span>
                  </div>
                  <ProgressBar percent={status.memory.usedPercent} color={memColor} />
                </div>
                <div className="rounded-md border p-4">
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Disk</h4>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span>{formatBytes(status.disk.usedBytes)} / {formatBytes(status.disk.totalBytes)}</span>
                    <span className="font-semibold">{status.disk.usedPercent}%</span>
                  </div>
                  <ProgressBar percent={status.disk.usedPercent} color={diskColor} />
                </div>
              </div>

              {/* Services */}
              <div className="rounded-md border p-4">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Services</h4>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
                  {Object.entries(status.services)
                    .filter(([key]) => key !== "dockerMessage")
                    .map(([name, state]) => (
                      <div key={name} className="flex items-center gap-2">
                        <StatusDot status={state} />
                        <span className="capitalize">{name}</span>
                        <span className="ml-auto text-xs text-muted-foreground capitalize">{state}</span>
                      </div>
                    ))}
                </div>
              </div>

              {/* Containers */}
              {status.containers.length > 0 && (
                <div className="rounded-md border p-4">
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Containers</h4>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-xs text-muted-foreground uppercase">
                          <th className="pb-2 pr-4">Name</th>
                          <th className="pb-2 pr-4">Status</th>
                          <th className="pb-2">Image</th>
                        </tr>
                      </thead>
                      <tbody>
                        {status.containers.map((c) => (
                          <tr key={c.id} className="border-b last:border-0">
                            <td className="py-2 pr-4 font-medium">{c.name}</td>
                            <td className="py-2 pr-4">
                              <span className="inline-flex items-center gap-1.5">
                                <StatusDot status={c.status} />
                                <span className="capitalize">{c.status}</span>
                              </span>
                            </td>
                            <td className="py-2 text-muted-foreground truncate max-w-[200px]">{c.image}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </SettingsSection>
  );
};
