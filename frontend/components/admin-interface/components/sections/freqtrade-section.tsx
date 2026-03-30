"use client";

import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { SettingsSection } from "@/components/settings-interface/components/shared/settings-section";
import { RefreshCw, Save, Trash2, Upload, FileCode2, FileJson, FileText, ChevronDown, ChevronRight, Rocket, Settings2, Key, Shield, Star } from "lucide-react";

type FtFileInfo = {
  key: string;
  path: string;
  filename: string;
  exists: boolean;
  size: number;
  modified: number | null;
};

type FtFileContent = FtFileInfo & { content: string };

type FtCategory = {
  label: string;
  ext: string;
  files: FtFileInfo[];
  default: string;
};

type FtFilesResponse = {
  strategy: FtCategory;
  config: FtCategory;
  compose: FtCategory;
  template: FtCategory;
};

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
  google_client_id: string;
  ssh_key_exists?: boolean;
};

type SSHKeySource = {
  id: string;
  label: string;
  path: string;
  exists: boolean;
  size: number;
};

type StrategyOption = { filename: string; name: string };

const CATEGORY_META: Record<string, { label: string; icon: React.ReactNode; accept: string; placeholder: string }> = {
  strategy: { label: "Strategy Files (.py)", icon: <FileCode2 className="h-4 w-4" />, accept: ".py", placeholder: "MyStrategy.py" },
  config:   { label: "Config Files (.json)", icon: <FileJson className="h-4 w-4" />, accept: ".json", placeholder: "config.json" },
  compose:  { label: "Docker Compose (.yml)", icon: <FileText className="h-4 w-4" />, accept: ".yml,.yaml", placeholder: "docker-compose.yml" },
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
  const [fileData, setFileData] = useState<FtFilesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedFile, setExpandedFile] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [loadingContent, setLoadingContent] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState<{ ok: boolean; total: number; success: number; failed: number; bots: Array<{ bot_id: string; bot_name: string; files_pushed: string[]; errors: string[]; reloaded?: boolean; restarted?: boolean; local?: boolean }> } | null>(null);
  const [deploySettings, setDeploySettings] = useState<DeploySettings | null>(null);
  const [originalDeploySettings, setOriginalDeploySettings] = useState<DeploySettings | null>(null);
  const [strategies, setStrategies] = useState<StrategyOption[]>([]);
  const [savingSettings, setSavingSettings] = useState(false);
  const [sshKeyContent, setSshKeyContent] = useState("");
  const [uploadingKey, setUploadingKey] = useState(false);
  const [sshKeySources, setSshKeySources] = useState<SSHKeySource[]>([]);
  const [selectingSource, setSelectingSource] = useState(false);
  // Upload state per category
  const [uploadCategory, setUploadCategory] = useState<string>("strategy");
  const [uploadName, setUploadName] = useState("");
  const [uploadContent, setUploadContent] = useState("");
  const [uploading, setUploading] = useState(false);
  const [settingDefault, setSettingDefault] = useState(false);

  const showMessage = useCallback((type: "success" | "error", text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 4000);
  }, []);

  const fetchFiles = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/freqtrade/files", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load files");
      const data = (await res.json()) as FtFilesResponse;
      setFileData(data);
    } catch (e) {
      showMessage("error", e instanceof Error ? e.message : "Failed to load files");
    } finally {
      setLoading(false);
    }
  }, [showMessage]);

  useEffect(() => { fetchFiles(); }, [fetchFiles]);

  const openFile = async (key: string) => {
    if (expandedFile === key) { setExpandedFile(null); return; }
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
    } finally { setLoadingContent(false); }
  };

  const saveFile = async (key: string) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/freqtrade/files/${encodeURIComponent(key)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editContent }),
      });
      if (!res.ok) throw new Error("Save failed");
      setOriginalContent(editContent);
      showMessage("success", "File saved");
      fetchFiles();
    } catch (e) { showMessage("error", e instanceof Error ? e.message : "Save failed"); }
    finally { setSaving(false); }
  };

  const deleteFile = async (key: string) => {
    if (!confirm(`Delete ${key.split(":")[1] || key}?`)) return;
    setDeleting(key);
    try {
      const res = await fetch(`/api/admin/freqtrade/files/${encodeURIComponent(key)}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      showMessage("success", "File deleted");
      if (expandedFile === key) setExpandedFile(null);
      fetchFiles();
    } catch (e) { showMessage("error", e instanceof Error ? e.message : "Delete failed"); }
    finally { setDeleting(null); }
  };

  const uploadFile = async () => {
    if (!uploadName.trim() || !uploadContent.trim()) { showMessage("error", "Filename and content required"); return; }
    const cat = CATEGORY_META[uploadCategory];
    const ext = cat?.accept.split(",")[0] || ".py";
    const fname = uploadName.trim().endsWith(ext) ? uploadName.trim() : `${uploadName.trim()}${ext}`;
    setUploading(true);
    try {
      const res = await fetch("/api/admin/freqtrade/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: uploadCategory, filename: fname, content: uploadContent }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? "Upload failed");
      }
      showMessage("success", `${fname} uploaded`);
      setUploadName(""); setUploadContent("");
      fetchFiles(); fetchDeploySettings();
    } catch (e) { showMessage("error", e instanceof Error ? e.message : "Upload failed"); }
    finally { setUploading(false); }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadName(file.name);
    const reader = new FileReader();
    reader.onload = () => setUploadContent(reader.result as string);
    reader.readAsText(file);
  };

  const setDefault = async (category: string, filename: string) => {
    setSettingDefault(true);
    try {
      const res = await fetch("/api/admin/freqtrade/set-default", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, filename }),
      });
      if (!res.ok) throw new Error("Failed to set default");
      showMessage("success", `Default ${category} set to ${filename}`);
      fetchFiles();
    } catch (e) { showMessage("error", e instanceof Error ? e.message : "Set default failed"); }
    finally { setSettingDefault(false); }
  };

  const applyToBots = async (fileKeys?: string[]) => {
    setApplying(true); setApplyResult(null);
    try {
      const res = await fetch("/api/admin/freqtrade/apply-to-bots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_keys: fileKeys || ["strategy", "config", "compose"] }),
      });
      if (!res.ok) throw new Error("Apply failed");
      const data = await res.json();
      setApplyResult(data);
      if (data.ok) showMessage("success", `Applied to ${data.success}/${data.total} bot(s)`);
      else showMessage("error", `Applied to ${data.success}/${data.total} bot(s) — ${data.failed} failed`);
    } catch (e) { showMessage("error", e instanceof Error ? e.message : "Apply failed"); }
    finally { setApplying(false); }
  };

  const fetchDeploySettings = useCallback(async () => {
    try {
      const [settingsRes, sshRes] = await Promise.all([
        fetch("/api/admin/freqtrade/deploy-settings", { cache: "no-store" }),
        fetch("/api/admin/freqtrade/ssh-key", { cache: "no-store" }),
      ]);
      if (settingsRes.ok) {
        const data = await settingsRes.json();
        const s = { ...data.settings, ssh_key_exists: !!data.ssh_key_exists };
        setDeploySettings(s); setOriginalDeploySettings(s);
        setStrategies(data.strategies ?? []);
      }
      if (sshRes.ok) {
        const sshData = await sshRes.json();
        setSshKeySources(sshData.sources ?? []);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchDeploySettings(); }, [fetchDeploySettings]);

  const saveDeploySettings = async () => {
    if (!deploySettings) return;
    setSavingSettings(true);
    try {
      const res = await fetch("/api/admin/freqtrade/deploy-settings", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(deploySettings),
      });
      if (!res.ok) throw new Error("Save failed");
      const data = await res.json();
      fetchDeploySettings();
      if (data.ft_applied && data.apply_result) {
        setApplyResult(data.apply_result);
        showMessage("success", `Settings saved — applied to ${data.apply_result.success}/${data.apply_result.total} bot(s)`);
      } else showMessage("success", "Settings saved");
    } catch (e) { showMessage("error", e instanceof Error ? e.message : "Save failed"); }
    finally { setSavingSettings(false); }
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
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: sshKeyContent }),
      });
      if (!res.ok) throw new Error("Upload failed");
      showMessage("success", "SSH key uploaded"); setSshKeyContent("");
      if (deploySettings) setDeploySettings({ ...deploySettings, ssh_key_exists: true });
      fetchDeploySettings();
    } catch (e) { showMessage("error", e instanceof Error ? e.message : "SSH key upload failed"); }
    finally { setUploadingKey(false); }
  };

  const selectSshKeySource = async (sourceId: string) => {
    setSelectingSource(true);
    try {
      const res = await fetch("/api/admin/freqtrade/ssh-key/select", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: sourceId }),
      });
      if (!res.ok) throw new Error("Selection failed");
      const data = await res.json();
      showMessage("success", `SSH key selected: ${data.path}`);
      if (deploySettings) {
        const updated = { ...deploySettings, deploy_ssh_private_key_path: data.path, ssh_key_exists: true };
        setDeploySettings(updated); setOriginalDeploySettings(updated);
      }
      fetchDeploySettings();
    } catch (e) { showMessage("error", e instanceof Error ? e.message : "Failed to select SSH key"); }
    finally { setSelectingSource(false); }
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

  // Render a category file list with default selector
  const renderCategory = (category: string, cat: FtCategory) => {
    const meta = CATEGORY_META[category];
    if (!meta) return null;
    return (
      <div key={category} className="space-y-2">
        <div className="flex items-center gap-2">
          {meta.icon}
          <Label className="text-sm font-medium">{meta.label}</Label>
          <span className="text-xs text-muted-foreground">({cat.files.length} file{cat.files.length !== 1 ? "s" : ""})</span>
        </div>
        {cat.files.length === 0 ? (
          <div className="text-xs text-muted-foreground py-2 pl-6">No files uploaded yet</div>
        ) : (
          <div className="space-y-1">
            {cat.files.map((f) => {
              const isDefault = cat.default === f.filename;
              const isExpanded = expandedFile === f.key;
              return (
                <div key={f.key} className={`rounded-lg border overflow-hidden ${isDefault ? "border-primary/50 bg-primary/5" : "border-border/50"}`}>
                  <div className="flex items-center gap-2 px-3 py-2">
                    <button type="button" className="shrink-0" onClick={() => openFile(f.key)} disabled={loadingContent}>
                      {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </button>
                    <button type="button" className="flex-1 text-left text-sm font-medium truncate" onClick={() => openFile(f.key)} disabled={loadingContent}>
                      {f.filename}
                    </button>
                    <span className="text-xs text-muted-foreground shrink-0">{formatSize(f.size)}</span>
                    <span className="text-xs text-muted-foreground shrink-0">{formatDate(f.modified)}</span>
                    {isDefault ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-primary/10 text-primary border border-primary/20">
                        <Star className="h-3 w-3 fill-current" /> Default
                      </span>
                    ) : (
                      <Button variant="ghost" size="sm" className="h-7 text-xs px-2" onClick={() => setDefault(category, f.filename)} disabled={settingDefault}>
                        Set Default
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                      onClick={() => deleteFile(f.key)} disabled={deleting === f.key}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  {isExpanded && (
                    <div className="border-t border-border/50 p-3 space-y-2">
                      <textarea
                        className="w-full min-h-[300px] rounded-md border border-input bg-background px-3 py-2 text-sm font-mono resize-y focus:outline-none focus:ring-2 focus:ring-ring"
                        value={editContent} onChange={(e) => setEditContent(e.target.value)} spellCheck={false}
                      />
                      <div className="flex items-center gap-2">
                        {editContent !== originalContent && (
                          <Button size="sm" onClick={() => saveFile(f.key)} disabled={saving}>
                            <Save className="h-4 w-4 mr-1" /> {saving ? "Saving..." : "Save"}
                          </Button>
                        )}
                        <Button variant="outline" size="sm" onClick={() => setExpandedFile(null)}>Cancel</Button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <SettingsSection title="Freqtrade" description="Manage Freqtrade strategy files, configuration, and Docker setup">
      {message && (
        <div className={`mb-4 rounded-lg px-4 py-2 text-sm ${message.type === "success" ? "bg-green-500/10 text-green-400 border border-green-500/20" : "bg-red-500/10 text-red-400 border border-red-500/20"}`}>
          {message.text}
        </div>
      )}

      {/* File categories */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Label className="text-base font-medium">Managed Files</Label>
          <Button variant="outline" size="sm" onClick={fetchFiles} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>

        {loading && !fileData ? (
          <div className="text-sm text-muted-foreground py-8 text-center">Loading files...</div>
        ) : fileData ? (
          <div className="space-y-6">
            {(["strategy", "config", "compose"] as const).map((cat) => fileData[cat] && renderCategory(cat, fileData[cat]))}
          </div>
        ) : null}
      </div>

      {/* Upload File */}
      <div className="mt-6 space-y-3 rounded-lg border border-dashed border-border/50 p-4">
        <Label className="text-base font-medium">Upload File</Label>
        <div className="grid gap-3 md:grid-cols-3">
          <div className="space-y-2">
            <Label>Category</Label>
            <select
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              value={uploadCategory} onChange={(e) => { setUploadCategory(e.target.value); setUploadName(""); setUploadContent(""); }}
            >
              {Object.entries(CATEGORY_META).map(([key, meta]) => (
                <option key={key} value={key}>{meta.label}</option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label>Filename</Label>
            <Input value={uploadName} onChange={(e) => setUploadName(e.target.value)} placeholder={CATEGORY_META[uploadCategory]?.placeholder || ""} />
          </div>
          <div className="space-y-2">
            <Label>Or pick file</Label>
            <Input type="file" accept={CATEGORY_META[uploadCategory]?.accept || ""} onChange={handleFileUpload} />
          </div>
        </div>
        {uploadContent && (
          <textarea
            className="w-full min-h-[200px] rounded-md border border-input bg-background px-3 py-2 text-sm font-mono resize-y focus:outline-none focus:ring-2 focus:ring-ring"
            value={uploadContent} onChange={(e) => setUploadContent(e.target.value)} spellCheck={false}
          />
        )}
        {!uploadContent && (
          <textarea
            className="w-full min-h-[80px] rounded-md border border-input bg-background px-3 py-2 text-sm font-mono resize-y focus:outline-none focus:ring-2 focus:ring-ring"
            value={uploadContent} onChange={(e) => setUploadContent(e.target.value)}
            placeholder="Or paste file content here..." spellCheck={false}
          />
        )}
        <Button onClick={uploadFile} disabled={uploading || !uploadName.trim()}>
          <Upload className="h-4 w-4 mr-1" /> {uploading ? "Uploading..." : "Upload"}
        </Button>
      </div>

      {/* Apply to All Bots */}
      <div className="mt-6 space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-base font-medium">Apply to All Bots</Label>
            <p className="text-xs text-muted-foreground mt-1">Push default files to every active bot and reload</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => applyToBots(["strategy"])} disabled={applying}>
              <Rocket className="h-4 w-4 mr-1" /> {applying ? "Applying..." : "Strategy Only"}
            </Button>
            <Button size="sm" onClick={() => applyToBots()} disabled={applying}>
              <Rocket className="h-4 w-4 mr-1" /> {applying ? "Applying..." : "Apply All Files"}
            </Button>
          </div>
        </div>
        {applyResult && (
          <div className="mt-3 space-y-2">
            <div className={`text-sm font-medium ${applyResult.ok ? "text-green-400" : "text-yellow-400"}`}>
              {applyResult.success}/{applyResult.total} bot(s) updated
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
                  {bot.errors.length > 0 && <span className="text-red-400 ml-auto">{bot.errors.join("; ")}</span>}
                </div>
              ))}
            </div>
          </div>
        )}
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
                <Save className="h-4 w-4 mr-1" /> {savingSettings ? "Saving..." : "Save Settings"}
              </Button>
            )}
          </div>

          {/* Freqtrade Deploy */}
          <div className="space-y-3">
            <Label className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Freqtrade</Label>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="ds-strategy">Default Strategy</Label>
                <select id="ds-strategy" className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  value={deploySettings.default_strategy} onChange={(e) => updateSetting("default_strategy", e.target.value)}>
                  <option value="">— Use template —</option>
                  {strategies.map((s) => <option key={s.filename} value={s.name}>{s.name}</option>)}
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

          {/* Hetzner */}
          <div className="space-y-3 pt-4 border-t border-border/30">
            <Label className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Hetzner Provisioning</Label>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2"><Label htmlFor="ds-hetzner-token">API Token</Label><Input id="ds-hetzner-token" type="password" value={deploySettings.hetzner_api_token} onChange={(e) => updateSetting("hetzner_api_token", e.target.value)} placeholder="Hetzner Cloud API token" /></div>
              <div className="space-y-2"><Label htmlFor="ds-hetzner-dc">Datacenter</Label><Input id="ds-hetzner-dc" value={deploySettings.hetzner_datacenter} onChange={(e) => updateSetting("hetzner_datacenter", e.target.value)} placeholder="fsn1" /></div>
              <div className="space-y-2"><Label htmlFor="ds-hetzner-type">Server Type</Label><Input id="ds-hetzner-type" value={deploySettings.hetzner_server_type} onChange={(e) => updateSetting("hetzner_server_type", e.target.value)} placeholder="cx22" /></div>
              <div className="space-y-2"><Label htmlFor="ds-hetzner-image">OS Image</Label><Input id="ds-hetzner-image" value={deploySettings.hetzner_image} onChange={(e) => updateSetting("hetzner_image", e.target.value)} placeholder="ubuntu-22.04" /></div>
              <div className="space-y-2"><Label htmlFor="ds-hetzner-ssh">SSH Key Names</Label><Input id="ds-hetzner-ssh" value={deploySettings.hetzner_ssh_keys} onChange={(e) => updateSetting("hetzner_ssh_keys", e.target.value)} placeholder="my-key (comma-separated)" /></div>
              <div className="space-y-2"><Label htmlFor="ds-hetzner-root">Root Password</Label><Input id="ds-hetzner-root" type="password" value={deploySettings.hetzner_root_password} onChange={(e) => updateSetting("hetzner_root_password", e.target.value)} placeholder="For servers without SSH keys" /></div>
            </div>
          </div>

          {/* SSH */}
          <div className="space-y-3 pt-4 border-t border-border/30">
            <Label className="text-sm font-medium text-muted-foreground uppercase tracking-wide">SSH Configuration</Label>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2"><Label htmlFor="ds-ssh-user">SSH User</Label><Input id="ds-ssh-user" value={deploySettings.deploy_ssh_user} onChange={(e) => updateSetting("deploy_ssh_user", e.target.value)} /></div>
              <div className="space-y-2"><Label htmlFor="ds-ssh-port">SSH Port</Label><Input id="ds-ssh-port" value={deploySettings.deploy_ssh_port} onChange={(e) => updateSetting("deploy_ssh_port", e.target.value)} /></div>
            </div>
            <div className="mt-3 space-y-3 rounded-md border border-dashed border-border/50 p-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium flex items-center gap-1.5"><Key className="h-4 w-4" /> SSH Key</Label>
                <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium ${deploySettings.ssh_key_exists ? "bg-green-500/10 text-green-400 border border-green-500/20" : "bg-yellow-500/10 text-yellow-400 border border-yellow-500/20"}`}>
                  <span className={`h-2 w-2 rounded-full ${deploySettings.ssh_key_exists ? "bg-green-500" : "bg-yellow-500"}`} />
                  {deploySettings.ssh_key_exists ? "SSH key installed" : "No SSH key found"}
                </div>
              </div>
              {sshKeySources.length > 0 && (
                <div className="grid gap-2 md:grid-cols-2">
                  {sshKeySources.map((src) => {
                    const isActive = deploySettings.deploy_ssh_private_key_path === src.path;
                    return (
                      <button key={src.id} type="button" disabled={selectingSource || !src.exists}
                        onClick={() => src.exists && selectSshKeySource(src.id)}
                        className={`flex items-center justify-between gap-2 rounded-md border p-3 text-left text-sm transition-colors ${isActive ? "border-primary bg-primary/5 text-primary" : src.exists ? "border-border hover:border-primary/50 hover:bg-muted/50" : "border-border/30 opacity-50 cursor-not-allowed"}`}>
                        <div><div className="font-medium">{src.label}</div><div className="text-xs text-muted-foreground font-mono">{src.path}</div></div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {src.exists ? <span className="text-xs text-green-400">{formatSize(src.size)}</span> : <span className="text-xs text-yellow-400">Not found</span>}
                          {isActive && <span className="h-2 w-2 rounded-full bg-primary" />}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
              <div className="space-y-2 pt-2 border-t border-border/20">
                <div className="flex items-center justify-between">
                  <Label className="text-sm">Upload SSH Key</Label>
                  <Input type="file" className="w-auto text-xs" onChange={handleSshKeyFile} />
                </div>
                <textarea className="w-full min-h-[100px] rounded-md border border-input bg-background px-3 py-2 text-xs font-mono resize-y focus:outline-none focus:ring-2 focus:ring-ring"
                  value={sshKeyContent} onChange={(e) => setSshKeyContent(e.target.value)}
                  placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;Paste your private key here...&#10;-----END OPENSSH PRIVATE KEY-----" spellCheck={false} />
                <Button size="sm" onClick={uploadSshKey} disabled={uploadingKey || !sshKeyContent.trim()}>
                  <Upload className="h-4 w-4 mr-1" /> {uploadingKey ? "Uploading..." : "Upload Key"}
                </Button>
              </div>
            </div>
          </div>

          {/* Google Auth */}
          <div className="space-y-3 pt-4 border-t border-border/30">
            <Label className="text-sm font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
              <Shield className="h-3.5 w-3.5" /> Google Authentication
            </Label>
            <div className="space-y-2">
              <Label htmlFor="ds-google-client-id">Google Client ID</Label>
              <Input id="ds-google-client-id" value={deploySettings.google_client_id || ""} onChange={(e) => updateSetting("google_client_id", e.target.value)} placeholder="123456789.apps.googleusercontent.com" />
              <p className="text-xs text-muted-foreground">Required for Google Sign-In. Get it from the Google Cloud Console.</p>
            </div>
          </div>
        </div>
      )}
    </SettingsSection>
  );
};
