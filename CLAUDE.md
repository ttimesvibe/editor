# ttimes-editor — 운영 컨텍스트 기록

이 문서는 반복적으로 헷갈리거나 수동 확인이 까다로운 운영 정보를 정리한 메모입니다.
코드 주석·README 에 녹이기 애매한 계정/네임스페이스/배포 관행을 기록합니다.

---

## Cloudflare 계정 구조 (중요)

이 프로젝트는 **두 개의 Cloudflare 계정**에 걸쳐 있습니다. 혼동 주의.

| 계정 | Account ID | 용도 |
|---|---|---|
| **ttimes6000** | `d556c524bda75cc7c5b5f13b6433ede7` | **프로드** (현 운영, Worker `alleditor`) |
| **ttimesvibe** | `fb0a10864393158e940b149b3ead37f6` | **refactor-track 테스트** (Worker `ttimes-editor`, 신규 기능 선행 실험장) |

### 왜 두 환경이 병행 운영되나 (중요)

**둘 다 실제로 쓰이고 있음 — 테스트가 "죽은" 환경이 아님.**
- **ttimes6000 `alleditor`** = 운영 — 전체 팀이 매일 쓰는 안정 버전 (리스트 뷰, 기존 dashboard).
- **ttimesvibe `ttimes-editor`** = refactor-track 테스트 — Kanban 뷰, 역할 배정, 촬영 일정, "내 프로젝트만 보기" 같은 **신규 기능을 이쪽에 먼저 구현**해 테스터들이 돌려본 뒤 검증이 끝나면 prod(alleditor)로 promote.
- 같은 사용자가 **양쪽에 동일/유사 프로젝트를 나란히 만들어** 비교하기도 함 ("김민정 6강" vs "김민정 6강 싱크" 같은 이름 중복). 공통 프로젝트의 updatedAt 이 test 쪽이 더 최신인 것도 이 때문 — 테스터가 Kanban 에서 같은 프로젝트를 만지는 중.

**함의**:
- **양쪽 KV 를 서로 동기화하지 않는다**. 목적이 다르기 때문에 drift 는 정상.
- test-side 에 기능이 안착하면 **코드를 prod 로 promote**, KV 데이터는 각자 유지.
- "이관(migrate) / diff & sync" 같은 접근은 **이 프로젝트에 틀린 프레임**. 올바른 접근: 양쪽 환경을 각자의 목적대로 유지하되, **코드 동기화 루틴만 잘 관리**.

- `wrangler whoami` 시 OAuth 로그인 이메일은 `ttimesvibe@gmail.com` 이지만 두 계정 모두 권한을 가진 상태.
- `worker/wrangler.toml` 에 `account_id = "d556c524..."` 가 하드코딩돼 있어 기본 타깃은 **프로드(ttimes6000)**.

### ttimesvibe(테스트) 계정 조회 방법

`worker/` 디렉터리 안에서 `CLOUDFLARE_ACCOUNT_ID` env var 를 설정해도 `wrangler.toml` 의 `account_id` 가 덮어쓰기 합니다. 테스트 계정을 조회하려면 **다른 디렉터리**(예: `%TEMP%`)로 이동해서 env 로 강제해야 합니다:

```bash
cd /tmp   # 또는 임의의 wrangler.toml 이 없는 경로
export CLOUDFLARE_ACCOUNT_ID=fb0a10864393158e940b149b3ead37f6
npx -y wrangler kv namespace list
npx -y wrangler kv key list --namespace-id=<id> --remote
```

`--remote` 플래그 없이는 로컬 dev 캐시를 조회하므로 빈 결과가 반환됩니다. 프로드·테스트 실제 KV 를 보려면 항상 `--remote` 필수.

---

## KV Namespaces

### ttimes6000 (프로드) 계정

| id | title | 용도 |
|---|---|---|
| `2892f3a4de90429dbcf0eb272578009e` | **editor-session** (단수) | **프로드 SESSIONS** (현재 운영 바인딩, ~145 keys) |
| `52ba7093bf864f1d91a4ddf0c8f08b01` | auth-kv | 인증 (다른 서비스) |
| `30e3cbcd39d14b8fade9c8c447a84fbf` | video-review-sessions | 영상 리뷰 (다른 서비스) |

### ttimesvibe (테스트/레거시) 계정

| id | title | 용도 | keys |
|---|---|---|---:|
| `9e4f5bb9cd294b86868e4b9d502adbcc` | **editor-sessions** (복수) | **refactor-track 테스트 Worker `ttimes-editor` 의 SESSIONS** — 활성 운영 | ~90 |
| `b4c4e3c3944146cb856b2622fff59473` | ttimes-editor-sessions | **레거시** (refactor 이전 스키마 `save_*`, `session_index`, `shared_dict`, 더 이상 안 씀) | ~8 |
| `b91de13be69045e59941b1ff000ffa0a` | SESSIONS | 용도 불명 (generic name) | ? |
| `fe10896854fb4fe994e85ecadd11079c` | hilight-sessions | 하이라이트 서비스 | ? |
| `e996e428a46c48a0bd12d01cb1ea87fa` | modify-sessions | 수정 서비스 | ? |
| `41a11a71bd72436dbad9f5ce324dd555` | subtitle-sessions | 자막 서비스 | ? |
| `1506cd4fc76b4e55b09856a6111fb9ec` | ttimes-doctor-sessions | 닥터(이전 버전) | ? |
| `d046679406244b3a8c75f804fca5a51b` | visual-sessions | 비주얼 서비스 | ? |

### 네임스페이스 혼동 포인트
- **editor-session (단수, prod) ≠ editor-sessions (복수, test)** — 계정도 다르고 목적도 다름.
- 두 KV 는 스키마는 같지만 **서로 다른 Worker / 다른 사용자 그룹 / 다른 기능셋** 을 담는다. diff 해서 **sync 할 대상이 아님** (사용자 의도적 병행 운영).
- ttimes-editor-sessions 는 이름이 비슷하지만 **스키마가 완전히 다른 레거시** — 현 운영 대상 아님.

---

## Worker 배포

### 프로드 (현 리포 타깃)
- 이름: **`alleditor`** (ttimes6000), URL `https://alleditor.ttimes6000.workers.dev`
- 바인딩: `SESSIONS` → `2892f3a4de90429dbcf0eb272578009e`
- 배포: `cd worker && npx wrangler deploy`
- 로그: `npx wrangler tail`

### refactor-track 테스트 (별도 Worker)
- 이름: **`ttimes-editor`** (추정, ttimesvibe 계정) — 실제 URL 은 운영자 확인 필요
- 바인딩: SESSIONS → `9e4f5bb9cd294b86868e4b9d502adbcc` (editor-sessions, 복수)
- **현재 이 리포의 `worker/wrangler.toml` 은 prod 전용**. 테스트 쪽 배포는 별도 설정/리포에서 이뤄짐. 이 리포에서 `wrangler deploy` 하면 prod 만 반영됨.
- test-only 신규 기능(Kanban 등) 도 프로드 코드에 `if` 분기로 들어가 있을 수 있고, 분리된 브랜치/파일로 있을 수도 있음 — 작업 전 커밋 히스토리로 확인 필요.

### 절대 금지
- `wrangler.toml` 에 `[placement]` 블록 추가 금지 — 대시보드 Region 설정(GCP US)이 덮어씌워짐.

---

## 프론트엔드 빌드

- 배포 위치: **`docs/`** (GitHub Pages, `main` 브랜치 `/docs` 폴더).
- URL: `https://ttimesvibe.github.io/editor/` (리포 소유: `github.com/ttimesvibe/editor`).
- 빌드: `cd docs && npm run build`
- 임시 디렉터리(`%TEMP%/service-build/` 등)에서 빌드하지 말 것 — 과거 drift 사고 발생. `docs/BUILD.md` 참고.
- `docs/build.js` 의 pre/post drift guard 가 `config.js` 의 `workerUrl` drift 를 자동 차단.

### Canonical Worker URL
`https://alleditor.ttimes6000.workers.dev` — `docs/src/utils/config.js` 와 `docs/build.js` 양쪽에 같이 박혀 있음. 변경 시 두 곳 동시 수정.

### Git 리모트
- `origin` → `github.com/ttimesvibe/ttimes-editor` (리팩터 원본)
- `editor` → `github.com/ttimesvibe/editor` (현 Pages 배포처). **푸시 타깃은 `editor/main`**.

---

## 자주 하는 실수 방지 체크리스트

- [ ] ttimesvibe 계정 작업 시 `%TEMP%` 등 wrangler.toml 없는 곳에서 실행했는가?
- [ ] `wrangler kv key list` 시 `--remote` 플래그 붙였는가?
- [ ] 프론트엔드 빌드는 `docs/` 에서 했는가? (임시 경로 X)
- [ ] `config.js` 의 `workerUrl` 변경 시 `build.js` 의 `CANONICAL_WORKER_URL` 도 같이 수정했는가?
- [ ] worker 배포 후 `wrangler tail` 로 실제 반영 확인했는가?
- [ ] git push 타깃이 `editor/main` 인가? (`origin/main` 아님)
