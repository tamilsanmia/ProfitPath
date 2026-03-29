"use client";

import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { SettingsSection } from "@/components/settings-interface/components/shared/settings-section";
import { RefreshCw, Save, Trash2, Upload, FileCode2, FileJson, FileText, ChevronDown, ChevronRight, Rocket, Settings2 } from "lucide-react";

type FtFileInfo = {
  key: string;
  path: string;
  exists: boolean;
  size: number;
  modified: number | null;
};

type FtFileContent = FtFileInfo & { content: string };

type DeploySettings = {
  deploy_dir: string;
  deploy_image: string;
  deploy_api_port: string;
  usernames: string;
  passwords: string;
  deploy_ssh_user: string;
  deploy_ssh_port: string;
  deploy_ssh_private_key_path: string;
  default_strategy: string;
  hetzner_api_token: string;
  hetzner_datacenter: string;
  hetzner_server_type: string;
  hetzner_image: string;
  hetzner_ssh_keys: string;
  hetzner_root_password: string;
  ssh_key_exists?: boolean;
};

type StrategyOption = { filename: string; name: string };

const FILE_LABELS: Record<string, { label: string; description: string; icon: React.ReactNode }> = {
  strategy: { label: "Strategy (BotPrimeX.py)", description: "Main trading strategy file", icon: <FileCode2 className="h-4 w-4" /> },
  config: { label: "Config (config.json)", description: "Freqtrade configuration", icon: <FileJson className="h-4 w-4" /> },
  "docker-compose": { label: "Docker Compose", description: "Freqtrade docker-compose.yml", icon: <FileText className="h-4 w-4" /> },
  "strategy-template": { label: "Strategy Template", description: "Template used for new bot deployments", icon: <FileCode2 className="h-4 w-4" /> },
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(ts: number | null): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleString();
}

export const FreqtradeSection: React.FC = () => {
  const [files, setFiles] = useState<FtFileInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedFile, setExpandedFile] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [loadingContent, setLoadingContent] = useState(false);
  const [uploadName, setUploadName] = useState("");
  const [uploadContent, setUploadContent] = useState("");
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState<{ ok: boolean; total: number; success: number; failed: number; bots: Array<{ bot_id: string; bot_name: string; files_pushed: string[]; errors: string[]; reloaded?: boolean; restarted?: boolean; local?: boolean }> } | null>(null);
  const [deploySettings, setDeploySettings] = useState<DeploySettings | null>(null);
  const [originalDeploySettings, setOriginalDeploySettings] = useState<DeploySettings | null>(null);
  const [strategies, setStrategies] = useState<StrategyOption[]>([]);
  const [savingSettings, setSavingSettings] = useState(false);
  const [sshKeyContent, setSshKeyContent] = useState("");
  const [uploadingKey, setUploadingKey] = useState(false);

  const showMessage = useCallback((type: "success" | "error", text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 4000);
  }, []);

  const fetchFiles = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/freqtrade/files", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load files");
      const data = (await res.json()) as FtFileInfo[];
      setFiles(data);
    } catch (e) {
      showMessage("error", e instanceof Error ? e.message : "Failed to load files");
    } finally {
      setLoading(false);
    }
  }, [showMessage]);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  const openFile = async (key: string) => {
    if (expandedFile === key) {
      setExpandedFile(null);
      return;
    }
    setLoadingContent(true);
    try {
      const res = await fetch(`/api/admin/freqtrade/files/${encodeURIComponent(key)}`, { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to read file");
      const data = (await res.json()) as FtFileContent;
      setEditContent(data.content);
      setOriginalContent(data.content);
      setExpandedFile(key);
    } catch (e) {
      showMessage("error", e instanceof Error ? e.message : "Failed to read file");
    } finally {
      setLoadingContent(false);
    }
  };

  const saveFile = async (key: string) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/freqtrade/files/${encodeURIComponent(key)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editContent }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? "Save failed");
      }
      setOriginalContent(editContent);
      showMessage("success", "File saved successfully");
      fetchFiles();
    } catch (e) {
      showMessage("error", e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const deleteFile = async (key: string) => {
    if (!confirm(`Delete ${key}?`)) return;
    setDeleting(key);
    try {
      const res = await fetch(`/api/admin/freqtrade/files/${encodeURIComponent(key)}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? "Delete failed");
      }
      showMessage("success", "File deleted");
      if (expandedFile === key) setExpandedFile(null);
      fetchFiles();
    } catch (e) {
      showMessage("error", e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeleting(null);
    }
  };

  const uploadStrategy = async () => {
    if (!uploadName.trim() || !uploadContent.trim()) {
      showMessage("error", "Filename and content are required");
      return;
    }
    const fname = uploadName.trim().endsWith(".py") ? uploadName.trim() : `${uploadName.trim()}.py`;
    setUploading(true);
    try {
      const res = await fetch("/api/admin/freqtrade/strategies/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: fname, content: uploadContent }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? "Upload failed");
      }
      showMessage("success", `Strategy ${fname} uploaded`);
      setUploadName("");
      setUploadContent("");
      fetchFiles();
      fetchDeploySettings();
    } catch (e) {
      showMessage("error", e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      setUploadContent(reader.result as string);
    };
    reader.readAsText(file);
  };

  const isCore = (key: string) => ["strategy", "config", "docker-compose", "strategy-template"].includes(key);

  const applyToBots = async (fileKeys?: string[]) => {
    setApplying(true);
    setApplyResult(null);
    try {
      const res = await fetch("/api/admin/freqtrade/apply-to-bots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_keys: fileKeys || ["strategy", "config", "docker-compose"] }),
      });
      if (!res.ok) throw new Error("Apply failed");
      const data = await res.json();
      setApplyResult(data);
      if (data.ok) {
        showMessage("success", `Applied to ${data.success}/${data.total} bot(s)`);
      } else {
        showMessage("error", `Applied to ${data.success}/${data.total} bot(s) — ${data.failed} failed`);
      }
      fetchFiles();
    } catch (e) {
      showMessage("error", e instanceof Error ? e.message : "Apply failed");
    } finally {
      setApplying(false);
    }
  };

  const fetchDeploySettings = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/freqtrade/deploy-settings", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setDeploySettings(data.settings);
      setOriginalDeploySettings(data.settings);
      setStrategies(data.strategies ?? []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchDeploySettings(); }, [fetchDeploySettings]);

  const saveDeploySettings = async () => {
    if (!deploySettings) return;
    setSavingSettings(true);
    try {
      const res = await fetch("/api/admin/freqtrade/deploy-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(deploySettings),
      });
      if (!res.ok) throw new Error("Save failed");
      const data = await res.json();
      fetchDeploySettings();

      if (data.ft_applied && data.apply_result) {
        const ar = data.apply_result;
        setApplyResult(ar);
        if (ar.ok) {
          showMessage("success", `Settings saved — applied to ${ar.success}/${ar.total} bot(s)`);
        } else {
          showMessage("success", `Settings saved — applied to ${ar.success}/${ar.total} bot(s), ${ar.failed} failed`);
        }
      } else {
        showMessage("success", "Settings saved");
      }
    } catch (e) {
      showMessage("error", e instanceof Error ? e.message : "Save failed");
    } finally {
      setSavingSettings(false);
    }
  };

  const updateSetting = (key: keyof DeploySettings, value: string) => {
    if (!deploySettings) return;
    setDeploySettings({ ...deploySettings, [key]: value });
  };

  const uploadSshKey = async () => {
    if (!sshKeyContent.trim()) return;
    setUploadingKey(true);
    try {
      const res = await fetch("/api/admin/freqtrade/ssh-key", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: sshKeyContent }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? "Upload failed");
      }
      showMessage("success", "SSH key uploaded");
      setSshKeyContent("");
      if (deploySettings) setDeploySettings({ ...deploySettings, ssh_key_exists: true });
      if (originalDeploySettings) setOriginalDeploySettings({ ...originalDeploySettings, ssh_key_exists: true });
    } catch (e) {
      showMessage("error", e instanceof Error ? e.message : "SSH key upload failed");
    } finally {
      setUploadingKey(false);
    }
  };

  const handleSshKeyFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setSshKeyContent(reader.result as string);
    reader.readAsText(file);
  };

  const hasSettingsChanges = deploySettings && originalDeploySettings
    ? JSON.stringify(deploySettings) !== JSON.stringify(originalDeploySettings)
    : false;

  const getFileLabel = (key: string) => {
    if (FILE_LABELS[key]) return FILE_LABELS[key];
    if (key.startsWith("strategy:")) {
      const name = key.split(":")[1];
      return { label: name, description: "Extra strategy file", icon: <FileCode2 className="h-4 w-4" /> };
    }
    return { label: key, description: "", icon: <FileText className="h-4 w-4" /> };
  };

  return (
    <SettingsSection title="Freqtrade" description="Manage Freqtrade strategy files, configuration, pairlists, and Docker setup">
      {message && (
        <div className={`mb-4 rounded-lg px-4 py-2 text-sm ${message.type === "success" ? "bg-green-500/10 text-green-400 border border-green-500/20" : "bg-red-500/10 text-red-400 border border-red-500/20"}`}>
          {message.text}
        </div>
      )}

      {/* File list */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-base font-medium">Managed Files</Label>
          <Button variant="outline" size="sm" onClick={fetchFiles} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {loading && files.length === 0 ? (
          <div className="text-sm text-muted-foreground py-8 text-center">Loading files...</div>
        ) : (
          <div className="space-y-1">
            {files.map((f) => {
              const meta = getFileLabel(f.key);
              const isExpanded = expandedFile === f.key;
              return (
                <div key={f.key} className="rounded-lg border border-border/50 overflow-hidden">
                  {/* File row header */}
                  <button
                    type="button"
                    className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/30 transition-colors"
                    onClick={() => openFile(f.key)}
                    disabled={loadingContent}
                  >
                    {isExpanded ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                    <span className="shrink-0">{meta.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm">{meta.label}</div>
                      <div className="text-xs text-muted-foreground">{meta.description}</div>
                    </div>
                    <div className="text-xs text-muted-foreground shrink-0 text-right">
                      {f.exists ? (
                        <>
                          <span>{formatSize(f.size)}</span>
                          <span className="ml-2">{formatDate(f.modified)}</span>
                        </>
                      ) : (
                        <span className="text-yellow-500">Missing</span>
                      )}
                    </div>
                    {!isCore(f.key) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="shrink-0 h-8 w-8 p-0 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                        onClick={(e) => { e.stopPropagation(); deleteFile(f.key); }}
                        disabled={deleting === f.key}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </button>

                  {/* Expanded editor */}
                  {isExpanded && (
                    <div className="border-t border-border/50 p-4 space-y-3">
                      <textarea
                        className="w-full min-h-[400px] rounded-md border border-input bg-background px-3 py-2 text-sm font-mono resize-y focus:outline-none focus:ring-2 focus:ring-ring"
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        spellCheck={false}
                      />
                      <div className="flex items-center gap-2">
                        {editContent !== originalContent && (
                          <Button size="sm" onClick={() => saveFile(f.key)} disabled={saving}>
                            <Save className="h-4 w-4 mr-1" />
                            {saving ? "Saving..." : "Save"}
                          </Button>
                        )}
                        <Button variant="outline" size="sm" onClick={() => setExpandedFile(null)}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Apply to All Bots */}
      <div className="mt-6 space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-base font-medium">Apply to All Bots</Label>
            <p className="text-xs text-muted-foreground mt-1">Push file changes to every active bot and reload</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => applyToBots(["strategy"])} disabled={applying}>
              <Rocket className="h-4 w-4 mr-1" />
              {applying ? "Applying..." : "Strategy Only"}
            </Button>
            <Button size="sm" onClick={() => applyToBots()} disabled={applying}>
              <Rocket className="h-4 w-4 mr-1" />
              {applying ? "Applying..." : "Apply All Files"}
            </Button>
          </div>
        </div>
        {applyResult && (
          <div className="mt-3 space-y-2">
            <div className={`text-sm font-medium ${applyResult.ok ? "text-green-400" : "text-yellow-400"}`}>
              {applyResult.success}/{applyResult.total} bot(s) updated successfully
              {applyResult.failed > 0 && ` — ${applyResult.failed} failed`}
            </div>
            <div className="space-y-1">
              {applyResult.bots.map((bot) => (
                <div key={bot.bot_id} className="flex items-center gap-2 text-xs rounded px-3 py-1.5 bg-muted/30">
                  <span className={`h-2 w-2 rounded-full shrink-0 ${bot.errors.length === 0 ? "bg-green-500" : "bg-red-500"}`} />
                  <span className="font-medium">{bot.bot_name}</span>
                  <span className="text-muted-foreground">({bot.bot_id})</span>
                  {bot.reloaded && <span className="text-green-400 ml-auto">reloaded</span>}
                  {bot.restarted && <span className="text-blue-400 ml-auto">restarted</span>}
                  {bot.local && <span className="text-muted-foreground ml-1">(local)</span>}
                  {bot.errors.length > 0 && (
                    <span className="text-red-400 ml-auto">{bot.errors.join("; ")}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Upload new strategy */}
      <div className="mt-6 space-y-3 rounded-lg border border-dashed border-border/50 p-4">
        <Label className="text-base font-medium">Upload Strategy File</Label>
        <p className="text-xs text-muted-foreground">Upload a new .py strategy file or paste content below</p>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="ft-upload-name">Filename</Label>
            <Input id="ft-upload-name" value={uploadName} onChange={(e) => setUploadName(e.target.value)} placeholder="MyStrategy.py" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ft-upload-file">Or pick file</Label>
            <Input id="ft-upload-file" type="file" accept=".py" onChange={handleFileUpload} />
          </div>
        </div>
        {uploadContent && (
          <textarea
            className="w-full min-h-[200px] rounded-md border border-input bg-background px-3 py-2 text-sm font-mono resize-y focus:outline-none focus:ring-2 focus:ring-ring"
            value={uploadContent}
            onChange={(e) => setUploadContent(e.target.value)}
            placeholder="Paste strategy code here..."
            spellCheck={false}
          />
        )}
        {!uploadContent && (
          <textarea
            className="w-full min-h-[100px] rounded-md border border-input bg-background px-3 py-2 text-sm font-mono resize-y focus:outline-none focus:ring-2 focus:ring-ring"
            value={uploadContent}
            onChange={(e) => setUploadContent(e.target.value)}
            placeholder="Paste strategy code here..."
            spellCheck={false}
          />
        )}
        <Button onClick={uploadStrategy} disabled={uploading || !uploadName.trim()}>
          <Upload className="h-4 w-4 mr-1" />
          {uploading ? "Uploading..." : "Upload Strategy"}
        </Button>
      </div>

      {/* Deploy Settings */}
      {deploySettings && (
        <div className="mt-6 space-y-4 rounded-lg border border-border/50 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Settings2 className="h-4 w-4" />
              <Label className="text-base font-medium">Deploy Settings</Label>
            </div>
            {hasSettingsChanges && (
              <Button size="sm" onClick={saveDeploySettings} disabled={savingSettings}>
                <Save className="h-4 w-4 mr-1" />
                {savingSettings ? "Saving..." : "Save Settings"}
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">Configuration for new bot deployments. Changes require a backend restart to take effect.</p>

          {/* Freqtrade Deploy */}
          <div className="space-y-3">
            <Label className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Freqtrade</Label>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="ds-strategy">Default Strategy</Label>
                <select
                  id="ds-strategy"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  value={deploySettings.default_strategy}
                  onChange={(e) => updateSetting("default_strategy", e.target.value)}
                >
                  <option value="">— Use template —</option>
                  {strategies.map((s) => (
                    <option key={s.filename} value={s.name}>{s.name}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="ds-image">Docker Image</Label>
                <Input id="ds-image" value={deploySettings.deploy_image} onChange={(e) => updateSetting("deploy_image", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ds-dir">Deploy Directory</Label>
                <Input id="ds-dir" value={deploySettings.deploy_dir} onChange={(e) => updateSetting("deploy_dir", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ds-port">API Port</Label>
                <Input id="ds-port" value={deploySettings.deploy_api_port} onChange={(e) => updateSetting("deploy_api_port", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ds-user">Freqtrade Username</Label>
                <Input id="ds-user" value={deploySettings.usernames} onChange={(e) => updateSetting("usernames", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ds-pass">Freqtrade Password</Label>
                <Input id="ds-pass" type="password" value={deploySettings.passwords} onChange={(e) => updateSetting("passwords", e.target.value)} />
              </div>
            </div>
          </div>

          {/* Hetzner Provisioning */}
          <div className="space-y-3 pt-4 border-t border-border/30">
            <Label className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Hetzner Provisioning</Label>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="ds-hetzner-token">API Token</Label>
                <Input id="ds-hetzner-token" type="password" value={deploySettings.hetzner_api_token} onChange={(e) => updateSetting("hetzner_api_token", e.target.value)} placeholder="Hetzner Cloud API token" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ds-hetzner-dc">Datacenter</Label>
                <Input id="ds-hetzner-dc" value={deploySettings.hetzner_datacenter} onChange={(e) => updateSetting("hetzner_datacenter", e.target.value)} placeholder="fsn1" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ds-hetzner-type">Server Type</Label>
                <Input id="ds-hetzner-type" value={deploySettings.hetzner_server_type} onChange={(e) => updateSetting("hetzner_server_type", e.target.value)} placeholder="cx22" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ds-hetzner-image">OS Image</Label>
                <Input id="ds-hetzner-image" value={deploySettings.hetzner_image} onChange={(e) => updateSetting("hetzner_image", e.target.value)} placeholder="ubuntu-22.04" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ds-hetzner-ssh">SSH Key Names</Label>
                <Input id="ds-hetzner-ssh" value={deploySettings.hetzner_ssh_keys} onChange={(e) => updateSetting("hetzner_ssh_keys", e.target.value)} placeholder="my-key (comma-separated)" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ds-hetzner-root">Root Password</Label>
                <Input id="ds-hetzner-root" type="password" value={deploySettings.hetzner_root_password} onChange={(e) => updateSetting("hetzner_root_password", e.target.value)} placeholder="For servers without SSH keys" />
              </div>
            </div>
          </div>

          {/* SSH Configuration */}
          <div className="space-y-3 pt-4 border-t border-border/30">
            <Label className="text-sm font-medium text-muted-foreground uppercase tracking-wide">SSH Configuration</Label>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="ds-ssh-user">SSH User</Label>
                <Input id="ds-ssh-user" value={deploySettings.deploy_ssh_user} onChange={(e) => updateSetting("deploy_ssh_user", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ds-ssh-port">SSH Port</Label>
                <Input id="ds-ssh-port" value={deploySettings.deploy_ssh_port} onChange={(e) => updateSetting("deploy_ssh_port", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ds-ssh-keypath">Key Path</Label>
                <Input id="ds-ssh-keypath" value={deploySettings.deploy_ssh_private_key_path} onChange={(e) => updateSetting("deploy_ssh_private_key_path", e.target.value)} placeholder="/app/ssh_deploy_key" />
              </div>
              <div className="space-y-2 flex items-end">
                <div className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium ${deploySettings.ssh_key_exists ? "bg-green-500/10 text-green-400 border border-green-500/20" : "bg-yellow-500/10 text-yellow-400 border border-yellow-500/20"}`}>
                  <span className={`h-2 w-2 rounded-full ${deploySettings.ssh_key_exists ? "bg-green-500" : "bg-yellow-500"}`} />
                  {deploySettings.ssh_key_exists ? "SSH key installed" : "No SSH key found"}
                </div>
              </div>
            </div>

            {/* SSH Key Upload */}
            <div className="mt-3 space-y-2 rounded-md border border-dashed border-border/50 p-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm">Upload SSH Private Key</Label>
                <Input type="file" className="w-auto text-xs" onChange={handleSshKeyFile} />
              </div>
              <textarea
                className="w-full min-h-[120px] rounded-md border border-input bg-background px-3 py-2 text-xs font-mono resize-y focus:outline-none focus:ring-2 focus:ring-ring"
                value={sshKeyContent}
                onChange={(e) => setSshKeyContent(e.target.value)}
                placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;Paste your private key here...&#10;-----END OPENSSH PRIVATE KEY-----"
                spellCheck={false}
              />
              <Button size="sm" onClick={uploadSshKey} disabled={uploadingKey || !sshKeyContent.trim()}>
                <Upload className="h-4 w-4 mr-1" />
                {uploadingKey ? "Uploading..." : "Upload Key"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </SettingsSection>
  );
};
