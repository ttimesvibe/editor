# KV Snapshot 아카이브

Cloudflare Workers KV 스냅샷과 진단 기록을 보관합니다.

## 폴더 구조

```
kv-snapshot/
├── README.md                     ← 이 파일
├── retrieval-guide.md            ★ 팀원이 "어제 저장한 게 없어졌다" 신고 시 사용 가이드
├── 20260424-1845/                prod KV 최초 스냅샷 (145 keys 목록)
├── 20260424-diff/                prod vs test KV 키 차분 분석
│   ├── prod-keys.json            prod 키 전체 목록 (145개)
│   ├── test-keys.json            test 키 전체 목록 (90개)
│   ├── prod-project_index.json   prod 의 project_index 값
│   ├── test-project_index.json   test 의 project_index 값
│   └── diff-summary.json         prod-only/test-only/common 분류
├── 20260424-test-fetch/          test KV 에서 내려받은 key-value 원본 덤프
├── 20260424-prod-fetch/          prod KV 에서 내려받은 비교용 덤프
├── 20260424-diagnosis.md         ★ drift 오라우팅 진단 마스터 문서
├── 20260424-diagnosis-data.json  진단 구조화 데이터 (기계 판독용)
└── 20260424-per-project/         ★ 프로젝트별 개별 진단 카드 (MD)
```

## 스냅샷 시점

- 2026-04-24 야간 (KST) — drift 복구 작업 시점
- prod KV: `editor-session` (ttimes6000, id `2892f3a4de90429dbcf0eb272578009e`), 145 keys
- test KV: `editor-sessions` (ttimesvibe, id `9e4f5bb9cd294b86868e4b9d502adbcc`), 90 keys

## 빠른 사용

**팀원이 "작업한 게 사라졌다" 신고** → `retrieval-guide.md` 참조.

**특정 프로젝트 진단 결과 확인** → `20260424-per-project/<id>_*.md` 직접 열기.

**전체 판정 요약** → `20260424-diagnosis.md` 참조.

## 보안

- `*-fetch/` 아래 raw content JSON 은 **업무 내용 포함**이라 git 에서 제외 (`kv-snapshot/*/s_*.json` 등)
- 메타데이터 (`keys.json`, `project_index.json`, 진단 MD) 는 커밋됨
- raw 데이터는 로컬 OneDrive 동기화로만 보관
