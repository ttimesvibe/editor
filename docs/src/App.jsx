import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import * as mammoth from "mammoth";

// ── Utils ──
import { loadConfig, saveConfig } from "./utils/config.js";
import { loadDictionary, syncDictionaryFromServer, updateDictionary } from "./utils/dictionary.js";
import { delay, apiCall, apiSaveSession, apiLoadSession, apiAnalyze, apiCorrect, apiHighlightsDraft, apiHighlightsEdit, apiSaveTab, apiLoadMeta, apiLoadTab, apiProjectUpdateStep, apiHeartbeat, apiLeave } from "./utils/api.js";
import { createEmergencyBackup, getLatestBackup, listBackups, autoRetry } from "./utils/backup.js";
import { SaveFailModal, ConflictModal, RestoreModal, BackupListModal } from "./components/v2_modals.jsx";
import { mergeTabData as clientMergeTabData } from "./utils/clientMerge.js";
import { tabLabel } from "./utils/errorMessages.js";
import { parseDocxWithTrackChanges, computeBlockStrikes } from "./utils/docxParser.js";
import { calcRegression, tsToSeconds, secondsToDisplay, calcDuration, parseBlocks, splitChunks, chunkToText, chunkCtx } from "./utils/lengthModel.js";
import { findPositions, getCorrectedText } from "./utils/diffRenderer.js";
import { _savedTheme, C, FN, applyTheme, MARKER_COLORS, MARKER_COLORS_LIGHT, MARKER_COLORS_DARK, setMarkerColors } from "./utils/styles.js";
// R1 — 헌장 v1.1 §5/§6 정식 충족: 11 탭 데이터 schema 단일 진실.
import { TAB_IDS, TAB_SCHEMAS, pickFields, isValidTab } from "./utils/tabSchemas.js";
// R2.a/R2.b/R2.c — 부모 탭 컴포넌트 추출 (TabComponentInterface 따름).
import ReviewTab from "./tabs/ReviewTab.jsx";
import CorrectionTab from "./tabs/CorrectionTab.jsx";
import ScriptTab from "./tabs/ScriptTab.jsx";
import GuideTab from "./tabs/GuideTab.jsx";
import { generateExportHTML } from "./utils/exportHTML.js";

// ── Components ──
import { Badge, Progress, MarkedText, TypeBadge, BlockView, ReviewBlock, ScriptEditBlock, CorrectionRightBlock } from "./components/BlockComponents.jsx";
import { GuideCard } from "./components/GuideCard.jsx";
import { ShareModal, SessionListModal, SettingsModal } from "./components/Modals.jsx";
import { EditorialSummaryPanel } from "./components/EditorialSummaryPanel.jsx";
import { TermReviewScreen } from "./components/TermReviewScreen.jsx";
import { LoginScreen } from "./components/LoginScreen.jsx";

// ── Tabs ──
import { HighlightTab } from "./tabs/HighlightTab.jsx";
import { SetgenTab } from "./tabs/SetgenTab.jsx";
import { VisualTab } from "./tabs/VisualTab.jsx";
import { ModifyTab } from "./tabs/ModifyTab.jsx";

// ── Views ──
import { Dashboard } from "./views/Dashboard.jsx";
import { NewProjectModal } from "./views/NewProjectModal.jsx";
import { ShootModal } from "./views/ShootModal.jsx";

// ═══════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════

export default function App() {
  // ── 인증 상태 ──
  const [authState, setAuthState] = useState("checking"); // checking | login | authenticated
  const [authUser, setAuthUser] = useState(null);
  const [view, setView] = useState("checking"); // checking | login | dashboard | editor
  const [editorSessionId, setEditorSessionId] = useState(null); // 대시보드에서 선택한 세션 ID

  // 마운트 시 토큰 확인
  useEffect(() => {
    const token = localStorage.getItem("ttimes_token");
    if (!token) {
      setAuthState("login");
      setView("login");
      return;
    }
    try {
      // base64url → UTF-8 디코딩 (한글 이름 지원)
      const payloadB64 = token.split(".")[1];
      const payloadBytes = Uint8Array.from(atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
      const payload = JSON.parse(new TextDecoder().decode(payloadBytes));
      if (payload.exp < Date.now() / 1000) {
        localStorage.removeItem("ttimes_token");
        localStorage.removeItem("ttimes_user");
        setAuthState("login");
        setView("login");
        return;
      }
      setAuthUser({ email: payload.sub, name: payload.name, role: payload.role });
      setAuthState("authenticated");
      // URL에 ?s={id}가 있으면 바로 에디터, 아니면 대시보드
      const params = new URLSearchParams(window.location.search);
      if (params.get("s")) {
        setEditorSessionId(params.get("s"));
        setView("editor");
      } else {
        setView("dashboard");
      }
    } catch {
      localStorage.removeItem("ttimes_token");
      setAuthState("login");
      setView("login");
    }
  }, []);

  const handleAuthLogin = useCallback((token, user) => {
    localStorage.setItem("ttimes_token", token);
    localStorage.setItem("ttimes_user", JSON.stringify(user));
    setAuthUser(user);
    setAuthState("authenticated");
    setView("dashboard");
  }, []);

  const handleLogout = useCallback(() => {
    localStorage.removeItem("ttimes_token");
    localStorage.removeItem("ttimes_user");
    setAuthUser(null);
    setAuthState("login");
    setView("login");
  }, []);

  const handleSelectProject = useCallback((id) => {
    setEditorSessionId(id);
    window.history.replaceState({}, "", `${window.location.pathname}?s=${id}`);
    setView("editor");
  }, []);

  const handleBackToDashboard = useCallback(() => {
    setEditorSessionId(null);
    window.history.replaceState({}, "", window.location.pathname);
    setView("dashboard");
  }, []);

  // 인증 게이트
  if (view === "checking") {
    return <div style={{height:"100vh",background:"#0F0F23",display:"flex",alignItems:"center",justifyContent:"center",color:"#9CA3AF",fontFamily:"'Pretendard Variable', sans-serif"}}>로딩 중...</div>;
  }
  if (view === "login") {
    return <LoginScreen onLogin={handleAuthLogin} />;
  }

  if (view === "dashboard") {
    return <DashboardWrapper authUser={authUser} onSelectProject={handleSelectProject} onLogout={handleLogout} />;
  }

  return <AuthenticatedApp authUser={authUser} onLogout={handleLogout} initialSessionId={editorSessionId} onBackToDashboard={handleBackToDashboard} />;
}

function DashboardWrapper({ authUser, onSelectProject, onLogout }) {
  const [cfg] = useState(loadConfig);
  const [theme, setTheme] = useState(_savedTheme);
  const toggleTheme = useCallback(() => {
    setTheme(prev => {
      const next = prev === "dark" ? "light" : "dark";
      applyTheme(next);
      setMarkerColors(next === "light" ? MARKER_COLORS_LIGHT : MARKER_COLORS_DARK);
      return next;
    });
  }, []);
  const [showNewProject, setShowNewProject] = useState(false);
  const [editProjectData, setEditProjectData] = useState(null); // null = create mode, object = edit mode
  const [showShootModal, setShowShootModal] = useState(false);
  const [editShootData, setEditShootData] = useState(null); // null = create mode, object = edit mode
  const [viewMode, setViewMode] = useState("board"); // "board" | "kanban"
  const [parentShootIdForNewProject, setParentShootIdForNewProject] = useState(null);
  const [kanbanRefreshKey, setKanbanRefreshKey] = useState(0);
  const [projectRefreshKey, setProjectRefreshKey] = useState(0);

  const handleNewProjectCreate = useCallback(async (id, fileContent, fileName) => {
    const wasEdit = !!editProjectData;
    setShowNewProject(false);
    setEditProjectData(null);
    setParentShootIdForNewProject(null);
    setKanbanRefreshKey(k => k + 1);
    setProjectRefreshKey(k => k + 1);
    // 원고를 manuscript 탭에 저장 (생성 시에만)
    if (fileContent && !wasEdit) {
      try {
        // fileContent는 객체({text, fullText, paragraphs, hasTrackChanges}) 또는 레거시 문자열
        const payload = (typeof fileContent === "string")
          ? { text: fileContent, fileName }
          : {
              text: fileContent.text,
              fileName,
              fullText: fileContent.fullText || fileContent.text,
              paragraphs: fileContent.paragraphs || null,
              hasTrackChanges: !!fileContent.hasTrackChanges,
            };
        await apiSaveTab(id, "manuscript", payload, cfg, fileName);
      } catch (e) {
        console.error("원고 저장 실패:", e);
      }
      onSelectProject(id);
    }
  }, [onSelectProject, cfg, editProjectData]);

  const handleEditProject = useCallback((proj) => {
    setEditProjectData(proj);
    setShowNewProject(true);
  }, []);

  const handleShootCreated = useCallback(() => {
    setShowShootModal(false);
    setEditShootData(null);
    setKanbanRefreshKey(k => k + 1);
  }, []);

  const handleEditShoot = useCallback((shoot) => {
    setEditShootData(shoot);
    setShowShootModal(true);
  }, []);

  const handleNewProjectWithShoot = useCallback((parentShootId) => {
    setParentShootIdForNewProject(parentShootId || null);
    setShowNewProject(true);
  }, []);

  return <>
    <Dashboard authUser={authUser} cfg={cfg} onSelectProject={onSelectProject}
      onNewProject={() => { setEditProjectData(null); setParentShootIdForNewProject(null); setShowNewProject(true); }}
      onEditProject={handleEditProject}
      onNewShoot={() => { setEditShootData(null); setShowShootModal(true); }}
      onEditShoot={handleEditShoot}
      onNewProjectWithShoot={handleNewProjectWithShoot}
      onLogout={onLogout}
      toggleTheme={toggleTheme} theme={theme}
      viewMode={viewMode} setViewMode={setViewMode}
      kanbanRefreshKey={kanbanRefreshKey} projectRefreshKey={projectRefreshKey} />
    {showNewProject && <NewProjectModal authUser={authUser} cfg={cfg}
      parentShootId={parentShootIdForNewProject}
      project={editProjectData}
      onClose={() => { setShowNewProject(false); setEditProjectData(null); setParentShootIdForNewProject(null); }}
      onCreate={handleNewProjectCreate} />}
    {showShootModal && <ShootModal authUser={authUser} cfg={cfg}
      shoot={editShootData}
      onClose={() => { setShowShootModal(false); setEditShootData(null); }} onCreate={handleShootCreated} />}
  </>;
}

function AuthenticatedApp({ authUser, onLogout, initialSessionId, onBackToDashboard }) {
  const [cfg, setCfg] = useState(loadConfig);
  const [theme, setTheme] = useState(_savedTheme);
  const toggleTheme = useCallback(() => {
    setTheme(prev => {
      const next = prev === "dark" ? "light" : "dark";
      applyTheme(next);
      setMarkerColors(next === "light" ? MARKER_COLORS_LIGHT : MARKER_COLORS_DARK);
      return next;
    });
  }, []);
  const [blocks, setBlocks] = useState([]);
  const [diffs, setDiffs] = useState([]);
  const [hl, setHl] = useState([]);
  const [hlStats, setHlStats] = useState(null);
  const [hlVerdicts, setHlVerdicts] = useState({}); // { "blockIndex-subtitle": "use"|"recommend"|"discard"|null }
  const [hlEdits, setHlEdits] = useState({}); // { "blockIndex-subtitle": "수정된 텍스트" }
  const [scriptEdits, setScriptEdits] = useState({}); // { blockIndex: "수동 편집된 텍스트" } — 1.5단계
  const [blockDeletions, setBlockDeletions] = useState({}); // { blockIndex: [{s, e}, ...] } — 수정본 삭제선
  const [subtitleCache, setSubtitleCache] = useState(null); // AI 자막 포맷팅 결과 캐시
  const [subtitleResult, setSubtitleResult] = useState(null); // 2패널 표시용 자막 결과
  const [reviewData, setReviewData] = useState(null); // 0차: { paragraphs, hasTrackChanges, deletedBlockIndices, duration }
  const [addingAt, setAddingAt] = useState(null); // 자막 추가 중인 block_index
  const [addForm, setAddForm] = useState({ subtitle: "", type: "A1" }); // 추가 폼 상태
  const [anal, setAnal] = useState(null);
  const [fn, setFn] = useState("");
  const [tab, setTab] = useState("correction");
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState({p:0,l:""});
  const [summaryCollapsed, setSummaryCollapsed] = useState(false);
  const [gReady, setGReady] = useState(false);
  const [gBusy, setGBusy] = useState(false);
  const [partialBusy, setPartialBusy] = useState(false); // 부분 생성 로딩
  const [selPopup, setSelPopup] = useState(null); // { blockIdx, text, x, y }
  const [aBlock, setABlock] = useState(null);
  const [showSet, setShowSet] = useState(false);
  const [err, setErr] = useState(null);
  const [termReview, setTermReview] = useState(false);
  const [pendingTerms, setPendingTerms] = useState([]);
  const [shareUrl, setShareUrl] = useState(null);
  const [sessionId, setSessionId] = useState(null); // 공유된 세션 ID (업데이트용)
  const [lastSavedSnapshot, setLastSavedSnapshot] = useState("");
  const [autoSaveStatus, setAutoSaveStatus] = useState(""); // "", "pending", "saving", "saved"
  const autoSaveTimer = useRef(null);
  const sessionIdRef = useRef(null);
  const savingInProgress = useRef(false); // 동시 저장 방지 (boolean — beforeunload 가드용)
  // CMS v2 — A-1: mutex → 락(promise) 변환. 진행 중이면 skip 대신 대기 후 실행.
  const saveLock = useRef(Promise.resolve());
  const withSaveLock = useCallback(async (fn) => {
    const prev = saveLock.current;
    let release;
    saveLock.current = new Promise(r => { release = r; });
    try {
      await prev;
      return await fn();
    } finally {
      release();
    }
  }, []);
  const [saving, setSaving] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [hlMarkers, setHlMarkers] = useState({}); // { "blockIdx-subtitle": { color: "yellow", ranges: [{s,e}] } }
  const [matchingMode, setMatchingMode] = useState(null); // { key: "blockIdx-subtitle", color: "yellow" } or null
  const [showSessions, setShowSessions] = useState(false); // 세션 목록 모달
  const [bookmark, setBookmark] = useState(null); // 책갈피 블록 인덱스
  const [exportCache, setExportCache] = useState({}); // { highlight, setgen, visual, modify }

  // CMS v2 — D2 모달 + 4중 백업 (묶음 ① ½)
  const [saveFailModal, setSaveFailModal] = useState(null);
  const [conflictModal, setConflictModal] = useState(null);
  const [restoreModal, setRestoreModal] = useState(null);
  const [backupListOpen, setBackupListOpen] = useState(false);
  const autoSaveFailCount = useRef(0);

  // CMS v2 — 묶음 ⑫ 멀티유저 sync (Phase 1+2+3)
  const lastLoadedAt = useRef({});       // { tab: serverSavedAt }
  const lastLoadedVersion = useRef({});  // { tab: version }
  const [activeUsers, setActiveUsers] = useState([]);
  const [otherUserToast, setOtherUserToast] = useState(null); // { tab, by, at }
  const lastToastShownAt = useRef({});   // debounce: { sub: timestamp }

  const lRef = useRef(null), rRef = useRef(null), syncing = useRef(false), bEls = useRef({});
  const dirtyTabs = useRef(new Set()); // 마지막 저장 이후 변경된 탭 추적
  const isInitialLoad = useRef(true); // 초기 로드 중에는 dirty 마킹 안 함

  // ── R1 — 11 탭 단일 store (derived state) — 헌장 §5/§6 정식 충족 prep ──
  // 본 store 는 R1 시점에 derived (부모 탭의 useState 들 + 자식 탭의 exportCache 의 결합).
  // R3 시점에 부모 state 폐기 + tabData 가 진짜 source of truth 로 변환됨.
  // 본 단계 (R1) 에선 사용 X (라이브 영향 0). R2.a~d 의 컴포넌트 추출 + R3 폐기 시점에 사용 시작.
  //
  // 헌장 §5 (11 탭 동등): tabData[tabId] 가 단일 형식 → 모든 탭 동등 read/write.
  // 헌장 §6 (부모/자식 카테고리 거부): 외부에서 부모/자식 구분 불가능 — 모두 tabData[tabId] 키.
  // 미래 변경 시 utils/tabSchemas.js 의 TAB_SCHEMAS 가 단일 진실.
  // eslint-disable-next-line no-unused-vars
  const tabData = useMemo(() => ({
    review:     pickFields("review",     { reviewData }),
    correction: pickFields("correction", { blocks, anal, diffs, scriptEdits, blockDeletions }),
    script:     pickFields("script",     { blocks, scriptEdits }),
    guide:      pickFields("guide",      { hl, hlStats, hlVerdicts, hlEdits, hlMarkers }),
    highlight:  exportCache.highlight  || {},
    setgen:     exportCache.setgen     || {},
    visual:     exportCache.visual     || {},
    modify:     exportCache.modify     || {},
    metadata:   exportCache.metadata   || {},
    manuscript: exportCache.manuscript || {},
    subtitle:   exportCache.subtitle   || {},
  }), [
    reviewData,
    blocks, anal, diffs, scriptEdits, blockDeletions,
    hl, hlStats, hlVerdicts, hlEdits, hlMarkers,
    exportCache,
  ]);

  // ─────────────────────────────────────────────────────────────────────────
  // R3.a — patchTab 단일 setter API (헌장 §5/§6 정식 충족)
  // ─────────────────────────────────────────────────────────────────────────
  //
  // 책임: 11 탭 동등 단일 쓰기 진입점.
  //   - 모든 탭 동일한 (tabId, partial, opts) 형식.
  //   - 약속 Y 메커니즘: opts.markDirty=false 로 fetch / 초기 load 시 dirty 차단.
  //   - 헌장 §3 금지 조항 강제: dirty 마킹은 본 함수에 단일화 → 진입 안 한 탭 dirty 누적 차단의 토대.
  //
  // 본 단계 (R3.a) 는 additive — 기존 setHl/setBlocks/setExportCache 호출은 그대로 유지.
  // 새 코드는 patchTab 사용 권고. R3.b/c/d 단계에서 호출부 점진 이행 + useState 폐기.
  //
  // 호출 예:
  //   patchTab("guide", { hl: newHl })
  //   patchTab("highlight", { clips: ... })
  //   patchTab("review", { reviewData: ... }, { markDirty: false })  // 약속 Y
  //
  // ───────────────────────────────────────────────────────────────────────────
  const patchTab = useCallback((tabId, partial, opts = {}) => {
    if (!isValidTab(tabId)) {
      console.warn(`[patchTab] unknown tabId: ${tabId}`);
      return;
    }
    if (!partial || typeof partial !== "object") return;

    // 부모 4 탭 — 개별 useState setter 라우팅 (R3.d 시점에 단일 store 로 통합)
    if (tabId === "review") {
      if ("reviewData" in partial) setReviewData(partial.reviewData);
    } else if (tabId === "correction") {
      if ("blocks" in partial) setBlocks(partial.blocks);
      if ("anal" in partial) setAnal(partial.anal);
      if ("diffs" in partial) setDiffs(partial.diffs);
      if ("scriptEdits" in partial) setScriptEdits(partial.scriptEdits);
      if ("blockDeletions" in partial) setBlockDeletions(partial.blockDeletions);
    } else if (tabId === "script") {
      // script 와 correction 은 blocks/scriptEdits 공유 (헌장 정합 결정: 동일 참조)
      if ("blocks" in partial) setBlocks(partial.blocks);
      if ("scriptEdits" in partial) setScriptEdits(partial.scriptEdits);
    } else if (tabId === "guide") {
      // guide 와 highlight 는 hl/hlStats/hlVerdicts/hlEdits/hlMarkers 공유 (동일 참조)
      if ("hl" in partial) setHl(partial.hl);
      if ("hlStats" in partial) setHlStats(partial.hlStats);
      if ("hlVerdicts" in partial) setHlVerdicts(partial.hlVerdicts);
      if ("hlEdits" in partial) setHlEdits(partial.hlEdits);
      if ("hlMarkers" in partial) setHlMarkers(partial.hlMarkers);
    } else {
      // 자식 7 탭 (highlight / setgen / visual / modify / metadata / manuscript / subtitle)
      // — exportCache 통일 라우팅. R3.d 시점에 tabData 단일 store 로 통합.
      setExportCache(prev => ({
        ...prev,
        [tabId]: { ...(prev[tabId] || {}), ...partial },
      }));
    }

    // dirty 마킹 — 약속 Y 메커니즘. markDirty=false 시 차단 (fetch / 초기 load).
    if (opts.markDirty !== false && !isInitialLoad.current) {
      dirtyTabs.current.add(tabId);
    }
  }, []);
  // eslint-disable-next-line no-unused-vars
  const _patchTabRef = patchTab; // R3.b/c/d 시점 호출부 이행 — 현 단계에선 미사용 (lint 회피)

  // ── localStorage 자동저장 (CMS v2 G5/PS2: 500ms debounce, main thread 차단 완화) ──
  const teSessionDebounce = useRef(null);
  useEffect(() => {
    if (blocks.length === 0) return;
    if (teSessionDebounce.current) clearTimeout(teSessionDebounce.current);
    teSessionDebounce.current = setTimeout(() => {
      try {
        localStorage.setItem("te_session", JSON.stringify({ blocks, anal, diffs, hl, hlStats, hlVerdicts, hlEdits, hlMarkers, scriptEdits, blockDeletions, reviewData, fn, tab, gReady, bookmark, exportCache }));
      } catch {}
    }, 500);
    return () => { if (teSessionDebounce.current) clearTimeout(teSessionDebounce.current); };
  }, [blocks, anal, diffs, hl, hlStats, hlVerdicts, hlEdits, hlMarkers, scriptEdits, blockDeletions, reviewData, fn, tab, gReady, bookmark]);

  // CMS v2 — 묶음 ⑫ Phase 2+3 (30초 폴링 + heartbeat + active-users + leave)
  useEffect(() => {
    const id = sessionId;
    if (!id || cfg.apiMode === "mock" || !cfg.workerUrl || !authUser) return;

    let stopped = false;
    const user = { sub: authUser.email, name: authUser.name };

    const beat = async () => {
      if (stopped) return;
      const r = await apiHeartbeat(id, cfg, user, tab);
      if (r?.active) {
        setActiveUsers(r.active.filter(u => u.sub !== authUser.email));
      }
      // meta 폴링 동시
      try {
        const meta = await apiLoadMeta(id, cfg);
        if (meta?.stages) {
          for (const [t, info] of Object.entries(meta.stages)) {
            const serverAt = info?.updatedAt;
            const localAt = lastLoadedAt.current[t];
            if (!serverAt) continue;
            const updatedBy = meta.updatedBy;
            const updatedSub = typeof updatedBy === "object" ? updatedBy?.sub : null;
            if (updatedSub === authUser.email) continue;
            if (!localAt || serverAt > localAt) {
              // 5분 noise debounce per user
              const debounceKey = updatedSub || "anon";
              const last = lastToastShownAt.current[debounceKey] || 0;
              if (Date.now() - last > 5 * 60 * 1000) {
                setOtherUserToast({
                  tab: t,
                  by: typeof updatedBy === "object" ? updatedBy?.name : "다른 편집자",
                  at: serverAt,
                  type: "polled",
                });
                lastToastShownAt.current[debounceKey] = Date.now();
              }
            }
          }
        }
      } catch {}
    };

    // 즉시 1회 + 30초 주기
    beat();
    const interval = setInterval(beat, 30 * 1000);

    // 탭 활성화 시 즉시 1회
    const onVisibility = () => { if (document.visibilityState === "visible") beat(); };
    document.addEventListener("visibilitychange", onVisibility);

    // pagehide 시 leave (sendBeacon)
    const onPageHide = () => { try { apiLeave(id, cfg, user); } catch {} };
    window.addEventListener("pagehide", onPageHide);

    return () => {
      stopped = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      // 컴포넌트 unmount 시도 leave
      try { apiLeave(id, cfg, user); } catch {}
    };
  }, [sessionId, cfg, authUser, tab]);

  // CMS v2 — otherUserToast 자동 닫힘
  useEffect(() => {
    if (!otherUserToast) return;
    const t = setTimeout(() => setOtherUserToast(null), 5000);
    return () => clearTimeout(t);
  }, [otherUserToast]);

  // CMS v2 — 탭 로드 시 lastLoadedAt + version 추적 (apiLoadTab 결과 갱신)
  // App.jsx 내 기존 apiLoadTab 호출처 (line 308 results.forEach 영역) 가 이 ref 갱신.
  // 별도 wrapping 없이 useEffect 로 sessionId 변경 시 초기화만.
  useEffect(() => {
    lastLoadedAt.current = {};
    lastLoadedVersion.current = {};
  }, [sessionId]);

  // CMS v2 — beforeunload 가드 (D2 1차 백업, 묶음 ① ½)
  useEffect(() => {
    const onBeforeUnload = (e) => {
      // dirty 가 있고 저장 진행 중이 아닐 때만 경고
      if (dirtyTabs.current.size > 0 && !savingInProgress.current) {
        e.preventDefault();
        e.returnValue = "저장되지 않은 변경사항이 있습니다. 정말 떠나시겠습니까?";
        return e.returnValue;
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  // CMS v2 — 진입 시 복원 모달 (D2 — 다음 로그인 즉시)
  useEffect(() => {
    try {
      const latest = getLatestBackup();
      if (latest && latest.sessionId) {
        const all = listBackups();
        setRestoreModal({ backup: latest, totalCount: all.length });
      }
    } catch (e) {
      console.warn("[backup] restore check failed:", e?.message || e);
    }
  }, []);

  // ── 앱 마운트 시: URL 공유 파라미터 또는 localStorage 복원 ──
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sid = params.get("s");
    if (sid) {
      setReadOnly(false);
      setSessionId(sid); sessionIdRef.current = sid;
      setBusy(true); setProg({p:20,l:"세션 불러오는 중..."});
      (async () => {
        try {
          const data = await apiLoadSession(sid, cfg);
          if (data.blocks && data.blocks.length > 0) {
            // 레거시 전체 데이터
            setBlocks(data.blocks);
            setAnal(data.anal || null);
            setDiffs(data.diffs || []);
            setHl(data.hl || []);
            setHlStats(data.hlStats || null);
            setHlVerdicts(data.hlVerdicts || {}); setHlEdits(data.hlEdits || {}); setHlMarkers(data.hlMarkers || {}); setScriptEdits(data.scriptEdits || {}); setBlockDeletions(data.blockDeletions || {}); setReviewData(data.reviewData || null);
            setFn(data.fn || "");
            setGReady((data.hl?.length > 0));
            setTab(data.hl?.length > 0 ? "guide" : data.reviewData ? "review" : "correction");
          } else if (data.schema === "v2") {
            // v2 메타만 — 탭 데이터 추가 로드
            setFn(data.fn || "");
            setProg({p:40,l:"탭 데이터 불러오는 중..."});
            // CMS v2 — meta.stages 기반 조건부 load (404 다발 제거)
            // 이전: 8 탭 일괄 load → 빈 탭 404 다수 (console noise)
            // 변경: meta.stages 의 키만 load → 404 0건
            const ALL_TABS = ["correction","guide","highlight","visual","modify","setgen","review","manuscript"];
            const stages = data.stages || {};
            const tabs = ALL_TABS.filter(t => stages[t]);
            const results = tabs.length > 0
              ? await Promise.allSettled(tabs.map(t => apiLoadTab(sid, t, cfg)))
              : [];
            const td = {};
            results.forEach((r, i) => {
              if (r.status === "fulfilled" && r.value) {
                td[tabs[i]] = r.value;
                // CMS v2 — lastLoadedAt + version 추적 (B5)
                if (r.value.savedAt) lastLoadedAt.current[tabs[i]] = r.value.savedAt;
                if (r.value.version !== undefined) lastLoadedVersion.current[tabs[i]] = r.value.version;
              }
            });
            const c = td.correction || {};
            setBlocks(c.blocks || []); setAnal(c.anal || null); setDiffs(c.diffs || []);
            setScriptEdits(c.scriptEdits || {}); setBlockDeletions(c.blockDeletions || {});
            if (td.review) setReviewData(td.review.reviewData || td.review);
            // 편집가이드 데이터: guide 탭 우선, 폴백으로 highlight 탭 (레거시 호환)
            const g = td.guide || {};
            const gFallback = (g.hl ? g : td.highlight) || {};
            setHl(gFallback.hl || []); setHlStats(gFallback.hlStats || null);
            setHlVerdicts(gFallback.hlVerdicts || {}); setHlEdits(gFallback.hlEdits || {}); setHlMarkers(gFallback.hlMarkers || {});
            const hasHl = (gFallback.hl?.length > 0);
            // 하이라이트 탭 clips 복원
            if (td.highlight?.clips) {
              setExportCache(prev => ({ ...prev, highlight: td.highlight }));
            }
            // CMS v2 — visual/modify/setgen 도 exportCache 에 박음 (자식 컴포넌트의 자체 fetch 회피)
            const cachePatch = {};
            if (td.visual) cachePatch.visual = td.visual;
            if (td.modify) cachePatch.modify = td.modify;
            if (td.setgen) cachePatch.setgen = td.setgen;
            if (Object.keys(cachePatch).length > 0) {
              setExportCache(prev => ({ ...prev, ...cachePatch }));
            }
            setGReady(hasHl);

            // blocks가 비어있고 manuscript 탭에 원고가 있으면 자동으로 0차 검토 시작
            if ((!c.blocks || c.blocks.length === 0) && td.manuscript?.text) {
              const msText = td.manuscript.text;
              const msName = td.manuscript.fileName || data.fn || "";
              const savedParagraphs = td.manuscript.paragraphs;
              const savedHasTrackChanges = !!td.manuscript.hasTrackChanges;
              const savedFullText = td.manuscript.fullText || msText;
              setFn(msName);

              if (savedParagraphs && savedHasTrackChanges) {
                // ── 변경 추적 데이터로 0차 검토 정상 구성 ──
                const reviewBlocks = parseBlocks(savedFullText);
                const { blockStrikeRanges, deletedBlockIndices } = computeBlockStrikes(savedParagraphs, reviewBlocks, savedFullText);
                const duration = calcDuration(reviewBlocks, new Set(deletedBlockIndices));
                setReviewData({
                  hasTrackChanges: true,
                  deletedBlockIndices,
                  blockStrikeRanges,
                  duration,
                  reviewBlocks,
                  cleanTextChars: msText.length,
                  paragraphs: savedParagraphs,
                  cleanText: msText,
                });
                // blocks는 cleanText 기준 — 1차 교정 이후 단계가 삭제 반영된 본문 사용
                setBlocks(parseBlocks(msText));
              } else {
                // ── 레거시 / track changes 없음 — 기존 동작 ──
                const reviewBlocks = parseBlocks(msText);
                const duration = calcDuration(reviewBlocks);
                const paragraphs = savedParagraphs || msText.split('\n').map(line => [{ text: line, deleted: false }]);
                setReviewData({ hasTrackChanges: false, deletedBlockIndices: [], blockStrikeRanges: {}, duration, reviewBlocks, cleanTextChars: msText.length, paragraphs, cleanText: msText });
                setBlocks(reviewBlocks);
              }
              setTab("review");
            } else {
              setTab(hasHl ? "guide" : c.blocks?.length > 0 ? "correction" : "correction");
            }
          }
          setProg({p:100,l:"✅ 세션 로드 완료"});
        } catch (e) { setErr(e.message); }
        finally { setBusy(false); setTimeout(() => { isInitialLoad.current = false; }, 500); /* CMS v2: 500ms — setBlocks/setHl 등 dirty add useEffect 모두 fire 후 false (이전 0ms 는 race 로 자동 dirty 누적) */ }
      })();
    } else {
      try {
        const saved = localStorage.getItem("te_session");
        if (saved) {
          const s = JSON.parse(saved);
          if (s.blocks?.length > 0) {
            setBlocks(s.blocks); setAnal(s.anal || null);
            setDiffs(s.diffs || []); setHl(s.hl || []);
            setHlStats(s.hlStats || null); setHlVerdicts(s.hlVerdicts || {}); setHlEdits(s.hlEdits || {}); setHlMarkers(s.hlMarkers || {}); setScriptEdits(s.scriptEdits || {}); setBlockDeletions(s.blockDeletions || {}); setReviewData(s.reviewData || null);
            setFn(s.fn || ""); setTab(s.tab || "correction"); setGReady(s.gReady || false);
            if (s.bookmark != null) setBookmark(s.bookmark);
            if (s.exportCache) setExportCache(s.exportCache);
          }
        }
      } catch {}
      setTimeout(() => { isInitialLoad.current = false; }, 500); /* CMS v2: 500ms — setBlocks/setHl 등 dirty add useEffect 모두 fire 후 false (이전 0ms 는 race 로 자동 dirty 누적) */
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── dirty 탭 추적: 데이터 변경 시 해당 탭을 dirty로 마킹 ──
  useEffect(() => {
    if (isInitialLoad.current) return;
    dirtyTabs.current.add("correction");
  }, [blocks, anal, diffs, scriptEdits, blockDeletions]);

  useEffect(() => {
    if (isInitialLoad.current) return;
    dirtyTabs.current.add("guide");
  }, [hl, hlStats, hlVerdicts, hlEdits, hlMarkers]);

  useEffect(() => {
    if (isInitialLoad.current) return;
    dirtyTabs.current.add("review");
  }, [reviewData]);

  useEffect(() => {
    if (isInitialLoad.current) return;
    if (exportCache.highlight) { console.log("[r3-diag] dirty add: highlight"); dirtyTabs.current.add("highlight"); }
  }, [exportCache.highlight]);

  // CMS v2 — 묶음 ⑤ G2: 11 탭 dirty 추적 확장 (visual/setgen/modify/metadata)
  // 자식 컴포넌트의 onSave 콜백이 setExportCache 만 갱신 → 본 useEffect 가 dirty 자동 add
  // 실 저장은 [💾 저장] 클릭 시 saveDirtyTabsToKV 가 모아서 한 번에 (v2 가드 통과)
  useEffect(() => {
    if (isInitialLoad.current) return;
    if (exportCache.visual) { console.log("[r3-diag] dirty add: visual"); dirtyTabs.current.add("visual"); }
  }, [exportCache.visual]);

  useEffect(() => {
    if (isInitialLoad.current) return;
    if (exportCache.setgen) { console.log("[r3-diag] dirty add: setgen"); dirtyTabs.current.add("setgen"); }
  }, [exportCache.setgen]);

  useEffect(() => {
    if (isInitialLoad.current) return;
    if (exportCache.modify) { console.log("[r3-diag] dirty add: modify"); dirtyTabs.current.add("modify"); }
  }, [exportCache.modify]);

  useEffect(() => {
    if (isInitialLoad.current) return;
    if (exportCache.metadata) { console.log("[r3-diag] dirty add: metadata"); dirtyTabs.current.add("metadata"); }
  }, [exportCache.metadata]);

  // sync scroll — 1차 교정 탭에서만 연동 (편집 가이드는 독립 스크롤)
  const onScroll = useCallback(src => {
    if (tab !== "correction") return; // 편집 가이드 탭에서는 연동 안 함
    if (syncing.current) return; syncing.current = true;
    const a = src==="l"?lRef.current:rRef.current;
    const b = src==="l"?rRef.current:lRef.current;
    if (a&&b) { const r = a.scrollTop/(a.scrollHeight-a.clientHeight||1); b.scrollTop = r*(b.scrollHeight-b.clientHeight||1); }
    requestAnimationFrame(()=>{syncing.current=false});
  },[tab]);

  useEffect(()=>{
    const l=lRef.current, r=rRef.current; if(!l||!r) return;
    const oL=()=>onScroll("l"), oR=()=>onScroll("r");
    l.addEventListener("scroll",oL,{passive:true}); r.addEventListener("scroll",oR,{passive:true});
    return()=>{l.removeEventListener("scroll",oL);r.removeEventListener("scroll",oR)};
  },[onScroll,tab,blocks.length]);

  const scrollTo = useCallback(i => {
    setABlock(i);
    // 편집 가이드 탭에서는 g 키, 1차 교정 탭에서는 l/r 키
    const el = bEls.current[`g${i}`] || bEls.current[`l${i}`] || bEls.current[`r${i}`];
    if (el) {
      const container = el.closest('[data-scroll-container]');
      if (container) {
        const containerRect = container.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        const offset = elRect.top - containerRect.top + container.scrollTop - containerRect.height / 3;
        container.scrollTo({ top: offset, behavior: 'smooth' });
      } else {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
    // 1차 교정 탭: 반대편 패널도 스크롤 (좌→우, 우→좌)
    const otherKey = bEls.current[`l${i}`] === el ? `r${i}` : `l${i}`;
    const otherEl = bEls.current[otherKey];
    if (otherEl && otherEl !== el) {
      const container = otherEl.closest('[data-scroll-container]');
      if (container) {
        const containerRect = container.getBoundingClientRect();
        const elRect = otherEl.getBoundingClientRect();
        const offset = elRect.top - containerRect.top + container.scrollTop - containerRect.height / 3;
        container.scrollTo({ top: offset, behavior: 'smooth' });
      }
    }
    // 편집 가이드: 오른쪽 강조자막 패널도 해당 블록의 자막으로 스크롤
    if (rRef.current) {
      const hlEl = rRef.current.querySelector(`[data-hl-block="${i}"]`);
      if (hlEl) {
        const containerRect = rRef.current.getBoundingClientRect();
        const elRect = hlEl.getBoundingClientRect();
        const offset = elRect.top - containerRect.top + rRef.current.scrollTop - 60;
        rRef.current.scrollTo({ top: offset, behavior: 'smooth' });
      }
    }
  },[]);

  const saveCfg = useCallback(c=>{setCfg(c);saveConfig(c);setShowSet(false)},[]);

  // ── stepProgress 자동 업데이트 ──
  const STEP_MAP = { review: 0, correction: 1, script: 2, guide: 3, visual: 4, modify: 5, highlight: 6, setgen: 7 };
  const updateStepProgress = useCallback((tabName) => {
    const sid = sessionIdRef.current;
    if (!sid || cfg.apiMode === "mock") return;
    const stepIndex = STEP_MAP[tabName];
    if (stepIndex === undefined) return;
    apiProjectUpdateStep(sid, tabName, stepIndex, cfg).catch(() => {});
  }, [cfg]);

  // 저장 & 공유
  // ── dirty 탭만 KV 저장 (변경된 탭만 개별 저장) ──
  // overrides: { correction: {...}, guide: {...} } — setState 직후 클로저가 stale할 때 최신 데이터 주입용
  // CMS v2 — D2 + B3 (묶음 ① ½)
  // opts.manual : 수동 저장 (실패 시 모달 노출)
  // opts.silent : 자동 저장 (silent fail, 3회 누적 시 토스트만)
  const saveDirtyTabsToKV = useCallback(async (id, overrides = {}, opts = {}) => {
    if (!id || cfg.apiMode === "mock") return;
    const dirty = dirtyTabs.current;
    if (dirty.size === 0) return;
    const tabsToSave = [];
    const payloads = {};
    const saves = [];
    const optsFor = (tab) => ({
      baseSavedAt: lastLoadedAt.current[tab],
      baseVersion: lastLoadedVersion.current[tab],
      force: !!opts.force,
    });

    // CMS v2 — 묶음 ⑤ G2 + G7: 11 탭 dispatch table
    // 모든 탭이 동일한 v2 가드 (충돌 감지 / 모달 / 4중 백업 / 토스트) 통과
    const SAVE_DISPATCH = {
      correction: () => ({ blocks, anal, diffs, scriptEdits, blockDeletions }),
      review:     () => reviewData || {},
      guide:      () => ({ hl, hlStats, hlVerdicts, hlEdits, hlMarkers }),
      highlight:  () => exportCache.highlight,
      visual:     () => exportCache.visual,
      setgen:     () => exportCache.setgen,
      modify:     () => exportCache.modify,
      metadata:   () => exportCache.metadata,
      manuscript: () => exportCache.manuscript,
      subtitle:   () => exportCache.subtitle,
    };

    for (const t of dirty) {
      const data = overrides[t] !== undefined ? overrides[t] : SAVE_DISPATCH[t]?.();
      if (!data) continue; // 데이터 없으면 skip (예: highlight 의 exportCache 미설정)
      payloads[t] = data;
      tabsToSave.push(t);
      saves.push(apiSaveTab(id, t, data, cfg, fn, optsFor(t)));
    }
    if (saves.length === 0) return;

    // Promise.allSettled — 결과 분류
    const results = await Promise.allSettled(saves);
    const failed = [];
    const conflicts = [];
    const success = [];
    results.forEach((r, i) => {
      const t = tabsToSave[i];
      if (r.status === "fulfilled") {
        success.push(t);
        // CMS v2 — 성공 시 lastLoadedAt + version 갱신 (B5)
        if (r.value?.savedAt) lastLoadedAt.current[t] = r.value.savedAt;
        if (r.value?.version !== undefined) lastLoadedVersion.current[t] = r.value.version;
        // 머지된 경우 토스트
        if (r.value?.merged && r.value?.mergedBy?.sub !== authUser?.email) {
          setOtherUserToast({ tab: t, by: r.value.mergedBy?.name || "다른 편집자", at: r.value.savedAt, type: "merged" });
        }
      }
      else if (r.reason?.status === 409) conflicts.push({ tab: t, payload: payloads[t], reason: r.reason });
      else failed.push({ tab: t, error: r.reason, payload: payloads[t] });
    });

    // dirty 보존 — 성공한 탭만 해제
    const successSet = new Set(success);
    const remaining = new Set([...dirty].filter((t) => !successSet.has(t)));
    dirtyTabs.current = remaining;

    if (success.length > 0) console.log(`[save-flow] saved: [${success.join(", ")}]`);

    // 실패 처리
    if (failed.length > 0) {
      // 2차 백업 (localStorage 자동) — 모달 노출 전 즉시
      for (const f of failed) {
        createEmergencyBackup({ type: "save_failure", sessionId: id, fn, payload: f.payload, reason: f.error?.message || "save failed" });
      }
      if (opts.manual) {
        // 수동 저장 → 모달
        setSaveFailModal({
          failedTabs: failed.map((f) => ({ tab: f.tab, error: f.error })),
          sessionId: id, fn, payload: payloads,
          onRetry: () => { setSaveFailModal(null); saveDirtyTabsToKV(id, overrides, { manual: true }); },
          onClose: () => setSaveFailModal(null),
        });
      } else if (!opts.silent) {
        // 기본: 토스트
        autoSaveFailCount.current += 1;
        if (autoSaveFailCount.current >= 3) {
          console.warn("[save-flow] auto-save failed 3 times in a row");
          setErr("자동 저장이 3회 연속 실패했습니다. '공유' 버튼으로 수동 저장을 시도해주세요.");
          autoSaveFailCount.current = 0;
        }
      }
    } else {
      autoSaveFailCount.current = 0;
    }

    // 충돌 처리 (B3) — 묶음 ⑫ Phase 1
    if (conflicts.length > 0) {
      for (const c of conflicts) {
        createEmergencyBackup({ type: "conflict", sessionId: id, fn, payload: c.payload, reason: "conflict 409" });
      }
      // 첫 충돌만 모달 (다중 충돌 시 한 번에 한 탭)
      const c = conflicts[0];
      const applyServerToState = (tab, serverData) => {
        // 서버 데이터로 React state 갱신 (탭 별)
        if (tab === "correction") {
          if (serverData.blocks) setBlocks(serverData.blocks);
          if (serverData.anal !== undefined) setAnal(serverData.anal);
          if (serverData.diffs !== undefined) setDiffs(serverData.diffs);
          if (serverData.scriptEdits !== undefined) setScriptEdits(serverData.scriptEdits || {});
          if (serverData.blockDeletions !== undefined) setBlockDeletions(serverData.blockDeletions || {});
        } else if (tab === "review") {
          if (serverData.reviewData !== undefined) setReviewData(serverData.reviewData);
        } else if (tab === "guide") {
          if (serverData.hl !== undefined) setHl(serverData.hl || []);
          if (serverData.hlStats !== undefined) setHlStats(serverData.hlStats);
          if (serverData.hlVerdicts !== undefined) setHlVerdicts(serverData.hlVerdicts || {});
          if (serverData.hlEdits !== undefined) setHlEdits(serverData.hlEdits || {});
          if (serverData.hlMarkers !== undefined) setHlMarkers(serverData.hlMarkers || {});
        }
        if (serverData.savedAt) lastLoadedAt.current[tab] = serverData.savedAt;
        if (serverData.version !== undefined) lastLoadedVersion.current[tab] = serverData.version;
      };
      setConflictModal({
        tab: c.tab,
        serverUpdatedBy: c.reason?.serverUpdatedBy,
        onMerge: async () => {
          try {
            const merged = clientMergeTabData(c.reason.serverData || {}, c.payload, c.tab);
            await apiSaveTab(id, c.tab, merged, cfg, fn, {
              baseSavedAt: c.reason.serverSavedAt,
              baseVersion: c.reason.serverVersion,
              force: true,
            });
            applyServerToState(c.tab, merged);
            dirtyTabs.current.delete(c.tab);
            setConflictModal(null);
            setOtherUserToast({ tab: c.tab, by: "양쪽 합침 완료", at: new Date().toISOString(), type: "merged" });
          } catch (e) {
            console.error("[merge] failed:", e?.message || e);
            setErr("합치기에 실패했습니다: " + (e?.message || ""));
            setConflictModal(null);
          }
        },
        onAcceptServer: () => {
          applyServerToState(c.tab, c.reason.serverData || {});
          dirtyTabs.current.delete(c.tab);
          setConflictModal(null);
        },
        onForceMine: async () => {
          try {
            await apiSaveTab(id, c.tab, c.payload, cfg, fn, {
              baseSavedAt: c.reason.serverSavedAt,
              baseVersion: c.reason.serverVersion,
              force: true,
            });
            dirtyTabs.current.delete(c.tab);
            setConflictModal(null);
          } catch (e) {
            console.error("[force-save] failed:", e?.message || e);
            setErr("강제 저장에 실패했습니다: " + (e?.message || ""));
            setConflictModal(null);
          }
        },
        onClose: () => setConflictModal(null),
      });
    }

    // 호출자에게 결과 throw (handleShare 등이 catch)
    if (failed.length > 0 || conflicts.length > 0) {
      const err = new Error(`save partial: ${failed.length} failed, ${conflicts.length} conflicts`);
      err.failed = failed; err.conflicts = conflicts;
      throw err;
    }
  }, [blocks, anal, diffs, scriptEdits, blockDeletions, reviewData, hl, hlStats, hlVerdicts, hlEdits, hlMarkers, exportCache, cfg, fn, authUser]);

  // ── 자동 KV 저장 (큰 작업 완료 시 호출) ──
  // overrideData: setState 직후 아직 렌더링 전일 때 최신 데이터를 직접 전달
  //   예: autoSaveToKV({ diffs: ad }) → correction 탭에 ad를 직접 사용
  const autoSaveToKV = useCallback(async (overrideData = {}) => {
    if (cfg.apiMode === "mock") return;
    // CMS v2 — A-1: 락(promise) — 진행 중이면 대기 후 실행 (skip 안 함)
    return withSaveLock(async () => {
      savingInProgress.current = true;
      try {
        const id = sessionIdRef.current;
        if (!id) { console.warn("[save-flow] auto-save skip: no session id"); return; }
        const overrides = {};
        if (overrideData.diffs !== undefined || overrideData.blocks !== undefined) {
          overrides.correction = { blocks: overrideData.blocks || blocks, anal: overrideData.anal || anal, diffs: overrideData.diffs || diffs, scriptEdits: overrideData.scriptEdits || scriptEdits, blockDeletions: overrideData.blockDeletions || blockDeletions };
          dirtyTabs.current.add("correction");
        }
        if (overrideData.hl !== undefined) {
          overrides.guide = { hl: overrideData.hl || hl, hlStats: overrideData.hlStats || hlStats, hlVerdicts: overrideData.hlVerdicts || hlVerdicts, hlEdits: overrideData.hlEdits || hlEdits, hlMarkers: overrideData.hlMarkers || hlMarkers };
          dirtyTabs.current.add("guide");
        }
        if (overrideData.reviewData !== undefined) {
          overrides.review = overrideData.reviewData;
          dirtyTabs.current.add("review");
        }
        await saveDirtyTabsToKV(id, overrides);
        updateStepProgress(tab);
      } catch (e) {
        console.warn("[save-flow] auto-save failed:", e.message);
      } finally {
        savingInProgress.current = false;
      }
    });
  }, [cfg, saveDirtyTabsToKV, blocks, anal, diffs, scriptEdits, blockDeletions, hl, hlStats, hlVerdicts, hlEdits, hlMarkers, tab, updateStepProgress, withSaveLock]);

  // ── 3분 디바운스 자동 저장 (변경 감지 → 3분 후 dirty 탭만 저장) ──
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);

  useEffect(() => {
    console.log("[r3-diag] autoSave useEffect run");
    if (cfg.apiMode === "mock" || !cfg.workerUrl) { console.log("[r3-diag] autoSave skipped: mock/no-workerUrl"); return; }
    if (!blocks || blocks.length === 0) { console.log("[r3-diag] autoSave skipped: blocks empty"); return; }
    // R3.b — 자식 탭 (exportCache) 도 변경 감지 영역 포함. 헌장 §5 (11 탭 동등 dirty 감지).
    const currentSnapshot = JSON.stringify({ blocks, anal, diffs, hl, hlStats, hlVerdicts, hlEdits, hlMarkers, scriptEdits, blockDeletions, reviewData, fn, exportCache });
    if (currentSnapshot === lastSavedSnapshot) { console.log("[r3-diag] autoSave skipped: snapshot unchanged"); return; }

    console.log("[r3-diag] autoSave timer scheduled (30s), dirtyTabs=[" + [...dirtyTabs.current].join(",") + "]");
    setAutoSaveStatus("pending");
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);

    autoSaveTimer.current = setTimeout(async () => {
      console.log("[r3-diag] autoSave timer FIRED, dirtyTabs=[" + [...dirtyTabs.current].join(",") + "]");
      const curId = sessionIdRef.current;
      if (!curId) { console.log("[r3-diag] autoSave fire skipped: no sessionId"); setAutoSaveStatus(""); return; }
      if (dirtyTabs.current.size === 0) { console.log("[r3-diag] autoSave fire skipped: dirty empty"); setAutoSaveStatus(""); return; }
      // CMS v2 — A-1: 락(promise) — 진행 중이면 대기 후 실행
      setAutoSaveStatus("saving");
      try {
        await withSaveLock(async () => {
          savingInProgress.current = true;
          try {
            await saveDirtyTabsToKV(curId);
            setLastSavedSnapshot(currentSnapshot);
            setAutoSaveStatus("saved");
            updateStepProgress(tab);
            setTimeout(() => setAutoSaveStatus(""), 3000);
          } finally { savingInProgress.current = false; }
        });
      } catch (e) {
        console.warn("[save-flow] debounce auto-save failed:", e.message);
        setAutoSaveStatus("");
      }
    }, 30 * 1000); // CMS v2: 30초 (묶음 ② A-1, 3분 → 30초)

    return () => {
      if (autoSaveTimer.current) {
        console.log("[r3-diag] autoSave cleanup (timer cleared before fire)");
        clearTimeout(autoSaveTimer.current);
      }
    };
    // R3.b — exportCache 추가 (자식 탭 변경 시 useEffect 재실행 → 30s timer fire). 헌장 §5/§3 정합.
  }, [blocks, anal, diffs, hl, hlStats, hlVerdicts, hlEdits, hlMarkers, scriptEdits, blockDeletions, reviewData, fn, exportCache, lastSavedSnapshot, cfg]);

  // CMS v2 — pagehide sendBeacon (묶음 ② A-2, TAB-MOD-01 모범 차용)
  useEffect(() => {
    const onPageHide = () => {
      const id = sessionIdRef.current;
      if (!id || dirtyTabs.current.size === 0 || cfg.apiMode === "mock" || !cfg.workerUrl) return;
      try {
        // dirty 탭 모두 sendBeacon (비동기 / 보장 발사)
        // R3.b — 11 탭 모두 dispatch (헌장 §5 11 탭 동등 / 가치 1 무손실 W4 보강).
        // 본 단계 전까지 자식 탭 (setgen/visual/modify/metadata/manuscript/subtitle) 누락 → 페이지 닫기 시 직접 손실.
        const payloads = {};
        if (dirtyTabs.current.has("correction")) payloads.correction = { blocks, anal, diffs, scriptEdits, blockDeletions };
        if (dirtyTabs.current.has("review")) payloads.review = reviewData || {};
        if (dirtyTabs.current.has("guide")) payloads.guide = { hl, hlStats, hlVerdicts, hlEdits, hlMarkers };
        if (dirtyTabs.current.has("highlight") && exportCache.highlight) payloads.highlight = exportCache.highlight;
        if (dirtyTabs.current.has("setgen") && exportCache.setgen) payloads.setgen = exportCache.setgen;
        if (dirtyTabs.current.has("visual") && exportCache.visual) payloads.visual = exportCache.visual;
        if (dirtyTabs.current.has("modify") && exportCache.modify) payloads.modify = exportCache.modify;
        if (dirtyTabs.current.has("metadata") && exportCache.metadata) payloads.metadata = exportCache.metadata;
        if (dirtyTabs.current.has("manuscript") && exportCache.manuscript) payloads.manuscript = exportCache.manuscript;
        if (dirtyTabs.current.has("subtitle") && exportCache.subtitle) payloads.subtitle = exportCache.subtitle;
        for (const [tab, data] of Object.entries(payloads)) {
          const body = JSON.stringify({ id, tab, data, fn });
          const blob = new Blob([body], { type: "application/json" });
          navigator.sendBeacon(`${cfg.workerUrl}/save`, blob);
        }
      } catch (e) {
        console.warn("[save-flow] pagehide flush failed:", e?.message || e);
      }
    };
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, [blocks, anal, diffs, scriptEdits, blockDeletions, reviewData, hl, hlStats, hlVerdicts, hlEdits, hlMarkers, exportCache, fn, cfg]);

  const handleShare = useCallback(async () => {
    // CMS v2 — A-1: 락(promise) — 자동저장 진행 중이면 skip 대신 대기 후 실행
    setSaving(true); setErr(null);
    try {
      await withSaveLock(async () => {
        savingInProgress.current = true;
        try {
          const id = sessionIdRef.current;
          if (!id) { setErr("프로젝트 ID가 없습니다. 대시보드에서 프로젝트를 선택해주세요."); return; }
          await saveDirtyTabsToKV(id, {}, { manual: true });
          const url = `${window.location.origin}${window.location.pathname}?s=${id}`;
          setShareUrl(url);
          // R3.b — autoSave 의 currentSnapshot 형식과 일치 (exportCache 포함). 헌장 §5 (11 탭 동등).
          setLastSavedSnapshot(JSON.stringify({ blocks, anal, diffs, hl, hlStats, hlVerdicts, hlEdits, hlMarkers, scriptEdits, blockDeletions, reviewData, fn, exportCache }));
          if (autoSaveTimer.current) { clearTimeout(autoSaveTimer.current); setAutoSaveStatus(""); }
        } finally { savingInProgress.current = false; }
      });
    } catch (e) {
      if (!e.failed && !e.conflicts) setErr(e.message);
    }
    finally { setSaving(false); }
    // R3.b — handleShare deps 에 exportCache 추가 (lastSavedSnapshot 형식 일관성 + 최신 capture).
  }, [blocks, anal, diffs, hl, hlStats, hlVerdicts, hlEdits, hlMarkers, scriptEdits, blockDeletions, reviewData, fn, exportCache, cfg, saveDirtyTabsToKV, withSaveLock]);

  // ── 내보내기 ──
  const handleExport = useCallback(async () => {
    // exportCache에 빠진 탭 데이터가 있으면 KV에서 가져옴
    let cache = { ...exportCache };
    if (sessionId && cfg?.workerUrl) {
      // CMS v2 — meta.stages 기반 조건부 load (404 다발 제거)
      let stages = {};
      try {
        const meta = await apiLoadMeta(sessionId, cfg);
        stages = meta?.stages || {};
      } catch {}
      const candidates = ["visual", "highlight", "setgen", "modify"].filter(t => !cache[t]);
      const missing = candidates.filter(t => stages[t]);
      if (missing.length > 0) {
        const results = await Promise.allSettled(
          missing.map(t => apiLoadTab(sessionId, t, cfg))
        );
        results.forEach((r, i) => {
          if (r.status === "fulfilled" && r.value) {
            cache[missing[i]] = r.value.data || r.value; // data.data (레거시) 또는 직접
          }
        });
        setExportCache(cache);
      }
    }
    const data = {
      filename: fn,
      exportedAt: new Date().toISOString(),
      blocks, diffs, anal, hl, hlVerdicts, hlEdits, hlMarkers, scriptEdits, blockDeletions, reviewData,
      exportCache: cache,
    };
    const html = generateExportHTML(data);
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fn || "편집가이드"}_${new Date().toISOString().slice(0,10)}.html`;
    a.click();
    URL.revokeObjectURL(url);
  }, [fn, blocks, diffs, anal, hl, hlVerdicts, hlEdits, hlMarkers, scriptEdits, blockDeletions, reviewData, exportCache, sessionId, cfg]);

  // 새 파일 시작
  const handleReset = useCallback(() => {
    localStorage.removeItem("te_session");
    if (autoSaveTimer.current) { clearTimeout(autoSaveTimer.current); autoSaveTimer.current = null; }
    setAutoSaveStatus(""); setLastSavedSnapshot("");
    setBlocks([]); setAnal(null); setDiffs([]); setHl([]); setHlStats(null); setHlVerdicts({}); setHlEdits({}); setHlMarkers({}); setScriptEdits({}); setBlockDeletions({}); setReviewData(null);
    setFn(""); setTab("correction"); setGReady(false); setBookmark(null); setExportCache({});
    setTermReview(false); setReadOnly(false); setSessionId(null); sessionIdRef.current = null;
    window.history.replaceState({}, "", window.location.pathname);
  }, []);

  // Process file — analyze only, then pause for term review
  const handleFile = useCallback(async(text,name)=>{
    // CMS v2 — N4: 재업로드 confirm + W-2 백업 (이미 작업 중인 데이터 보호)
    if (blocks.length > 0 || diffs.length > 0 || hl.length > 0 || reviewData) {
      const ok = window.confirm(
        `이미 편집 중인 작업이 있습니다.\n\n새 원고를 업로드하면 현재 작업이 덮어씌워집니다.\n\n계속하시겠습니까?\n\n(현재 작업은 백업 파일로 자동 저장됩니다.)`
      );
      if (!ok) return;
      // 현재 작업 백업 (manuscript_replace 타입)
      try {
        createEmergencyBackup({
          type: "manuscript_replace",
          sessionId: sessionId || "draft",
          fn,
          payload: { blocks, anal, diffs, hl, hlStats, hlVerdicts, hlEdits, hlMarkers, scriptEdits, blockDeletions, reviewData, exportCache },
          reason: `manuscript replace: ${fn || "(이전)"} → ${name}`,
        });
      } catch (e) { console.warn("[backup] manuscript_replace 백업 실패:", e?.message); }
    }
    setFn(name); setBusy(true); setErr(null); setDiffs([]); setHl([]); setHlStats(null); setGReady(false);
    setTermReview(false); setTab("correction");
    try {
      setProg({p:5,l:"텍스트 파싱 중..."});
      const parsed = parseBlocks(text); setBlocks(parsed);
      setProg({p:20,l:"단어장 동기화 중..."});
      // 서버에서 팀 공유 단어장 불러오기 (정답형 문자열 배열) — analyze 전에 로드
      const dict = await syncDictionaryFromServer(cfg);
      const dictNormalized = dict.map(t => typeof t === "string" ? t : t.correct || t.wrong).filter(Boolean);
      setProg({p:40,l:"Step 0: 사전 분석 중..."});
      const ft = parsed.map(b=>`${b.speaker} ${b.timestamp}\n${b.text}`).join("\n\n");
      // 화자명 라인에서 고유 화자명 추출 (사람이 입력한 ground truth)
      const speakerNames = [...new Set(parsed.map(b => b.speaker).filter(s => s && s !== "—"))];
      const speakerHint = speakerNames.length > 0
        ? `\n\n[화자명 라인에서 추출한 정확한 화자명 목록: ${speakerNames.join(", ")}]\n이 이름들은 사람이 직접 입력한 것이므로 정답 기준입니다. 본문 속에서 이와 다르게 표기된 이름은 STT 오인식으로 판단하세요.\n`
        : "";
      const a = await apiAnalyze(speakerHint + ft, cfg, dictNormalized); setAnal(a);
      // 메타데이터 저장 (하이라이트/세트 탭에서 활용)
      if (sessionIdRef.current) {
        const metadata = {
          interviewee: a.speakers?.[0] ? `${a.speakers[0].name} ${a.speakers[0].role || ""}`.trim() : "",
          topic: a.overview?.topic || "",
          keywords: a.overview?.keywords || [],
          speakers: a.speakers || [],
          genre: a.genre || null,
        };
        // CMS v2 — metadata 도 saveDirtyTabsToKV 통과 (충돌 감지/모달/4중 백업)
        setExportCache(prev => ({ ...prev, metadata }));
        dirtyTabs.current.add("metadata");
        saveDirtyTabsToKV(sessionIdRef.current, { metadata }).catch(() => {});
      }
      const newTerms = a.term_corrections || [];
      // Step 0 term_corrections 중 단어장에 이미 있는 항목 제외
      // 정규화 비교: 대소문자 무시 + wrong/correct 양쪽 모두 체크
      const dictLower = new Set(dictNormalized.map(w => w.toLowerCase()));
      const filteredTerms = newTerms.filter(t => {
        const correctLower = (t.correct || "").toLowerCase();
        const wrongLower = (t.wrong || "").toLowerCase();
        // correct 또는 wrong이 단어장에 있으면 이미 처리된 것 → 제외
        return !dictLower.has(correctLower) && !dictLower.has(wrongLower);
      });
      setPendingTerms(filteredTerms);
      setProg({p:100,l:`✅ 사전 분석 완료 (단어장 ${dictNormalized.length}건 + 신규 후보 ${filteredTerms.length}건)`});
      setTermReview(true);
    } catch(e) { setErr(e.message); setProg({p:0,l:""}); }
    finally { setBusy(false); }
  },[cfg]);

  // Run correction with user-approved terms (v4 통합 교정)
  const handleCorrectStart = useCallback(async(approvedTerms)=>{
    setTermReview(false);
    // 확정된 용어를 단어장에 자동 저장 (correct 값만)
    const added = await updateDictionary(approvedTerms, cfg);
    if (added > 0) console.log(`📚 단어장에 ${added}건 추가됨 (총 ${loadDictionary().length}건)`);
    // 단어장 정답 목록도 analysis에 포함 (Worker 프롬프트에서 사용)
    const dict = loadDictionary();
    const dictWords = dict.map(t => typeof t === "string" ? t : t.correct || t.wrong).filter(Boolean);
    const approvedAnal = { ...anal, term_corrections: approvedTerms, dictionary_words: dictWords };
    setAnal(approvedAnal);
    setBusy(true); setErr(null);
    try {
      // ── 통합 교정: 필러 + 용어 + 맞춤법 + 구어체 (단일 루프) ──
      const chs = splitChunks(blocks, cfg.chunkSize); const ad = [];
      for(let i=0;i<chs.length;i++){
        const pct = 5 + Math.round(i/chs.length * 90);
        setProg({p:pct, l:`1차 교정: 청크 ${i+1}/${chs.length} 교정 중...`});
        const res = await apiCorrect(chunkToText(chs[i]),i,chs.length,approvedAnal,chunkCtx(chs[i]),cfg);
        if(res.chunks) ad.push(...res.chunks);
        if(cfg.apiMode==="live"&&i<chs.length-1) await delay(1000);
      }

      setDiffs(ad); setProg({p:100,l:"✅ 1차 교정 완료"});
      // 자동 KV 저장 (1차 교정 완료)
      autoSaveToKV({ diffs: ad });
    } catch(e) { setErr(e.message); setProg({p:0,l:""}); }
    finally { setBusy(false); }
  },[anal, blocks, cfg, autoSaveToKV]);

  // ── 용어 설명 AI 생성 (Gemini 2.5 Flash — 프론트엔드 직접 호출) ──
  const handleTermGen = useCallback(async () => {
    const term = addForm.termInput?.trim();
    if (!term) return;
    if (cfg.apiMode === "mock") {
      setAddForm(f => ({...f, subtitle: `${term}(Term) : 이것은 Mock 용어 설명입니다.`}));
      return;
    }
    if (!cfg.workerUrl) {
      setErr("설정에서 Worker URL을 입력해주세요.");
      return;
    }
    setAddForm(f => ({...f, generating: true}));
    try {
      const block = blocks.find(b => b.index === addingAt);
      const context = block ? block.text.substring(0, 500) : "";

      const d = await apiCall("term-explain", { term, context }, cfg);
      if (d.result?.explanation) {
        setAddForm(f => ({...f, subtitle: d.result.explanation, generating: false}));
      } else {
        setAddForm(f => ({...f, generating: false}));
      }
    } catch (e) {
      setErr(e.message);
      setAddForm(f => ({...f, generating: false}));
    }
  }, [addForm.termInput, addingAt, blocks, cfg]);

  // ── 수동 자막 추가 ──
  const handleAddSubtitle = useCallback(() => {
    if (addingAt === null || !addForm.subtitle.trim()) return;
    const block = blocks.find(b => b.index === addingAt);
    const newItem = {
      block_index: addingAt,
      speaker: block?.speaker || "—",
      source_text: "",
      subtitle: addForm.subtitle.trim(),
      type: addForm.type,
      type_name: addForm.type === "B2" ? "용어 설명형" : addForm.type === "C1" ? "추가 삭제" : "수동 추가",
      reason: "편집자 수동 추가",
      placement_hint: null,
      sequence_id: null,
      _manual: true, // 수동 추가 표시
    };
    setHl(prev => [...prev, newItem]);
    // 자동으로 '사용' 판정
    setHlVerdicts(prev => ({...prev, [`${newItem.block_index}-${newItem.subtitle}`]: "use"}));
    setAddingAt(null);
    setAddForm({ subtitle: "", type: "A1" });
  }, [addingAt, addForm, blocks]);

  // ── 삭제선 적용 헬퍼 ──
  const applyDeletions = useCallback((text, dels) => {
    if (!dels || dels.length === 0) return text;
    const sorted = [...dels].sort((a, b) => b.s - a.s); // reverse order to not shift indices
    let result = text;
    for (const d of sorted) {
      result = result.slice(0, d.s) + result.slice(d.e);
    }
    return result;
  }, []);

  // ── 교정된 스크립트/블록 (탭 공유용 useMemo) ── handleGuide보다 앞에 선언 필수
  const correctedScript = useMemo(() => {
    if (blocks.length === 0) return "";
    return blocks.map(b => {
      const se = scriptEdits[b.index];
      let text = se !== undefined ? se : getCorrectedText(b.text, diffs.filter(d => d.blockIndex === b.index));
      text = applyDeletions(text, blockDeletions[b.index]);
      return text;
    }).join("\n");
  }, [blocks, diffs, scriptEdits, blockDeletions, applyDeletions]);

  // scriptEdits(수동 수정) + blockDeletions(추가 삭제선) 반영 — correctedScript와 동일한 규칙
  const correctedBlocks = useMemo(() =>
    blocks.map(b => {
      const se = scriptEdits[b.index];
      let text = se !== undefined ? se : getCorrectedText(b.text, diffs.filter(d => d.blockIndex === b.index));
      text = applyDeletions(text, blockDeletions[b.index]);
      return { id: b.index, speaker: b.speaker, time: b.timestamp, text };
    }),
    [blocks, diffs, scriptEdits, blockDeletions, applyDeletions]);

  const correctedBlocksFull = useMemo(() =>
    blocks.map(b => {
      const se = scriptEdits[b.index];
      let text = se !== undefined ? se : getCorrectedText(b.text, diffs.filter(d => d.blockIndex === b.index));
      text = applyDeletions(text, blockDeletions[b.index]);
      return { index: b.index, speaker: b.speaker, timestamp: b.timestamp, text };
    }),
    [blocks, diffs, scriptEdits, blockDeletions, applyDeletions]);

  // Generate guide — 2-Pass: Draft → Editor (청크 분할 지원)
  const handleGuide = useCallback(async()=>{
    setGBusy(true); setErr(null); setTab("guide");
    try {
      // ── 청크 분할: 40,000자 기준, 오버랩 5블록 ──
      const HIGHLIGHT_CHUNK_SIZE = 40000;
      const OVERLAP_BLOCKS = 5;

      const hlChunks = [];
      let currentChunk = [];
      let currentLen = 0;
      for (const b of correctedBlocksFull) {
        if (currentLen + b.text.length > HIGHLIGHT_CHUNK_SIZE && currentChunk.length > 0) {
          hlChunks.push(currentChunk);
          // 오버랩: 마지막 5블록을 다음 청크에 포함 (맥락 연결)
          const overlap = currentChunk.slice(-OVERLAP_BLOCKS);
          currentChunk = [...overlap];
          currentLen = overlap.reduce((s, x) => s + x.text.length, 0);
        }
        currentChunk.push(b);
        currentLen += b.text.length;
      }
      if (currentChunk.length > 0) hlChunks.push(currentChunk);

      const totalChunks = hlChunks.length;
      const isSingleChunk = totalChunks === 1;

      // ── Pass 1: Draft Agent (청크별 순차 호출) ──
      let allDraftHighlights = [];
      for (let ci = 0; ci < totalChunks; ci++) {
        const chunkLabel = isSingleChunk ? "" : ` (청크 ${ci+1}/${totalChunks})`;
        const pct = 5 + Math.round((ci / totalChunks) * 35);
        setProg({p: pct, l: `Pass 1: 강조자막 후보 생성 중${chunkLabel} (Draft Agent)...`});

        const draftResult = await apiHighlightsDraft(
          hlChunks[ci], anal, cfg,
          isSingleChunk ? undefined : ci,
          isSingleChunk ? undefined : totalChunks
        );
        const chunkHighlights = draftResult.highlights || [];
        allDraftHighlights.push(...chunkHighlights);

        // 청크 간 Rate limit 보호
        if (cfg.apiMode === "live" && ci < totalChunks - 1) {
          setProg({p: pct + 2, l: `청크 간 대기 중... ☕`});
          await delay(5000);
        }
      }

      // 오버랩 구간 중복 제거 (같은 block_index의 자막이 여러 청크에서 생성될 수 있음)
      if (!isSingleChunk) {
        const seen = new Set();
        allDraftHighlights = allDraftHighlights.filter(h => {
          const key = `${h.block_index}-${h.subtitle}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      }

      setProg({p: 42, l: `Draft 완료: ${allDraftHighlights.length}건 후보 생성`});

      // Rate limit 보호 대기
      if (cfg.apiMode === "live") {
        setProg({p: 45, l: "API 한도 보호를 위해 잠시 대기 중 (약 15초)... ☕"});
        await delay(15000);
      }

      // ── Pass 2: Editor Agent (청크별 순차 호출) ──
      let allFinalHighlights = [];
      let allRemoved = [];
      let totalDraftCount = allDraftHighlights.length;

      if (isSingleChunk) {
        // 단일 청크: 한 번에 Editor 호출
        setProg({p: 55, l: "Pass 2: 강조자막 검증·선별 중 (Editor Agent)..."});
        const editResult = await apiHighlightsEdit(correctedBlocksFull, anal, allDraftHighlights, cfg);
        allFinalHighlights = editResult.highlights || [];
        allRemoved = editResult.removed || [];
      } else {
        // 다중 청크: 각 청크의 Draft 결과를 해당 청크 원문과 함께 Editor에 전달
        for (let ci = 0; ci < totalChunks; ci++) {
          const pct = 50 + Math.round((ci / totalChunks) * 40);
          setProg({p: pct, l: `Pass 2: 검증·선별 중 (청크 ${ci+1}/${totalChunks}) (Editor Agent)...`});

          // 이 청크에 해당하는 block_index 범위의 Draft 결과만 추출
          const chunkBlockIndices = new Set(hlChunks[ci].map(b => b.index));
          const chunkDrafts = allDraftHighlights.filter(h => chunkBlockIndices.has(h.block_index));

          if (chunkDrafts.length === 0) continue; // Draft 결과가 없는 청크는 스킵

          const editResult = await apiHighlightsEdit(
            hlChunks[ci], anal, chunkDrafts, cfg, ci, totalChunks
          );
          allFinalHighlights.push(...(editResult.highlights || []));
          allRemoved.push(...(editResult.removed || []));

          if (cfg.apiMode === "live" && ci < totalChunks - 1) {
            setProg({p: pct + 2, l: `청크 간 대기 중... ☕`});
            await delay(5000);
          }
        }

        // Editor 결과도 오버랩 중복 제거
        const seenFinal = new Set();
        allFinalHighlights = allFinalHighlights.filter(h => {
          const key = `${h.block_index}-${h.subtitle}`;
          if (seenFinal.has(key)) return false;
          seenFinal.add(key);
          return true;
        });
      }

      const finalStats = {
        draft_count: totalDraftCount,
        final_count: allFinalHighlights.length,
        removal_rate: `${Math.round((1 - allFinalHighlights.length / Math.max(totalDraftCount, 1)) * 100)}%`,
      };
      setHl(allFinalHighlights);
      setHlStats(finalStats);

      setProg({p:100,l:`✅ 편집 가이드 완료 (2-Pass${isSingleChunk ? "" : `, ${totalChunks}청크`})`}); setGReady(true);
      // 자동 KV 저장 (편집 가이드 완료)
      autoSaveToKV({ hl: allFinalHighlights, hlStats: finalStats });
    } catch(e) { setErr(e.message); }
    finally { setGBusy(false); }
  },[blocks,correctedBlocksFull,anal,cfg,autoSaveToKV]);

  // ── 부분 강조자막 생성 (텍스트 드래그 → 해당 블록만 생성) ──
  const handlePartialGenerate = useCallback(async (blockIdx, selectedText) => {
    setPartialBusy(true); setErr(null); setSelPopup(null);
    try {
      // 앞뒤 3블록 컨텍스트 포함
      const ctxRange = 3;
      const startIdx = Math.max(0, blockIdx - ctxRange);
      const endIdx = Math.min(blocks.length - 1, blockIdx + ctxRange);
      const contextBlocks = blocks.slice(startIdx, endIdx + 1);
      const targetIndices = [blockIdx];

      // 최대 3개 자막
      const maxItems = 3;

      const body = {
        mode: "draft",
        blocks: contextBlocks,
        analysis: anal,
        target_block_indices: targetIndices,
        max_items: maxItems,
        selected_text: selectedText,
      };

      const d = await apiCall("highlights", body, cfg);
      const partialHl = d?.result?.highlights || [];

      if (partialHl.length > 0) {
        // 타겟 블록 결과만 필터 + 상한 적용
        const filtered = partialHl
          .filter(h => targetIndices.includes(h.block_index))
          .slice(0, maxItems);
        // 수동 생성 표시 추가
        const marked = filtered.map(h => ({ ...h, _manual: true }));
        setHl(prev => [...prev, ...marked]);
      } else {
        setErr("이 구간에서 강조자막 후보를 찾지 못했습니다.");
      }
    } catch (e) {
      setErr(`부분 생성 오류: ${e.message}`);
    } finally {
      setPartialBusy(false);
    }
  }, [blocks, anal, cfg]);

  const dm = useMemo(()=>{ const m={}; for(const d of diffs) { if(!m[d.block_index]) m[d.block_index]=[]; m[d.block_index].push(...d.changes); } return m; },[diffs]);

  const guides = useMemo(()=>{
    return [...hl].sort((a,b) => (a.block_index||0) - (b.block_index||0));
  },[hl]);

  const fC = diffs.reduce((s,d)=>s+d.changes.filter(c=>c.type==="filler_removal").length,0);
  const tC = diffs.reduce((s,d)=>s+d.changes.filter(c=>c.type==="term_correction").length,0);
  const sC = diffs.reduce((s,d)=>s+d.changes.filter(c=>c.type==="spelling").length,0);
  const hasData = blocks.length>0&&!busy;

  // ── 형광펜 마커 추가 핸들러 ──
  const handleMarkerAdd = useCallback((key, color, blockIdx, s, e) => {
    setHlMarkers(prev => {
      const existing = prev[key] || { color, ranges: [] };
      // 색상이 바뀌면 기존 범위 초기화
      const prevRanges = existing.color === color ? existing.ranges : [];
      // 새 범위가 기존 범위와 겹치면 병합
      const newRanges = [...prevRanges];
      let merged = false;
      for (let i = 0; i < newRanges.length; i++) {
        const r = newRanges[i];
        if (r.blockIdx === blockIdx && !(e <= r.s || s >= r.e)) {
          // 겹침 → 확장
          newRanges[i] = { blockIdx, s: Math.min(s, r.s), e: Math.max(e, r.e) };
          merged = true;
          break;
        }
      }
      if (!merged) newRanges.push({ blockIdx, s, e });
      return { ...prev, [key]: { color, ranges: newRanges } };
    });
  }, []);

  // 형광펜 삭제 (특정 자막의 모든 마커 제거)
  const handleMarkerClear = useCallback((key) => {
    setHlMarkers(prev => { const n = { ...prev }; delete n[key]; return n; });
  }, []);

  // file upload handler for docx
  const onFileUpload = useCallback(async(file)=>{
    if(!file) return;
    if(file.name.endsWith(".docx")){
      const buf = await file.arrayBuffer();
      // 먼저 삭제선(변경 추적) 감지 시도
      try {
        const tcResult = await parseDocxWithTrackChanges(buf.slice(0)); // arrayBuffer 복사
        if (tcResult.hasTrackChanges) {
          // 삭제선이 있으면 0차 탭으로 이동
          setFn(file.name);
          const cleanText = tcResult.cleanText;
          const reviewBlocks = parseBlocks(tcResult.fullText);

          // paragraphs → charMap: fullText의 각 문자에 대한 deleted 여부
          const charMap = [];
          for (let pi = 0; pi < tcResult.paragraphs.length; pi++) {
            for (const seg of tcResult.paragraphs[pi]) {
              for (let ci = 0; ci < seg.text.length; ci++) {
                charMap.push(seg.deleted);
              }
            }
            if (pi < tcResult.paragraphs.length - 1) charMap.push(false); // \n
          }

          // 각 블록의 fullText 내 위치를 찾아 삭제 구간 추출
          const fullText = tcResult.fullText;
          const blockStrikeRanges = {}; // { blockIndex: [{s, e}] }
          const deletedBlockIndices = new Set();
          let searchFrom = 0;

          for (const rb of reviewBlocks) {
            const blockStart = fullText.indexOf(rb.text, searchFrom);
            if (blockStart === -1) continue;
            searchFrom = blockStart + rb.text.length;

            // 블록 텍스트 범위에서 삭제된 문자 구간 추출
            const ranges = [];
            let rangeStart = -1;
            let deletedCount = 0;
            for (let ci = 0; ci < rb.text.length; ci++) {
              const isDel = (blockStart + ci) < charMap.length && charMap[blockStart + ci];
              if (isDel) {
                deletedCount++;
                if (rangeStart === -1) rangeStart = ci;
              } else {
                if (rangeStart !== -1) { ranges.push({ s: rangeStart, e: ci }); rangeStart = -1; }
              }
            }
            if (rangeStart !== -1) ranges.push({ s: rangeStart, e: rb.text.length });

            if (ranges.length > 0) blockStrikeRanges[rb.index] = ranges;
            // 블록 텍스트의 80% 이상이 삭제되면 블록 전체 삭제로 판정
            const textLen = rb.text.replace(/\s/g, "").length;
            if (textLen > 0 && deletedCount >= textLen * 0.8) deletedBlockIndices.add(rb.index);
          }

          const duration = calcDuration(reviewBlocks, deletedBlockIndices);
          const cleanTextChars = cleanText.length;
          setReviewData({ hasTrackChanges: true, deletedBlockIndices: [...deletedBlockIndices], blockStrikeRanges, duration, reviewBlocks, cleanTextChars, paragraphs: tcResult.paragraphs, cleanText });
          // blocks는 cleanText 기준 — 0차 review는 reviewData.paragraphs로 독립 렌더
          setBlocks(parseBlocks(cleanText));
          setTab("review");
          setDiffs([]); setHl([]); setHlStats(null); setGReady(false); setTermReview(false);
          return;
        }
      } catch (e) {
        console.warn("삭제선 파싱 실패, mammoth fallback:", e.message);
      }
      // 삭제선 없어도 0차 원고검토로 이동 (mammoth 텍스트 추출 후)
      const res = await mammoth.extractRawText({arrayBuffer:buf});
      const plainText = res.value;
      const reviewBlocks = parseBlocks(plainText);
      const duration = calcDuration(reviewBlocks);
      const paragraphs = plainText.split('\n').map(line => [{ text: line, deleted: false }]);
      setFn(file.name);
      setReviewData({ hasTrackChanges: false, deletedBlockIndices: [], blockStrikeRanges: {}, duration, reviewBlocks, cleanTextChars: plainText.length, paragraphs, cleanText: plainText });
      setBlocks(reviewBlocks);
      setTab("review");
      setDiffs([]); setHl([]); setHlStats(null); setGReady(false); setTermReview(false);
    } else {
      const text = await file.text();
      const reviewBlocks = parseBlocks(text);
      const duration = calcDuration(reviewBlocks);
      const paragraphs = text.split('\n').map(line => [{ text: line, deleted: false }]);
      setFn(file.name);
      setReviewData({ hasTrackChanges: false, deletedBlockIndices: [], blockStrikeRanges: {}, duration, reviewBlocks, cleanTextChars: text.length, paragraphs, cleanText: text });
      setBlocks(reviewBlocks);
      setTab("review");
      setDiffs([]); setHl([]); setHlStats(null); setGReady(false); setTermReview(false);
    }
  },[handleFile]);

  const fileRef = useRef(null);
  const [drag,setDrag] = useState(false);

  return <div style={{height:"100vh",background:C.bg,color:C.tx,fontFamily:FN,display:"flex",flexDirection:"column"}}>
    {/* HEADER */}
    <header style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0 20px",height:52,
      borderBottom:`1px solid ${C.bd}`,background:C.sf,flexShrink:0}}>
      <div style={{display:"flex",alignItems:"center",gap:10}}>
        {onBackToDashboard && <button onClick={async () => {
          if (blocks.length > 0 && sessionIdRef.current) {
            try { await autoSaveToKV(); } catch {}
          }
          onBackToDashboard();
        }} style={{padding:"4px 10px",borderRadius:6,border:`1px solid ${C.bd}`,
          background:"transparent",color:C.txM,fontSize:12,cursor:"pointer",fontFamily:FN}}>← 프로젝트 목록</button>}
        <span style={{fontSize:18,fontWeight:800,letterSpacing:"-0.03em"}}>
          <span style={{color:C.ac}}>티타임즈</span> 편집 CMS
        </span>
        {fn && <span style={{fontSize:11,color:C.txD,padding:"2px 8px",background:"rgba(255,255,255,0.04)",borderRadius:4}}>{fn}</span>}
        <span style={{fontSize:10,padding:"2px 6px",borderRadius:3,fontWeight:600,
          background:cfg.apiMode==="live"?"rgba(34,197,94,0.15)":"rgba(251,191,36,0.15)",
          color:cfg.apiMode==="live"?C.ok:C.wn}}>{cfg.apiMode==="live"?"LIVE":"MOCK"}</span>
        {autoSaveStatus && <span style={{fontSize:11,color:autoSaveStatus==="saved"?C.ok:"#9CA3AF",padding:"3px 8px",borderRadius:6,
          background:autoSaveStatus==="saved"?"rgba(34,197,94,0.1)":"rgba(255,255,255,0.04)"}}>
          {autoSaveStatus==="pending"?"⏳ 자동 저장 대기":autoSaveStatus==="saving"?"💾 자동 저장 중...":"✓ 자동 저장됨"}
        </span>}
      </div>
      <div style={{display:"flex",alignItems:"center",gap:8}}>
        {readOnly && <span style={{fontSize:11,padding:"3px 10px",borderRadius:12,fontWeight:600,
          background:"rgba(168,85,247,0.15)",color:"#A855F7",border:"1px solid rgba(168,85,247,0.3)"}}>
          읽기 전용
        </span>}
        {(hasData||tab==="modify")&&!termReview && <div style={{display:"flex",gap:1,background:"rgba(255,255,255,0.04)",borderRadius:7,padding:2}}>
          {[["review","0차 검토"],["correction","1차 교정"],["script","스크립트"],["guide","편집 가이드"],["visual","자료·그래픽"],["modify","수정사항"],["highlight","하이라이트"],["setgen","세트"]].map(([id,l])=>
            <button key={id} onClick={()=>setTab(id)} style={{padding:"5px 10px",borderRadius:5,border:"none",cursor:"pointer",
              fontSize:11,fontWeight:tab===id?600:400,background:tab===id?C.ac:"transparent",
              color:tab===id?"#fff":C.txM,transition:"all 0.12s",whiteSpace:"nowrap",
              opacity:(id==="review"&&!reviewData)||(id!=="modify"&&!hasData)?0.4:1,
              pointerEvents:(id==="review"&&!reviewData)||(id!=="modify"&&!hasData)?"none":"auto"}}>{l}{id==="guide"&&gReady?" ✓":""}</button>)}
        </div>}
        {hasData && !readOnly && !termReview && (
          <button onClick={handleShare} disabled={saving} style={{padding:"5px 14px",borderRadius:6,border:"none",
            background:saving?"rgba(74,108,247,0.4)":`linear-gradient(135deg,#22C55E,#16A34A)`,
            color:"#fff",fontSize:12,fontWeight:600,cursor:saving?"not-allowed":"pointer"}}>
            {saving?"저장 중…":"💾 저장"}
          </button>
        )}
        {hasData && (
          <button onClick={handleExport} title="HTML로 내보내기" style={{padding:"5px 10px",borderRadius:6,
            border:`1px solid ${C.bd}`,background:"transparent",color:C.txM,fontSize:12,cursor:"pointer"}}>
            📥 내보내기
          </button>
        )}
        {!readOnly && <button onClick={()=>setShowSessions(true)} title="작업 히스토리"
          style={{padding:"5px 10px",borderRadius:6,border:`1px solid ${C.bd}`,
            background:"transparent",color:C.txM,fontSize:12,cursor:"pointer"}}>📋</button>}
        <button onClick={toggleTheme} title={theme==="dark"?"라이트 모드":"다크 모드"}
          style={{padding:"5px 10px",borderRadius:6,border:`1px solid ${C.bd}`,
            background:"transparent",color:C.txM,fontSize:12,cursor:"pointer"}}>{theme==="dark"?"☀️":"🌙"}</button>
        {!readOnly && <button onClick={()=>setShowSet(true)} style={{padding:"5px 10px",borderRadius:6,border:`1px solid ${C.bd}`,
          background:"transparent",color:C.txM,fontSize:12,cursor:"pointer"}}>⚙️</button>}
        <span style={{fontSize:11,color:C.txM,marginLeft:4}}>{authUser?.name||authUser?.email}</span>
        <button onClick={onLogout} style={{padding:"4px 10px",borderRadius:6,border:`1px solid ${C.bd}`,
          background:"transparent",color:C.txD,fontSize:11,cursor:"pointer",fontFamily:FN}}>로그아웃</button>
      </div>
    </header>

    {err && <div style={{padding:"10px 20px",background:"rgba(239,68,68,0.1)",borderBottom:"1px solid rgba(239,68,68,0.2)",
      fontSize:13,color:"#EF4444",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
      <span>⚠️ {err}</span>
      <button onClick={()=>setErr(null)} style={{background:"none",border:"none",color:"#EF4444",cursor:"pointer",fontSize:16}}>✕</button>
    </div>}

    {(busy||gBusy) && <div style={{padding:"0 20px",flexShrink:0}}><Progress pct={prog.p} label={prog.l}/></div>}
    {(busy||gBusy) && anal?.editorial_summary && <div style={{padding:"0 20px 12px",maxWidth:660,margin:"0 auto",width:"100%",overflowY:"auto",maxHeight:"calc(100vh - 180px)"}}>
      <EditorialSummaryPanel summary={anal.editorial_summary} collapsed={summaryCollapsed} onToggle={()=>setSummaryCollapsed(v=>!v)}/>
    </div>}

    <main style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      {/* TERM REVIEW */}
      {termReview && <TermReviewScreen
        terms={pendingTerms}
        analysis={anal}
        onConfirm={handleCorrectStart}
        onSkip={()=>handleCorrectStart([])}
      />}

      {/* EMPTY */}
      {!termReview&&!hasData&&!busy&&!readOnly && <div style={{padding:"40px 24px",maxWidth:520,margin:"0 auto",width:"100%"}}>
        <div onDragOver={e=>{e.preventDefault();setDrag(true)}} onDragLeave={()=>setDrag(false)}
          onDrop={e=>{e.preventDefault();setDrag(false);onFileUpload(e.dataTransfer.files[0])}}
          onClick={()=>fileRef.current?.click()}
          style={{border:`2px dashed ${drag?C.ac:C.bd}`,borderRadius:16,padding:"56px 32px",textAlign:"center",
            cursor:"pointer",background:drag?C.acS:"transparent",transition:"all 0.2s"}}>
          <div style={{fontSize:44,marginBottom:14,opacity:0.5}}>📄</div>
          <div style={{fontSize:16,fontWeight:600,color:C.tx,marginBottom:6}}>docx 또는 txt 파일을 드래그하거나 클릭</div>
          <div style={{fontSize:12,color:C.txD}}>클로바노트 STT 출력물 (.docx, .txt)</div>
          <input ref={fileRef} type="file" accept=".docx,.txt" style={{display:"none"}}
            onChange={e=>onFileUpload(e.target.files?.[0])}/>
        </div>
        <p style={{textAlign:"center",fontSize:13,color:C.txD,lineHeight:1.8,marginTop:16}}>
          파일 업로드 → 자동 사전 분석 + 필러 제거 + 용어 교정<br/>
          이후 편집 가이드에서 강조자막 생성 (v2 룰북 2-Pass)
        </p>
        <div style={{textAlign:"center",marginTop:24,paddingTop:16,borderTop:`1px solid ${C.bd}`}}>
          <button onClick={()=>setTab("modify")} style={{background:"transparent",border:`1px solid ${C.bd}`,borderRadius:8,
            padding:"10px 24px",cursor:"pointer",color:C.ac,fontSize:13,fontFamily:FN,fontWeight:500,transition:"all 0.15s"}}
            onMouseEnter={e=>e.currentTarget.style.borderColor=C.ac} onMouseLeave={e=>e.currentTarget.style.borderColor=C.bd}>
            🎬 원고 없이 영상 수정사항 작성하기</button>
        </div>
      </div>}

      {/* 0차: 원고 검토 (삭제선 표시 + 분량 계산) */}
      {/* R2.a — review 인라인 렌더 → ReviewTab 컴포넌트 추출. TabComponentInterface 따름. */}
      {!termReview && hasData && tab === "review" && reviewData && (
        <ReviewTab
          tabId="review"
          data={tabData.review}
          onSave={() => {}}                              /* read-only — 호출 X (인터페이스 통일성) */
          blocks={blocks}
          fn={fn}
          C={C}
          onAction={{
            onProceedToCorrection: () => {
              const ct = reviewData.cleanText || "";
              setTab("correction");
              handleFile(ct, fn);
            },
          }}
        />
      )}

      {/* 1차 교정 */}
      {/* R2.b — correction 인라인 렌더 → CorrectionTab 컴포넌트. TabComponentInterface 따름. */}
      {!termReview && hasData && tab === "correction" && (
        <CorrectionTab
          tabId="correction"
          data={tabData.correction}
          onSave={() => {}}        /* setState 가 자동 dirty 마킹 */
          blocks={blocks}
          dm={dm}
          scriptEdits={scriptEdits}
          blockDeletions={blockDeletions}
          aBlock={aBlock}
          fC={fC} tC={tC} sC={sC}
          applyDeletions={applyDeletions}
          scrollTo={scrollTo}
          setBlockDeletions={setBlockDeletions}
          setScriptEdits={setScriptEdits}
          setSubtitleCache={setSubtitleCache}
          setSubtitleResult={setSubtitleResult}
          lRef={lRef} rRef={rRef} bEls={bEls}
          C={C}
        />
      )}

      {/* 1.5단계: 스크립트 편집 */}
      {/* R2.c — script 인라인 렌더 → ScriptTab 컴포넌트. TabComponentInterface 따름.
          저장 영역 (setScriptEdits) / 툴 영역 (LLM apiCall + 자막 캐시 + 클립보드) 명확히 구분.
          결합 영역 1 곳 (ScriptEditBlock onSave 안 setScriptEdits + 캐시 무효화) 의도된 보존. */}
      {!termReview && hasData && tab === "script" && (
        <ScriptTab
          tabId="script"
          data={tabData.script}
          onSave={() => {}}
          blocks={blocks}
          dm={dm}
          scriptEdits={scriptEdits}
          blockDeletions={blockDeletions}
          fC={fC} tC={tC} sC={sC}
          applyDeletions={applyDeletions}
          setScriptEdits={setScriptEdits}
          subtitleCache={subtitleCache}
          subtitleResult={subtitleResult}
          setSubtitleCache={setSubtitleCache}
          setSubtitleResult={setSubtitleResult}
          apiCall={apiCall}
          cfg={cfg}
          C={C} FN={FN}
        />
      )}

      {/* 편집 가이드 — R2.d 추출 (헌장 v1.1 §5/§6 정식 충족) */}
      {!termReview&&hasData&&tab==="guide" && (
        <GuideTab
          tabId="guide"
          data={tabData?.guide}
          onSave={()=>{}}
          hl={hl} hlStats={hlStats} hlVerdicts={hlVerdicts} hlEdits={hlEdits} hlMarkers={hlMarkers}
          guides={guides}
          blocks={blocks} dm={dm} scriptEdits={scriptEdits} blockDeletions={blockDeletions} aBlock={aBlock}
          fC={fC} tC={tC}
          gReady={gReady} gBusy={gBusy} bookmark={bookmark} matchingMode={matchingMode}
          selPopup={selPopup} addingAt={addingAt} addForm={addForm} partialBusy={partialBusy}
          setHl={setHl} setHlVerdicts={setHlVerdicts} setHlEdits={setHlEdits} setHlMarkers={setHlMarkers}
          setGReady={setGReady} setBookmark={setBookmark} setMatchingMode={setMatchingMode}
          setSelPopup={setSelPopup} setAddingAt={setAddingAt} setAddForm={setAddForm} setTab={setTab}
          applyDeletions={applyDeletions} scrollTo={scrollTo}
          handleGuide={handleGuide} handlePartialGenerate={handlePartialGenerate}
          handleTermGen={handleTermGen} handleAddSubtitle={handleAddSubtitle}
          handleMarkerAdd={handleMarkerAdd} handleMarkerClear={handleMarkerClear}
          lRef={lRef} rRef={rRef} bEls={bEls}
          C={C}
        />
      )}

      {/* ── 하이라이트 탭 (display:none으로 state 유지) ── */}
      {!termReview&&hasData && <div style={{display: tab==="highlight" ? "contents" : "none"}}>
        <HighlightTab
          script={correctedScript}
          blocks={correctedBlocks}
          sessionId={sessionId}
          config={cfg}
          currentTab={tab}
          initialData={exportCache.highlight}
          onSave={(data) => {
            console.log("[r3-diag] highlight onSave called, keys=", data ? Object.keys(data) : "null");
            setExportCache(prev => ({ ...prev, highlight: data }));
          }}
        />
      </div>}

      {/* ── 세트 생성 탭 (display:none으로 state 유지) ── */}
      {!termReview&&hasData && <div style={{display: tab==="setgen" ? "contents" : "none"}}>
        <SetgenTab
          script={correctedScript}
          blocks={blocks}
          guestName={anal?.speakers?.[0]?.name?.split(" ")[0] || ""}
          guestTitle={anal?.speakers?.[0] ? `${anal.speakers[0].name} ${anal.speakers[0].role || ""}`.trim() : ""}
          sessionId={sessionId}
          config={cfg}
          keywords={anal?.overview?.keywords || []}
          currentTab={tab}
          initialData={exportCache.setgen}
          onSave={(data) => {
            // CMS v2 — 자식 → 부모 즉시 박제 (KV PUT 은 부모 자동저장 30초 디바운스가 처리).
            console.log("[r3-diag] setgen onSave called, keys=", data ? Object.keys(data) : "null");
            setExportCache(prev => ({ ...prev, setgen: data }));
            dirtyTabs.current.add("setgen");
          }}
        />
      </div>}

      {/* ── 자료 & 그래픽 탭 (display:none으로 state 유지) ── */}
      {!termReview&&hasData && <div style={{display: tab==="visual" ? "contents" : "none"}}>
        <VisualTab
          script={correctedScript}
          blocks={correctedBlocksFull}
          sessionId={sessionId}
          config={cfg}
          currentTab={tab}
          initialData={exportCache.visual}
          onSave={(data) => {
            // CMS v2 — 자식 → 부모 즉시 박제 (KV PUT 은 부모 자동저장 30초 디바운스가 처리).
            console.log("[r3-diag] visual onSave called, keys=", data ? Object.keys(data) : "null");
            setExportCache(prev => ({ ...prev, visual: data }));
            dirtyTabs.current.add("visual");
          }}
        />
      </div>}

      {/* ── 수정사항 탭 (display:none으로 state 유지) ── */}
      {!termReview && <div style={{display: tab==="modify" ? "contents" : "none"}}>
        <ModifyTab
          sessionId={sessionId}
          config={cfg}
          currentTab={tab}
          initialData={exportCache.modify}
          authUser={authUser}
          onSave={(data) => {
            // CMS v2 — 자식 → 부모 즉시 박제 (KV PUT 은 부모 자동저장 30초 디바운스가 처리).
            console.log("[r3-diag] modify onSave called, keys=", data ? Object.keys(data) : "null", "items=", data?.modifications?.length);
            setExportCache(prev => ({ ...prev, modify: data }));
            dirtyTabs.current.add("modify");
          }}
        />
      </div>}
    </main>

    {showSet && <SettingsModal config={cfg} onSave={saveCfg} onClose={()=>setShowSet(false)}/>}
    {shareUrl && <ShareModal shareUrl={shareUrl} onClose={()=>setShareUrl(null)}/>}
    {showSessions && <SessionListModal config={cfg} onClose={()=>setShowSessions(false)}
      onLoad={async(id)=>{
        setShowSessions(false);
        setBusy(true); setProg({p:30,l:"세션 불러오는 중..."});
        try {
          const data = await apiLoadSession(id, cfg);
          setBlocks(data.blocks || []);
          setAnal(data.anal || null);
          setDiffs(data.diffs || []);
          setHl(data.hl || []);
          setHlStats(data.hlStats || null);
          setHlVerdicts(data.hlVerdicts || {}); setHlEdits(data.hlEdits || {}); setHlMarkers(data.hlMarkers || {}); setScriptEdits(data.scriptEdits || {}); setBlockDeletions(data.blockDeletions || {}); setReviewData(data.reviewData || null);
          setFn(data.fn || "");
          setSessionId(id);
          setGReady((data.hl?.length > 0));
          setTab(data.hl?.length > 0 ? "guide" : data.reviewData ? "review" : "correction");
          window.history.replaceState({}, "", `${window.location.pathname}?s=${id}`);
          setProg({p:100,l:"✅ 세션 로드 완료"});
        } catch(e) { setErr(e.message); }
        finally { setBusy(false); }
      }}
    />}

<style>{`
      @import url('https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css');
      *{box-sizing:border-box;margin:0;padding:0}
      
      ::-webkit-scrollbar { width: 10px; height: 10px; }
      ::-webkit-scrollbar-track { background: ${theme === "dark" ? "rgba(255, 255, 255, 0.03)" : "rgba(0, 0, 0, 0.04)"}; }
      ::-webkit-scrollbar-thumb { background: ${theme === "dark" ? "rgba(255, 255, 255, 0.2)" : "rgba(0, 0, 0, 0.2)"}; border-radius: 5px; }
      ::-webkit-scrollbar-thumb:hover { background: ${theme === "dark" ? "rgba(255, 255, 255, 0.4)" : "rgba(0, 0, 0, 0.4)"}; }
      
      body{overflow:hidden}
    `}</style>
    {/* CMS v2 — 묶음 ⑫ active-users 헤더 인디케이터 (Phase 3) */}
    {activeUsers.length > 0 && <div style={{
      position: "fixed", top: 56, right: 16, zIndex: 100,
      background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.3)",
      borderRadius: 20, padding: "6px 14px", fontSize: 13, color: "#16A34A",
      boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
    }}>
      👥 동시 편집: {activeUsers.map(u => `${u.name}${u.tabs?.length > 1 ? ` (탭 ${u.tabs.length}개)` : ""}`).join(", ")}
    </div>}
    {/* CMS v2 — 묶음 ⑫ otherUserToast (Phase 2 폴링) */}
    {otherUserToast && <div style={{
      position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
      zIndex: 200, padding: "12px 20px",
      background: otherUserToast.type === "merged" ? "rgba(34,197,94,0.95)" : "rgba(59,130,246,0.95)",
      color: "#fff", borderRadius: 10, fontSize: 14, fontWeight: 600,
      boxShadow: "0 8px 24px rgba(0,0,0,0.25)", maxWidth: 480,
    }}>
      {otherUserToast.type === "merged"
        ? `✓ ${otherUserToast.by}의 변경사항도 함께 저장되었습니다 (${tabLabel(otherUserToast.tab)})`
        : `📝 ${otherUserToast.by}님이 ${tabLabel(otherUserToast.tab)} 탭을 수정했습니다`}
      <button onClick={() => setOtherUserToast(null)} style={{ marginLeft: 12, background: "transparent", border: "none", color: "#fff", cursor: "pointer", fontSize: 16 }}>✕</button>
    </div>}
    {/* CMS v2 — D2/B3 모달 (묶음 ① ½) */}
    {saveFailModal && <SaveFailModal {...saveFailModal} />}
    {conflictModal && <ConflictModal {...conflictModal} />}
    {restoreModal && <RestoreModal
      backup={restoreModal.backup}
      totalCount={restoreModal.totalCount}
      onRestore={() => {
        try {
          const data = restoreModal.backup.data || {};
          if (data.blocks) setBlocks(data.blocks);
          if (data.anal) setAnal(data.anal);
          if (data.diffs) setDiffs(data.diffs);
          if (data.hl) setHl(data.hl);
          if (data.hlStats) setHlStats(data.hlStats);
          if (data.hlVerdicts) setHlVerdicts(data.hlVerdicts);
          if (data.hlEdits) setHlEdits(data.hlEdits);
          if (data.hlMarkers) setHlMarkers(data.hlMarkers);
          if (data.scriptEdits) setScriptEdits(data.scriptEdits);
          if (data.blockDeletions) setBlockDeletions(data.blockDeletions);
          if (data.reviewData) setReviewData(data.reviewData);
          if (restoreModal.backup.fn) setFn(restoreModal.backup.fn);
          if (restoreModal.backup.sessionId) {
            setSessionId(restoreModal.backup.sessionId);
            sessionIdRef.current = restoreModal.backup.sessionId;
          }
          setRestoreModal(null);
        } catch (e) {
          console.error("[backup] restore failed:", e?.message || e);
          setErr("복원에 실패했습니다. 백업 목록에서 다운로드하여 수동 복원해주세요.");
        }
      }}
      onSkip={() => setRestoreModal(null)}
      onShowList={() => { setRestoreModal(null); setBackupListOpen(true); }}
    />}
    {backupListOpen && <BackupListModal
      onSelect={(b) => {
        // 선택된 백업으로 복원
        setRestoreModal({ backup: b, totalCount: 1 });
        setBackupListOpen(false);
      }}
      onClose={() => setBackupListOpen(false)}
    />}
  </div>;
}
