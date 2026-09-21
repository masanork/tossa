<!-- web/src/lib/AdminModal.svelte -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { swipeDown } from './swipeToDismiss';
  import { focusTrap } from './focusTrap';
  import type { SystemSettings, User } from './types';
  import {
    registerPasskey,
    loginPasskey,
    updateSettings,
    importFederationFromUrl,
    importFederationFromFeatures,
    fetchAuthStatus,
    fetchUsers,
    updateUserRole,
    deleteUserApi,
    broadcastPushApi,
    issueApiTokenApi,
    triggerBackupApi,
    fetchBackupsApi,
    fetchCapacityApi,
    refreshCapacityApi,
    requestEmailVerification,
    confirmEmailVerification,
    type CapacityReport,
    importCsvApi,
    fetchDisasters,
    createDisasterApi,
    archiveDisasterApi,
    activateDisasterApi,
    deleteDisasterApi,
    fetchSettings,
  } from './api';
  import type { BackupRecord, BackupResult } from './types';
  import {
    parseCsv,
    inferColumnMapping,
    normalizeRows,
    generateSampleCsv,
    parseImportFile,
    type ColumnMapping,
    type ExcelSheetInfo,
    type CsvParsedData,
  } from './csvHelper';
  import {
    X,
    KeyRound,
    Shield,
    LogOut,
    Check,
    AlertCircle,
    Download,
    Upload,
    RefreshCw,
    Network,
    Users,
    Sliders,
    Crown,
    Palette,
    BellRing,
    Radio,
    Trash2,
    Bot,
    Copy,
    Database,
    FileText,
    Maximize2,
    Minimize2,
    FileSpreadsheet,
    FileUp,
    AlertTriangle,
    MapPin,
    Building,
    Search,
    Archive,
    ArchiveRestore,
    Plus,
    Calendar,
    ChevronDown,
    ChevronUp,
    Activity,
  } from '@lucide/svelte';
  import { themeManager, THEME_OPTIONS } from './theme.svelte';
  import * as m from '../paraglide/messages.js';
  import { searchMunicipalities, type Municipality } from './municipalityCodes';
  import type { DisasterArea, DisasterEvent, DisasterType } from './types';

  interface Props {
    settings: SystemSettings;
    user: User | null;
    token: string | null;
    isTop?: boolean;
    zIndex?: number;
    onClose: () => void;
    onAuthSuccess: (user: User, token: string) => void;
    onLogout: () => void;
    onSettingsUpdated: (newSettings: SystemSettings) => void;
    onPostsUpdated?: () => void;
  }

  const {
    settings,
    user,
    token,
    isTop = true,
    zIndex = 60,
    onClose,
    onAuthSuccess,
    onLogout,
    onSettingsUpdated,
    onPostsUpdated,
  }: Props = $props();

  let username = $state('');
  let isAuthenticating = $state(false);
  let statusMessage = $state<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // First-time setup state
  let isFirstUserSetup = $state(false);

  // Fullscreen / wide modal state
  let isFullscreen = $state(false);

  // Admin tabs
  let activeTab = $state<
    | 'settings'
    | 'import'
    | 'users'
    | 'federation'
    | 'mcp'
    | 'backup'
    | 'capacity'
  >('settings');

  // CSV / Excel Import state
  let csvFileName = $state('');
  let csvHeaders = $state<string[]>([]);
  let csvRows = $state<string[][]>([]);
  let columnMapping = $state<ColumnMapping>({
    title: null,
    area: null,
    address: null,
    category: null,
    lat: null,
    lng: null,
    currentStatus: null,
    note: null,
    url: null,
  });
  let updateDuplicates = $state(true);
  let defaultCategoryId = $state('shelter');
  let isImportingCsv = $state(false);
  let csvStatusMessage = $state<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  let isDraggingCsv = $state(false);
  let fileInputRef = $state<HTMLInputElement | null>(null);

  // Excel (.xlsx) sheet selection state
  let availableSheets = $state<ExcelSheetInfo[]>([]);
  let selectedSheetIndex = $state<number>(0);

  const normalizedPreview = $derived.by(() => {
    if (csvRows.length === 0 || csvHeaders.length === 0) {
      return { valid: [], errors: [] };
    }
    return normalizeRows(
      csvRows,
      columnMapping,
      defaultArea || settings.default_area || ''
    );
  });

  function applySheetData(data: CsvParsedData) {
    csvHeaders = data.headers;
    csvRows = data.rows;
    columnMapping = inferColumnMapping(data.headers);
  }

  function handleSelectSheet(index: number) {
    selectedSheetIndex = index;
    const sheet = availableSheets[index];
    if (sheet) {
      applySheetData(sheet.data);
    }
  }

  async function handleImportSpreadsheetFile(file: File) {
    try {
      csvStatusMessage = null;
      csvFileName = file.name;

      const result = await parseImportFile(file);
      availableSheets = result.sheets;
      selectedSheetIndex = 0;

      if (result.sheets.length > 0 && result.sheets[0]) {
        applySheetData(result.sheets[0].data);
      }
    } catch (err: any) {
      csvStatusMessage = {
        type: 'error',
        text: `ファイルの読み込みに失敗しました: ${err?.message}`,
      };
    }
  }

  function handleLoadSampleCsv() {
    const sample = generateSampleCsv();
    csvFileName = 'tossa_shelter_sample.csv';
    const parsed = parseCsv(sample);
    availableSheets = [{ name: 'tossa_shelter_sample.csv', data: parsed }];
    selectedSheetIndex = 0;
    applySheetData(parsed);
    csvStatusMessage = null;
  }

  function handleDownloadSampleCsv() {
    const sample = generateSampleCsv();
    const blob = new Blob([new Uint8Array([0xef, 0xbb, 0xbf]), sample], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tossa_shelter_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleExecuteCsvImport() {
    if (!token) return;
    if (normalizedPreview.valid.length === 0) {
      csvStatusMessage = {
        type: 'error',
        text: 'インポート可能な有効データがありません',
      };
      return;
    }

    isImportingCsv = true;
    csvStatusMessage = null;
    try {
      const res = await importCsvApi(
        {
          posts: normalizedPreview.valid,
          updateDuplicates,
          defaultCategoryId,
        },
        token
      );

      if (res.success && res.stats) {
        csvStatusMessage = {
          type: 'success',
          text:
            res.message ||
            `${res.stats.added}件を追加、${res.stats.updated}件を更新しました`,
        };
        if (onPostsUpdated) {
          onPostsUpdated();
        }
      } else {
        csvStatusMessage = {
          type: 'error',
          text: res.error || '一括インポートに失敗しました',
        };
      }
    } catch (err: any) {
      csvStatusMessage = {
        type: 'error',
        text: `エラーが発生しました: ${err?.message}`,
      };
    } finally {
      isImportingCsv = false;
    }
  }

  // Backup state
  let backups = $state<BackupRecord[]>([]);
  let isLoadingBackups = $state(false);
  let isTriggeringBackup = $state(false);
  let backupStatusMessage = $state<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  let lastBackupResult = $state<BackupResult | null>(null);

  let capacityReport = $state<CapacityReport | null>(null);
  let isLoadingCapacity = $state(false);
  let isRefreshingCapacity = $state(false);
  let capacityError = $state<string | null>(null);

  async function loadCapacity() {
    if (!token) return;
    isLoadingCapacity = true;
    capacityError = null;
    try {
      const res = await fetchCapacityApi(token);
      if (res.success && res.report) {
        capacityReport = res.report;
      } else {
        capacityError = res.error || '規模レポートを取得できませんでした';
      }
    } catch (err: any) {
      capacityError = err?.message || '規模レポートを取得できませんでした';
    } finally {
      isLoadingCapacity = false;
    }
  }

  async function handleRefreshCapacity() {
    if (!token) return;
    isRefreshingCapacity = true;
    capacityError = null;
    try {
      const res = await refreshCapacityApi(token);
      if (res.success && res.report) {
        capacityReport = res.report;
      } else {
        capacityError = res.error || 'スナップショット更新に失敗しました';
      }
    } catch (err: any) {
      capacityError = err?.message || 'スナップショット更新に失敗しました';
    } finally {
      isRefreshingCapacity = false;
    }
  }

  async function loadBackups() {
    if (!token) return;
    isLoadingBackups = true;
    try {
      const res = await fetchBackupsApi(token);
      if (res.success && res.backups) {
        backups = res.backups;
      }
    } catch (err: any) {
      console.error('Failed to load backups:', err);
    } finally {
      isLoadingBackups = false;
    }
  }

  async function handleTriggerBackup() {
    if (!token || isTriggeringBackup) return;
    isTriggeringBackup = true;
    backupStatusMessage = null;
    try {
      const res = await triggerBackupApi(token);
      if (res.success) {
        lastBackupResult = res;
        const count = res.metadata?.totalRecords ?? 0;
        backupStatusMessage = {
          type: 'success',
          text: `D1データベースのバックアップが完了しました（合計 ${count} 件）`,
        };
        await loadBackups();
      } else {
        backupStatusMessage = {
          type: 'error',
          text: res.error || 'バックアップの実行に失敗しました',
        };
      }
    } catch (err: any) {
      backupStatusMessage = {
        type: 'error',
        text: err?.message || '通信エラーが発生しました',
      };
    } finally {
      isTriggeringBackup = false;
    }
  }

  // MCP / API Token state
  let mcpTokenName = $state('Claude / Cursor MCP');
  let isIssuingMcpToken = $state(false);
  let issuedMcpToken = $state<{
    token: string;
    tokenName: string;
    expiresAt: string;
  } | null>(null);
  let isTokenCopied = $state(false);
  let isSnippetCopied = $state(false);
  let mcpTokenError = $state<string | null>(null);

  async function handleIssueMcpToken() {
    if (!token) return;
    isIssuingMcpToken = true;
    mcpTokenError = null;
    isTokenCopied = false;
    try {
      const res = await issueApiTokenApi(
        mcpTokenName.trim() || 'MCP Agent',
        token
      );
      if (res.success && res.token) {
        issuedMcpToken = {
          token: res.token,
          tokenName: res.tokenName || mcpTokenName,
          expiresAt: res.expiresAt || '',
        };
      } else {
        mcpTokenError = res.error || 'トークン発行に失敗しました';
      }
    } catch (err: any) {
      mcpTokenError = err.message || '通信エラーが発生しました';
    } finally {
      isIssuingMcpToken = false;
    }
  }

  async function handleCopyToken() {
    if (!issuedMcpToken) return;
    await navigator.clipboard.writeText(issuedMcpToken.token);
    isTokenCopied = true;
    setTimeout(() => {
      isTokenCopied = false;
    }, 2500);
  }

  async function handleCopySnippet() {
    const origin = window.location.origin;
    const tokenStr = issuedMcpToken
      ? issuedMcpToken.token
      : 'tossa_pat_YOUR_TOKEN';
    const snippet = JSON.stringify(
      {
        mcpServers: {
          tossa: {
            url: `${origin}/mcp`,
            headers: {
              Authorization: `Bearer ${tokenStr}`,
            },
          },
        },
      },
      null,
      2
    );
    await navigator.clipboard.writeText(snippet);
    isSnippetCopied = true;
    setTimeout(() => {
      isSnippetCopied = false;
    }, 2500);
  }

  // Settings form state
  let emergencyBanner = $state('');
  let defaultArea = $state('');
  let isSavingSettings = $state(false);

  // Federation / Migration sync state
  let remoteSyncUrl = $state('');
  let isSyncing = $state(false);
  let syncMessage = $state<{ type: 'success' | 'error'; text: string } | null>(
    null
  );
  let fileInput = $state<HTMLInputElement | null>(null);

  // Member management state
  let userList = $state<User[]>([]);
  let userQueryInput = $state('');
  let userQuery = $state('');
  let userRoleFilter = $state<'all' | 'admin' | 'moderator' | 'user'>('all');
  let userPage = $state(0);
  let userTotal = $state(0);
  let userCounts = $state({
    all: 0,
    admin: 0,
    moderator: 0,
    user: 0,
  });
  const USER_PAGE_SIZE = 50;
  let userSearchTimer: ReturnType<typeof setTimeout> | null = null;

  let emailInput = $state('');
  let emailCodeInput = $state('');
  let isSendingEmail = $state(false);
  let isConfirmingEmail = $state(false);
  let emailFormError = $state<string | null>(null);

  async function handleSendEmailCode() {
    if (!token) return;
    isSendingEmail = true;
    emailFormError = null;
    try {
      const res = await requestEmailVerification(emailInput, token);
      if (res.success) {
        statusMessage = { type: 'success', text: '確認番号を送りました' };
      } else {
        emailFormError = res.error || '送信に失敗しました';
      }
    } catch (err: any) {
      emailFormError = err?.message || '送信に失敗しました';
    } finally {
      isSendingEmail = false;
    }
  }

  async function handleConfirmEmailCode() {
    if (!token) return;
    isConfirmingEmail = true;
    emailFormError = null;
    try {
      const res = await confirmEmailVerification(token, {
        code: emailCodeInput,
      });
      if (res.success && res.user) {
        onAuthSuccess(res.user, token);
        emailCodeInput = '';
        emailInput = '';
        statusMessage = {
          type: 'success',
          text: 'メールアドレスを確認しました',
        };
      } else {
        emailFormError = res.error || '確認に失敗しました';
      }
    } catch (err: any) {
      emailFormError = err?.message || '確認に失敗しました';
    } finally {
      isConfirmingEmail = false;
    }
  }
  let isLoadingUsers = $state(false);
  let roleChangeMessage = $state<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Web Push broadcast state
  let broadcastTitle = $state('');
  let broadcastBody = $state('');
  let broadcastArea = $state('');
  let isBroadcasting = $state(false);
  let broadcastResult = $state<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  async function handleBroadcastPush() {
    if (!token || !broadcastTitle || !broadcastBody) return;
    isBroadcasting = true;
    broadcastResult = null;
    const res = await broadcastPushApi(
      {
        title: broadcastTitle,
        body: broadcastBody,
        area: broadcastArea || undefined,
        alertType: 'emergency',
      },
      token
    );
    isBroadcasting = false;
    if (res.success) {
      broadcastResult = {
        type: 'success',
        text: `配信完了: 送信 ${res.result?.sent ?? 0} 件 (失敗: ${res.result?.failed ?? 0} 件)`,
      };
      broadcastTitle = '';
      broadcastBody = '';
    } else {
      broadcastResult = {
        type: 'error',
        text: res.error || 'プッシュ一斉配信に失敗しました',
      };
    }
  }

  // Multi-Disaster Events State
  let disastersList = $state<DisasterEvent[]>([]);
  let isLoadingDisasters = $state(false);
  let showNewDisasterForm = $state(false);
  let showArchivedDisasters = $state(false);

  // New disaster form
  let newDisasterName = $state('');
  let newDisasterType = $state<DisasterType>('earthquake');
  let newDisasterDesignatedAt = $state(new Date().toISOString().slice(0, 16));
  let newDisasterAreas = $state<DisasterArea[]>([]);
  let newDisasterBannerMessage = $state('');
  let newDisasterNote = $state('');
  let isSubmittingDisaster = $state(false);
  let disasterFormError = $state<string | null>(null);

  // Muni search for new disaster form
  let newMuniSearchQuery = $state('');
  let newMuniSearchResults = $state<Municipality[]>([]);
  let isSearchingNewMuni = $state(false);
  let newMuniSearchTimer: any = null;

  const activeDisasters = $derived(
    disastersList.filter((d) => d.status === 'active')
  );
  const archivedDisasters = $derived(
    disastersList.filter((d) => d.status === 'archived')
  );

  function getDisasterTypeLabel(type: DisasterType): string {
    switch (type) {
      case 'earthquake':
        return m.disaster_type_earthquake();
      case 'flood':
        return m.disaster_type_flood();
      case 'landslide':
        return m.disaster_type_landslide();
      case 'tsunami':
        return m.disaster_type_tsunami();
      case 'storm':
        return m.disaster_type_storm();
      case 'volcano':
        return m.disaster_type_volcano();
      case 'snow':
        return m.disaster_type_snow();
      default:
        return m.disaster_type_other();
    }
  }

  async function loadDisasters() {
    isLoadingDisasters = true;
    try {
      disastersList = await fetchDisasters();
    } catch (err: any) {
      console.error('Failed to load disasters', err);
    } finally {
      isLoadingDisasters = false;
    }
  }

  function handleNewMuniInput(e: Event) {
    const q = (e.target as HTMLInputElement).value;
    newMuniSearchQuery = q;
    clearTimeout(newMuniSearchTimer);
    if (!q.trim()) {
      newMuniSearchResults = [];
      isSearchingNewMuni = false;
      return;
    }
    isSearchingNewMuni = true;
    newMuniSearchTimer = setTimeout(async () => {
      newMuniSearchResults = await searchMunicipalities(q.trim());
      isSearchingNewMuni = false;
    }, 180);
  }

  function handleAddNewDisasterArea(muni: Municipality) {
    if (
      !newDisasterAreas.some(
        (a) => a.code === muni.code || a.name === muni.name
      )
    ) {
      newDisasterAreas = [
        ...newDisasterAreas,
        {
          code: muni.code,
          name: muni.name,
          pref: muni.pref,
          fullName: muni.fullName,
          lat: muni.lat,
          lng: muni.lng,
          isPrefecture: muni.isPrefecture,
        },
      ];
    }
    newMuniSearchQuery = '';
    newMuniSearchResults = [];
  }

  function handleRemoveNewDisasterArea(code: string) {
    newDisasterAreas = newDisasterAreas.filter((a) => a.code !== code);
  }

  async function handleCreateDisaster() {
    if (!newDisasterName.trim()) {
      disasterFormError = '災害名を入力してください';
      return;
    }
    isSubmittingDisaster = true;
    disasterFormError = null;
    try {
      const res = await createDisasterApi(
        {
          name: newDisasterName.trim(),
          disaster_type: newDisasterType,
          designated_at: newDisasterDesignatedAt
            ? new Date(newDisasterDesignatedAt).toISOString()
            : new Date().toISOString(),
          areas: newDisasterAreas,
          banner_message: newDisasterBannerMessage.trim() || undefined,
          note: newDisasterNote.trim() || undefined,
        },
        token
      );
      if (!res.success) {
        throw new Error(res.error || '災害の登録に失敗しました');
      }
      newDisasterName = '';
      newDisasterType = 'earthquake';
      newDisasterDesignatedAt = new Date().toISOString().slice(0, 16);
      newDisasterAreas = [];
      newDisasterBannerMessage = '';
      newDisasterNote = '';
      showNewDisasterForm = false;

      await loadDisasters();
      const updated = await fetchSettings();
      onSettingsUpdated(updated);
    } catch (err: any) {
      disasterFormError = err.message || '災害の登録に失敗しました';
    } finally {
      isSubmittingDisaster = false;
    }
  }

  async function handleArchiveDisaster(disaster: DisasterEvent) {
    if (
      !confirm(
        `災害「${disaster.name}」を収束・アーカイブしますか？\n進行中の災害が0件になると、システムは自動的に平時モードに戻ります。`
      )
    ) {
      return;
    }
    try {
      const res = await archiveDisasterApi(disaster.id, token);
      if (!res.success) {
        throw new Error(res.error || 'アーカイブに失敗しました');
      }
      await loadDisasters();
      const updated = await fetchSettings();
      onSettingsUpdated(updated);
    } catch (err: any) {
      alert('アーカイブに失敗しました: ' + err.message);
    }
  }

  async function handleActivateDisaster(disaster: DisasterEvent) {
    try {
      const res = await activateDisasterApi(disaster.id, token);
      if (!res.success) {
        throw new Error(res.error || '再開に失敗しました');
      }
      await loadDisasters();
      const updated = await fetchSettings();
      onSettingsUpdated(updated);
    } catch (err: any) {
      alert('再開に失敗しました: ' + err.message);
    }
  }

  async function handleDeleteDisaster(disaster: DisasterEvent) {
    if (
      !confirm(
        `災害「${disaster.name}」を削除しますか？\nこの操作は取り消せません。`
      )
    ) {
      return;
    }
    try {
      const res = await deleteDisasterApi(disaster.id, token);
      if (!res.success) {
        throw new Error(res.error || '削除に失敗しました');
      }
      await loadDisasters();
      const updated = await fetchSettings();
      onSettingsUpdated(updated);
    } catch (err: any) {
      alert('削除に失敗しました: ' + err.message);
    }
  }

  let isFetchingDisasterShelters = $state(false);
  let disasterShelterMessage = $state<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  let fetchedDisasterShelters = $state<any[]>([]);

  async function handleFetchSheltersForDisaster(disaster: DisasterEvent) {
    if (!disaster.areas || disaster.areas.length === 0) {
      alert('この災害には対象地域が設定されていません。');
      return;
    }
    isFetchingDisasterShelters = true;
    disasterShelterMessage = null;
    fetchedDisasterShelters = [];

    try {
      const res = await fetch('/api/opendata/disaster-areas/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ areas: disaster.areas }),
      });

      if (!res.ok) throw new Error('避難所データの取得に失敗しました');
      const data: any = await res.json();
      if (data.success && Array.isArray(data.shelters)) {
        fetchedDisasterShelters = data.shelters;
        disasterShelterMessage = {
          type: 'success',
          text: `【${disaster.name}】${m.admin_disaster_fetched_count({ count: data.count })}`,
        };
        handleTransferDisasterSheltersToImport();
      } else {
        throw new Error(data.error || 'データが見つかりませんでした');
      }
    } catch (err: any) {
      disasterShelterMessage = {
        type: 'error',
        text: err.message || '取得エラーが発生しました',
      };
    } finally {
      isFetchingDisasterShelters = false;
    }
  }

  // Operation mode & disaster areas state (settings sync)
  let operationMode = $state<'normal' | 'disaster'>('normal');
  let disasterAreas = $state<DisasterArea[]>([]);

  $effect(() => {
    emergencyBanner = settings.emergency_banner || '';
    defaultArea = settings.default_area || '';
    operationMode =
      (settings.operation_mode as any) === 'disaster' ? 'disaster' : 'normal';
    if (settings.disaster_areas) {
      try {
        disasterAreas = JSON.parse(settings.disaster_areas);
      } catch {
        disasterAreas = [];
      }
    }
  });

  function handleTransferDisasterSheltersToImport() {
    if (fetchedDisasterShelters.length === 0) return;
    const headers = [
      '施設名称',
      '市区町村名',
      '施設所在地',
      '施設種別',
      '開設状況',
      '緯度',
      '経度',
      '備考',
      'ホームページURL',
    ];
    const rows = fetchedDisasterShelters.map((item) => [
      item.name,
      item.area,
      item.address,
      item.category,
      item.status_label || '開設中',
      String(item.lat),
      String(item.lng),
      item.note,
      item.source_url,
    ]);
    const csvLines = [
      headers.join(','),
      ...rows.map((r: string[]) =>
        r.map((v) => `"${(v || '').replace(/"/g, '""')}"`).join(',')
      ),
    ].join('\n');
    csvFileName = 'disaster-shelters-opendata.csv';
    const parsed = parseCsv(csvLines);
    availableSheets = [
      { name: '国土地理院避難所オープンデータ', data: parsed },
    ];
    selectedSheetIndex = 0;
    applySheetData(parsed);
    activeTab = 'import';
    disasterShelterMessage = {
      type: 'success',
      text: `${fetchedDisasterShelters.length} 件を一括インポート用プレビューに展開しました。「一括取り込みを実行」を押してD1に保存してください。`,
    };
  }

  onMount(async () => {
    // Initial setup check (whether there are 0 users registered)
    const status = await fetchAuthStatus();
    if (status.success) {
      isFirstUserSetup = status.isFirstUserSetup;
    }

    if (user?.role === 'admin' && token) {
      await loadUsers();
    }
  });

  async function loadUsers() {
    if (!token) return;
    isLoadingUsers = true;
    try {
      const res = await fetchUsers(token, {
        q: userQuery,
        role: userRoleFilter,
        limit: USER_PAGE_SIZE,
        offset: userPage * USER_PAGE_SIZE,
      });
      if (res.success && res.users) {
        userList = res.users;
        userTotal = res.total ?? res.users.length;
        if (res.counts) userCounts = res.counts;
      } else if (res.error) {
        roleChangeMessage = { type: 'error', text: res.error };
      }
    } catch {
      // ignore
    } finally {
      isLoadingUsers = false;
    }
  }

  function handleUserSearchInput(value: string) {
    userQueryInput = value;
    if (userSearchTimer) clearTimeout(userSearchTimer);
    userSearchTimer = setTimeout(() => {
      userQuery = userQueryInput.trim();
      userPage = 0;
      void loadUsers();
    }, 300);
  }

  function handleUserRoleFilter(role: 'all' | 'admin' | 'moderator' | 'user') {
    userRoleFilter = role;
    userPage = 0;
    void loadUsers();
  }

  $effect(() => {
    if (
      activeTab === 'users' &&
      token &&
      user?.role === 'admin' &&
      userList.length === 0 &&
      !isLoadingUsers
    ) {
      void loadUsers();
    }
  });

  function isPasskeyCancelled(error?: string) {
    if (!error) return false;
    const text = error.toLowerCase();
    return (
      text.includes('cancel') ||
      text.includes('abort') ||
      text.includes('notallowed') ||
      text.includes('キャンセル')
    );
  }

  async function finishAuth(authed: User, authToken: string) {
    onAuthSuccess(authed, authToken);
    const adminNote =
      authed.role === 'admin' && isFirstUserSetup
        ? '（最初の認証のため管理者になりました）'
        : '';
    statusMessage = {
      type: 'success',
      text: `${authed.displayName} さんとして認証しました${adminNote}`,
    };
    if (authed.role === 'admin') {
      await loadUsers();
    }
  }

  async function handlePasskeyAuth() {
    isAuthenticating = true;
    statusMessage = null;
    const name = username.trim();

    try {
      const login = await loginPasskey(name || undefined);
      if (login.success && login.user && login.token) {
        await finishAuth(login.user, login.token);
        return;
      }
      if (isPasskeyCancelled(login.error)) {
        statusMessage = { type: 'error', text: 'キャンセルしました' };
        return;
      }

      if (!name) {
        statusMessage = {
          type: 'error',
          text: 'お名前を入力して、Passkey で認証してください',
        };
        return;
      }

      const registered = await registerPasskey(name, name);
      if (registered.success && registered.user && registered.token) {
        await finishAuth(registered.user, registered.token);
        return;
      }
      if (isPasskeyCancelled(registered.error)) {
        statusMessage = { type: 'error', text: 'キャンセルしました' };
        return;
      }
      statusMessage = {
        type: 'error',
        text:
          registered.error || login.error || 'Passkey で認証できませんでした',
      };
    } catch (err: any) {
      statusMessage = {
        type: 'error',
        text: err.message || 'Passkey で認証できませんでした',
      };
    } finally {
      isAuthenticating = false;
    }
  }

  // Change user role (delegation)
  async function handleUpdateRole(
    targetUserId: string,
    targetUsername: string,
    newRole: 'admin' | 'user'
  ) {
    if (!token) return;
    roleChangeMessage = null;

    try {
      const res = await updateUserRole(targetUserId, newRole, token);
      if (res.success) {
        roleChangeMessage = {
          type: 'success',
          text: `「${targetUsername}」の権限を「${newRole === 'admin' ? '管理者' : '一般ユーザー'}」に変更しました`,
        };
        await loadUsers();
      } else {
        roleChangeMessage = {
          type: 'error',
          text: res.error || '権限の変更に失敗しました',
        };
      }
    } catch (err: any) {
      roleChangeMessage = {
        type: 'error',
        text: err.message || '権限更新エラー',
      };
    }
  }

  // Delete user
  async function handleDeleteUser(
    targetUserId: string,
    targetUsername: string
  ) {
    if (!token) return;
    if (
      !confirm(
        `ユーザー「${targetUsername}」を完全に削除してもよろしいですか？\nこの操作は取り消せません。`
      )
    ) {
      return;
    }

    roleChangeMessage = null;
    try {
      const res = await deleteUserApi(targetUserId, token);
      if (res.success) {
        roleChangeMessage = {
          type: 'success',
          text: res.message || `ユーザー「${targetUsername}」を削除しました`,
        };
        await loadUsers();
      } else {
        roleChangeMessage = {
          type: 'error',
          text: res.error || 'ユーザー削除に失敗しました',
        };
      }
    } catch (err: any) {
      roleChangeMessage = {
        type: 'error',
        text: err.message || 'ユーザー削除エラー',
      };
    }
  }

  // Save system settings
  async function handleSaveSettings() {
    if (!token) return;

    isSavingSettings = true;
    statusMessage = null;

    try {
      const res = await updateSettings(
        {
          emergency_banner: emergencyBanner,
          default_area: defaultArea,
          operation_mode: operationMode,
          disaster_areas: JSON.stringify(disasterAreas),
        },
        token
      );

      if (res.success && res.settings) {
        onSettingsUpdated(res.settings);
        statusMessage = { type: 'success', text: 'システム設定を更新しました' };
      } else {
        statusMessage = {
          type: 'error',
          text: res.error || '設定の更新に失敗しました',
        };
      }
    } catch (err: any) {
      statusMessage = { type: 'error', text: err.message || '設定更新エラー' };
    } finally {
      isSavingSettings = false;
    }
  }

  // Import and synchronize data from remote URL
  async function handleSyncFromRemoteUrl() {
    if (!token || !remoteSyncUrl.trim()) return;

    isSyncing = true;
    syncMessage = null;

    try {
      const res = await importFederationFromUrl(remoteSyncUrl.trim(), token);
      if (res.success) {
        syncMessage = {
          type: 'success',
          text: res.message || '同期が完了しました',
        };
        onSettingsUpdated(settings);
      } else {
        syncMessage = {
          type: 'error',
          text: res.error || '同期に失敗しました',
        };
      }
    } catch (err: any) {
      syncMessage = { type: 'error', text: err.message || '通信エラー' };
    } finally {
      isSyncing = false;
    }
  }

  // Import GeoJSON from uploaded file
  async function handleImportFile(e: Event) {
    const target = e.target as HTMLInputElement;
    const file = target.files?.[0];
    if (!file || !token) return;

    isSyncing = true;
    syncMessage = null;

    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const features = json.features || (Array.isArray(json) ? json : []);

      if (!features || features.length === 0) {
        syncMessage = {
          type: 'error',
          text: '有効なGeoJSON featureが見つかりませんでした',
        };
        return;
      }

      const res = await importFederationFromFeatures(features, token);
      if (res.success) {
        syncMessage = {
          type: 'success',
          text: res.message || 'インポートが完了しました',
        };
        onSettingsUpdated(settings);
      } else {
        syncMessage = { type: 'error', text: res.error || 'インポート失敗' };
      }
    } catch (err: any) {
      syncMessage = {
        type: 'error',
        text: `ファイル解析エラー: ${err.message}`,
      };
    } finally {
      isSyncing = false;
      if (fileInput) fileInput.value = '';
    }
  }
</script>

<div
  role="presentation"
  style="z-index: {zIndex};"
  inert={!isTop}
  onclick={(e) => {
    if (e.target === e.currentTarget && isTop) onClose();
  }}
  class="fixed inset-0 flex items-end justify-center bg-black/60 p-0 backdrop-blur-xs transition-all duration-200 {isFullscreen
    ? 'sm:p-2 md:p-3'
    : 'sm:items-center sm:p-4 md:p-6'} {isTop ? 'opacity-100' : 'opacity-80'}"
>
  <div
    role="dialog"
    aria-modal="true"
    aria-labelledby="admin-modal-title"
    use:focusTrap={{ onEscape: onClose }}
    use:swipeDown={onClose}
    class="animate-in fade-in slide-in-from-bottom-6 sm:slide-in-from-bottom-0 sm:zoom-in-95 flex flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl transition-all duration-200 sm:rounded-2xl dark:bg-slate-900 dark:text-slate-100 {!user
      ? 'max-h-[94vh] w-full max-w-xl sm:max-h-[90vh]'
      : isFullscreen
        ? 'h-full w-full max-w-none rounded-t-2xl sm:rounded-2xl'
        : 'h-[96vh] w-full max-w-5xl sm:h-[90vh] xl:max-w-6xl'} {isTop
      ? 'scale-100 opacity-100'
      : 'pointer-events-none scale-[0.97] opacity-85'}"
  >
    <!-- Mobile drag handle -->
    <div
      class="mx-auto my-2.5 h-1.5 w-12 shrink-0 rounded-full bg-slate-300 sm:hidden dark:bg-slate-700"
    ></div>

    <!-- Header -->
    <div
      class="flex shrink-0 items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-3.5 dark:border-slate-800 dark:bg-slate-800/80"
    >
      <div class="flex items-center gap-2">
        <KeyRound class="h-4 w-4 text-blue-600 dark:text-blue-400" />
        <h2
          id="admin-modal-title"
          class="text-base font-black text-slate-900 dark:text-white"
        >
          {user
            ? user.role === 'admin'
              ? 'システム管理ダッシュボード'
              : 'アカウント設定'
            : 'Passkey で認証'}
        </h2>
        {#if user}
          <span
            class="hidden items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold sm:inline-flex {user.role ===
            'admin'
              ? 'border border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
              : 'border border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300'}"
          >
            {user.role === 'admin' ? '管理者' : '一般ユーザー'}
          </span>
        {/if}
      </div>

      <div class="flex items-center gap-1">
        {#if user}
          <button
            type="button"
            onclick={() => (isFullscreen = !isFullscreen)}
            aria-label={isFullscreen
              ? '元のサイズに戻す'
              : '画面いっぱいに広げる'}
            title={isFullscreen ? '元のサイズに戻す' : '画面いっぱいに広げる'}
            class="hidden cursor-pointer rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-200 hover:text-slate-800 sm:inline-flex dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200"
          >
            {#if isFullscreen}
              <Minimize2 class="h-4 w-4" />
            {:else}
              <Maximize2 class="h-4 w-4" />
            {/if}
          </button>
        {/if}
        <button
          type="button"
          onclick={onClose}
          aria-label="閉じる"
          class="cursor-pointer rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-200 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-300"
        >
          <X class="h-5 w-5" />
        </button>
      </div>
    </div>

    <div class="flex flex-col gap-4 overflow-y-auto p-4 sm:p-5">
      {#if statusMessage}
        <div
          class={`flex items-center gap-2 rounded-xl p-3 text-xs font-medium ${
            statusMessage.type === 'success'
              ? 'border border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-300'
              : 'border border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800/60 dark:bg-rose-950/40 dark:text-rose-300'
          }`}
        >
          {#if statusMessage.type === 'success'}
            <Check
              class="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400"
            />
          {:else}
            <AlertCircle
              class="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400"
            />
          {/if}
          <span>{statusMessage.text}</span>
        </div>
      {/if}

      {#if !user}
        <div class="flex flex-col gap-3.5">
          {#if isFirstUserSetup}
            <div
              class="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-700/50 dark:bg-amber-950/30 dark:text-amber-200"
            >
              <Crown
                class="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
              />
              <p class="leading-relaxed text-amber-800 dark:text-amber-300">
                最初に認証した人が管理者になります。お名前を入れて Passkey
                で認証してください。
              </p>
            </div>
          {:else}
            <p
              class="text-xs leading-relaxed text-slate-600 dark:text-slate-400"
            >
              指紋や顔認証で入れます。パスワードは不要です。
            </p>
          {/if}

          <div>
            <label
              for="auth-username"
              class="mb-1 block text-xs font-bold text-slate-700 dark:text-slate-300"
            >
              お名前
            </label>
            <input
              id="auth-username"
              type="text"
              bind:value={username}
              placeholder="例: 山田太郎"
              autocomplete="username webauthn"
              class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-blue-500 focus:outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
            />
          </div>

          <button
            type="button"
            onclick={handlePasskeyAuth}
            disabled={isAuthenticating}
            class="flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-3 py-2.5 text-sm font-bold text-white shadow-xs transition hover:bg-blue-700 disabled:opacity-50"
          >
            <KeyRound class="h-4 w-4" />
            <span>{isAuthenticating ? '認証中...' : 'Passkey で認証'}</span>
          </button>
        </div>

        <!-- 2. Authenticated state -->
      {:else}
        <div class="flex flex-col gap-4">
          <!-- User info badge -->
          <div
            class="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-800/60"
          >
            <div class="flex items-center gap-2.5">
              <div
                class="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-tr from-blue-600 to-indigo-600 text-sm font-black text-white shadow-xs"
              >
                {user.displayName.charAt(0)}
              </div>
              <div>
                <div
                  class="flex items-center gap-1.5 text-xs font-bold text-slate-900 dark:text-slate-100"
                >
                  <span>{user.displayName}</span>
                  {#if user.role === 'admin'}
                    <span
                      class="py-0.2 inline-flex items-center gap-0.5 rounded-full border border-amber-300 bg-amber-100 px-1.5 text-[10px] font-bold text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                    >
                      <Crown
                        class="h-3 w-3 text-amber-600 dark:text-amber-400"
                      />
                      管理者
                    </span>
                  {:else}
                    <span
                      class="py-0.2 inline-flex items-center gap-0.5 rounded-full border border-blue-200 bg-blue-50 px-1.5 text-[10px] font-semibold text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300"
                    >
                      一般ユーザー
                    </span>
                  {/if}
                </div>
                <div
                  class="font-mono text-[11px] text-slate-500 dark:text-slate-400"
                >
                  @{user.username}
                </div>
              </div>
            </div>
            <button
              type="button"
              onclick={onLogout}
              class="flex cursor-pointer items-center gap-1 rounded-lg border border-rose-200 px-2.5 py-1.5 text-xs font-medium text-rose-600 transition hover:bg-rose-50 dark:border-rose-800 dark:text-rose-400 dark:hover:bg-rose-950/40"
              title="ログアウト"
            >
              <LogOut class="h-3.5 w-3.5" />
              <span>ログアウト</span>
            </button>
          </div>

          <div
            class="rounded-xl border border-slate-200 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-slate-800/40"
          >
            <div
              class="text-[11px] font-bold text-slate-700 dark:text-slate-200"
            >
              メールアドレス（任意）
            </div>
            {#if user.emailVerified && user.email}
              <p class="mt-1 text-xs text-slate-600 dark:text-slate-300">
                {user.email}
                <span
                  class="ml-1 font-bold text-emerald-700 dark:text-emerald-400"
                  >確認済み</span
                >
              </p>
            {:else}
              <p
                class="mt-1 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400"
              >
                連絡とメンバー管理に使います。パスワードにはしません。
              </p>
              {#if user.pendingEmail}
                <p class="mt-1 text-[11px] text-amber-800 dark:text-amber-300">
                  {user.pendingEmail} に番号を送りました
                </p>
              {/if}
              <div class="mt-2 flex flex-col gap-2 sm:flex-row">
                <input
                  type="email"
                  bind:value={emailInput}
                  placeholder="you@example.com"
                  class="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
                <button
                  type="button"
                  onclick={handleSendEmailCode}
                  disabled={isSendingEmail || !emailInput.trim()}
                  class="cursor-pointer rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
                  >{isSendingEmail ? '送信中...' : '番号を送る'}</button
                >
              </div>
              <div class="mt-2 flex flex-col gap-2 sm:flex-row">
                <input
                  type="text"
                  inputmode="numeric"
                  autocomplete="one-time-code"
                  bind:value={emailCodeInput}
                  placeholder="6桁の番号"
                  class="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs tracking-widest dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
                <button
                  type="button"
                  onclick={handleConfirmEmailCode}
                  disabled={isConfirmingEmail || !emailCodeInput.trim()}
                  class="cursor-pointer rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-800 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  >{isConfirmingEmail ? '確認中...' : '確認する'}</button
                >
              </div>
              {#if emailFormError}
                <p class="mt-1 text-[11px] text-rose-600">{emailFormError}</p>
              {/if}
            {/if}
          </div>

          <!-- Guide for standard users -->
          {#if user.role !== 'admin'}
            <div
              class="flex flex-col gap-2 rounded-xl border border-blue-100 bg-blue-50/60 p-4 text-xs text-slate-700 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-slate-300"
            >
              <div
                class="flex items-center gap-1.5 font-bold text-blue-900 dark:text-blue-200"
              >
                <Shield class="h-4 w-4 text-blue-600 dark:text-blue-400" />
                <span>認証できました</span>
              </div>
              <p
                class="text-[11px] leading-relaxed text-slate-600 dark:text-slate-400"
              >
                投稿のほか、自分が書いた情報の編集と削除ができます。
              </p>
            </div>

            <!-- Standard User: MCP / Agent Token Card -->
            <div
              class="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 dark:border-slate-800 dark:bg-slate-800/40"
            >
              <div
                class="flex items-center gap-1.5 font-bold text-slate-800 dark:text-slate-200"
              >
                <Bot class="h-4 w-4 text-blue-600 dark:text-blue-400" />
                <span>AI エージェント連携（MCP）</span>
              </div>
              <p
                class="text-[11px] leading-relaxed text-slate-600 dark:text-slate-400"
              >
                Claude Desktop、Cursor などの AI アシスタントと連携するための
                API トークンを発行できます。
              </p>

              <div>
                <label
                  for="user-mcp-token-name"
                  class="mb-1 block text-xs font-bold text-slate-700 dark:text-slate-300"
                >
                  トークン用途・識別名
                </label>
                <div class="flex gap-2">
                  <input
                    id="user-mcp-token-name"
                    type="text"
                    bind:value={mcpTokenName}
                    placeholder="例: Claude Desktop, Cursor"
                    class="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                  <button
                    type="button"
                    onclick={handleIssueMcpToken}
                    disabled={isIssuingMcpToken}
                    class="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-2xs transition hover:bg-blue-700 disabled:opacity-50"
                  >
                    <KeyRound class="h-3.5 w-3.5" />
                    <span
                      >{isIssuingMcpToken
                        ? '発行中...'
                        : 'トークンを発行'}</span
                    >
                  </button>
                </div>
              </div>

              {#if mcpTokenError}
                <div
                  class="rounded-lg border border-rose-200 bg-rose-50 p-2 text-[11px] text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-300"
                >
                  {mcpTokenError}
                </div>
              {/if}

              {#if issuedMcpToken}
                <div
                  class="flex flex-col gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50/80 p-3 dark:border-emerald-800/60 dark:bg-emerald-950/40"
                >
                  <div class="flex items-center justify-between">
                    <span
                      class="flex items-center gap-1 text-xs font-bold text-emerald-800 dark:text-emerald-300"
                    >
                      <Check class="h-3.5 w-3.5" />
                      APIトークンを発行しました（有効期限: 1年間）
                    </span>
                  </div>

                  <div class="flex items-center gap-1.5">
                    <input
                      type="text"
                      readonly
                      value={issuedMcpToken.token}
                      class="flex-1 rounded-lg border border-emerald-300 bg-white px-2.5 py-1.5 font-mono text-[11px] text-slate-800 select-all dark:border-emerald-700 dark:bg-slate-900 dark:text-slate-100"
                    />
                    <button
                      type="button"
                      onclick={handleCopyToken}
                      class="flex shrink-0 cursor-pointer items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-emerald-700"
                    >
                      {#if isTokenCopied}
                        <Check class="h-3.5 w-3.5" />
                        <span>コピー済</span>
                      {:else}
                        <Copy class="h-3.5 w-3.5" />
                        <span>コピー</span>
                      {/if}
                    </button>
                  </div>
                </div>
              {/if}
            </div>

            <!-- Full feature panel for administrators -->
          {:else}
            <!-- Tab navigation -->
            <div
              class="flex items-center gap-1 overflow-x-auto border-b border-slate-200 text-xs font-bold whitespace-nowrap dark:border-slate-800"
            >
              <button
                type="button"
                onclick={() => {
                  activeTab = 'settings';
                }}
                class={`flex cursor-pointer items-center gap-1.5 border-b-2 px-3 py-2 transition-all ${
                  activeTab === 'settings'
                    ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                    : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                <Sliders class="h-3.5 w-3.5" />
                <span>地域・告知</span>
              </button>

              <button
                type="button"
                onclick={() => {
                  activeTab = 'users';
                  void loadUsers();
                }}
                class={`flex cursor-pointer items-center gap-1.5 border-b-2 px-3 py-2 transition-all ${
                  activeTab === 'users'
                    ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                    : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                <Users class="h-3.5 w-3.5" />
                <span>メンバー</span>
              </button>

              <button
                type="button"
                onclick={() => {
                  activeTab = 'import';
                }}
                class={`flex cursor-pointer items-center gap-1.5 border-b-2 px-3 py-2 transition-all ${
                  activeTab === 'import'
                    ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                    : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                <FileSpreadsheet class="h-3.5 w-3.5" />
                <span>データ取込</span>
              </button>

              <button
                type="button"
                onclick={() => {
                  activeTab = 'federation';
                }}
                class={`flex cursor-pointer items-center gap-1.5 border-b-2 px-3 py-2 transition-all ${
                  activeTab === 'federation'
                    ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                    : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                <Network class="h-3.5 w-3.5" />
                <span>サイト連携</span>
              </button>

              <button
                type="button"
                onclick={() => {
                  activeTab = 'mcp';
                }}
                class={`flex cursor-pointer items-center gap-1.5 border-b-2 px-3 py-2 transition-all ${
                  activeTab === 'mcp'
                    ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                    : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                <Bot class="h-3.5 w-3.5" />
                <span>MCP連携</span>
              </button>

              <button
                type="button"
                onclick={() => {
                  activeTab = 'capacity';
                  void loadCapacity();
                }}
                class={`flex cursor-pointer items-center gap-1.5 border-b-2 px-3 py-2 transition-all ${
                  activeTab === 'capacity'
                    ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                    : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                <Activity class="h-3.5 w-3.5" />
                <span>規模</span>
              </button>

              <button
                type="button"
                onclick={() => {
                  activeTab = 'backup';
                  void loadBackups();
                }}
                class={`flex cursor-pointer items-center gap-1.5 border-b-2 px-3 py-2 transition-all ${
                  activeTab === 'backup'
                    ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                    : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                <Database class="h-3.5 w-3.5" />
                <span>バックアップ</span>
              </button>
            </div>

            <!-- Tab 1: Region & Announcement settings -->
            {#if activeTab === 'settings'}
              <div class="grid grid-cols-1 gap-5 lg:grid-cols-2">
                <!-- Left: 運用モード切替・基本告知・地域設定 -->
                <div
                  class="flex flex-col gap-4 rounded-xl border border-slate-200 bg-slate-50/50 p-4 dark:border-slate-800 dark:bg-slate-800/30"
                >
                  <!-- Current System Operation Mode Status Banner -->
                  <div
                    class="flex flex-col gap-2 rounded-xl p-3.5 transition {activeDisasters.length >
                    0
                      ? 'border border-red-300 bg-red-50 text-red-900 shadow-xs dark:border-red-800 dark:bg-red-950/50 dark:text-red-200'
                      : 'border border-emerald-200 bg-emerald-50/80 text-emerald-900 dark:border-emerald-800/60 dark:bg-emerald-950/30 dark:text-emerald-200'}"
                  >
                    <div class="flex items-center justify-between">
                      <div class="flex items-center gap-2">
                        {#if activeDisasters.length > 0}
                          <AlertTriangle
                            class="h-4 w-4 text-red-600 dark:text-red-400"
                          />
                          <span class="text-xs font-black">
                            {m.admin_disasters_active_count({
                              count: activeDisasters.length,
                            })}
                          </span>
                        {:else}
                          <Building
                            class="h-4 w-4 text-emerald-600 dark:text-emerald-400"
                          />
                          <span class="text-xs font-black">
                            {m.admin_disasters_normal_state()}
                          </span>
                        {/if}
                      </div>
                      <span
                        class="rounded-full px-2 py-0.5 text-[10px] font-semibold {activeDisasters.length >
                        0
                          ? 'bg-red-200 text-red-800 dark:bg-red-900/80 dark:text-red-200'
                          : 'bg-emerald-200 text-emerald-800 dark:bg-emerald-900/80 dark:text-emerald-200'}"
                      >
                        {activeDisasters.length > 0
                          ? '自動発災モード中'
                          : '通常稼働中'}
                      </span>
                    </div>
                    <p class="text-[11px] leading-relaxed opacity-90">
                      {activeDisasters.length > 0
                        ? `現在 ${activeDisasters.length} 件の災害事象が進行中のため、システムは自動的に有事・発災モードとして稼働しています。`
                        : '現在進行中の災害事象はありません。システムは平時（日常・地域生活情報）モードとして稼働しています。'}
                    </p>
                  </div>

                  <!-- Active Disasters Management -->
                  <div class="flex flex-col gap-3">
                    <div class="flex items-center justify-between">
                      <h4
                        class="flex items-center gap-1.5 text-xs font-bold text-slate-800 dark:text-slate-200"
                      >
                        <AlertTriangle class="h-3.5 w-3.5 text-red-600" />
                        <span>{m.admin_disasters_title()}</span>
                      </h4>
                      <button
                        type="button"
                        onclick={() =>
                          (showNewDisasterForm = !showNewDisasterForm)}
                        class="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-red-300 bg-red-50 px-2.5 py-1 text-[11px] font-bold text-red-700 transition hover:bg-red-100 dark:border-red-800 dark:bg-red-950/60 dark:text-red-300"
                      >
                        <Plus class="h-3.5 w-3.5" />
                        <span>{m.admin_disasters_add_btn()}</span>
                      </button>
                    </div>

                    <!-- New Disaster Registration Form (Collapsible) -->
                    {#if showNewDisasterForm}
                      <div
                        class="flex flex-col gap-3 rounded-xl border border-red-300 bg-red-50/70 p-3.5 shadow-xs dark:border-red-800 dark:bg-red-950/40"
                      >
                        <div
                          class="flex items-center justify-between border-b border-red-200 pb-2 dark:border-red-900/60"
                        >
                          <span
                            class="text-xs font-extrabold text-red-900 dark:text-red-200"
                          >
                            {m.admin_disasters_add_btn()}
                          </span>
                          <button
                            type="button"
                            onclick={() => (showNewDisasterForm = false)}
                            class="text-red-500 hover:text-red-700 dark:hover:text-red-300"
                          >
                            <X class="h-4 w-4" />
                          </button>
                        </div>

                        <!-- Disaster Name -->
                        <div>
                          <label
                            for="new-disaster-name"
                            class="mb-1 block text-[11px] font-bold text-red-900 dark:text-red-300"
                          >
                            {m.admin_disasters_name_label()}
                            <span class="text-red-500">*</span>
                          </label>
                          <input
                            id="new-disaster-name"
                            type="text"
                            bind:value={newDisasterName}
                            placeholder={m.admin_disasters_name_placeholder()}
                            class="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-900 placeholder:text-slate-400 focus:border-red-500 focus:outline-hidden dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                          />
                        </div>

                        <!-- Type & Designated At -->
                        <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          <div>
                            <label
                              for="new-disaster-type"
                              class="mb-1 block text-[11px] font-bold text-red-900 dark:text-red-300"
                            >
                              {m.admin_disasters_type_label()}
                            </label>
                            <select
                              id="new-disaster-type"
                              bind:value={newDisasterType}
                              class="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900 focus:border-red-500 focus:outline-hidden dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                            >
                              <option value="earthquake"
                                >{m.disaster_type_earthquake()}</option
                              >
                              <option value="flood"
                                >{m.disaster_type_flood()}</option
                              >
                              <option value="landslide"
                                >{m.disaster_type_landslide()}</option
                              >
                              <option value="tsunami"
                                >{m.disaster_type_tsunami()}</option
                              >
                              <option value="storm"
                                >{m.disaster_type_storm()}</option
                              >
                              <option value="volcano"
                                >{m.disaster_type_volcano()}</option
                              >
                              <option value="snow"
                                >{m.disaster_type_snow()}</option
                              >
                              <option value="other"
                                >{m.disaster_type_other()}</option
                              >
                            </select>
                          </div>
                          <div>
                            <label
                              for="new-disaster-designated-at"
                              class="mb-1 block text-[11px] font-bold text-red-900 dark:text-red-300"
                            >
                              発災・指定日時
                            </label>
                            <input
                              id="new-disaster-designated-at"
                              type="datetime-local"
                              bind:value={newDisasterDesignatedAt}
                              class="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900 focus:border-red-500 focus:outline-hidden dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                            />
                          </div>
                        </div>

                        <!-- Target Municipalities Selection -->
                        <div>
                          <span
                            class="mb-1 block text-[11px] font-bold text-red-900 dark:text-red-300"
                          >
                            {m.admin_disaster_areas_title()}
                          </span>
                          <p
                            class="mb-1.5 text-[10px] text-red-800/80 dark:text-red-300/80"
                          >
                            {m.admin_disaster_areas_desc()}
                          </p>

                          <!-- Selected Area Chips in Form -->
                          {#if newDisasterAreas.length > 0}
                            <div class="mb-2 flex flex-wrap gap-1">
                              {#each newDisasterAreas as area (area.code)}
                                <span
                                  class="inline-flex items-center gap-1 rounded border border-red-300 bg-white px-2 py-0.5 text-xs font-bold text-red-800 shadow-2xs dark:border-red-800 dark:bg-slate-900 dark:text-red-200"
                                >
                                  <span>{area.fullName}</span>
                                  {#if area.isPrefecture}
                                    <span
                                      class="rounded bg-red-100 px-1 text-[9px] font-bold text-red-700 dark:bg-red-900/60 dark:text-red-300"
                                    >
                                      県全域
                                    </span>
                                  {/if}
                                  <button
                                    type="button"
                                    onclick={() =>
                                      handleRemoveNewDisasterArea(area.code)}
                                    class="ml-0.5 text-red-500 hover:text-red-700 dark:hover:text-red-300"
                                  >
                                    <X class="h-3 w-3" />
                                  </button>
                                </span>
                              {/each}
                            </div>
                          {/if}

                          <!-- Search Input -->
                          <div class="relative">
                            <div class="relative flex items-center">
                              <Search
                                class="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-slate-400"
                              />
                              <input
                                type="text"
                                value={newMuniSearchQuery}
                                oninput={handleNewMuniInput}
                                placeholder={m.admin_disaster_search_placeholder()}
                                class="w-full rounded-lg border border-slate-300 bg-white py-1.5 pr-3 pl-8 text-xs text-slate-900 placeholder:text-slate-400 focus:border-red-500 focus:ring-1 focus:ring-red-500 focus:outline-hidden dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                              />
                              {#if isSearchingNewMuni}
                                <RefreshCw
                                  class="pointer-events-none absolute right-2.5 h-3.5 w-3.5 animate-spin text-slate-400"
                                />
                              {/if}
                            </div>

                            {#if newMuniSearchResults.length > 0}
                              <div
                                class="absolute top-full z-50 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-800"
                              >
                                {#each newMuniSearchResults as item (item.code + item.name)}
                                  <button
                                    type="button"
                                    onclick={() =>
                                      handleAddNewDisasterArea(item)}
                                    class="flex w-full cursor-pointer items-center justify-between px-3 py-2 text-left text-xs transition hover:bg-red-50 dark:hover:bg-red-950/40"
                                  >
                                    <span
                                      class="flex items-center gap-1.5 font-bold text-slate-800 dark:text-slate-100"
                                    >
                                      {#if item.isPrefecture}
                                        <span
                                          class="rounded bg-red-100 px-1 py-0.5 text-[9px] font-bold text-red-700 dark:bg-red-900/60 dark:text-red-300"
                                        >
                                          県全域
                                        </span>
                                      {/if}
                                      {item.fullName}
                                    </span>
                                    <span
                                      class="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500 dark:bg-slate-700 dark:text-slate-400"
                                    >
                                      {item.code}
                                    </span>
                                  </button>
                                {/each}
                              </div>
                            {/if}
                          </div>
                        </div>

                        <!-- Banner Message & Note -->
                        <div>
                          <label
                            for="new-disaster-banner"
                            class="mb-1 block text-[11px] font-bold text-red-900 dark:text-red-300"
                          >
                            緊急告知文（任意）
                          </label>
                          <input
                            id="new-disaster-banner"
                            type="text"
                            bind:value={newDisasterBannerMessage}
                            placeholder="ヘッダーに表示する緊急テキスト（空欄時は災害名を表示）"
                            class="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-red-500 focus:outline-hidden dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                          />
                        </div>

                        {#if disasterFormError}
                          <div
                            class="text-xs font-bold text-red-600 dark:text-red-400"
                          >
                            ⚠️ {disasterFormError}
                          </div>
                        {/if}

                        <button
                          type="button"
                          onclick={handleCreateDisaster}
                          disabled={isSubmittingDisaster}
                          class="flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-red-600 py-2 text-xs font-bold text-white shadow-xs transition hover:bg-red-700 disabled:opacity-50"
                        >
                          {#if isSubmittingDisaster}
                            <RefreshCw class="h-3.5 w-3.5 animate-spin" />
                            <span>登録中...</span>
                          {:else}
                            <AlertTriangle class="h-3.5 w-3.5" />
                            <span>{m.admin_disasters_save_btn()}</span>
                          {/if}
                        </button>
                      </div>
                    {/if}

                    <!-- Active Disasters List Cards -->
                    {#if isLoadingDisasters}
                      <div
                        class="flex items-center justify-center p-4 text-xs text-slate-500"
                      >
                        <RefreshCw class="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        <span>災害情報を読み込み中...</span>
                      </div>
                    {:else if activeDisasters.length === 0}
                      <div
                        class="rounded-xl border border-dashed border-slate-300 p-4 text-center text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400"
                      >
                        {m.admin_disasters_empty()}
                      </div>
                    {:else}
                      <div class="flex flex-col gap-2.5">
                        {#each activeDisasters as disaster (disaster.id)}
                          <div
                            class="flex flex-col gap-2 rounded-xl border border-red-200 bg-white p-3 shadow-xs dark:border-red-900/60 dark:bg-slate-800/80"
                          >
                            <div class="flex items-start justify-between gap-2">
                              <div>
                                <div class="flex items-center gap-1.5">
                                  <span
                                    class="rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-black text-white"
                                  >
                                    {getDisasterTypeLabel(
                                      disaster.disaster_type
                                    )}
                                  </span>
                                  <h5
                                    class="text-xs font-extrabold text-slate-900 dark:text-slate-100"
                                  >
                                    {disaster.name}
                                  </h5>
                                </div>
                                {#if disaster.designated_at}
                                  <div
                                    class="mt-1 flex items-center gap-1 text-[10px] text-slate-500 dark:text-slate-400"
                                  >
                                    <Calendar class="h-3 w-3" />
                                    <span
                                      >{new Date(
                                        disaster.designated_at
                                      ).toLocaleString()}</span
                                    >
                                  </div>
                                {/if}
                              </div>

                              <div class="flex items-center gap-1">
                                <button
                                  type="button"
                                  onclick={() =>
                                    handleArchiveDisaster(disaster)}
                                  class="inline-flex cursor-pointer items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-[10px] font-bold text-slate-700 shadow-2xs transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600"
                                  title={m.admin_disasters_archive_btn()}
                                >
                                  <Archive
                                    class="h-3 w-3 text-slate-600 dark:text-slate-300"
                                  />
                                  <span>{m.admin_disasters_archive_btn()}</span>
                                </button>
                                <button
                                  type="button"
                                  onclick={() => handleDeleteDisaster(disaster)}
                                  class="rounded-md p-1 text-slate-400 hover:text-red-600 dark:hover:text-red-400"
                                  title="削除"
                                >
                                  <Trash2 class="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </div>

                            <!-- Designated Municipalities in this Disaster -->
                            {#if disaster.areas && disaster.areas.length > 0}
                              <div
                                class="flex flex-wrap items-center gap-1 pt-1"
                              >
                                <span
                                  class="flex items-center gap-0.5 text-[10px] font-semibold text-slate-500 dark:text-slate-400"
                                >
                                  <MapPin class="h-3 w-3 text-red-500" />
                                  <span>被災地域:</span>
                                </span>
                                {#each disaster.areas as area (area.code)}
                                  <span
                                    class="inline-flex items-center gap-0.5 rounded border border-red-200 bg-red-50 px-1.5 py-0.5 text-[10px] font-bold text-red-800 dark:border-red-900 dark:bg-red-950/60 dark:text-red-300"
                                  >
                                    <span>{area.name}</span>
                                    {#if area.isPrefecture}
                                      <span class="text-[9px] opacity-75"
                                        >(全域)</span
                                      >
                                    {/if}
                                  </span>
                                {/each}
                              </div>
                            {/if}

                            <!-- Banner message if any -->
                            {#if disaster.banner_message}
                              <div
                                class="rounded bg-red-50 px-2 py-1 text-[11px] text-red-800 dark:bg-red-950/40 dark:text-red-300"
                              >
                                📢 {disaster.banner_message}
                              </div>
                            {/if}

                            <!-- Action: Fetch Shelters for this Disaster -->
                            {#if disaster.areas && disaster.areas.length > 0}
                              <div class="pt-1">
                                <button
                                  type="button"
                                  onclick={() =>
                                    handleFetchSheltersForDisaster(disaster)}
                                  disabled={isFetchingDisasterShelters}
                                  class="flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-red-300 bg-red-50 px-2.5 py-1.5 text-xs font-bold text-red-700 transition hover:bg-red-100 disabled:opacity-50 dark:border-red-800 dark:bg-red-950/50 dark:text-red-300"
                                >
                                  {#if isFetchingDisasterShelters}
                                    <RefreshCw
                                      class="h-3.5 w-3.5 animate-spin"
                                    />
                                    <span>{m.admin_disaster_fetching()}</span>
                                  {:else}
                                    <Building class="h-3.5 w-3.5" />
                                    <span
                                      >【{disaster.name}】{m.admin_disaster_fetch_btn()}</span
                                    >
                                  {/if}
                                </button>
                              </div>
                            {/if}
                          </div>
                        {/each}
                      </div>
                    {/if}

                    <!-- Fetch result notice -->
                    {#if disasterShelterMessage}
                      <div
                        class="rounded-lg p-2 text-xs font-semibold {disasterShelterMessage.type ===
                        'success'
                          ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200'
                          : 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200'}"
                      >
                        <p>{disasterShelterMessage.text}</p>
                        {#if fetchedDisasterShelters.length > 0}
                          <button
                            type="button"
                            onclick={handleTransferDisasterSheltersToImport}
                            class="mt-1.5 flex cursor-pointer items-center gap-1 rounded bg-emerald-600 px-2.5 py-1 text-xs font-bold text-white shadow-xs transition hover:bg-emerald-700"
                          >
                            <span
                              >{m.admin_disaster_import_now()} (→ {fetchedDisasterShelters.length}
                              件)</span
                            >
                          </button>
                        {/if}
                      </div>
                    {/if}

                    <!-- Archived Disasters Collapsible -->
                    {#if archivedDisasters.length > 0}
                      <div
                        class="mt-2 rounded-xl border border-slate-200 bg-slate-100/70 p-3 dark:border-slate-700/60 dark:bg-slate-800/50"
                      >
                        <button
                          type="button"
                          onclick={() =>
                            (showArchivedDisasters = !showArchivedDisasters)}
                          class="flex w-full cursor-pointer items-center justify-between text-left text-xs font-bold text-slate-700 dark:text-slate-300"
                        >
                          <span class="flex items-center gap-1.5">
                            <Archive class="h-3.5 w-3.5 text-slate-500" />
                            <span
                              >{m.admin_disasters_archived_title()} ({archivedDisasters.length}
                              件)</span
                            >
                          </span>
                          {#if showArchivedDisasters}
                            <ChevronUp class="h-4 w-4 text-slate-400" />
                          {:else}
                            <ChevronDown class="h-4 w-4 text-slate-400" />
                          {/if}
                        </button>

                        {#if showArchivedDisasters}
                          <div class="mt-2.5 flex flex-col gap-2">
                            {#each archivedDisasters as arch (arch.id)}
                              <div
                                class="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-2 text-xs shadow-2xs dark:border-slate-700 dark:bg-slate-800"
                              >
                                <div>
                                  <div
                                    class="flex items-center gap-1.5 font-bold text-slate-800 dark:text-slate-200"
                                  >
                                    <span
                                      class="py-0.2 rounded bg-slate-200 px-1.5 text-[9px] text-slate-700 dark:bg-slate-700 dark:text-slate-300"
                                    >
                                      {getDisasterTypeLabel(arch.disaster_type)}
                                    </span>
                                    <span>{arch.name}</span>
                                  </div>
                                  {#if arch.designated_at}
                                    <span class="text-[10px] text-slate-400">
                                      {new Date(
                                        arch.designated_at
                                      ).toLocaleDateString()}
                                    </span>
                                  {/if}
                                </div>
                                <div class="flex items-center gap-1">
                                  <button
                                    type="button"
                                    onclick={() => handleActivateDisaster(arch)}
                                    class="inline-flex cursor-pointer items-center gap-1 rounded bg-blue-50 px-2 py-1 text-[10px] font-bold text-blue-700 transition hover:bg-blue-100 dark:bg-blue-950/60 dark:text-blue-300"
                                    title={m.admin_disasters_activate_btn()}
                                  >
                                    <ArchiveRestore class="h-3 w-3" />
                                    <span
                                      >{m.admin_disasters_activate_btn()}</span
                                    >
                                  </button>
                                  <button
                                    type="button"
                                    onclick={() => handleDeleteDisaster(arch)}
                                    class="p-1 text-slate-400 hover:text-red-600 dark:hover:text-red-400"
                                    title="削除"
                                  >
                                    <Trash2 class="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              </div>
                            {/each}
                          </div>
                        {/if}
                      </div>
                    {/if}
                  </div>

                  <!-- Emergency announcement banner -->
                  <div>
                    <label
                      for="admin-emergency-banner"
                      class="mb-1 block text-xs font-bold text-slate-700 dark:text-slate-300"
                    >
                      緊急告知アナウンス文（全画面最上部に固定表示）
                    </label>
                    <textarea
                      id="admin-emergency-banner"
                      bind:value={emergencyBanner}
                      rows="3"
                      placeholder="例: 災害救助法適用に伴い避難所・給水所が開設されています。現地の混雑や物資の最新状況を共有してください。（空にすると非表示）"
                      class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-blue-500 focus:outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
                    ></textarea>
                  </div>

                  <!-- Target region / municipality name -->
                  <div>
                    <label
                      for="admin-default-area"
                      class="mb-1 block text-xs font-bold text-slate-700 dark:text-slate-300"
                    >
                      対象地域・自治体名
                    </label>
                    <input
                      id="admin-default-area"
                      type="text"
                      bind:value={defaultArea}
                      placeholder="例: 石川県能登地方、高知県高知市、〇〇町（空欄時は全域）"
                      class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-blue-500 focus:outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
                    />
                    <p
                      class="mt-1 text-[10px] text-slate-500 dark:text-slate-400"
                    >
                      ※
                      設定するとヘッダーに地域名が表示され、地図の初期表示や住所補完の中心となります。
                    </p>
                  </div>

                  <!-- Save button -->
                  <button
                    type="button"
                    onclick={handleSaveSettings}
                    disabled={isSavingSettings}
                    class="mt-auto flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-3 py-2.5 text-xs font-bold text-white shadow-xs transition hover:bg-blue-700 disabled:opacity-50"
                  >
                    <span>
                      {isSavingSettings ? '保存中...' : '設定を反映する'}
                    </span>
                  </button>
                </div>

                <!-- Right: Web Push Emergency Broadcast Section -->
                <div
                  class="flex flex-col gap-3 rounded-xl border border-red-200 bg-red-50/50 p-4 dark:border-red-900/40 dark:bg-red-950/20"
                >
                  <div
                    class="flex items-center gap-1.5 text-xs font-bold text-red-700 dark:text-red-400"
                  >
                    <Radio class="h-4 w-4" />
                    <span>緊急プッシュ一斉配信 (Web Push Broadcast)</span>
                  </div>
                  <p class="text-[11px] text-slate-600 dark:text-slate-400">
                    購読登録済みの全端末に、画面を閉じていても即座に通知をプッシュ配信します。
                  </p>

                  <div class="space-y-2.5">
                    <div>
                      <input
                        type="text"
                        bind:value={broadcastTitle}
                        placeholder="通知タイトル (例: 【緊急避難】河川水位が警戒水位を超過)"
                        class="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 placeholder:text-slate-400 focus:border-red-500 focus:outline-hidden dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
                      />
                    </div>
                    <div>
                      <textarea
                        bind:value={broadcastBody}
                        rows="3"
                        placeholder="通知本文 (例: ○○川流域にお住まいの方は、速やかに高台や避難所に避難を開始してください。)"
                        class="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-red-500 focus:outline-hidden dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
                      ></textarea>
                    </div>
                    <div>
                      <input
                        type="text"
                        bind:value={broadcastArea}
                        placeholder="対象地域（空欄の場合は全地域に配信）"
                        class="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-red-500 focus:outline-hidden dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
                      />
                    </div>

                    <button
                      type="button"
                      disabled={isBroadcasting ||
                        !broadcastTitle ||
                        !broadcastBody}
                      onclick={handleBroadcastPush}
                      class="flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-red-600 px-3 py-2 text-xs font-bold text-white shadow-xs transition hover:bg-red-700 active:scale-98 disabled:opacity-50"
                    >
                      <BellRing class="h-3.5 w-3.5" />
                      <span
                        >{isBroadcasting
                          ? '配信中...'
                          : '緊急プッシュを一斉配信する'}</span
                      >
                    </button>

                    {#if broadcastResult}
                      <div
                        class={`rounded-lg p-2 text-xs font-medium ${
                          broadcastResult.type === 'success'
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                            : 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300'
                        }`}
                      >
                        {broadcastResult.text}
                      </div>
                    {/if}
                  </div>
                </div>
              </div>

              <!-- Tab 2: Member role management -->
            {:else if activeTab === 'users'}
              <div class="flex flex-col gap-3">
                <div class="flex items-center justify-between gap-2">
                  <span
                    class="text-xs font-bold text-slate-700 dark:text-slate-300"
                    >メンバー {userCounts.all.toLocaleString()}名</span
                  >
                  <button
                    type="button"
                    onclick={loadUsers}
                    class="flex cursor-pointer items-center gap-1 text-xs font-semibold text-blue-600 hover:underline dark:text-blue-400"
                  >
                    <RefreshCw
                      class={`h-3 w-3 ${isLoadingUsers ? 'animate-spin' : ''}`}
                    />
                    <span>再読み込み</span>
                  </button>
                </div>

                <div class="relative">
                  <Search
                    class="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
                  />
                  <input
                    type="search"
                    value={userQueryInput}
                    oninput={(e) =>
                      handleUserSearchInput(e.currentTarget.value)}
                    placeholder="名前・ユーザー名で検索"
                    class="w-full rounded-lg border border-slate-300 bg-white py-2 pr-3 pl-8 text-xs text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>

                <div class="flex flex-wrap gap-1.5">
                  {#each [{ id: 'all' as const, label: 'すべて', count: userCounts.all }, { id: 'admin' as const, label: '管理者', count: userCounts.admin }, { id: 'moderator' as const, label: 'モデレーター', count: userCounts.moderator }, { id: 'user' as const, label: '一般', count: userCounts.user }] as chip (chip.id)}
                    <button
                      type="button"
                      onclick={() => handleUserRoleFilter(chip.id)}
                      class={`rounded-full px-2.5 py-1 text-[11px] font-bold transition ${
                        userRoleFilter === chip.id
                          ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
                      }`}
                    >
                      {chip.label}
                      <span class="ml-1 opacity-70"
                        >{chip.count.toLocaleString()}</span
                      >
                    </button>
                  {/each}
                </div>

                {#if roleChangeMessage}
                  <div
                    class={`flex items-center gap-2 rounded-lg p-2.5 text-xs font-medium ${
                      roleChangeMessage.type === 'success'
                        ? 'border border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-300'
                        : 'border border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800/60 dark:bg-rose-950/40 dark:text-rose-300'
                    }`}
                  >
                    <span>{roleChangeMessage.text}</span>
                  </div>
                {/if}

                {#if isLoadingUsers && userList.length === 0}
                  <div
                    class="py-12 text-center text-xs text-slate-400 dark:text-slate-500"
                  >
                    <RefreshCw
                      class="mx-auto mb-2 h-5 w-5 animate-spin text-blue-500"
                    />
                    ユーザー一覧を読み込み中...
                  </div>
                {:else if userList.length === 0}
                  <div
                    class="rounded-xl border border-slate-200 bg-slate-50 py-12 text-center text-xs text-slate-400 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-500"
                  >
                    {userQuery || userRoleFilter !== 'all'
                      ? '条件に合うメンバーがいません'
                      : 'ユーザーが見つかりません'}
                  </div>
                {:else}
                  <div
                    class="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800"
                  >
                    {#each userList as u (u.id)}
                      <div
                        class="flex items-center gap-2 border-b border-slate-100 px-3 py-2 last:border-b-0 dark:border-slate-800"
                      >
                        <div class="min-w-0 flex-1">
                          <div
                            class="flex items-center gap-1.5 truncate text-xs font-bold text-slate-900 dark:text-slate-100"
                          >
                            <span class="truncate"
                              >{u.displayName || u.username}</span
                            >
                            {#if u.id === user.id}
                              <span
                                class="shrink-0 text-[10px] font-bold text-blue-600 dark:text-blue-400"
                                >(自分)</span
                              >
                            {/if}
                          </div>
                          <div
                            class="truncate font-mono text-[10px] text-slate-400"
                          >
                            @{u.username}
                          </div>
                          {#if u.emailVerified && u.email}
                            <div class="truncate text-[10px] text-slate-500">
                              {u.email}
                            </div>
                          {:else if u.pendingEmail}
                            <div
                              class="truncate text-[10px] text-amber-700 dark:text-amber-300"
                            >
                              {u.pendingEmail}（未確認）
                            </div>
                          {/if}
                        </div>
                        {#if u.role === 'admin'}
                          <span
                            class="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-amber-200 bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                          >
                            <Crown class="h-3 w-3" />
                            管理者
                          </span>
                        {:else if u.role === 'moderator'}
                          <span
                            class="shrink-0 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-800 dark:bg-blue-950/50 dark:text-blue-300"
                            >モデレーター</span
                          >
                        {:else}
                          <span
                            class="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                            >一般</span
                          >
                        {/if}
                        <div class="flex shrink-0 items-center gap-1">
                          {#if u.id !== user.id}
                            {#if u.role !== 'admin'}
                              <button
                                type="button"
                                onclick={() =>
                                  handleUpdateRole(
                                    u.id,
                                    u.displayName || u.username,
                                    'admin'
                                  )}
                                class="cursor-pointer rounded-md border border-amber-200 bg-amber-50 px-1.5 py-1 text-[10px] font-bold text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                                >管理者に</button
                              >
                            {:else}
                              <button
                                type="button"
                                onclick={() =>
                                  handleUpdateRole(
                                    u.id,
                                    u.displayName || u.username,
                                    'user'
                                  )}
                                class="cursor-pointer rounded-md border border-slate-200 bg-slate-100 px-1.5 py-1 text-[10px] font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                                >一般に</button
                              >
                            {/if}
                            <button
                              type="button"
                              onclick={() =>
                                handleDeleteUser(
                                  u.id,
                                  u.displayName || u.username
                                )}
                              class="cursor-pointer rounded-md border border-rose-200 bg-rose-50 p-1 text-rose-600 dark:border-rose-900/60 dark:bg-rose-950/40"
                              title="削除"
                            >
                              <Trash2 class="h-3 w-3" />
                            </button>
                          {/if}
                        </div>
                      </div>
                    {/each}
                  </div>
                  {#if userTotal > USER_PAGE_SIZE}
                    <div
                      class="flex items-center justify-between text-[11px] text-slate-500"
                    >
                      <span>
                        {userPage * USER_PAGE_SIZE + 1}–{Math.min(
                          (userPage + 1) * USER_PAGE_SIZE,
                          userTotal
                        )}
                        / {userTotal.toLocaleString()}
                      </span>
                      <div class="flex gap-1.5">
                        <button
                          type="button"
                          disabled={userPage === 0}
                          onclick={() => {
                            userPage -= 1;
                            void loadUsers();
                          }}
                          class="cursor-pointer rounded-md border border-slate-200 px-2 py-1 font-bold disabled:opacity-40 dark:border-slate-700"
                          >前へ</button
                        >
                        <button
                          type="button"
                          disabled={(userPage + 1) * USER_PAGE_SIZE >=
                            userTotal}
                          onclick={() => {
                            userPage += 1;
                            void loadUsers();
                          }}
                          class="cursor-pointer rounded-md border border-slate-200 px-2 py-1 font-bold disabled:opacity-40 dark:border-slate-700"
                          >次へ</button
                        >
                      </div>
                    </div>
                  {/if}
                {/if}
                <p class="text-[10px] text-slate-400 dark:text-slate-500">
                  管理者は設定変更・データ同期・全投稿の編集ができます。一覧は50件ずつ読みます。
                </p>
              </div>

              <!-- Tab: CSV / TSV Batch Dataset Import -->
            {:else if activeTab === 'import'}
              <div class="grid grid-cols-1 gap-5 lg:grid-cols-12">
                <!-- Left Column: File Drop & Column Mapping Config (5 cols) -->
                <div class="flex flex-col gap-4 lg:col-span-5">
                  <!-- File Drag & Drop Zone -->
                  <div
                    role="region"
                    aria-label="CSVファイルアップロードエリア"
                    ondragover={(e) => {
                      e.preventDefault();
                      isDraggingCsv = true;
                    }}
                    ondragleave={() => {
                      isDraggingCsv = false;
                    }}
                    ondrop={(e) => {
                      e.preventDefault();
                      isDraggingCsv = false;
                      const file = e.dataTransfer?.files?.[0];
                      if (file) void handleImportSpreadsheetFile(file);
                    }}
                    class={`relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-5 text-center transition-all ${
                      isDraggingCsv
                        ? 'border-blue-500 bg-blue-50/70 dark:border-blue-400 dark:bg-blue-950/40'
                        : 'border-slate-300 bg-slate-50/50 hover:bg-slate-100/60 dark:border-slate-700 dark:bg-slate-800/30 dark:hover:bg-slate-800/60'
                    }`}
                  >
                    <input
                      type="file"
                      accept=".csv,.tsv,.txt,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                      bind:this={fileInputRef}
                      onchange={(e) => {
                        const file = (e.target as HTMLInputElement).files?.[0];
                        if (file) void handleImportSpreadsheetFile(file);
                      }}
                      class="hidden"
                    />

                    <div
                      class="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400"
                    >
                      <FileUp class="h-5 w-5" />
                    </div>

                    <div
                      class="text-xs font-bold text-slate-800 dark:text-slate-200"
                    >
                      ここに Excel (.xlsx) / CSV / TSV ファイルをドロップ
                    </div>
                    <p
                      class="mt-1 text-[11px] text-slate-500 dark:text-slate-400"
                    >
                      または
                      <button
                        type="button"
                        onclick={() => fileInputRef?.click()}
                        class="cursor-pointer font-bold text-blue-600 underline hover:text-blue-700 dark:text-blue-400"
                      >
                        ファイルを選択
                      </button>
                    </p>

                    <div
                      class="mt-3 flex flex-wrap items-center justify-center gap-1.5"
                    >
                      <span
                        class="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400"
                      >
                        Excel (.xlsx) 直接読込対応
                      </span>
                      <span
                        class="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400"
                      >
                        UTF-8 / Shift_JIS CSV 自動対応
                      </span>
                    </div>
                  </div>

                  <!-- Excel Multi-Sheet Selector (if multiple sheets found) -->
                  {#if availableSheets.length > 1}
                    <div
                      class="flex flex-col gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 dark:border-emerald-800/60 dark:bg-emerald-950/30"
                    >
                      <div
                        class="flex items-center justify-between text-xs font-bold text-emerald-900 dark:text-emerald-200"
                      >
                        <span class="flex items-center gap-1.5">
                          <FileSpreadsheet
                            class="h-4 w-4 text-emerald-600 dark:text-emerald-400"
                          />
                          複数のシートを検出 ({availableSheets.length} 枚)
                        </span>
                      </div>
                      <label
                        for="excel-sheet-selector"
                        class="text-[11px] text-emerald-800 dark:text-emerald-300"
                      >
                        取り込むワークシートを選択してください:
                      </label>
                      <select
                        id="excel-sheet-selector"
                        value={selectedSheetIndex}
                        onchange={(e) =>
                          handleSelectSheet(Number(e.currentTarget.value))}
                        class="w-full rounded-lg border border-emerald-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 focus:ring-2 focus:ring-emerald-500 focus:outline-none dark:border-emerald-700 dark:bg-slate-900 dark:text-slate-100"
                      >
                        {#each availableSheets as sheet, idx (idx)}
                          <option value={idx}>
                            📄 {sheet.name} ({sheet.data.rows.length} 行)
                          </option>
                        {/each}
                      </select>
                    </div>
                  {/if}

                  <!-- Sample & Template Helper Buttons -->
                  <div class="flex items-center gap-2">
                    <button
                      type="button"
                      onclick={handleLoadSampleCsv}
                      class="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-2xs transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                    >
                      <FileSpreadsheet
                        class="h-3.5 w-3.5 text-blue-600 dark:text-blue-400"
                      />
                      <span>サンプルを読込</span>
                    </button>
                    <button
                      type="button"
                      onclick={handleDownloadSampleCsv}
                      class="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-2xs transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                    >
                      <Download class="h-3.5 w-3.5 text-slate-500" />
                      <span>テンプレート保存</span>
                    </button>
                  </div>

                  <!-- Import Options -->
                  <div
                    class="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 dark:border-slate-800 dark:bg-slate-800/40"
                  >
                    <h4
                      class="text-xs font-bold text-slate-800 dark:text-slate-200"
                    >
                      取込オプション設定
                    </h4>

                    <label
                      class="flex cursor-pointer items-center gap-2 text-xs text-slate-700 dark:text-slate-300"
                    >
                      <input
                        type="checkbox"
                        bind:checked={updateDuplicates}
                        class="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 dark:border-slate-700"
                      />
                      <span>同名・同地域の既存データがあれば上書き更新する</span
                      >
                    </label>

                    <div>
                      <label
                        for="default-category-select"
                        class="mb-1 block text-[11px] font-bold text-slate-600 dark:text-slate-400"
                      >
                        種別未指定時のデフォルトカテゴリ
                      </label>
                      <select
                        id="default-category-select"
                        bind:value={defaultCategoryId}
                        class="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                      >
                        <option value="shelter">⛺ 避難所 (shelter)</option>
                        <option value="water">💧 給水所 (water)</option>
                        <option value="food">🍙 食料・炊き出し (food)</option>
                        <option value="safety">🦺 安否確認 (safety)</option>
                        <option value="restroom">🚻 トイレ (restroom)</option>
                        <option value="charging"
                          >🔋 充電スポット (charging)</option
                        >
                        <option value="bath">♨️ 入浴・シャワー (bath)</option>
                        <option value="supplies"
                          >📦 物資・支援物資 (supplies)</option
                        >
                        <option value="store">🏪 店舗・日用品 (store)</option>
                        <option value="general"
                          >📌 一般・その他 (general)</option
                        >
                      </select>
                    </div>
                  </div>

                  <!-- Column Mapping Selectors (shown when CSV is loaded) -->
                  {#if csvHeaders.length > 0}
                    <div
                      class="flex flex-col gap-3 rounded-xl border border-blue-200 bg-blue-50/40 p-3.5 dark:border-blue-900/50 dark:bg-blue-950/20"
                    >
                      <div class="flex items-center justify-between">
                        <h4
                          class="text-xs font-bold text-slate-900 dark:text-slate-100"
                        >
                          列の自動判別・マッピング設定
                        </h4>
                        <span
                          class="text-[10px] text-blue-600 dark:text-blue-400"
                        >
                          検出: {csvHeaders.length} 列
                        </span>
                      </div>
                      <p class="text-[11px] text-slate-600 dark:text-slate-400">
                        CSVのヘッダー列と tossa
                        の項目を紐付けます（自動判定済みですが変更可能）:
                      </p>

                      <div class="grid grid-cols-1 gap-2.5">
                        <!-- Title (Required) -->
                        <div>
                          <label
                            for="map-title"
                            class="mb-0.5 flex items-center justify-between text-[11px] font-bold text-slate-700 dark:text-slate-300"
                          >
                            <span
                              >施設名・タイトル <span class="text-rose-500"
                                >*</span
                              ></span
                            >
                            {#if columnMapping.title !== null}
                              <span
                                class="font-mono text-[10px] text-emerald-600"
                                >列 {columnMapping.title + 1}</span
                              >
                            {/if}
                          </label>
                          <select
                            id="map-title"
                            bind:value={columnMapping.title}
                            class="w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                          >
                            <option value={null}>-- 未選択 --</option>
                            {#each csvHeaders as h, i (i)}
                              <option value={i}>列 {i + 1}: {h}</option>
                            {/each}
                          </select>
                        </div>

                        <!-- Area (Required) -->
                        <div>
                          <label
                            for="map-area"
                            class="mb-0.5 flex items-center justify-between text-[11px] font-bold text-slate-700 dark:text-slate-300"
                          >
                            <span
                              >市区町村・地域名 <span class="text-rose-500"
                                >*</span
                              ></span
                            >
                            {#if columnMapping.area !== null}
                              <span
                                class="font-mono text-[10px] text-emerald-600"
                                >列 {columnMapping.area + 1}</span
                              >
                            {/if}
                          </label>
                          <select
                            id="map-area"
                            bind:value={columnMapping.area}
                            class="w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                          >
                            <option value={null}
                              >-- 未選択 (デフォルト地域を使用) --</option
                            >
                            {#each csvHeaders as h, i (i)}
                              <option value={i}>列 {i + 1}: {h}</option>
                            {/each}
                          </select>
                        </div>

                        <!-- Address -->
                        <div>
                          <label
                            for="map-address"
                            class="mb-0.5 flex items-center justify-between text-[11px] font-bold text-slate-700 dark:text-slate-300"
                          >
                            <span>所在地・住所</span>
                            {#if columnMapping.address !== null}
                              <span
                                class="font-mono text-[10px] text-emerald-600"
                                >列 {columnMapping.address + 1}</span
                              >
                            {/if}
                          </label>
                          <select
                            id="map-address"
                            bind:value={columnMapping.address}
                            class="w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                          >
                            <option value={null}>-- 未選択 --</option>
                            {#each csvHeaders as h, i (i)}
                              <option value={i}>列 {i + 1}: {h}</option>
                            {/each}
                          </select>
                        </div>

                        <!-- Category -->
                        <div>
                          <label
                            for="map-category"
                            class="mb-0.5 flex items-center justify-between text-[11px] font-bold text-slate-700 dark:text-slate-300"
                          >
                            <span>施設種別・区分</span>
                            {#if columnMapping.category !== null}
                              <span
                                class="font-mono text-[10px] text-emerald-600"
                                >列 {columnMapping.category + 1}</span
                              >
                            {/if}
                          </label>
                          <select
                            id="map-category"
                            bind:value={columnMapping.category}
                            class="w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                          >
                            <option value={null}
                              >-- 未選択 (デフォルトカテゴリを使用) --</option
                            >
                            {#each csvHeaders as h, i (i)}
                              <option value={i}>列 {i + 1}: {h}</option>
                            {/each}
                          </select>
                        </div>

                        <!-- Lat / Lng Grid -->
                        <div class="grid grid-cols-2 gap-2">
                          <div>
                            <label
                              for="map-lat"
                              class="mb-0.5 block text-[11px] font-bold text-slate-700 dark:text-slate-300"
                            >
                              緯度 (lat)
                            </label>
                            <select
                              id="map-lat"
                              bind:value={columnMapping.lat}
                              class="w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                            >
                              <option value={null}>-- 未選択 --</option>
                              {#each csvHeaders as h, i (i)}
                                <option value={i}>列 {i + 1}: {h}</option>
                              {/each}
                            </select>
                          </div>
                          <div>
                            <label
                              for="map-lng"
                              class="mb-0.5 block text-[11px] font-bold text-slate-700 dark:text-slate-300"
                            >
                              経度 (lng)
                            </label>
                            <select
                              id="map-lng"
                              bind:value={columnMapping.lng}
                              class="w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                            >
                              <option value={null}>-- 未選択 --</option>
                              {#each csvHeaders as h, i (i)}
                                <option value={i}>列 {i + 1}: {h}</option>
                              {/each}
                            </select>
                          </div>
                        </div>

                        <!-- Current Status -->
                        <div>
                          <label
                            for="map-status"
                            class="mb-0.5 flex items-center justify-between text-[11px] font-bold text-slate-700 dark:text-slate-300"
                          >
                            <span>開設状況・ステータス</span>
                            {#if columnMapping.currentStatus !== null}
                              <span
                                class="font-mono text-[10px] text-emerald-600"
                                >列 {columnMapping.currentStatus + 1}</span
                              >
                            {/if}
                          </label>
                          <select
                            id="map-status"
                            bind:value={columnMapping.currentStatus}
                            class="w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                          >
                            <option value={null}
                              >-- 未選択 (「開設中」として登録) --</option
                            >
                            {#each csvHeaders as h, i (i)}
                              <option value={i}>列 {i + 1}: {h}</option>
                            {/each}
                          </select>
                        </div>

                        <!-- Note & URL -->
                        <div class="grid grid-cols-2 gap-2">
                          <div>
                            <label
                              for="map-note"
                              class="mb-0.5 block text-[11px] font-bold text-slate-700 dark:text-slate-300"
                            >
                              備考・収容定員
                            </label>
                            <select
                              id="map-note"
                              bind:value={columnMapping.note}
                              class="w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                            >
                              <option value={null}>-- 未選択 --</option>
                              {#each csvHeaders as h, i (i)}
                                <option value={i}>列 {i + 1}: {h}</option>
                              {/each}
                            </select>
                          </div>
                          <div>
                            <label
                              for="map-url"
                              class="mb-0.5 block text-[11px] font-bold text-slate-700 dark:text-slate-300"
                            >
                              関連URL
                            </label>
                            <select
                              id="map-url"
                              bind:value={columnMapping.url}
                              class="w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                            >
                              <option value={null}>-- 未選択 --</option>
                              {#each csvHeaders as h, i (i)}
                                <option value={i}>列 {i + 1}: {h}</option>
                              {/each}
                            </select>
                          </div>
                        </div>
                      </div>
                    </div>
                  {/if}
                </div>

                <!-- Right Column: Data Preview & Execution (7 cols) -->
                <div class="flex flex-col gap-4 lg:col-span-7">
                  {#if csvStatusMessage}
                    <div
                      class={`flex items-center gap-2 rounded-xl p-3 text-xs font-medium ${
                        csvStatusMessage.type === 'success'
                          ? 'border border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-300'
                          : 'border border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800/60 dark:bg-rose-950/40 dark:text-rose-300'
                      }`}
                    >
                      {#if csvStatusMessage.type === 'success'}
                        <Check
                          class="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400"
                        />
                      {:else}
                        <AlertCircle
                          class="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400"
                        />
                      {/if}
                      <span>{csvStatusMessage.text}</span>
                    </div>
                  {/if}

                  {#if csvRows.length > 0}
                    <!-- Data Stats Summary Bar -->
                    <div
                      class="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-800/60"
                    >
                      <div class="flex items-center gap-2">
                        <FileSpreadsheet
                          class="h-4 w-4 text-blue-600 dark:text-blue-400"
                        />
                        <span
                          class="text-xs font-bold text-slate-800 dark:text-slate-200"
                        >
                          {csvFileName || 'アップロードデータ'}
                        </span>
                      </div>
                      <div class="flex items-center gap-2 text-xs">
                        <span
                          class="rounded-full bg-blue-100 px-2.5 py-0.5 font-bold text-blue-800 dark:bg-blue-950/60 dark:text-blue-300"
                        >
                          検出 {csvRows.length} 行
                        </span>
                        <span
                          class="rounded-full bg-emerald-100 px-2.5 py-0.5 font-bold text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                        >
                          有効 {normalizedPreview.valid.length} 件
                        </span>
                        {#if normalizedPreview.errors.length > 0}
                          <span
                            class="rounded-full bg-rose-100 px-2.5 py-0.5 font-bold text-rose-800 dark:bg-rose-950/60 dark:text-rose-300"
                          >
                            不備 {normalizedPreview.errors.length} 行
                          </span>
                        {/if}
                      </div>
                    </div>

                    <!-- Errors warning if any -->
                    {#if normalizedPreview.errors.length > 0}
                      <div
                        class="rounded-xl border border-amber-200 bg-amber-50/90 p-3 text-xs text-amber-900 dark:border-amber-700/50 dark:bg-amber-950/30 dark:text-amber-200"
                      >
                        <div class="font-bold">
                          一部の行でタイトル等が欠落しているためスキップされます:
                        </div>
                        <ul
                          class="mt-1 list-inside list-disc text-[11px] text-amber-800 dark:text-amber-300"
                        >
                          {#each normalizedPreview.errors.slice(0, 4) as err (err.row)}
                            <li>行 {err.row}: {err.reason}</li>
                          {/each}
                          {#if normalizedPreview.errors.length > 4}
                            <li>他 {normalizedPreview.errors.length - 4} 件</li>
                          {/if}
                        </ul>
                      </div>
                    {/if}

                    <!-- Preview Table -->
                    <div
                      class="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900"
                    >
                      <div
                        class="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-bold text-slate-700 dark:border-slate-800 dark:bg-slate-800/80 dark:text-slate-300"
                      >
                        <span
                          >マッピング結果プレビュー (先頭 {Math.min(
                            normalizedPreview.valid.length,
                            6
                          )} 件)</span
                        >
                        <span class="text-[10px] font-normal text-slate-400">
                          全 {normalizedPreview.valid.length} 件中
                        </span>
                      </div>

                      <div class="max-h-72 overflow-x-auto overflow-y-auto">
                        <table class="w-full text-left text-xs">
                          <thead
                            class="sticky top-0 bg-slate-100/90 backdrop-blur-xs dark:bg-slate-800/90"
                          >
                            <tr
                              class="border-b border-slate-200 text-[11px] text-slate-500 dark:border-slate-700 dark:text-slate-400"
                            >
                              <th class="p-2 font-bold">施設名</th>
                              <th class="p-2 font-bold">地域</th>
                              <th class="p-2 font-bold">所在地</th>
                              <th class="p-2 font-bold">状況</th>
                              <th class="p-2 font-bold">緯度/経度</th>
                            </tr>
                          </thead>
                          <tbody
                            class="divide-y divide-slate-100 font-mono text-[11px] dark:divide-slate-800"
                          >
                            {#each normalizedPreview.valid.slice(0, 6) as item, itemIdx (itemIdx)}
                              <tr
                                class="hover:bg-slate-50 dark:hover:bg-slate-800/40"
                              >
                                <td
                                  class="p-2 font-sans font-bold text-slate-900 dark:text-slate-100"
                                >
                                  {item.title}
                                </td>
                                <td
                                  class="p-2 text-slate-600 dark:text-slate-300"
                                >
                                  {item.area}
                                </td>
                                <td
                                  class="max-w-[160px] truncate p-2 text-slate-500 dark:text-slate-400"
                                  title={item.address || ''}
                                >
                                  {item.address || '-'}
                                </td>
                                <td class="p-2 font-sans">
                                  <span
                                    class={`inline-block rounded-md px-1.5 py-0.5 text-[10px] font-bold ${
                                      item.currentStatus === 'available'
                                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                                        : item.currentStatus === 'crowded'
                                          ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                                          : 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300'
                                    }`}
                                  >
                                    {item.statusLabel}
                                  </span>
                                </td>
                                <td class="p-2 text-slate-400">
                                  {item.lat && item.lng
                                    ? `${item.lat.toFixed(3)}, ${item.lng.toFixed(3)}`
                                    : '-'}
                                </td>
                              </tr>
                            {/each}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <!-- Import Execution Action -->
                    <div class="flex items-center justify-end gap-3 pt-2">
                      <button
                        type="button"
                        onclick={handleExecuteCsvImport}
                        disabled={isImportingCsv ||
                          normalizedPreview.valid.length === 0}
                        class="flex cursor-pointer items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-5 py-2.5 text-xs font-bold text-white shadow-md transition hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50"
                      >
                        {#if isImportingCsv}
                          <RefreshCw class="h-4 w-4 animate-spin" />
                          <span>一括インポート実行中...</span>
                        {:else}
                          <Upload class="h-4 w-4" />
                          <span
                            >{normalizedPreview.valid.length} 件のデータを一括インポート</span
                          >
                        {/if}
                      </button>
                    </div>
                  {:else}
                    <!-- Empty state guide -->
                    <div
                      class="flex flex-col items-center justify-center rounded-2xl border border-slate-200 bg-slate-50/50 p-8 text-center dark:border-slate-800 dark:bg-slate-800/30"
                    >
                      <div
                        class="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-100 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400"
                      >
                        <FileSpreadsheet class="h-6 w-6" />
                      </div>
                      <h4
                        class="text-sm font-bold text-slate-800 dark:text-slate-200"
                      >
                        施設一覧を一括登録
                      </h4>
                      <p
                        class="mt-1.5 max-w-md text-xs leading-relaxed text-slate-500 dark:text-slate-400"
                      >
                        自治体の Excel / CSV
                        を取り込むタブです。国土地理院の指定避難所は、発災登録した災害カードから対象地域ごとに取得します。
                      </p>

                      <div
                        class="mt-5 grid w-full max-w-md grid-cols-3 gap-2 text-left"
                      >
                        <div
                          class="rounded-xl border border-slate-200 bg-white p-2.5 dark:border-slate-700 dark:bg-slate-800"
                        >
                          <div
                            class="font-mono text-[11px] font-bold text-blue-600 dark:text-blue-400"
                          >
                            Step 1
                          </div>
                          <div
                            class="mt-0.5 text-[11px] text-slate-700 dark:text-slate-300"
                          >
                            ファイルをドロップ
                          </div>
                        </div>
                        <div
                          class="rounded-xl border border-slate-200 bg-white p-2.5 dark:border-slate-700 dark:bg-slate-800"
                        >
                          <div
                            class="font-mono text-[11px] font-bold text-blue-600 dark:text-blue-400"
                          >
                            Step 2
                          </div>
                          <div
                            class="mt-0.5 text-[11px] text-slate-700 dark:text-slate-300"
                          >
                            列マッピング確認
                          </div>
                        </div>
                        <div
                          class="rounded-xl border border-slate-200 bg-white p-2.5 dark:border-slate-700 dark:bg-slate-800"
                        >
                          <div
                            class="font-mono text-[11px] font-bold text-blue-600 dark:text-blue-400"
                          >
                            Step 3
                          </div>
                          <div
                            class="mt-0.5 text-[11px] text-slate-700 dark:text-slate-300"
                          >
                            ワンクリック登録
                          </div>
                        </div>
                      </div>
                    </div>
                  {/if}
                </div>
              </div>

              <!-- Tab 3: Data Federation -->
            {:else if activeTab === 'federation'}
              <div class="flex flex-col gap-4">
                {#if syncMessage}
                  <div
                    class={`flex items-center gap-1.5 rounded-xl p-3 text-xs ${
                      syncMessage.type === 'success'
                        ? 'border border-emerald-200 bg-emerald-50 font-medium text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-300'
                        : 'border border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800/60 dark:bg-rose-950/40 dark:text-rose-300'
                    }`}
                  >
                    <span>{syncMessage.text}</span>
                  </div>
                {/if}

                <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <!-- Left: Remote Site Realtime Federation -->
                  <div
                    class="flex flex-col justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-800/40"
                  >
                    <div>
                      <div class="flex items-center justify-between">
                        <div
                          class="flex items-center gap-1.5 text-xs font-bold text-slate-800 dark:text-slate-200"
                        >
                          <Network
                            class="h-4 w-4 text-blue-600 dark:text-blue-400"
                          />
                          <span>他サイトとの連携 (Federation)</span>
                        </div>
                        <span
                          class="font-mono text-[10px] text-slate-500 dark:text-slate-400"
                          >GeoJSON-LD</span
                        >
                      </div>

                      <p
                        class="mt-1.5 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400"
                      >
                        災害時に他チームが立ち上げた tossa
                        や互換サイトと相互にデータを連携・移行できます。
                      </p>
                    </div>

                    <!-- Import from remote site URL -->
                    <div class="flex flex-col gap-1.5 pt-2">
                      <label
                        for="admin-sync-url"
                        class="text-[11px] font-bold text-slate-700 dark:text-slate-300"
                      >
                        相手の tossa URL を入力して連携:
                      </label>
                      <div class="flex items-center gap-1.5">
                        <input
                          id="admin-sync-url"
                          type="url"
                          bind:value={remoteSyncUrl}
                          placeholder="例: https://other-tossa.workers.dev"
                          class="flex-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-blue-500 focus:outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
                        />
                        <button
                          type="button"
                          onclick={handleSyncFromRemoteUrl}
                          disabled={isSyncing || !remoteSyncUrl.trim()}
                          class="flex shrink-0 cursor-pointer items-center gap-1 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 px-3 py-1.5 text-xs font-bold text-white shadow-2xs transition hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50"
                        >
                          <RefreshCw
                            class={`h-3 w-3 ${isSyncing ? 'animate-spin' : ''}`}
                          />
                          <span>{isSyncing ? '同期中...' : '連携・同期'}</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  <!-- Right: Export & File Import -->
                  <div
                    class="flex flex-col justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-800/40"
                  >
                    <div>
                      <h4
                        class="text-xs font-bold text-slate-800 dark:text-slate-200"
                      >
                        オフライン・手動データ移行
                      </h4>
                      <p
                        class="mt-1.5 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400"
                      >
                        通信障害時やローカル環境へのデータ退避として、GeoJSON-LD
                        形式のファイル出力・取り込みを行えます。
                      </p>
                    </div>

                    <div class="flex flex-col gap-2 pt-2 sm:flex-row">
                      <a
                        href="/api/federation/export"
                        download
                        class="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-center text-xs font-bold text-slate-700 shadow-2xs transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                      >
                        <Download
                          class="h-3.5 w-3.5 text-blue-600 dark:text-blue-400"
                        />
                        <span>データ出力 (Export)</span>
                      </a>

                      <label
                        class="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-center text-xs font-bold text-slate-700 shadow-2xs transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                      >
                        <Upload
                          class="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400"
                        />
                        <span>ファイル取込 (Import)</span>
                        <input
                          type="file"
                          accept=".json,.geojson"
                          bind:this={fileInput}
                          onchange={handleImportFile}
                          class="hidden"
                        />
                      </label>
                    </div>
                  </div>
                </div>
              </div>
            {/if}

            <!-- Tab 4: MCP / Agent Integration -->
            {#if activeTab === 'mcp'}
              <div class="flex flex-col gap-3.5">
                <div
                  class="rounded-xl border border-blue-100 bg-blue-50/60 p-3.5 text-xs text-slate-700 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-slate-300"
                >
                  <div
                    class="mb-1 flex items-center gap-1.5 font-bold text-blue-900 dark:text-blue-200"
                  >
                    <Bot class="h-4 w-4 text-blue-600 dark:text-blue-400" />
                    <span>AI エージェント連携（MCP）</span>
                  </div>
                  <p
                    class="text-[11px] leading-relaxed text-slate-600 dark:text-slate-400"
                  >
                    Claude Desktop、Cursor、Antigravity 等の AI
                    アシスタントから、tossa
                    の生活情報や避難所・給水所データを直接検索・更新できる
                    MCP（Model Context
                    Protocol）エンドポイントが稼働しています。
                  </p>
                </div>

                <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <!-- Token Generation Card -->
                  <div
                    class="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-800/40"
                  >
                    <div>
                      <h4
                        class="text-xs font-bold text-slate-800 dark:text-slate-200"
                      >
                        エージェント専用 API トークン発行
                      </h4>
                      <p
                        class="mt-1 text-[11px] text-slate-500 dark:text-slate-400"
                      >
                        AIアシスタントに付与する識別名（例: Claude,
                        Cursor）を入力して発行してください。
                      </p>
                    </div>

                    <div class="flex flex-col gap-1.5">
                      <label
                        for="mcp-token-name"
                        class="text-[11px] font-bold text-slate-700 dark:text-slate-300"
                      >
                        用途・識別名
                      </label>
                      <div class="flex gap-2">
                        <input
                          id="mcp-token-name"
                          type="text"
                          bind:value={mcpTokenName}
                          placeholder="例: Claude Desktop, Cursor"
                          class="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                        />
                        <button
                          type="button"
                          onclick={handleIssueMcpToken}
                          disabled={isIssuingMcpToken}
                          class="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-2xs transition hover:bg-blue-700 disabled:opacity-50"
                        >
                          <KeyRound class="h-3.5 w-3.5" />
                          <span
                            >{isIssuingMcpToken
                              ? '発行中...'
                              : 'トークンを発行'}</span
                          >
                        </button>
                      </div>
                    </div>

                    {#if mcpTokenError}
                      <div
                        class="rounded-lg border border-rose-200 bg-rose-50 p-2 text-[11px] text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-300"
                      >
                        {mcpTokenError}
                      </div>
                    {/if}

                    {#if issuedMcpToken}
                      <div
                        class="flex flex-col gap-2 rounded-lg border border-emerald-200 bg-emerald-50/80 p-3 dark:border-emerald-800/60 dark:bg-emerald-950/40"
                      >
                        <div class="flex items-center justify-between">
                          <span
                            class="flex items-center gap-1 text-xs font-bold text-emerald-800 dark:text-emerald-300"
                          >
                            <Check class="h-3.5 w-3.5" />
                            APIトークンを発行しました（有効期限: 1年間）
                          </span>
                          <span
                            class="text-[10px] text-slate-500 dark:text-slate-400"
                          >
                            {issuedMcpToken.tokenName}
                          </span>
                        </div>

                        <div class="flex items-center gap-1.5">
                          <input
                            type="text"
                            readonly
                            value={issuedMcpToken.token}
                            class="flex-1 rounded-lg border border-emerald-300 bg-white px-2.5 py-1.5 font-mono text-[11px] text-slate-800 select-all dark:border-emerald-700 dark:bg-slate-900 dark:text-slate-100"
                          />
                          <button
                            type="button"
                            onclick={handleCopyToken}
                            class="flex shrink-0 cursor-pointer items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-emerald-700"
                          >
                            {#if isTokenCopied}
                              <Check class="h-3.5 w-3.5" />
                              <span>コピー済</span>
                            {:else}
                              <Copy class="h-3.5 w-3.5" />
                              <span>コピー</span>
                            {/if}
                          </button>
                        </div>

                        <p
                          class="text-[10px] text-slate-500 dark:text-slate-400"
                        >
                          ※
                          トークンは再表示されません。安全な場所に保存してエージェントの設定ファイルに設定してください。
                        </p>
                      </div>
                    {/if}
                  </div>

                  <!-- Setup Configuration Guide Card -->
                  <div
                    class="flex flex-col justify-between gap-2.5 rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-800/40"
                  >
                    <div class="flex items-center justify-between">
                      <span
                        class="text-xs font-bold text-slate-700 dark:text-slate-300"
                      >
                        Claude Desktop / Cursor 設定スニペット
                      </span>
                      <button
                        type="button"
                        onclick={handleCopySnippet}
                        class="flex cursor-pointer items-center gap-1 text-[11px] font-bold text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                      >
                        {#if isSnippetCopied}
                          <Check class="h-3 w-3" />
                          <span>設定JSONをコピー済</span>
                        {:else}
                          <Copy class="h-3 w-3" />
                          <span>設定JSONをコピー</span>
                        {/if}
                      </button>
                    </div>

                    <pre
                      class="flex-1 overflow-x-auto rounded-lg bg-slate-900 p-3 font-mono text-[11px] leading-snug text-slate-200"><code
                        >{`{
  "mcpServers": {
    "tossa": {
      "url": "${typeof window !== 'undefined' ? window.location.origin : ''}/mcp"${
        issuedMcpToken
          ? `,\n      "headers": {\n        "Authorization": "Bearer ${issuedMcpToken.token}"\n      }`
          : ''
      }
    }
  }
}`}</code
                      ></pre>
                  </div>
                </div>
              </div>
            {:else if activeTab === 'capacity'}
              <div class="flex flex-col gap-4">
                <div
                  class="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-slate-800/40"
                >
                  <p
                    class="text-[11px] leading-relaxed text-slate-600 dark:text-slate-400"
                  >
                    D1 の件数と KV
                    スナップショットの鮮度から、追加課金なしで今やるべきことを出します。Hyperdrive
                    / PostgreSQL はまだ不要な段階では提案しません。
                  </p>
                  <button
                    type="button"
                    onclick={() => handleRefreshCapacity()}
                    disabled={isRefreshingCapacity || !token}
                    class="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                  >
                    <RefreshCw
                      class={`h-3.5 w-3.5 ${isRefreshingCapacity ? 'animate-spin' : ''}`}
                    />
                    <span>スナップショットを更新</span>
                  </button>
                </div>

                {#if capacityError}
                  <div
                    class="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300"
                  >
                    {capacityError}
                  </div>
                {/if}

                {#if isLoadingCapacity && !capacityReport}
                  <div class="py-8 text-center text-xs text-slate-400">
                    規模データを読み込み中...
                  </div>
                {:else if capacityReport}
                  <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    <div
                      class="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
                    >
                      <div class="text-[10px] font-bold text-slate-400">
                        投稿
                      </div>
                      <div
                        class="mt-1 text-lg font-black text-slate-900 dark:text-white"
                      >
                        {capacityReport.posts.toLocaleString()}
                      </div>
                    </div>
                    <div
                      class="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
                    >
                      <div class="text-[10px] font-bold text-slate-400">
                        24h 更新
                      </div>
                      <div
                        class="mt-1 text-lg font-black text-slate-900 dark:text-white"
                      >
                        {capacityReport.postsUpdated24h.toLocaleString()}
                      </div>
                    </div>
                    <div
                      class="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
                    >
                      <div class="text-[10px] font-bold text-slate-400">
                        24h 書き込み
                      </div>
                      <div
                        class="mt-1 text-lg font-black text-slate-900 dark:text-white"
                      >
                        {capacityReport.writeEvents24h.toLocaleString()}
                      </div>
                    </div>
                    <div
                      class="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
                    >
                      <div class="text-[10px] font-bold text-slate-400">
                        KV スナップショット
                      </div>
                      <div
                        class="mt-1 text-sm font-black text-slate-900 dark:text-white"
                      >
                        {#if !capacityReport.kvBound}
                          未接続
                        {:else if capacityReport.snapshotAgeSeconds == null}
                          未作成
                        {:else if capacityReport.snapshotAgeSeconds < 60}
                          {capacityReport.snapshotAgeSeconds}秒前
                        {:else}
                          {Math.round(
                            capacityReport.snapshotAgeSeconds / 60
                          )}分前
                        {/if}
                      </div>
                    </div>
                    <div
                      class="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
                    >
                      <div class="text-[10px] font-bold text-slate-400">
                        端末セッション
                      </div>
                      <div
                        class="mt-1 text-lg font-black text-slate-900 dark:text-white"
                      >
                        {capacityReport.deviceSessions.toLocaleString()}
                      </div>
                    </div>
                    <div
                      class="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
                    >
                      <div class="text-[10px] font-bold text-slate-400">
                        アクセスログ
                      </div>
                      <div
                        class="mt-1 text-lg font-black text-slate-900 dark:text-white"
                      >
                        {capacityReport.accessLogs.toLocaleString()}
                      </div>
                    </div>
                  </div>

                  <div class="flex flex-col gap-2">
                    {#each capacityReport.advice as item, i (`${item.level}-${i}`)}
                      <div
                        class={`rounded-xl border p-3 text-xs ${
                          item.level === 'act'
                            ? 'border-rose-200 bg-rose-50/80 text-rose-900 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-200'
                            : item.level === 'watch'
                              ? 'border-amber-200 bg-amber-50/80 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200'
                              : 'border-emerald-200 bg-emerald-50/80 text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200'
                        }`}
                      >
                        <div class="font-bold">{item.title}</div>
                        <p class="mt-1 leading-relaxed opacity-90">
                          {item.body}
                        </p>
                      </div>
                    {/each}
                  </div>
                {/if}
              </div>
            {:else if activeTab === 'backup'}
              <div class="flex flex-col gap-4">
                <!-- Backup Status Alert -->
                {#if backupStatusMessage}
                  <div
                    class={`flex items-start gap-2 rounded-xl border p-3 text-xs ${
                      backupStatusMessage.type === 'success'
                        ? 'border-emerald-200 bg-emerald-50/80 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300'
                        : 'border-red-200 bg-red-50/80 text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300'
                    }`}
                  >
                    {#if backupStatusMessage.type === 'success'}
                      <Check
                        class="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400"
                      />
                    {:else}
                      <AlertCircle
                        class="h-4 w-4 shrink-0 text-red-600 dark:text-red-400"
                      />
                    {/if}
                    <div class="flex-1 font-medium">
                      {backupStatusMessage.text}
                    </div>
                    <button
                      type="button"
                      onclick={() => {
                        backupStatusMessage = null;
                      }}
                      class="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                    >
                      <X class="h-3.5 w-3.5" />
                    </button>
                  </div>
                {/if}

                <div class="grid grid-cols-1 gap-4 lg:grid-cols-12">
                  <!-- Left: 5 columns on desktop (Cron status & manual trigger) -->
                  <div class="flex flex-col gap-4 lg:col-span-5">
                    <!-- Automatic Cron Backup Info Box -->
                    <div
                      class="rounded-xl border border-blue-200/80 bg-blue-50/60 p-4 dark:border-blue-900/50 dark:bg-blue-950/30"
                    >
                      <div
                        class="flex items-center gap-2 text-xs font-bold text-blue-900 dark:text-blue-300"
                      >
                        <Database
                          class="h-4 w-4 text-blue-600 dark:text-blue-400"
                        />
                        <span>D1 自動バックアップ稼働状況</span>
                      </div>
                      <p
                        class="mt-2 text-[11px] leading-relaxed text-blue-800/80 dark:text-blue-300/80"
                      >
                        Cloudflare Cron Triggers により、<strong
                          >毎日 12:00 JST (03:00 UTC)</strong
                        >
                        に全テーブル（投稿、ユーザー、設定、ステータス履歴等）を自動で
                        JSON ダンプし、Cloudflare R2（<code>backups/</code
                        >）に保管しています（最新 30 世代を自動保持）。
                      </p>
                    </div>

                    <!-- Manual Backup Trigger Action -->
                    <div
                      class="flex flex-col justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900"
                    >
                      <div>
                        <h4
                          class="text-xs font-bold text-slate-800 dark:text-slate-200"
                        >
                          手動即時バックアップ
                        </h4>
                        <p
                          class="mt-1 text-[11px] text-slate-500 dark:text-slate-400"
                        >
                          メンテナンス前や災害対応の区切りに、現在の全データを
                          R2 に直ちに退避・スナップショット保存します。
                        </p>
                      </div>

                      <button
                        type="button"
                        onclick={handleTriggerBackup}
                        disabled={isTriggeringBackup}
                        class="mt-1 flex cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white shadow-xs transition hover:bg-blue-700 disabled:opacity-50"
                      >
                        {#if isTriggeringBackup}
                          <RefreshCw class="h-3.5 w-3.5 animate-spin" />
                          <span>バックアップ生成中...</span>
                        {:else}
                          <Download class="h-3.5 w-3.5" />
                          <span>今すぐバックアップ実行</span>
                        {/if}
                      </button>

                      {#if lastBackupResult && lastBackupResult.metadata}
                        <div
                          class="mt-2 border-t border-slate-100 pt-2.5 dark:border-slate-800"
                        >
                          <div
                            class="text-[11px] font-bold text-slate-700 dark:text-slate-300"
                          >
                            直前のバックアップ結果（計 {lastBackupResult
                              .metadata.totalRecords} 件）:
                          </div>
                          <div class="mt-1.5 flex flex-wrap gap-1.5">
                            {#each Object.entries(lastBackupResult.metadata.tableCounts) as [table, count] (table)}
                              <span
                                class="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 font-mono text-[10px] text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                              >
                                <span>{table}:</span>
                                <span class="font-bold">{count}</span>
                              </span>
                            {/each}
                          </div>
                        </div>
                      {/if}
                    </div>
                  </div>

                  <!-- Right: 7 columns on desktop (Stored Backups List) -->
                  <div
                    class="rounded-xl border border-slate-200 bg-white p-4 shadow-xs lg:col-span-7 dark:border-slate-800 dark:bg-slate-900"
                  >
                    <div class="mb-3 flex items-center justify-between">
                      <div class="flex items-center gap-1.5">
                        <FileText
                          class="h-4 w-4 text-slate-500 dark:text-slate-400"
                        />
                        <h4
                          class="text-xs font-bold text-slate-800 dark:text-slate-200"
                        >
                          R2 保存済みバックアップ一覧 ({backups.length} 件)
                        </h4>
                      </div>
                      <button
                        type="button"
                        onclick={loadBackups}
                        disabled={isLoadingBackups}
                        class="flex cursor-pointer items-center gap-1 text-[11px] font-bold text-blue-600 hover:text-blue-800 disabled:opacity-50 dark:text-blue-400 dark:hover:text-blue-300"
                      >
                        <RefreshCw
                          class={`h-3 w-3 ${isLoadingBackups ? 'animate-spin' : ''}`}
                        />
                        <span>再読込</span>
                      </button>
                    </div>

                    {#if isLoadingBackups}
                      <div
                        class="flex items-center justify-center py-10 text-xs text-slate-400"
                      >
                        <RefreshCw class="mr-2 h-4 w-4 animate-spin" />
                        <span>一覧を取得中...</span>
                      </div>
                    {:else if backups.length === 0}
                      <div
                        class="rounded-lg bg-slate-50 py-10 text-center text-xs text-slate-500 dark:bg-slate-800/50 dark:text-slate-400"
                      >
                        保存されているバックアップはありません（R2バケット未バインドまたは初回実行前）
                      </div>
                    {:else}
                      <div class="overflow-x-auto">
                        <table class="w-full text-left text-xs">
                          <thead>
                            <tr
                              class="border-b border-slate-200 text-[11px] text-slate-500 dark:border-slate-800 dark:text-slate-400"
                            >
                              <th class="pb-2 font-bold">ファイル名</th>
                              <th class="pb-2 font-bold">作成日時</th>
                              <th class="pb-2 text-right font-bold">総件数</th>
                              <th class="pb-2 text-right font-bold">サイズ</th>
                            </tr>
                          </thead>
                          <tbody
                            class="divide-y divide-slate-100 font-mono text-[11px] dark:divide-slate-800/60"
                          >
                            {#each backups as b (b.key)}
                              <tr
                                class="hover:bg-slate-50 dark:hover:bg-slate-800/40"
                              >
                                <td
                                  class="py-2.5 font-medium text-slate-800 dark:text-slate-200"
                                >
                                  {b.key.replace('backups/', '')}
                                </td>
                                <td
                                  class="py-2.5 text-slate-500 dark:text-slate-400"
                                >
                                  {b.uploaded
                                    ? new Date(b.uploaded).toLocaleString(
                                        'ja-JP'
                                      )
                                    : '-'}
                                </td>
                                <td
                                  class="py-2.5 text-right text-slate-700 dark:text-slate-300"
                                >
                                  {b.totalRecords !== undefined
                                    ? `${b.totalRecords} 件`
                                    : '-'}
                                </td>
                                <td
                                  class="py-2.5 text-right text-slate-500 dark:text-slate-400"
                                >
                                  {(b.size / 1024).toFixed(1)} KB
                                </td>
                              </tr>
                            {/each}
                          </tbody>
                        </table>
                      </div>
                    {/if}
                  </div>
                </div>
              </div>
            {/if}
          {/if}
        </div>
      {/if}

      <!-- Theme & Power Saving Setting -->
      <div
        class="mt-2 rounded-xl border border-slate-200 bg-slate-50/80 p-3.5 dark:border-slate-800 dark:bg-slate-800/60"
      >
        <div class="mb-2 flex items-center justify-between">
          <div
            class="flex items-center gap-1.5 font-bold text-slate-800 dark:text-slate-200"
          >
            <Palette class="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
            <span>{m.theme_title()}</span>
          </div>
          <span class="text-[11px] text-slate-500 dark:text-slate-400">
            {THEME_OPTIONS.find((t) => t.mode === themeManager.mode)?.label}
          </span>
        </div>
        <div class="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          {#each THEME_OPTIONS as opt (opt.mode)}
            <button
              type="button"
              onclick={() => themeManager.setTheme(opt.mode)}
              class={`flex cursor-pointer flex-col items-center justify-center rounded-lg border p-2 text-center transition ${
                themeManager.mode === opt.mode
                  ? 'border-blue-500 bg-blue-50/80 font-bold text-blue-700 ring-2 ring-blue-500/20 dark:border-blue-500 dark:bg-blue-950/60 dark:text-blue-300'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
              }`}
            >
              <span class="text-sm">{opt.icon}</span>
              <span class="mt-0.5 text-[11px]">{opt.shortLabel}</span>
            </button>
          {/each}
        </div>
      </div>
    </div>
  </div>
</div>
