# 허진호 1편 (deleted)

- **세션 ID**: `4eg1p3w172q70`
- **판정**: ✅ project_index entry 는 04-24 06:54 에 업데이트됐으나 내부 세션 meta/탭의 savedAt 은 4/16~17 이후 변경 없음 — **인덱스 rebuild 성 touch 만**, 실 저장 아님

## project_index 비교

**PROD project_index**:
- fn: `허진호 1편`
- creator: 홍재의 (hjae@mt.co.kr)
- editors: ['hjae@mt.co.kr', 'hjae@mt.co.kr', 'dmlwjd22@mt.co.kr']
- createdAt: 2026-04-14 14:12:49 KST
- updatedAt: **2026-04-19 23:52:40 KST**
- currentStep: `done`  stepProgress: [True, True, True, True, True, True, True, True]
- ⚠️ deleted: `True` at 2026-04-14 14:27:34 KST by hjae@mt.co.kr

**TEST project_index**:
- fn: `허진호 1편`
- creator: 홍재의 (hjae@mt.co.kr)
- editors: ['hjae@mt.co.kr', 'hjae@mt.co.kr', 'dmlwjd22@mt.co.kr']
- createdAt: 2026-04-14 14:12:49 KST
- updatedAt: **2026-04-24 15:54:04 KST**
- currentStep: `done`  stepProgress: [True, True, True, True, True, True, True, True]
- ⚠️ deleted: `True` at 2026-04-14 14:27:34 KST

## 탭별 저장 타임라인

| 탭 | PROD savedAt | PROD 크기 | TEST savedAt | TEST 크기 |
|---|---|---:|---|---:|
| correction | - | - | 2026-04-18 03:17:05 KST | 158696 |
| guide | - | - | 2026-04-18 03:17:04 KST | 105 |
| meta | - | - | 2026-04-18 03:17:05 KST | 397 |
| metadata | - | - | 2026-04-17 22:54:31 KST | 857 |
| review | - | - | 2026-04-18 03:17:05 KST | 219649 |

## 파일 경로 (유실 신고 시 열어볼 것)

**test 원본 (복원용 소스)**:
- `kv-snapshot/20260424-test-fetch/s_4eg1p3w172q70_correction.json`
- `kv-snapshot/20260424-test-fetch/s_4eg1p3w172q70_guide.json`
- `kv-snapshot/20260424-test-fetch/s_4eg1p3w172q70_meta.json`
- `kv-snapshot/20260424-test-fetch/s_4eg1p3w172q70_metadata.json`
- `kv-snapshot/20260424-test-fetch/s_4eg1p3w172q70_review.json`

**prod 비교 (당시)**:

## 세부 설명

project_index entry 는 2026-04-24 06:53~06:54 KST(=04-24 오후 KST) 에 업데이트됐으나, **실제 세션 데이터(meta, 탭들) 는 4/16~4/17 이후 건드려지지 않음**. 10초 이내 클러스터(5개 프로젝트 동시)인 것으로 볼 때, 누군가 test KV 에서 `/projects/rebuild-index` 같은 인덱스 재생성 작업을 돌린 부산물. 실 저장 아님.
