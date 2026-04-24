# 팀원 유실 신고 시 데이터 회수 가이드

> **전제**: 2026-04-19~04-24 사이 프론트엔드 번들에 구 test worker URL 이 하드코딩된 채 배포되는 drift 사고가 있었고, 캐시된 stale bundle 을 쓰던 팀원의 저장이 일시적으로 test KV 로 갔습니다. 04-24 18:49 (KST) 이후로 수정 번들이 배포되면서 drift 는 종료됐습니다.
>
> **2026-04-24 야간 시점 진단 결론**: **실작업물 유실은 0건** (상세: `20260424-diagnosis.md`).
> 하지만 팀원이 "작업한 게 안 보인다" 고 신고할 때는 이 가이드로 **즉시 해당 프로젝트의 test 쪽 원본을 꺼내** 확인·복원할 수 있습니다.

---

## Step 1. 어떤 프로젝트인지 식별

팀원에게 물어볼 3가지:
1. **프로젝트 이름** (예: "허진호 2편")
2. **어느 탭** (0차 원고 / 1차 교정 / 편집가이드 / 수정사항 / 자료·그래픽 / 하이라이트 / 시각자료)
3. **언제쯤 저장** (날짜·시간, "아침에 저장한 게 없어짐" 같은 거)

## Step 2. 프로젝트 ID 찾기

```bash
cd kv-snapshot
grep -l "허진호 2편" 20260424-per-project/*.md
```
결과로 `20260424-per-project/<id>_허진호_2편.md` 파일 찾음. 파일 이름에 ID 포함.

또는 `20260424-diff/test-project_index.json` 에서 fn 으로 검색.

## Step 3. 진단 카드 확인

해당 프로젝트 MD 파일 열면:
- 사건 판정 (유령 터치 / 더미 저장 / content-identical / 등)
- test 쪽 실제 저장된 시각·탭·크기
- prod 쪽 현재 상태
- **그 탭의 test 원본 파일 경로**

## Step 4. test 쪽 원본 내용 직접 확인

```bash
# 예: 허진호 2편 (1c1f35223w1ke) 의 correction 탭
cat "kv-snapshot/20260424-test-fetch/s_1c1f35223w1ke_correction.json" | jq .

# 팀원에게 JSON 을 그대로 보여주거나, 주요 필드만 뽑아서
cat "kv-snapshot/20260424-test-fetch/s_1c1f35223w1ke_modify.json" | jq '.cards[].content'
```

## Step 5. 복원이 필요하면 prod 에 쓰기 (신중히)

### 원칙
- **단일 탭만** 복원. 프로젝트 전체 복사 금지.
- **복원 전 해당 prod 키 백업** 필수 (`kv-snapshot/YYYYMMDD-restore-backup/` 에).
- **팀원이 "이게 내 작업이 맞다" 고 직접 확인** 한 뒤에만 실행.

### 복원 명령

```bash
# 1) 현재 prod 키 백업
cd worker
npx wrangler kv key get "s:<sid>:<tab>" \
  --namespace-id=2892f3a4de90429dbcf0eb272578009e --remote \
  > "../kv-snapshot/$(date +%Y%m%d)-restore-backup/s_<sid>_<tab>.json"

# 2) test 원본을 prod 에 put
npx wrangler kv key put "s:<sid>:<tab>" \
  --path "../kv-snapshot/20260424-test-fetch/s_<sid>_<tab>.json" \
  --namespace-id=2892f3a4de90429dbcf0eb272578009e --remote

# 3) /projects/rebuild-index 호출로 project_index 갱신
curl -X POST "https://alleditor.ttimes6000.workers.dev/projects/rebuild-index" \
  -H "Authorization: Bearer $JWT"

# 4) 팀원이 CMS 에서 새로고침해 확인
```

---

## 자주 있는 케이스별 가이드

### A. "수정사항 카드가 없어졌어요"
1. `20260424-per-project/<id>_*.md` 에서 modify 탭의 test 측 cards 개수·내용 확인
2. test 에 실제 내용 있으면 (예: 정지훈 2편의 modify 는 **홍재의 더미** 였음 — 실제 작업자가 박성수인지 홍재의인지 확인 필수)
3. 팀원 본인 작업이 맞으면 Step 5 로 복원

### B. "편집가이드/교정 내용이 예전 상태로 돌아갔어요"
- 대부분 "byte-identical only savedAt" 패턴 → 실제로는 내용 동일, 원래 상태임
- 그래도 test 원본 열어서 실제로 뭐가 들었는지 확인 후 답변

### C. "어제 올린 이미지가 안 뜨어요"
- test 에 `s:<sid>:img:<imgid>` 키가 있는지 확인
  - 있으면: prod 의 visual/setgen 에서 그 imgid 를 참조하는지 점검 (안 하면 orphan)
  - 없으면: 이미지는 prod 에 정상 저장됐을 가능성 → 브라우저 캐시 의심

### D. "프로젝트가 목록에서 사라졌어요"
- 프로젝트 삭제(soft-delete) 여부를 `20260424-diff/prod-project_index.json` 의 `deleted: true` 로 확인
- 필요시 worker 의 `/projects/:id/restore` (Task #6 에서 구현 예정) 호출

---

## 진단 데이터 수명

- 이 스냅샷은 **2026-04-24 야간 시점의 KV 상태**
- 시간이 지나면 prod KV 는 팀원 저장으로 계속 변해감. 복원 시점에 prod 이 이미 진전됐을 수 있으니 **덮어쓰기 전 반드시 최신 prod 값도 함께 본다**.
- test KV 도 이론상 계속 쓰일 수 있으므로 (refactor-track 테스트용 Worker `ttimes-editor`), 주기적으로 재스냅샷 권장.

## 로그·증거 경로

```
kv-snapshot/
├── 20260424-test-fetch/       ← test 원본 JSON (원상 복구용 소스)
├── 20260424-prod-fetch/       ← 당시 prod 비교 본
├── 20260424-diff/             ← 차분 분석
└── 20260424-per-project/      ← 프로젝트별 진단 카드
```
