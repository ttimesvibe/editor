// CMS v2 — 탭 ID 단일 소스 (G1, N1)
// 묶음 ⑤ 가드레일 정합화의 핵심.
// UI ↔ Worker ↔ STEP_MAP ↔ dirty 추적 의 단일 정의.

export const TAB_MAP = {
  meta:       { worker: "meta",       ui: null,         step: null, dirtyKey: null },
  manuscript: { worker: "manuscript", ui: null,         step: null, dirtyKey: null },
  correction: { worker: "correction", ui: "correction", step: 1,    dirtyKey: "correction" },
  // UI 의 "script" 탭은 데이터를 correction 안에 동봉 저장 (App.jsx:487 검증됨)
  // 별도 worker 키 = subtitle (자막 결과 캐시)
  subtitle:   { worker: "subtitle",   ui: "script",     step: 2,    dirtyKey: "correction" },
  review:     { worker: "review",     ui: "review",     step: 0,    dirtyKey: "review" },
  highlight:  { worker: "highlight",  ui: "highlight",  step: 6,    dirtyKey: "highlight" },
  guide:      { worker: "guide",      ui: "guide",      step: 3,    dirtyKey: "guide" },
  setgen:     { worker: "setgen",     ui: "setgen",     step: 7,    dirtyKey: "setgen" },
  metadata:   { worker: "metadata",   ui: null,         step: null, dirtyKey: "metadata" },
  visual:     { worker: "visual",     ui: "visual",     step: 4,    dirtyKey: "visual" },
  modify:     { worker: "modify",     ui: "modify",     step: 5,    dirtyKey: "modify" },
};

// Worker 측에서 인정하는 탭 키 (E4 입력 검증)
export const PROJECT_TAB_KEYS = Object.values(TAB_MAP).map(t => t.worker);

// UI step 순서 (STEP_MAP 의 단일 소스)
export const STEP_MAP = Object.fromEntries(
  Object.entries(TAB_MAP)
    .filter(([_, v]) => v.ui && v.step != null)
    .map(([_, v]) => [v.ui, v.step])
);

// dirty 추적 가능한 탭 (saveDirtyTabsToKV 의 dispatch table 키)
export const DIRTY_TABS = [...new Set(
  Object.values(TAB_MAP).filter(t => t.dirtyKey).map(t => t.dirtyKey)
)];

// UI ID → Worker key 변환
export function uiToWorker(uiId) {
  for (const [key, v] of Object.entries(TAB_MAP)) {
    if (v.ui === uiId) return v.worker;
  }
  return uiId;  // fallback
}

// dirtyKey → 어느 worker 키에 저장할지 (subtitle 의 데이터는 correction 동봉)
export function dirtyKeyToWorker(dirtyKey) {
  return dirtyKey;  // 현재는 1:1 (subtitle 만 correction 으로 동봉)
}

// body.tab 입력 검증 (E4)
export function isValidTabKey(tab) {
  return PROJECT_TAB_KEYS.includes(tab);
}

// body.id 입력 검증 (E5)
export function isValidSessionId(id) {
  return typeof id === "string" && /^[a-z0-9]{8}$/.test(id);
}
