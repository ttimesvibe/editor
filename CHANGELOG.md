# CHANGELOG

ttimes-editor 의 운영 변경 이력. 큐레이션된 형식 — 증상/원인/수정/검증을 한 항목에 묶어 후속 trace 비용을 낮춤.
세부 diff 는 `git log` / 인라인 주석 (단계 표기 R3.e-2-fix 등) 참고.

---

## 2026-05-09 — 내보내기 HTML 통합 가이드 섹션 추가 + 카드 렌더 헬퍼 추출

### 7. feat(export): 🧩 통합 가이드 섹션 신설 (편집자 요청)

- **요청**: "편집가이드의 추가 콘텐츠(자막)와 자료/그래픽의 추가 콘텐츠(자료)를 한꺼번에 보고 싶다"
- **분석**: 두 섹션은 같은 블록 텍스트(`getCorrectedPlain`) 기반. 차이는 (1) 마커 source(`hlMarkers` vs `visualMarkers`), (2) 카드 source(자막 / 시각화 / 인서트 컷 / 수동 자료) 두 가지뿐.
- **사용자 결정**:
  - 위치: `편집가이드 → 자료&그래픽 → 통합` (분리 → 통합 순서)
  - 마커 충돌: 단순 합치기, 시작 빠른 쪽 표시 (불편 감수 명시)
- **변경**:
  - `exportHTML.js` 의 카드 색상 상수 (`TYPE_COLORS / IC_LABELS / IC_COLORS / RES_LABELS / RES_COLORS`) 를 함수 상위로 lift
  - 카드 렌더 헬퍼 4종 추출 (`renderGuideCard / renderVisCard / renderIcCard / renderResCard`) — 모두 verdict==="use" 필터 통합
  - `guideSection` / `visualSection` 인라인 카드 → 헬퍼 호출로 교체 (시각 결과 동등)
  - 새 `combinedSection` — `hlMarkers` + `visualMarkers` prefix 합친 후 `applyMarkers`, 카드는 자막 → 시각화 → 인서트 컷 → 수동 자료 순 stack
  - 기본 접힘 (`open=false`) — 분리 view 가 메인, 통합은 보조 view
- **검증**: 빌드 통과. 리팩터부 출력 동등성 — 헬퍼는 인라인 코드를 그대로 옮긴 것 (string template 내용 동일).
- **누더기 회피**: 카드 코드 ~80 줄 중복을 4 헬퍼로 통합. 이후 카드 형식 변경 시 한 곳만 수정.

---

## 2026-05-09 — SessionListModal 폐기 (Dashboard 게시판 superset)

### 6. cleanup(sessions): /sessions 라우트 + SessionListModal + updateSessionIndex 일괄 제거

- **배경**: CMS 우상단 📋 "작업 히스토리" 버튼 → `SessionListModal` → `/sessions` GET → `session_index` KV 의 단순 목록 표시. v1 시절 진입로.
- **중복 검토**: Dashboard 게시판 뷰 (`/projects` + `project_index`) 가 superset — 검색/필터/휴지통/권한/편집자 표시 모두 추가 제공. SessionListModal 은 v1→v2 이행 잔재.
- **Orphan 검증** (정공법 우선): KV 실측으로 session_index vs project_index 좌비 14건 발견.
  - 12 좀비 (entity 0, 인덱스만 잔존) — 4/24 KV drift 사고 흔적 등
  - 2 V1 레거시 (`save_<id>`, "(자료) 허진호2 컷편" 4/16 두 번)
- **사용자 결정**: KV 데이터 화석 보존 + 코드 일괄 제거 (자연 만료 또는 영구). 폐기 X.
- **변경**:
  - `App.jsx`: import / `showSessions` state / 📋 버튼 / 모달 렌더 4군 제거
  - `components/Modals.jsx`: `SessionListModal` 함수 + export 제거 (다른 export 영향 0)
  - `worker/index.js`: `/sessions` GET + `/sessions/delete` POST 라우트 / `handleSessionList` / `handleSessionDelete` / `updateSessionIndex` 함수 + 두 호출처 (handleSave, handleSaveLegacy) / stale 주석 1건 — 7군 제거
- **검증**: 94/94 worker 테스트 pass. 빌드 통과 (1026 KB → -4 KB 감소).
- **결정 기록**: 코드 dead 정리는 _코드만_ 정리하고 KV 데이터는 보존하는 것이 정공법. KV 부담 무시 (~25KB), 미래 forensic 가치 보존, 누더기 0.

---

## 2026-05-09 — 라이브 데이터 손실 + 휴지통 정합 묶음

이번 묶음의 일관 주제: **누더기 회피 + 정공법으로 데이터 손실 차단**.
사용자 보고 (modify/highlight/visual 탭에서 저장→나갔다 들어오면 항목이 마지막 1개만 남음) 의 두 갈래 원인 + 휴지통 정책 모순 + RestoreModal 재출현 — 4건을 동시 정리.

### 1. fix(merge): id-fallback dedupe — `9a6cef0`

- **증상**: 사용자 추가한 cards/clips 가 저장→재진입 후 마지막 1개만 남음
- **원인** (worker/merge.js): `MERGE_STRATEGIES.modify.cards` 의 `entityType: "manualResources"` 와 `highlight.clips` 의 `entityType: "hl"` 이 `fallbackKeySync` 의 키 필드 (blockIndex|type|query|url, subtitle|speaker|startMs) 와 mismatch. 사용자 생성 항목은 `_stableId` 가 없어 fallback 으로 추락 → 모두 같은 키 (e.g. `"|||"`) → arrayIdUnion Map 이 마지막 항목으로 덮어씌움
- **수정**: `fallbackKeySync` 첫 줄에 universal id 우선 분기 추가
  ```js
  if (item && item.id != null && item.id !== "") return `id:${item.id}`;
  ```
  AI 생성 항목은 `_stableId` 가 먼저 잡혀 영향 없음. `docs/src/utils/_mergeImpl.js` (클라 미러) 동기화
- **검증**: `worker/__tests__/mergeTabData.test.js` id-fallback 회귀 6 케이스 추가 (47 → 47 pass)

### 2. fix(autosave): tabDataStateRef 부활 — `b4d1063`

- **증상**: ★ 위 (1) 적용 후에도 데이터 손실 재발. 라이브 로그에서 `modify onSave called, cards=2` → `save PAYLOAD modify: cards=1` 격차 확인
- **원인** (App.jsx): `saveDirtyTabsToKV` 가 `useCallback([tabDataState, ...])` 라 매 state 변경마다 새 함수 reference. cascading 30s autoSave timer 가 schedule 시점 reference 를 holds → 30s 후 fire 시 OLD closure 의 OLD `tabDataState` 사용 → 사용자가 그 사이 입력한 데이터 누락 PUT
- **수정**:
  - `tabDataStateRef = useRef(tabDataState)` 부활 + `useEffect` 로 매 render mirror
  - `saveDirtyTabsToKV` 내부 read 를 `tabDataStateRef.current` 로 (closure 무관)
  - `useCallback` deps 에서 `tabDataState` 제거 → 함수 reference 안정 → timer 가 capture 해도 ref read 라 항상 최신
  - 같은 stale-closure 가능성 `pagehide` 핸들러에도 동시 적용
- **결정 기록**: R3.d.2.e 단계의 "useCallback 직접 read 로 ref 영역 사용 0" 가정이 잘못된 가정이었음. closure capture 의 timing 무시. **다음에 ref 폐기 결정할 때 timer/이벤트 핸들러 측 capture 경로까지 사고실험 의무**
- **검증**: 사용자 라이브 재시도 → "와!! 드디어 안 없어진다!" 보고

### 3. fix(trash): B안 정공법 정합 — `5e012ae`

- **배경**: 휴지통 영구삭제 정책이 두 주석 모순
  - `handleProjectDelete` L984: "scheduled cron이 30일 경과분 수행" — 자동삭제 가정
  - `handleProjectTrash` L1047: "자동 영구삭제 없음, 관리자 수동" — 수동 가정
  - 실제: scheduled() 핸들러 미구현 + entity TTL 30일 단축됨 → entity 만료 후 index 좀비 발생
- **측정**: `project_index` 25.3KB / KV 무료 1GB 의 0.0025%. 자동삭제 가치 < 위험
- **수정** (B 안 = 영구 보존 + admin 수동):
  - `handleProjectDelete`: entity TTL 단축 + `purgeEligibleAt` 박제 제거
  - `handleProjectTrash`: 응답 `purgeEligibleAt` 필드 제거 (클라 미사용 확인)
  - `handleProjectRestore`: 옛 엔트리 호환 주석 (TTL 1년 복원 로직 유지 — 옛 단축 키 자동 정리)
  - `wrangler.toml`: `[triggers] crons = []` 명시 → dashboard 잔여 cron 동기 제거
- **운영 정책 명시**: 영구삭제는 admin 이 `/projects/trash/purge` 로 수동 호출 (이미 구현). 자동 cron 없음
- **검증**: 94/94 pass. 배포 시 wrangler 가 dashboard cron `0 18 * * *` 자동 제거 확인

### 4. fix(backup): RestoreModal "무시" → totalCount 기반 분기 — (이번 commit)

- **증상**: Mount 팝업 "총 N개의 백업이 있습니다" 보고 "무시하고 새로 시작" 클릭 → 작업 → 재진입 시 또 출현
- **원인** (App.jsx onSkip): 보여준 1 개만 `deleteBackup` → 잔존 N-1 개로 매 진입 재트리거. 모달 framing ("총 N개" + "새로 시작") 과 코드 동작 불일치
- **수정**: `totalCount` 기반 분기로 모달 framing 과 코드 동작 정합
  - Mount 팝업 N>1: sid 의 N개 일괄 삭제 (프로젝트 reset)
  - 단일 컨텍스트 (mount-N=1 / BackupListModal 개별 선택, totalCount=1): 1개만 삭제 (옛 동작 유지)
- **footgun 차단**: BackupListModal 에서 1개 선택해 "무시" 시 다른 backup 보존 (이전 검토안의 일괄삭제 버전이 가졌던 문제 — 재검토로 분리)
- **검증**: 빌드 성공, 흐름 7 경로 매트릭스 회귀 0 확인

---

## 이전 변경 이력 (요약)

세부는 git log 참고. 큰 흐름:

- **M1 ~ M6** (헌장 v1.1 §1-§6 정식 충족): cascading throttle, justLoadedRef, setTabWithFreshness, ConflictModal 2 옵션, pagehide fetch keepalive, active-users UI
- **R Phase**: 11 탭 동등 단일 store (`tabDataState`), `patchTab` 단일 setter, schemaVersion 3.0
- **약속 W**: 4중 백업 (W1 자동재시도 / W2 localStorage / W3 다운로드 / W4 beforeunload)
- **약속 X**: 탭 진입 시 fresh fetch
- **약속 Y**: justLoadedRef 명시 신호 — 복원/load 가 dirty 만들지 않음

---

## 형식 규약

새 항목 추가 시:

```
## YYYY-MM-DD — 한 줄 요약 (큰 주제)

### N. fix(scope): 짧은 제목 — `<short-sha>`

- **증상**: 사용자 시점에서 무엇이 잘못 보였나
- **원인**: 어디 코드 / 왜 그렇게 됐나 (필요시 옛 결정의 가정 박제)
- **수정**: 무엇을 어떻게
- **검증**: 테스트 / 라이브 / 측정값
- **결정 기록** (선택): 미래 자아가 다시 같은 함정 안 빠지게
```
