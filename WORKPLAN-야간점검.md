# 퇴근 후 작업 상세 계획서

작성: 2026-04-24
작업 창: 금일 퇴근 후 (팀원 저장 트래픽 소진 후, 22:00 이후 권장)
작업자: Hong + Claude
총 예상 소요: 2.5~3.5시간 (검증 포함)

---

## 0. 사전 준비 (작업 시작 전 15분)

### 0.1 환경 스냅샷
- `wrangler kv key list --namespace-id=2892f3a4de90429dbcf0eb272578009e` → prod 키 전체 목록 덤프
- 테스트 KV namespace id 확인 (Cloudflare 대시보드 → editor worker → KV bindings)
- `wrangler kv key list --namespace-id=<test-id>` → test 키 전체 목록 덤프
- 두 목록을 `kv-snapshot/{YYYYMMDD-HHMM}/prod.json`, `test.json`로 저장

### 0.2 코드 상태 확정
- `git status` 깨끗한지 확인
- 현재 편집 중인 `docs/src/utils/docxParser.js` 변경분 리뷰 후 commit 준비
- prod 워커 현재 버전 ID 기록 (`wrangler deployments list`)

### 0.3 팀 공지
> "편집 CMS 야간 점검 22:00~01:00. **새로고침하지 마시고**, 현재 작업은 그대로 두세요. 저장은 가능합니다. 점검 중 잠시 느려질 수 있습니다."

---

## 1. Task #1 — Test KV ↔ Prod KV 3-way diff + 이관

**목표**: 4/23~4/24 기간 동안 stale bundle이 test 워커를 때리면서 test KV에 잘못 저장된 팀원 작업분을 prod KV로 회수. 데이터 손실 0 보장.

**예상 소요**: 60~90분

### 1.1 3-way 분류 (30분)
스냅샷 기반으로 키를 3집합으로 분류:
- **A. prod-only**: prod KV에만 존재 → 조치 불필요
- **B. test-only**: test KV에만 존재 → **prod로 복사 대상**
- **C. both**: 양쪽 존재 → `savedAt` 타임스탬프 비교
  - C1. test가 최신 (test.savedAt > prod.savedAt): **test→prod 덮어쓰기 대상**
  - C2. prod가 최신 또는 동일: 조치 불필요

분류 스크립트 (일회성, 로컬 실행):
```bash
node scripts/kv-diff.js \
  --prod-snapshot kv-snapshot/.../prod.json \
  --test-snapshot kv-snapshot/.../test.json \
  --output diff-report.json
```
산출물: `diff-report.json`에 B, C1 각 키 목록 + 각 엔트리의 fn/updatedBy/savedAt 메타.

### 1.2 사용자 리뷰 (10분)
- `diff-report.json`을 사람이 볼 수 있는 표로 출력 (`node scripts/kv-diff.js --print`)
- Hong이 눈으로 훑어서 "이관 승인" 여부 확정
- 특히 다음 케이스는 개별 확인:
  - B에 `session_index`/`project_index` 같은 집계 키 포함 시 → **자동 이관 금지, 수동 머지 필요**
  - C1에서 `s:{id}:meta`의 editor가 prod와 다른 경우 (같은 id를 다른 사용자가 동시에 편집)

### 1.3 Dry-run (5분)
- `scripts/kv-migrate.js --dry-run` 실행 → "어떤 키를 어디로 복사할지"만 출력, 실제 쓰기 없음
- 출력 샘플과 diff-report를 대조 검증

### 1.4 실제 이관 실행 (10~20분)
- `scripts/kv-migrate.js --execute --confirm <checksum>` (checksum은 dry-run 결과 해시, 중간 변경 방지용)
- 각 키를 `wrangler kv key put` 또는 워커 엔드포인트(`/admin/kv-import`, Bearer 인증)를 통해 prod에 기록
- 진행 로그는 `migration-log-{timestamp}.ndjson`에 append

### 1.5 이관 후 검증 (10분)
- prod KV에서 `project_index` 재조회 → `/projects/rebuild-index` 호출해서 누락 복구 최종 확인
- 랜덤 5개 세션 `s:{id}:meta` 읽어서 editor/updatedAt 이상 없는지 확인

**리스크 & 롤백**:
- prod에 덮어쓰기 전 각 키의 원본을 `kv-snapshot/.../prod-backup/` 으로 개별 백업
- 문제 발견 시 `scripts/kv-restore.js --from kv-snapshot/.../prod-backup/` 로 원복
- Worst case: 팀원이 이관 중 동시 저장 → 마지막-쓰기가 이김. 22:00 이후 창구 최소화로 리스크 억제.

---

## 2. Task #2 — docxParser self-closing w:del fix 배포 + 검증

**목표**: 이번 세션에서 수정한 `docs/src/utils/docxParser.js` 변경분을 prod에 배포하고 `260423_4월 국제 싱크` docx로 회귀 검증.

**예상 소요**: 20분

### 2.1 빌드
```bash
cd docs
npm run build   # docs/ 자체의 vite.config.js (index_build- prefix) 사용
```
**절대 temp 디렉토리에서 빌드하지 않음**. Task #4와 연결.

### 2.2 빌드 산출물 점검
- `docs/assets/index_build-*.js` 생성 확인
- `grep -o "https://[a-z.]*workers.dev" docs/assets/index_build-*.js | sort -u`
  - 기대: `alleditor.ttimes6000.workers.dev` + `auth.ttimes6000.workers.dev`만 출현
  - `editor.ttimes.workers.dev` 이 나오면 즉시 중단 (drift 재발)

### 2.3 커밋·배포
```bash
git add docs/src/utils/docxParser.js docs/assets/index_build-*.js docs/index.html
git commit -m "docx parser: self-closing <w:del/> 처리 — 단락 마크 삭제 표시 skip"
git push editor main
```
GitHub Pages 전파 대기 1~2분.

### 2.4 회귀 검증
- 문제 docx(`260423_4월 국제 싱크`) 브라우저에서 재업로드
- 기대:
  - "왜냐하면은 저는 잘 모르지만 이 우라늄" → strike ✅
  - "대요" → strike ✅ (이전엔 "죠"에 strike)
  - "농업하는 데도 써야 되고..." 블록 → 정상 (이전엔 통째로 strike)
- 추가 spot check: 기존 정상 docx(삭제선 없는 파일) 1개 업로드 → 기존과 동일하게 동작하는지

**리스크 & 롤백**:
- 문제 발생 시 `git revert` 후 재배포
- 이전 bundle 해시(`index_build-B6jhw42Z.js` 또는 현재 배포된 것) 기록해두면 복구 1분

---

## 3. Task #3 — 1차 교정 고유명사 할루시네이션 차단

**목표**: `/correct` 엔드포인트에서 모델이 지식 컷오프 기반 "사실 교정"으로 고유명사(재무장관 등)를 임의 교체하는 문제 차단. 프롬프트 하드닝 + worker 사후 guardrail 이중 방어.

**예상 소요**: 25~30분

### 3.1 `BASE_CORRECT_PROMPT` §2a 추가 (worker/index.js 1648줄 §2 직후)

```
### §2a. Proper Noun Absolute Preservation (★ HIGHEST PRIORITY, overrides §2)

For ALL proper nouns (person names, titles, organizations, places, product names),
the ONLY acceptable reasons to change them are:
  (1) Exact match in the provided terminology dictionary (§2 mandatory mapping), OR
  (2) Phonetic STT misrecognition where the corrected form is phonetically similar
      to the original (e.g., "홍재희"→"홍재의": same syllable count, near-homophone).

**ABSOLUTELY FORBIDDEN:**
- Changing a name based on your world knowledge of "who currently holds this position."
- Replacing a mentioned person with a different person you believe is more likely.
- "Correcting" a title/role assignment based on what you know about current events.
- Substituting any person name that is NOT phonetically close to the original AND
  NOT in the dictionary.

Your training data has a knowledge cutoff. The speaker in the interview has
current information that you do not. If the speaker says person X holds role Y,
you MUST preserve X exactly as written, even if you believe X no longer holds Y.

**Test before emitting any person-name change:**
  - Is the change in the dictionary? → OK
  - Are original and corrected phonetically similar (same syllable count ±1,
    majority of syllables share initial consonant/vowel)? → OK
  - Otherwise → DO NOT emit the change. Leave original intact.

Example (forbidden):
  original: "미국 재무장관 베센트" → corrected: "미국 재무장관 옐런"  ❌
  Example (allowed):
  original: "미국 재무장관 베셋" → corrected: "미국 재무장관 베센트"  ✅
```

### 3.2 Absolute Rules 12번 추가 (worker/index.js 1765줄 근처)
```
12. NEVER change a proper noun based on world knowledge. Only dictionary matches
    or phonetic STT fixes are allowed. When in doubt, preserve the original.
```

### 3.3 Worker 사후 guardrail

`handleCorrect` 응답 파싱 후, 각 change에 대해:
```js
function isSuspiciousNameChange(change, termDict) {
  if (change.type !== "term_correction") return false;
  // 1. dictionary 명시 매핑이면 통과
  if (termDict.some(t => t.wrong === change.original && t.correct === change.corrected)) return false;
  const a = change.original || "", b = change.corrected || "";
  // 2. 길이 차 크면 의심 (이름이 완전히 다른 사람일 가능성)
  if (Math.abs(a.length - b.length) > 1) return true;
  // 3. 공통 음절 비율 낮으면 의심
  const common = [...a].filter(ch => b.includes(ch)).length;
  if (common / Math.max(a.length, b.length, 1) < 0.5) return true;
  return false;
}
```

의심 change는 응답에서 제거(drop)하거나 `flagged: true`로 마킹해 프론트에서 별도 표시 가능. 우선은 **drop** (가장 안전한 default).

```js
// handleCorrect 응답 처리부
result.chunks = result.chunks.map(ch => ({
  ...ch,
  changes: ch.changes.filter(c => {
    if (isSuspiciousNameChange(c, termDict)) {
      console.log("[guardrail] dropped suspicious name change:", c);
      return false;
    }
    return true;
  })
}));
```

### 3.4 배포 & 검증
- `wrangler deploy`
- 테스트: 새 프로젝트에 "미국 재무장관 스콧 베센트는..." 같은 문장 포함 원고 업로드 → 1차 교정 돌림 → 응답에 옐런 교정 없는지 확인
- 혹시 터미널 교정(term_dict)에 있는 정상 교체는 여전히 적용되는지 회귀 체크

**리스크**:
- guardrail이 너무 엄격하면 정상 STT 오인식 교정(예: "엔비디아"→"NVIDIA")까지 막을 수 있음. 길이차 +1, 공통음절 50% 기준은 관대한 편이지만 실제 데이터로 검증 필요.
- 문제 시 guardrail `enabled: false` 플래그로 즉시 비활성화 가능하도록 env 변수화 고려.

---

## 4. Task #4 — temp service-build 디렉토리 폐기

**목표**: `C:\Users\Hong4137\AppData\Local\Temp\service-build\` 재사용 가능성을 원천 차단. 모든 prod 빌드는 repo `docs/`에서만.

**예상 소요**: 15분

### 4.1 temp 디렉토리 삭제
```bash
rm -rf "C:/Users/Hong4137/AppData/Local/Temp/service-build"
```

### 4.2 빌드 문서화
`docs/BUILD.md` (신규 1페이지) 작성:
> **Prod 빌드는 반드시 `docs/`에서 실행한다.**
> ```
> cd docs && npm install && npm run build
> git add docs/assets/ docs/index.html && git commit && git push editor main
> ```
> temp 디렉토리 사용 금지. vite.config.js는 `index_build-` prefix를 강제하므로 빌드 산출물이 다른 prefix로 생성되면 drift 발생 신호.

### 4.3 과거 `index-*.js` 잔재 정리 (선택)
- `docs/assets/`에 남아있는 구 prefix(`index-`) bundle은 현재 사용 안 됨
- `docs/index.html`이 참조하는 최신 파일 외 나머지는 삭제 가능 (git history엔 남음)

**리스크**: 없음. 순수 정리 작업.

---

## 5. Task #5 — build-time drift guard

**목표**: 빌드 단계에서 `docs/src/utils/config.js`의 workerUrl이 기대값과 다르면 빌드를 실패시켜, 이번 같은 stale config 사고 재발 원천 차단.

**예상 소요**: 20분

### 5.1 Pre-build 체크 스크립트
`docs/scripts/check-config.js`:
```js
import fs from "fs";
const EXPECTED_PROD_URL = "https://alleditor.ttimes6000.workers.dev";
const src = fs.readFileSync("src/utils/config.js", "utf8");
const m = src.match(/workerUrl:\s*"([^"]+)"/);
if (!m) { console.error("[check-config] workerUrl 못 찾음"); process.exit(1); }
if (m[1] !== EXPECTED_PROD_URL) {
  console.error(`[check-config] workerUrl drift: got ${m[1]}, expected ${EXPECTED_PROD_URL}`);
  process.exit(1);
}
console.log("[check-config] OK:", m[1]);
```

### 5.2 package.json 연결
```json
"scripts": {
  "prebuild": "node scripts/check-config.js",
  "build": "vite build"
}
```
→ `npm run build` 실행 시 자동으로 prebuild 실행, drift 있으면 build 진입 차단.

### 5.3 빌드 후 bundle 검증 (postbuild)
`docs/scripts/check-bundle.js`:
```js
import fs from "fs"; import path from "path";
const files = fs.readdirSync("dist/assets").filter(f => f.startsWith("index_build-") && f.endsWith(".js"));
if (files.length === 0) { console.error("[check-bundle] index_build-*.js 없음 — vite.config drift 의심"); process.exit(1); }
const content = fs.readFileSync(path.join("dist/assets", files[0]), "utf8");
if (content.includes("editor.ttimes.workers.dev")) {
  console.error("[check-bundle] bundle에 test URL 감지 — drift!"); process.exit(1);
}
console.log("[check-bundle] OK");
```
→ `"postbuild": "node scripts/check-bundle.js"` 추가.

### 5.4 검증
- 일부러 config.js를 test URL로 바꿔서 `npm run build` → prebuild에서 실패하는지 확인
- 원복 후 정상 빌드 확인

**리스크**: 없음. 추가 안전망.

---

## 6. Task #6 — 프로젝트 삭제 soft-delete + 30일 휴지통

**목표**: `handleProjectDelete`가 현재 하드 딜리트(11개 탭 키 + project_index 제거)로 실수 시 복구 불가. soft-delete + TTL 기반 자동 영구삭제로 전환.

**예상 소요**: 30~40분

### 6.1 Worker 변경 (`worker/index.js`)
- `handleProjectDelete`:
  - 기존 하드 딜리트 블록을 다음으로 대체:
    ```js
    // project_index 엔트리에 deleted 플래그 추가
    const entry = index.find(p => p.id === id);
    if (entry) {
      entry.deleted = true;
      entry.deletedAt = new Date().toISOString();
      entry.deletedBy = user?.sub || "unknown";
      await env.SESSIONS.put("project_index", JSON.stringify(index));
    }
    // s:{id}:* 키는 유지 (30일 후 정리 잡에서 처리)
    ```
- 이미 `handleProjectList`에 `filter(p => !p.deleted)`는 이번 세션에서 추가됨 → 화면엔 자동으로 안 보임

### 6.2 복구 엔드포인트
- `POST /projects/:id/restore` (관리자만) → entry.deleted = false, deletedAt/By 제거
- `GET /projects/trash` (관리자만) → deleted:true 엔트리 목록

### 6.3 영구삭제 스케줄 (Cron Trigger)
- `wrangler.toml`에 일 1회 cron 추가:
  ```toml
  [triggers]
  crons = ["0 18 * * *"]   # 매일 03:00 KST
  ```
- `scheduled()` 핸들러:
  ```js
  const cutoff = Date.now() - 30 * 24 * 3600 * 1000;
  const expired = index.filter(p => p.deleted && Date.parse(p.deletedAt) < cutoff);
  for (const p of expired) {
    for (const tab of ALL_TABS) await env.SESSIONS.delete(`s:${p.id}:${tab}`);
    await env.SESSIONS.delete(`s:${p.id}:meta`);
  }
  index = index.filter(p => !expired.find(e => e.id === p.id));
  await env.SESSIONS.put("project_index", JSON.stringify(index));
  ```

### 6.4 감사 로그 (선택, 여력되면)
- `audit:{YYYY-MM-DD}` 키에 삭제/복구 이벤트 append
- 2주간 데이터 누가 언제 삭제했는지 추적 가능

### 6.5 배포 & 검증
- `wrangler deploy`
- 테스트 프로젝트 1개 생성→삭제→목록에서 사라짐→`/projects/trash`에서 보임→`/projects/:id/restore`로 복구→목록에 다시 나옴

**리스크**:
- cron에서 실수로 deleted:false까지 지우면 참사 → 조건절을 `p.deleted === true && Date.parse(p.deletedAt) < cutoff` 로 엄격히
- 첫 배포 후 24시간은 cron 실행 결과 로그 모니터링

---

## 7. Task #7 — docx parser unit test fixture 추가

**목표**: 이번 self-closing w:del 버그가 회귀하지 않도록, 문제 docx를 영구 fixture로 보관 + 자동 테스트.

**예상 소요**: 20분

### 7.1 fixture 배치
- `docs/__fixtures__/track-changes-paragraph-mark-del.docx` ← 오늘 받은 `260423_4월 국제 싱크` (또는 민감정보 있으면 해당 단락만 떼낸 축소판)
- 민감정보 있으면 **2~3개 블록만 남긴 축약 docx 별도 생성**해서 커밋. 원본은 gitignore.

### 7.2 기대값 스냅샷
`docs/__fixtures__/track-changes-paragraph-mark-del.expected.json`:
```json
{
  "hasTrackChanges": true,
  "paragraphCount": 3,
  "segments": [
    {"block": 0, "deleted": ["왜냐하면은 저는 잘 모르지만 이 우라늄", "대요"]},
    {"block": 1, "deleted": []}
  ]
}
```

### 7.3 테스트
- `docs/__tests__/docxParser.test.js` (vitest):
  ```js
  import { parseDocxWithTrackChanges } from "../src/utils/docxParser.js";
  import fs from "fs"; import { expect, test } from "vitest";
  test("self-closing w:del paragraph-mark markers are skipped", async () => {
    const buf = fs.readFileSync("__fixtures__/track-changes-paragraph-mark-del.docx");
    const r = await parseDocxWithTrackChanges(buf.buffer);
    const deletedTexts = r.paragraphs.flatMap(p => p.filter(s => s.deleted).map(s => s.text));
    expect(deletedTexts).toContain("대요");
    expect(deletedTexts).not.toContain("죠");
  });
  ```
- `npm install -D vitest` + `"test": "vitest run"`

### 7.4 CI 고리 (선택, 지금은 로컬만)
- 향후 GitHub Actions에 연결해서 PR 시 자동 실행

**리스크**: 없음.

---

## 체크리스트 (작업 당일)

```
[ ] 0.1 KV 스냅샷 완료 (prod + test)
[ ] 0.2 git status clean
[ ] 0.3 팀 공지 발송
[ ] 2.x docxParser fix 빌드·배포·검증
[ ] 3.x /correct 프롬프트 §2a 하드닝 + guardrail + worker 배포 + 검증
[ ] 4.x temp 디렉토리 삭제 + BUILD.md 작성
[ ] 5.x prebuild/postbuild guard 추가 + 의도적 fail 테스트
[ ] 1.x KV 이관 dry-run → 승인 → 실행 → 검증
[ ] 6.x soft-delete 전환 worker 배포 + 복구 경로 검증
[ ] 7.x docx parser test fixture + test 추가
[ ] 최종 /health 체크 → 정상 응답 확인
[ ] 팀 공지 해제 ("점검 완료, 정상 이용 가능")
```

---

## 작업 순서 권고

**병렬 가능한 건 병렬로, 리스크 큰 건 검증 창 확보:**

1. **Task #2 (docxParser 배포)** — 이미 코드 수정 끝, 빠르게 배포·검증. Prod KV에 영향 없음.
2. **Task #3 (/correct 고유명사 guardrail)** — Task #2와 묶어 frontend+worker 동시 배포.
3. **Task #4 (temp 폐기) + Task #5 (drift guard)** — 함께 묶어서 빌드 파이프라인 정비 마무리.
4. **Task #1 (KV 이관)** — 이 시점에서 배포·파이프라인이 안정화된 상태에서 실행. 이관 중 저장 쓰기 거의 없음.
5. **Task #6 (soft-delete)** — KV 이관 끝난 후 배포. soft-delete 로직은 이관된 KV 상태를 전제로 동작.
6. **Task #7 (unit test)** — 마지막에. 당일 못 해도 내일로 미룰 수 있음.

**중단 지점**: 각 Task 종료마다 5분 휴식·검증. 문제 시 해당 Task만 롤백하고 다음으로 넘어가지 않음.

---

## 참고 — 이번 세션 주요 결론

- **사건 A (데이터 소실 착시)**: prod 프론트엔드 번들이 test 워커 URL을 하드코딩한 채 배포됨 (4/23 `112a81e` 커밋부터). temp 디렉토리 `config.js`가 4/19 repo 업데이트와 동기화되지 않은 채 빌드 소스로 사용됨. 드리프트 포인트는 `config.js:workerUrl` 1곳, 다른 소스 파일은 오염 없음 확인.
- **사건 B (삭제선 오인식)**: `docxParser.js`의 tokenRegex가 self-closing `<w:del .../>` (단락 마크 삭제 표시, 해당 docx에 38개)를 opening 태그로 오인해 다음 `</w:del>`까지 swallow. 이번 세션에서 regex에 self-closing alternative 추가로 수정 완료 (아직 미배포).
- **사건 C (재닛 옐런 할루시네이션)**: `/correct` 프롬프트 §2a 부재로 모델이 지식 컷오프 기반 인명 교체 수행. Task #3에서 처리.
