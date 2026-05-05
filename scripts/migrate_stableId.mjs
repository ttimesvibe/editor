#!/usr/bin/env node
// CMS v2 — _stableId 마이그레이션 스크립트 (B2)
// 사용:
//   node scripts/migrate_stableId.mjs dry-run [--ns=<namespace_id>]
//   node scripts/migrate_stableId.mjs commit  [--ns=<namespace_id>]
//   node scripts/migrate_stableId.mjs rollback <backup-file> [--ns=<namespace_id>]
//
// 5단계: 백업 dump → 분석 → 본 실행 (entity 단위 진행 추적) → random sample 검증 → rollback 매뉴얼

import { execSync } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import fs from "node:fs";

// ── 설정 ──
const DEFAULT_NS = "2892f3a4de90429dbcf0eb272578009e";  // PROD editor-session
const NS = process.argv.find(a => a.startsWith("--ns="))?.split("=")[1] || DEFAULT_NS;
const MODE = process.argv[2] || "dry-run";
const ROLLBACK_FILE = process.argv[3];

const ENTITIES_TO_MIGRATE = ["hl", "visualGuides", "insertCuts", "manualResources", "diffs"];
const STATUS_KEY = "migrate:_stableId:status";
const SAMPLE_SIZE = 10;

// ── 유틸 ──
// CMS v2 — multi-account 환경에서 명시적 account_id 전달 (CLAUDE.md 메모: 두 계정 보유)
const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || "d556c524bda75cc7c5b5f13b6433ede7"; // PROD 기본
function wrangler(cmd) {
  try {
    return execSync(`npx -y wrangler ${cmd} --namespace-id=${NS} --remote`, {
      encoding: "utf8",
      env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID },
    });
  } catch (e) {
    return null;
  }
}

function listAllKeys() {
  const out = wrangler("kv key list");
  if (!out) return [];
  try { return JSON.parse(out); } catch { return []; }
}

function getKey(key) {
  const out = wrangler(`kv key get "${key}"`);
  if (!out) return null;
  try { return JSON.parse(out); } catch { return null; }
}

function putKey(key, value) {
  const tmp = `./tmp-${Date.now()}-${Math.random().toString(36).slice(2,8)}.json`;
  fs.writeFileSync(tmp, JSON.stringify(value));
  try {
    execSync(`npx -y wrangler kv key put "${key}" --path="${tmp}" --namespace-id=${NS} --remote`, { encoding: "utf8" });
  } finally {
    fs.unlinkSync(tmp);
  }
}

// ── 1단계 — 백업 dump ──
async function dumpAll() {
  console.log("📥 1단계 — 백업 dump 시작");
  const keys = listAllKeys();
  const targetKeys = keys.filter(k =>
    k.name.startsWith("s:") && (k.name.endsWith(":guide") || k.name.endsWith(":visual") || k.name.endsWith(":highlight") || k.name.endsWith(":correction"))
  );
  console.log(`  대상 ${targetKeys.length}개 / 전체 ${keys.length}개`);

  const dump = {};
  for (const { name } of targetKeys) {
    const value = getKey(name);
    if (value) dump[name] = value;
  }
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `./kv-backup-${ts}.json`;
  fs.writeFileSync(backupPath, JSON.stringify(dump, null, 2));
  console.log(`✅ 백업 완료: ${backupPath} (${Object.keys(dump).length} keys)`);
  return { dump, backupPath };
}

// ── 2단계 — 분석 ──
function analyzeDump(dump) {
  console.log("🔍 2단계 — 분석");
  const stats = {
    totalKeys: 0,
    totalEntities: 0,
    alreadyMigrated: 0,
    toMigrate: 0,
    anomalies: [],
    perEntity: {},
  };
  for (const t of ENTITIES_TO_MIGRATE) stats.perEntity[t] = { total: 0, migrated: 0, toMigrate: 0 };

  for (const [key, value] of Object.entries(dump)) {
    stats.totalKeys += 1;
    for (const entityType of ENTITIES_TO_MIGRATE) {
      const arr = value?.[entityType];
      if (!Array.isArray(arr)) continue;
      for (const item of arr) {
        stats.totalEntities += 1;
        stats.perEntity[entityType].total += 1;
        if (item._stableId) {
          stats.alreadyMigrated += 1;
          stats.perEntity[entityType].migrated += 1;
        } else if (typeof item !== "object" || item === null || Array.isArray(item)) {
          // 진짜 비정상: 객체가 아닌 경우만
          stats.anomalies.push({ key, entityType, item });
        } else {
          // entity 마다 식별 필드 다름 (hl: subtitle/text, visualGuides: query/type/url, diffs: blockIndex/posStart 등)
          // _stableId 부재 = 마이그레이션 대상.
          stats.toMigrate += 1;
          stats.perEntity[entityType].toMigrate += 1;
        }
      }
    }
  }
  console.log(JSON.stringify(stats, null, 2));
  return stats;
}

// ── 3단계 — 본 실행 ──
async function commitMigration(dump, backupPath) {
  console.log("🚀 3단계 — 본 실행");
  // 진행 상태 (idempotent)
  const existingStatus = getKey(STATUS_KEY);
  const processed = new Set(existingStatus?.processed || []);
  console.log(`  이미 처리된 키: ${processed.size}개 (재실행 시 skip)`);

  let migratedCount = 0;
  let processedKeys = 0;
  for (const [key, value] of Object.entries(dump)) {
    if (processed.has(key)) continue;
    let dirty = false;
    for (const entityType of ENTITIES_TO_MIGRATE) {
      if (!Array.isArray(value?.[entityType])) continue;
      for (const item of value[entityType]) {
        if (!item._stableId) {
          item._stableId = randomUUID();
          dirty = true;
          migratedCount += 1;
        }
      }
    }
    if (dirty) {
      // version 도 도입 (B5) — 현재 0 또는 부재 → 1
      value.version = (value.version || 0) + 1;
      putKey(key, value);
    }
    processed.add(key);
    processedKeys += 1;
    // 매 entity 후 상태 키 갱신 (재실행 안전)
    putKey(STATUS_KEY, {
      processed: [...processed],
      lastProcessedAt: new Date().toISOString(),
      backupPath,
      mode: "commit",
    });
    if (processedKeys % 10 === 0) console.log(`  진행: ${processedKeys} keys / ${migratedCount} entities`);
  }
  console.log(`✅ ${migratedCount} entities migrated across ${processedKeys} keys`);
  return migratedCount;
}

// ── 4단계 — random sample 검증 ──
function verify(dump, sampleSize = SAMPLE_SIZE) {
  console.log("🧪 4단계 — random sample 검증");
  const keys = Object.keys(dump);
  const samples = keys.sort(() => Math.random() - 0.5).slice(0, sampleSize);
  const issues = [];
  for (const key of samples) {
    const live = getKey(key);
    if (!live) { issues.push({ key, issue: "missing" }); continue; }
    for (const entityType of ENTITIES_TO_MIGRATE) {
      const arr = live?.[entityType];
      if (!Array.isArray(arr)) continue;
      for (const item of arr) {
        if (!item._stableId) issues.push({ key, entityType, item, issue: "no _stableId" });
      }
    }
    // _stableId unique
    for (const entityType of ENTITIES_TO_MIGRATE) {
      const arr = live?.[entityType];
      if (!Array.isArray(arr)) continue;
      const ids = arr.map(i => i._stableId).filter(Boolean);
      if (new Set(ids).size !== ids.length) {
        issues.push({ key, entityType, issue: "duplicate _stableId" });
      }
    }
  }
  if (issues.length === 0) console.log("✅ 검증 통과");
  else console.error(`❌ ${issues.length} issues:`, issues);
  return issues;
}

// ── 5단계 — rollback ──
async function rollback(backupPath) {
  console.log("⏪ 5단계 — rollback");
  if (!fs.existsSync(backupPath)) {
    console.error(`❌ 백업 파일 없음: ${backupPath}`);
    process.exit(1);
  }
  const dump = JSON.parse(fs.readFileSync(backupPath, "utf8"));
  let restored = 0;
  for (const [key, value] of Object.entries(dump)) {
    putKey(key, value);
    restored += 1;
  }
  // 진행 상태 키 삭제
  execSync(`npx -y wrangler kv key delete "${STATUS_KEY}" --namespace-id=${NS} --remote`, { encoding: "utf8" });
  console.log(`✅ Rollback 완료: ${restored} keys restored from ${backupPath}`);
}

// ── main ──
(async () => {
  console.log(`▶ 모드: ${MODE} / 네임스페이스: ${NS}`);
  if (MODE === "rollback") return rollback(ROLLBACK_FILE);

  const { dump, backupPath } = await dumpAll();
  const stats = analyzeDump(dump);

  if (stats.anomalies.length > 0) {
    console.warn(`⚠ 비정상 entity ${stats.anomalies.length}개 — 사용자 검토 필요. 마이그레이션 중단.`);
    fs.writeFileSync("./anomalies.json", JSON.stringify(stats.anomalies, null, 2));
    return;
  }

  if (MODE === "dry-run") {
    console.log("🛑 dry-run 종료. commit 모드로 재실행 시 본 적용.");
    return;
  }

  await commitMigration(dump, backupPath);
  const issues = verify(dump);
  if (issues.length > 0) {
    console.error(`❌ 검증 실패. 자동 rollback 실행.`);
    await rollback(backupPath);
    process.exit(1);
  }
  console.log("✅ 마이그레이션 완료. 백업 파일 보관:", backupPath);
})();
