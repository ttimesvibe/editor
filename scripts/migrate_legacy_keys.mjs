#!/usr/bin/env node
// CMS v2 — Legacy key 마이그레이션 (묶음 ⑪)
// 사용:
//   node scripts/migrate_legacy_keys.mjs analyze     — 현황 분석만
//   node scripts/migrate_legacy_keys.mjs migrate     — save_*/auto_* → s:{id}:* 변환
//   node scripts/migrate_legacy_keys.mjs purge       — analyze 결과 기반 영구 삭제 (사용자 명시 승인 후)
//
// 처리 대상:
// - save_{id} → s:{id}:correction (또는 적절한 탭)
// - auto_{id} → 7일 TTL 만료에 맡김 (자동저장 백업이라 영구 보존 불요)
// - shared_dict → 단어장 KV — 별도 처리 (auth Worker 와 분리)

import { execSync } from "node:child_process";
import fs from "node:fs";

const NS = "2892f3a4de90429dbcf0eb272578009e"; // PROD editor-session
const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || "d556c524bda75cc7c5b5f13b6433ede7";
const MODE = process.argv[2] || "analyze";

function wrangler(cmd) {
  try {
    return execSync(`npx -y wrangler ${cmd} --namespace-id=${NS} --remote`, {
      encoding: "utf8",
      env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID },
    });
  } catch { return null; }
}

function listAllKeys() {
  const out = wrangler("kv key list");
  if (!out) return [];
  try { return JSON.parse(out); } catch { return []; }
}

function getKey(key) {
  const out = wrangler(`kv key get "${key}"`);
  if (!out) return null;
  try { return JSON.parse(out); } catch { return out; }
}

function putKey(key, value) {
  const tmp = `./tmp-legacy-${Date.now()}.json`;
  fs.writeFileSync(tmp, typeof value === "string" ? value : JSON.stringify(value));
  try {
    execSync(`npx -y wrangler kv key put "${key}" --path="${tmp}" --namespace-id=${NS} --remote`, {
      env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID },
      encoding: "utf8",
    });
  } finally { fs.unlinkSync(tmp); }
}

function deleteKey(key) {
  execSync(`npx -y wrangler kv key delete "${key}" --namespace-id=${NS} --remote`, {
    env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID },
    encoding: "utf8",
  });
}

async function analyze() {
  console.log("🔍 1단계 — legacy key 분석");
  const keys = listAllKeys();
  const stats = {
    total: keys.length,
    save_: keys.filter(k => k.name.startsWith("save_")).length,
    auto_: keys.filter(k => k.name.startsWith("auto_")).length,
    shared_dict: keys.filter(k => k.name === "shared_dict").length,
    s_prefix: keys.filter(k => k.name.startsWith("s:")).length,
    project_index: keys.filter(k => k.name === "project_index").length,
    session_index: keys.filter(k => k.name === "session_index").length,
    other: keys.filter(k => !k.name.startsWith("save_") && !k.name.startsWith("auto_") && !k.name.startsWith("s:") && !["shared_dict", "project_index", "session_index"].includes(k.name)).length,
  };
  console.log(JSON.stringify(stats, null, 2));
  return { keys, stats };
}

async function migrate() {
  console.log("🚀 2단계 — save_* 마이그레이션 (auto_* 는 TTL 만료)");
  const { keys, stats } = await analyze();
  const saveLegacy = keys.filter(k => k.name.startsWith("save_"));
  let migrated = 0;
  for (const { name } of saveLegacy) {
    const id = name.replace("save_", "");
    const data = getKey(name);
    if (!data) continue;
    // save_{id} 의 데이터를 s:{id}:correction 으로 (대표 탭)
    const targetKey = `s:${id}:correction`;
    const existing = getKey(targetKey);
    if (existing) {
      console.log(`  skip ${name} → ${targetKey} (이미 존재)`);
      continue;
    }
    // 변환: legacy save_*  data {blocks, anal, diffs, hl, ...}
    const correction = {
      blocks: data.blocks || [],
      anal: data.anal || null,
      diffs: data.diffs || [],
      scriptEdits: data.scriptEdits || {},
      blockDeletions: data.blockDeletions || {},
      savedAt: data.savedAt || new Date().toISOString(),
      version: 1,
      _migratedFrom: name,
    };
    putKey(targetKey, correction);
    console.log(`  ✓ ${name} → ${targetKey}`);
    migrated += 1;
  }
  console.log(`✅ ${migrated} save_* keys migrated`);
  console.log("ℹ auto_* keys 는 7일 TTL 만료에 맡김 (backup 성격이라 영구 보존 불필요)");
}

async function purge() {
  console.log("⏪ 3단계 — legacy key 영구 삭제 (사용자 명시 승인 후만)");
  const { keys } = await analyze();
  const targets = keys.filter(k => k.name.startsWith("save_") || k.name.startsWith("auto_") || k.name === "shared_dict");
  console.log(`삭제 대상: ${targets.length} keys`);
  console.log("⚠ 사용자 승인 필요. 실 삭제 진행하려면 --confirm 추가:");
  if (!process.argv.includes("--confirm")) {
    console.log("  node scripts/migrate_legacy_keys.mjs purge --confirm");
    return;
  }
  for (const { name } of targets) {
    deleteKey(name);
    console.log(`  ✗ ${name} deleted`);
  }
  console.log(`✅ ${targets.length} keys purged`);
}

(async () => {
  if (MODE === "analyze") await analyze();
  else if (MODE === "migrate") await migrate();
  else if (MODE === "purge") await purge();
  else console.error("Unknown mode:", MODE);
})();
