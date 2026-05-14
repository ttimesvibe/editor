# POSTMORTEM — lab fresh v2 시도 폐기 + test 환경 재설계 (2026-05-11)

## 본 사료의 정체성

2026-05-09 ~ 2026-05-11 동안 진행된 **lab fresh v2** 시도 (사료 188 .md 정독 → 본질 추출 → 모듈별 fresh 구현) 의 결과 **production 보다 못함 + PRD 정합 미달 + 스파게티 위험** 판정 → 사용자 결정 (2026-05-11) 으로 **lab application 전면 폐기**.

본 사료의 목적:
1. **무엇이 잘못됐는지 영구 박제** — v3/v4 재시도 시 같은 실수 회피
2. **새 방향 명시** — lab 인프라 (폴더 / Worker / GitHub repo) 는 보존, prod editor 의 clone 으로 test 환경 재구축
3. **본 세션 의 14+ commits + 사고 6건 박제** (시계열 + 원인)

---

## 사용자 명시 결정 (2026-05-11)

> "lab 프로젝트로 만든 새 애플리케이션이 예상 외로 prod 보다 오히려 좋지 않고, PRD 대로 구현되지 않은 것 같습니다. 오히려 지금부터의 오류수정이 스파게티 코드를 유발할 것으로 예상되어, lab 프로젝트를 전면 폐기하도록 합니다."

8 단계 plan (사용자 명시):

1. 본 lab 만든 경험을 문서에 박제 (본 사료)
2. lab application 전면 폐기
3. lab 인프라 (폴더 / Worker `lab` / GitHub `ttimesvibe/lab`) 는 test 버전을 위해 재사용
4. test 버전 = prod (alleditor) 코드 복사 → clone
5. test 의 Worker / KV 는 lab 용 (lab Worker / lab-sessions KV) 활용
6. clone 한 prod 코드를 수정해서 lab Worker / KV 가리키게 설정
7. (배경 — 원래 계획) lab 완성 후 옛 `ttimes-editor (test)` 의 KV 복사 → 옛 `ttimes-editor (test)` GitHub Pages + Worker 정리
8. (배경 — 신 계획) 새 lab (= prod clone) 완성 후 → 옛 ttimes-editor (test) 의 KV 데이터를 새 lab 으로 복사 → ttimes-editor (test) GitHub + Worker 정리

---

## 실패 영역 (★★★ v3/v4 시 회피 의무)

### 1. 사료 "본질 추출" 의 환상 — 실제로는 추측 기반 구현 다수

본 lab 시도의 핵심 가설은 사료 (`cms-v2-plan/` 188 개 .md) 의 **전수 정독 → 본질 추출 → fresh 모듈 구현**. 실제로는:

- master doc (`ops/lab-v2-fresh-2026-05-09.md`) 의 S1.1 ~ S5.9 박제는 충실 (~3700 줄)
- 그러나 실 구현 시 박제된 사료를 **재확인 안 하고 메모리 의존 + 추측** 작업 다수
- 2026-05-11 사용자 명시: "맘대로 예측하는군요? bullshit입니다" (박종천 2편.docx 의 1편/2편 합본 추측 사고)
- 본 세션 마지막에 ScriptTab 사료 §4.2.c 정합 검증했더니 의도 통째로 어긋남 (자막 우선 → 통원고 영역 누락)

**교훈**: 사료 박제 분량 ≠ 사료 정합도. **구현 시 매번 사료 직접 재확인 의무**.

### 2. fresh 재설계 가설 약함 — prod evolution layers 의 가치 재현 X

`prod editor (alleditor)` 의 `worker/index.js` 는 4242 줄, `App.jsx` 는 1800+ 줄. "겹겹이 쌓아올린 v2" 라고 사용자가 평가했으나, 실제로는:

- 4/14 strike 정규식 견고화 (`768a53a`)
- 4/22 track changes 저장 (`6bff0bb`)
- 4/24 self-closing `<w:del/>` 처리 (`4c55b05`)
- 4/24 한글↔한글 음운 유사성 guardrail (`33ed891`)
- ... 매 commit 이 라이브 사고 대응

이게 "evolution layers" 의 본질. **fresh 가 prod 의 라이브 사고 누적 가치를 재현 못 함**.

**교훈**: production 운영 중인 시스템의 evolution layers 는 "쌓인 사고 대응의 결정체". 그 가치를 fresh 가 다시 만들려면 **각 라이브 사고를 fresh 안에 다시 발생시키고 fix 하는 비용** 이 필요. 사료 정독만으로 재현 X.

### 3. 9 탭 production-ready 박제 — 사료 정합 검증 X

본 세션 마지막에 "9 user-facing 탭 모두 production-ready" 라고 박제 (Stage 7 master doc).

실제 검증:
- ScriptTab 사료 §4.2.c (1차 교정 통원고 + 사용자 편집) **누락** — /subtitle-format 만 호출하는 자막 위주로 구현됨
- 9 탭 중 1탭 핵심 어긋남이 production-ready 박제와 어울리지 않음

**교훈**: "production-ready" 박제 전 **사료 정합 매트릭스 (탭 × 사료 영역) 검증 의무**.

### 4. POSTMORTEM Rule 8 위반 (헌장 정합 pre-check)

POSTMORTEM 영구 8 룰 (S1.6) Rule 8: **헌장 정합 pre-check** — 코드 변경 전 헌장과의 정합성 확인 의무.

본 세션:
- ScriptTab 작성 전 PRD §4.2.c 직접 재확인 X
- TAB_MAP 의 `dirtyKey: "subtitle"` 이 PRD §12.1 명시 `dirtyKey: "correction"` 과 다른데도 무시 + 진행
- Phase 9 끝에 사용자 검토 후에야 발견

**교훈**: 새 컴포넌트 / 새 dispatch / 새 schema 추가 전 **PRD 의 해당 영역 직접 재확인** (메모리 의존 X).

### 5. 추측 작업의 누적 효과 — 한 영역 잘못이 전체 신뢰 잠식

본 세션 중 추측 사례:
- 1차 교정 결과 중복의 원인 추측 ("1편+2편 합본" → bullshit 판정)
- 사용자 보고 "스크립트 자막 의도" 검토 시 처음에 기술적 분석으로만 답변 (의도 못 짚음 — 사용자 재요청)
- correction.blocks 중복 원인 KV inspect 전 추측

각각은 작은 실수지만 **누적 결과 = production-ready 박제했으나 1탭 본질 어긋남 + 사용자 폐기 결정**.

**교훈**: 추측 작업의 위험은 누적. **"확인 안 한 영역은 박제 X"** 영구 룰.

---

## 본 세션 14 commits 시계열 (2026-05-11)

| commit | 작업 | 비고 |
|---|---|---|
| `a8ddbf3` | AI Phase 4 /subtitle-format (V2.2 + V3, 842 lines) | 10/10 LLM endpoint 마무리 |
| `3aee7eb` | 실 UI Phase 1: ManuscriptTab docx 업로드 | mammoth.js + track changes |
| `57dc0cc` | 실 UI Phase 2: ReviewTab 본문 + 삭제선 + build.js swap fix | swap fix 영구 박제 |
| `8dc1d65` | 실 UI Phase 3a: /analyze 연동 | |
| `8d26b79` | Phase 3a 보강: 분량 예측 (LOO MAE 3.9%) | lengthModel.js 신설 |
| `4147862` | 분석 결과 탭 이동 후 사라짐 fix | _analysisSummary 박제 |
| `811b42a` | "사전 분석 시작" 라벨 명확화 | |
| `640b0fe` | Phase 3b: /correct chunked + diff UI | |
| `f4f0266` | Phase 4: ScriptTab /subtitle-format V3 | ★ 사료 §4.2.c 와 어긋난 자막 위주 구현 |
| `ee50a74` | Phase 5: GuideTab /highlights 2-Pass | |
| `4dc11b5` | Phase 6: VisualTab /visuals + /insert-cuts | |
| `64c7a48` | Phase 7: HighlightTab /hl-recommend + /hl-timestamps | |
| `2d4d6aa` | Phase 8: SetgenTab /setgen multi-step | |
| `7a9d500` | Phase 9: ModifyTab YouTube + 카드 CRUD | |
| `7e245c6` | /correct max_tokens 32000 → 16000 (gpt-4o-mini 한계) | 사고 fix |
| `c02f382` | LLM timeout 30s → 180s + retry off | 사고 fix |
| `c940873` | stripStrikeFromBlocks 모두 비어짐 fix | 사고 fix |
| `509578b` | correction.blocks 중복 (array_id_union merge) fix | 사고 fix |
| `a22202c` | strike 영역 LLM 제외 (1차 fix — 후속 c940873) | 사고 fix |
| `e6a1fa6` | gpt-5*/o1*/o3* max_completion_tokens fix | 사고 fix |
| `dbf9d36` | ScriptTab 사료 §4.2.c 정합 재구현 | 사료 어긋남 정정 |
| `38bcd23` | 탭 라벨 줄바꿈 + /correct timeout 180→300s | 사고 fix |
| `dc73f1c` | 청크 15K→8K + max_tokens 16K→8K | 사고 fix |

worker tests: 235 → 272 (+37)
docs tests: 176 → 218 (+42)
총 490/490 PASS

폐기 시점 라이브 환경:
- Worker: `lab` (ttimesvibe), Version `41933eb8-5be3-4f68-b9d1-08cd11944a93`
- Pages: `https://ttimesvibe.github.io/lab/` 활성
- KV: `lab-sessions` (90 옛 keys + wmtflmzv 1 keys 등)

---

## 새 방향 — test 환경 = prod clone

### 인프라 보존 (사용자 명시 3)

| 자원 | 상태 | 새 용도 |
|---|---|---|
| 로컬 폴더 `D:\…\lab\` | **보존** | prod editor 코드로 교체 후 test 버전으로 운영 |
| GitHub `ttimesvibe/lab` | **보존** | prod editor repo (`ttimesvibe/editor` main branch) clone 후 push |
| Cloudflare Worker `lab` | **보존** | prod editor 의 worker 코드 (alleditor) clone 후 deploy |
| Cloudflare KV `lab-sessions` | **보존** | (배경 8) 옛 ttimes-editor (test) KV 복사 받음 |
| Cloudflare Pages `ttimesvibe.github.io/lab/` | **보존** | clone 한 prod docs 빌드 결과 |
| Secrets (OPENAI/GEMINI/JWT_SECRET) | **보존** | prod 와 동일 (사용자 명시 36, 37) |

### 폐기 영역 (사용자 명시 2)

- lab repo 의 모든 application 코드 (`docs/src/` `worker/*.js` `scripts/`)
- 단, master doc + 본 POSTMORTEM 은 editor repo 에 박제 (보존)

### test 환경 재구축 단계

1. **A: POSTMORTEM 박제** (본 사료, editor repo)
2. **B: lab repo application 폐기** — 모든 코드 제거 (clean slate)
3. **C: prod editor → lab repo clone** — `ttimesvibe/editor` (main branch) 의 `docs/` `worker/` `scripts/` 등 복사
4. **D: lab repo 의 설정 변경** — prod 가리키던 부분을 lab 가리키게
   - `worker/wrangler.toml` — `name = "alleditor"` → `name = "lab"`, account_id 변경 (`d556c524...` → `fb0a10864393158e940b149b3ead37f6`), KV id 변경 (`2892f3a4...` → `fbb8da8a...`)
   - `docs/src/utils/config.js` — `workerUrl: "https://alleditor.ttimes6000.workers.dev"` → `"https://lab.ttimes.workers.dev"`
   - `docs/build.js` — `CANONICAL_WORKER_URL` 동일 변경 + `FORBIDDEN_WORKER_URLS` 갱신
5. **E: 빌드 + 배포 검증** — `cd worker && wrangler deploy` / `cd docs && npm run build` / 라이브 동작 확인
6. **F: (배경 8 — 별 세션) 옛 ttimes-editor (test) → lab KV 복사 + 옛 환경 정리**
   - 옛 `editor-sessions` KV (90 keys) 데이터를 새 `lab-sessions` 으로 복사
     - 현 `lab-sessions` 의 lab fresh v2 keys 는 이미 옛 데이터 마이그레이션 결과라 큰 차이는 없음
     - 새 lab (prod clone) 으로 KV 스키마 정합 재확인
   - 옛 ttimes-editor (test) GitHub 페이지 + Worker `editor` 삭제

---

## v3/v4 재시도 시 영구 회피 패턴 (★ 영구 룰 추가)

POSTMORTEM 영구 8 룰 (S1.6) 의 사용자 명시 9 + 10 룰 추가:

### Rule 9 — fresh 재설계 금지 (production 운영 시스템)

**production 으로 운영 중인 시스템의 "fresh 재설계" 는 evolution layers 의 가치 재현 비용을 과소평가 → 금지**.

운영 중 시스템 변경의 정합 방법:
- 사용자 요구 → 영역 분리 → 영역별 patch (refactor / 신 기능 / 사고 fix)
- patch 별 사료 직접 재확인 + commit
- fresh 전체 재작성 X

### Rule 10 — 추측 작업 금지 ("확인 안 한 영역은 박제 X")

본 세션 사용자 명시: "맘대로 예측하는군요? bullshit입니다"

추측 작업 회피 절차:
1. 사용자 보고 / 사고 발생 → **데이터 직접 inspect 의무** (KV / 파일 / 사료)
2. 추측 가설 작성 시 **"이건 추측" 명시** + 사용자 확인 받기
3. fix 적용 전 **사료 정합 직접 확인**
4. "production-ready" 박제 전 **사료 정합 매트릭스 검증** (탭 × 사료 영역)

---

## 폐기 진행 의무 (★ POSTMORTEM Rule 1 정합)

본 사료 박제 후, 폐기 작업 진행은 **각 단계 별 사용자 명시 push 승인** 의무:

- A (본 POSTMORTEM editor repo push) → 사용자 명시 확인
- B (lab repo application 폐기) → 사용자 명시 확인
- C (prod clone) → 사용자 명시 확인
- D (설정 변경) → 사용자 명시 확인
- E (배포 + 검증) → 사용자 명시 확인

---

## 본 사료의 본질

> "lab fresh v2 시도 (2026-05-09 ~ 2026-05-11) 는 **production evolution layers 의 가치를 사료 정독만으로 재현 가능** 이라는 가설 검증 시도였고, **검증 결과: 가설 거짓**. v3/v4 재시도 시 같은 가설 X — production 기반 영역별 patch 방식 채택. 이 결정의 비용은 lab 시도 14 commits + 본 세션의 사용자 정신 비용 + 본 POSTMORTEM 박제 시간. 본 사료의 가치 = 이 비용을 다시 치르지 않게 하는 것."

POSTMORTEM 영구 10 룰 + 헌장 v1.1 + 영구 45+ 결정 정합 의무 유지. 본 폐기 결정 자체도 사용자 결정 46 로 박제.

---

## 참조

- master doc: `editor/ops/lab-v2-fresh-2026-05-09.md` (~4400 줄, Stage 0 ~ Stage 7 박제) — 본 사료와 함께 영구 보존
- 사료 폴더: `cms-v2-plan/` 188 개 .md (영구 보존, v3/v4 정독 대상)
- lab repo HEAD (lab fresh v2 폐기 시점): `dc73f1c`
- 옛 lab 코드 archive: GitHub repo history 에서 `dc73f1c` 이전 모두 보존 (force push X)

---

## ★ 2026-05-11 후속 작업 완료 (A-F 모두 완료)

### A-E (lab fresh v2 폐기 + prod clone + lab-auth 신설) — 본 사료 신설 시점

(위 본문 참조)

### F (옛 환경 정리) — 2026-05-11 후반 완료

| 단계 | 자원 | 결과 |
|---|---|---|
| F1 | KV `ttimes-editor-sessions` (b4c4e3c3..., legacy 8 keys) | ✅ wrangler delete |
| F2 | KV `editor-sessions` (9e4f5bb9..., 옛 test 82 keys) | ✅ 사용자 대시보드 삭제 |
| F3 | Worker `editor` (editor.ttimes.workers.dev) | ✅ 사용자 대시보드 삭제 (404 확인) |
| F4 | Worker `ttimes-edit` (옛 죽음) | ✅ 사용자 대시보드 삭제 (404 확인) |
| F5 | GitHub `ttimesvibe/ttimes-editor` | ✅ 사용자 GitHub 삭제 (404 확인) |

검증 결과:
- `editor.ttimes.workers.dev` → 404
- `ttimes-edit.ttimes.workers.dev` → 404
- `api.github.com/repos/ttimesvibe/ttimes-editor` → 404
- ttimesvibe 계정 KV 목록 → `lab-sessions` + `AUTH` (lab 전용) 만 남음 (다른 KV 6개는 lab 무관 서비스)
- `lab.ttimes.workers.dev` → 200 ✓
- `lab-auth.ttimes.workers.dev` → 200 ✓

★ 카니발 근원 모두 차단 + 옛 환경 완전 정리 완료. test 환경 = prod clone 단일 트리.

### 부가 — lab repo 의 admin page 신설

- `docs/admin/index.html` — prod `ttimesvibe/admin` 의 clone, AUTH_URL `lab-auth.ttimes.workers.dev` 변경
- 첫 admin: `hjae@mt.co.kr` (KV 직접 박음, `mustChangePassword=true`)
- URL: `https://ttimesvibe.github.io/lab/admin/`

### 본 결정의 본질 (요약)

> "2026-05-09 fresh v2 시도 (3 일) → 2026-05-11 라이브 검증 결과 prod 보다 못함 + PRD 정합 X 판단 → 사용자 명시 폐기 결정 → lab 인프라 (Worker / KV / GitHub repo / GitHub Pages) 보존 + application 코드만 prod editor clone 으로 교체 → lab-auth Worker 신설 + 카니발 근원 모두 차단 → 옛 ttimes-editor (test) 환경 5 자원 모두 정리 → **test 환경 = prod clone 단일 트리, 운영 1 + test 1 깔끔 분리** 상태 달성."

다음 단계 (별 세션):
1. 라이브 검증 (`ttimesvibe.github.io/lab/` + `/lab/admin/`)
2. test 환경에서 신규 기능 실험 (prod 안전 + 같은 사용자 인프라)
3. 안정화 후 prod (alleditor) 로 promote
