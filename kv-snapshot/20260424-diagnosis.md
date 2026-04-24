# 2026-04-24 drift 오라우팅 진단 마스터 문서

## 사건 개요

**drift 창**: 2026-04-19 ~ 2026-04-24 18:49 KST

- 프로드 프론트엔드 번들 (`docs/assets/index-D0qqRa9e.js` 세대) 에 구 test worker URL (`editor.ttimes.workers.dev`) 이 하드코딩된 채 GitHub Pages 로 배포됨
- 원인: temp 디렉터리 (`%TEMP%/service-build/`) 의 `config.js` 가 repo 최신판과 동기화되지 않은 채 빌드 소스로 쓰임
- drift 창 동안 **stale bundle 이 캐시된 브라우저의 저장 요청은 test Worker (`editor.ttimes.workers.dev`) → test KV (`editor-sessions` 복수, ttimesvibe)** 로 감
- 2026-04-24 18:49 KST 에 수정 번들 배포 (커밋 `4c55b05` 이후) 로 drift 실질 종료

## 진단 결과

**실작업물 유실: 0건**

### 13개 후보 프로젝트 전수 조사

| # | 프로젝트 | sid | 판정 | 복구? |
|---|---|---|---|:---:|
| 1 | 정지훈 1편 | `534h4v241x5f3` | content-identical (timestamp 만 다름) | ❌ |
| 2 | 정지훈 2편 | `6s5p3iy301v11` | 6탭 동일 + modify 는 홍재의 test 더미 | ❌ |
| 3 | 박종선 1편 | `x1o38d1t4l5w` | test/prod 양쪽 빈 modify | ❌ |
| 4 | 260331_허진호 1편 | `420p4l6h3a3b` | orphan 이미지 1장 (prod 참조 없음) | ❌ |
| 5 | 허진호 2편 | `1c1f35223w1ke` | phantom touch (04-16 이후 변경 없음) | ❌ |
| 6 | 이중학 1편 다시 | `2c2v5d2a4j3k4` | phantom touch | ❌ |
| 7 | 김지현 | `2s6x5z5m1e6c4` | phantom touch | ❌ |
| 8 | 허진호 2편 (다른 id) | `3620p4x4n25t` | phantom touch | ❌ |
| 9 | 허진호 1편 (deleted) | `4eg1p3w172q70` | phantom touch | ❌ |
| 10 | 강정수 싱크 (deleted) | `mnxehfhmofd3c2` | drift 이전 mirror, 양쪽 동일 | ❌ |
| 11 | 김민정 6강 싱크 | `o436i42d286b` | test-only (홍재의 test 환경 독립 프로젝트) | ❌ |
| 12 | 박종천 2편 | `mnw2nop1p7w73j` | pre-drift test-only | ❌ |
| 13 | 260413_허진호 2편 | `mnwpy8p7c16swe` | pre-drift test-only | ❌ |

## 왜 유실이 0건이었나 — 기전 정리

### (가) Phantom touch 클러스터 (5개)
- `1c1f35223w1ke`, `2c2v5d2a4j3k4`, `2s6x5z5m1e6c4`, `3620p4x4n25t`, `4eg1p3w172q70`
- 공통: test project_index 의 `updatedAt` 이 2026-04-24 06:53:59 ~ 06:54:08 KST (10초 이내 클러스터)
- 하지만 **세션 내부 `meta.updatedAt` 은 4/16~4/17** 로 일주일 전
- 해석: 누군가 test KV 에서 `/projects/rebuild-index` 같은 인덱스 재구성 호출 → 모든 entry 의 `updatedAt` 만 일괄 touch. **탭 저장 아님.**

### (나) Content-identical 저장 (2개, 정지훈 1편/2편 부분)
- 7개 (정지훈 1편 전부 + 정지훈 2편 6개 탭) 가 prod/test deep diff 결과 **실 내용 diff 0개**, timestamp 만 다름
- 해석 시나리오:
  1. 사용자가 stale bundle 로 접속 → test KV 에서 기존 데이터 로드 (test 에 4/19 이전 copy 가 있었음)
  2. 편집 없이 저장 버튼 누름 → test 에 동일 content 새 savedAt 으로 쓰임
  3. 새 번들로 재접속 → prod 데이터 로드 → 역시 편집 없이 저장 → prod 도 같은 content 새 savedAt 으로 쓰임
- 실제 사용자 편집이 없었거나, 있어도 양쪽에 동일하게 반영됨 → **유실 없음**

### (다) Test 더미 저장 (1개, 정지훈 2편 modify)
- test modify 카드 4개: "테스트", "테스트2", "테스트3", "에러 판단" 전부 `checked=True`
- `createdBy.email: hjae@mt.co.kr` (홍재의 본인) — prod editors 의 박성수가 아님
- prod modify 는 박성수의 진짜 편집 지시 15 카드
- 해석: **홍재의가 test 환경 (Kanban 테스트 Worker) 에서 수정사항 카드 UI 를 실험**. drift misroute 아님.
- **test → prod 복사 금지** (박성수 실작업 15→4 로 덮이는 참사)

### (라) 빈 저장 (1개, 박종선 1편)
- test/prod modify 모두 `{"videoUrl":"","cards":[],...}` 완전 빈 값
- 사용자가 수정사항 탭 열었다가 아무것도 입력 안 하고 저장 버튼만 누른 흔적. 양쪽 동일.

### (마) Orphan 이미지 (1개, 260331_허진호 1편)
- test 에 `s:420p4l6h3a3b:img:ohg4to27` JPEG 1장만 존재
- prod 의 visual/setgen 어디에도 `ohg4to27` 참조 없음
- 해석: 사용자가 이미지를 업로드했으나 해당 프로젝트의 자료그래픽 카드에 연결 안 함. 업로드만 test 로 샜음. **복구해도 쓰이지 않음.**

### (바) Pre-drift 데이터 / test 환경 프로젝트 (4개)
- `mnxehfhmofd3c2`, `mnw2nop1p7w73j`, `mnwpy8p7c16swe`, `o436i42d286b`
- 전부 drift 창 이전 (4/13~4/14) 에 test 환경에서 만들어졌거나, drift 와 무관하게 test 에만 존재하는 실험 프로젝트
- drift 오라우팅과 무관

## 추가 증거

### save_<sid> / auto_<sid> 키 (prod/test 양쪽)
- 8개 공통 `save_*` 및 `auto_mnxehfhmofd3c2` 키 모두 **byte-identical** (동일 md5 해시)
- savedAt 전부 4/13~4/16 (pre-drift)
- 오래된 자동저장 스냅샷이 양쪽에 미러링되어 보존된 상태. 새 저장은 이 키로 더 이상 쓰이지 않음.

### 양쪽 저장이 모두 4/24 오후 KST 에 발생한 2개 프로젝트
- **정지훈 2편 `6s5p3iy301v11`**: test 13:12~15:33 저장 → prod 17:41~18:03 저장. modify 빼고 content 동일.
- **박종선 1편 `x1o38d1t4l5w`**: test 16:14 저장 → prod 17:58 저장. 양쪽 모두 빈 값.

둘 다 사용자의 실 편집 데이터가 test 에 갇혀있지 않음.

## 조치

1. ✅ 이관 스크립트 실행 보류 (복구 대상 0)
2. ✅ 전체 KV raw 덤프를 로컬 보존 (`kv-snapshot/20260424-{test,prod}-fetch/`)
3. ✅ 프로젝트별 진단 카드 생성 (`kv-snapshot/20260424-per-project/`)
4. ✅ 팀원 유실 신고 대응 가이드 작성 (`kv-snapshot/retrieval-guide.md`)
5. ✅ 드리프트 원인/guard 조치는 WORKPLAN Task #4, #5 로 완료 (`docs/build.js` pre/post drift guard, temp 디렉터리 폐기)

## 관련 커밋

| 커밋 | 내용 |
|---|---|
| `4c55b05` | docxParser self-closing w:del fix + 첫 수정 번들 배포 (18:49 KST, drift 종료) |
| `33ed891` | worker 고유명사 할루시네이션 차단 |
| `e0c800b` | build drift guard 추가 (prebuild config.js workerUrl 검사 + postbuild 번들 내 URL 검사) |
| `91fede4` | docxParser unit test + build stale 번들 자동 purge |
| `a72e657`, `37bfb10`, `1712fb3` | CLAUDE.md 운영 메모 (두 계정·KV 관행·drift 복구 원칙) |

## 재발 방지

`docs/build.js` 에 박힌 drift guard:
- **prebuild**: `src/utils/config.js` 의 `workerUrl` 이 canonical (`alleditor.ttimes6000.workers.dev`) 아니면 빌드 실패
- **postbuild**: 번들 JS 에 FORBIDDEN URL (`editor.ttimes.workers.dev`, `ttimes-editor.ttimes6000.workers.dev`) 잔존 시 실패
- **postbuild**: canonical URL 이 빌드 결과 어디에도 없으면 실패

Temp 디렉터리 (`%TEMP%/service-build/`) 는 삭제됐고, `docs/BUILD.md` 에 "반드시 `docs/` 에서만 빌드" 명시.
