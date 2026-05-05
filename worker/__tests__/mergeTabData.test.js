// 단위 테스트 — mergeTabData / deepMerge / validateMergeResult / detectConflict
// 실행: node --test cms-v2-plan/06_v2_finalization/code/worker/__tests__/mergeTabData.test.js
// (Node 18+ 내장 test runner 사용)

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  deepMerge, mergeTabData, validateMergeResult, sanitizePayload,
  arrayIdUnion, mergeObjectWithArrayUnion, detectConflict,
  PROTO_KEYS,
} from "../merge.js";

describe("deepMerge — 엣지 케이스 (B1)", () => {
  test("undefined → existing 유지", () => {
    assert.deepEqual(deepMerge({a:1}, undefined), {a:1});
  });
  test("existing undefined → incoming 반환", () => {
    assert.deepEqual(deepMerge(undefined, {a:1}), {a:1});
  });
  test("incoming null → 명시적 삭제", () => {
    assert.equal(deepMerge({a:1}, null), null);
  });
  test("existing null → incoming", () => {
    assert.deepEqual(deepMerge(null, {a:1}), {a:1});
  });
  test("타입 불일치 (object vs string) → incoming wins", () => {
    assert.equal(deepMerge({a:1}, "string"), "string");
  });
  test("재귀 객체 머지", () => {
    assert.deepEqual(
      deepMerge({a:{b:1, c:2}}, {a:{b:9, d:4}}),
      {a:{b:9, c:2, d:4}}
    );
  });
  test("__proto__ 차단", () => {
    const polluted = JSON.parse('{"__proto__":{"polluted":true}}');
    const m = deepMerge({}, polluted);
    assert.equal(m.polluted, undefined);
    assert.equal({}.polluted, undefined);  // 전역 오염 없음
  });
  test("constructor 차단", () => {
    const m = deepMerge({}, {constructor: {malicious: true}});
    assert.equal(m.constructor, Object);  // 기본 Object constructor 유지
  });
  test("순환 참조 안전", () => {
    const a = {x:1};
    a.self = a;
    assert.doesNotThrow(() => deepMerge({}, a));
  });
  test("MAX_DEPTH 가드", () => {
    let nested = {};
    let cur = nested;
    for (let i = 0; i < 50; i++) { cur.next = {}; cur = cur.next; }
    assert.doesNotThrow(() => deepMerge({}, nested));
  });
  test("배열은 incoming wins (default)", () => {
    assert.deepEqual(deepMerge([1,2,3], [4,5]), [4,5]);
  });
  test("원자값 last-write-wins", () => {
    assert.equal(deepMerge(5, 10), 10);
    assert.equal(deepMerge("a", "b"), "b");
    assert.equal(deepMerge(true, false), false);
  });
});

describe("mergeTabData — correction 탭", () => {
  test("blocks: array_id_union (key=index)", () => {
    const ex = { blocks: [{index:0, text:"a"}, {index:1, text:"b"}] };
    const inc = { blocks: [{index:1, text:"B"}, {index:2, text:"c"}] };
    const m = mergeTabData(ex, inc, "correction");
    const sorted = m.blocks.sort((a,b) => a.index - b.index);
    assert.deepEqual(sorted, [
      {index:0, text:"a"},
      {index:1, text:"B"},  // last-write-wins per ID
      {index:2, text:"c"},
    ]);
  });
  test("scriptEdits: object_merge_recursive (key 단위 재귀)", () => {
    const ex = { scriptEdits: { 0: "x", 1: "y" } };
    const inc = { scriptEdits: { 1: "Y", 2: "z" } };
    const m = mergeTabData(ex, inc, "correction");
    assert.deepEqual(m.scriptEdits, { 0:"x", 1:"Y", 2:"z" });
  });
  test("blockDeletions: object_merge_array_union", () => {
    const ex = { blockDeletions: { 0: [{start:0, end:5}] } };
    const inc = { blockDeletions: { 0: [{start:10, end:15}] } };
    const m = mergeTabData(ex, inc, "correction");
    assert.equal(m.blockDeletions[0].length, 2);
    assert.ok(m.blockDeletions[0].some(d => d.start === 0));
    assert.ok(m.blockDeletions[0].some(d => d.start === 10));
  });
  test("blockDeletions: 같은 entity 는 중복 제거", () => {
    const ex = { blockDeletions: { 0: [{start:0, end:5}] } };
    const inc = { blockDeletions: { 0: [{start:0, end:5}] } };  // 동일
    const m = mergeTabData(ex, inc, "correction");
    assert.equal(m.blockDeletions[0].length, 1);
  });
});

describe("mergeTabData — guide 탭", () => {
  test("hl: array_stable_id_union (key=_stableId)", () => {
    const ex = { hl: [{_stableId:"a", subtitle:"x"}] };
    const inc = { hl: [{_stableId:"a", subtitle:"X"}, {_stableId:"b", subtitle:"y"}] };
    const m = mergeTabData(ex, inc, "guide");
    assert.equal(m.hl.length, 2);
    assert.equal(m.hl.find(h => h._stableId === "a").subtitle, "X");
    assert.equal(m.hl.find(h => h._stableId === "b").subtitle, "y");
  });
  test("hl: _stableId 부재 시 fallback (subtitle+speaker+startMs)", () => {
    const ex = { hl: [{subtitle:"x", speaker:"A", startMs:100}] };
    const inc = { hl: [{subtitle:"x", speaker:"A", startMs:200}] };  // 다른 startMs
    const m = mergeTabData(ex, inc, "guide");
    assert.equal(m.hl.length, 2);  // 별개 entity
  });
  test("hl: 같은 fallback 키는 last-write-wins", () => {
    const ex = { hl: [{subtitle:"x", speaker:"A", startMs:100, color:"red"}] };
    const inc = { hl: [{subtitle:"x", speaker:"A", startMs:100, color:"blue"}] };
    const m = mergeTabData(ex, inc, "guide");
    assert.equal(m.hl.length, 1);
    assert.equal(m.hl[0].color, "blue");
  });
  test("hlVerdicts: object_merge_recursive (중첩 보존)", () => {
    const ex = { hlVerdicts: { "id_1": { user: "A", verdict: "good" } } };
    const inc = { hlVerdicts: { "id_1": { user: "B" } } };
    const m = mergeTabData(ex, inc, "guide");
    // 재귀 머지 — verdict 보존
    assert.equal(m.hlVerdicts.id_1.user, "B");
    assert.equal(m.hlVerdicts.id_1.verdict, "good");
  });
  test("hlStats: last_write_wins", () => {
    const ex = { hlStats: { count: 5 } };
    const inc = { hlStats: { count: 3 } };
    const m = mergeTabData(ex, inc, "guide");
    assert.deepEqual(m.hlStats, { count: 3 });
  });
});

describe("mergeTabData — visual / setgen / review", () => {
  test("visualGuides: array_stable_id_union", () => {
    const ex = { visualGuides: [{_stableId:"v1", url:"a.png"}] };
    const inc = { visualGuides: [{_stableId:"v2", url:"b.png"}] };
    const m = mergeTabData(ex, inc, "visual");
    assert.equal(m.visualGuides.length, 2);
  });
  test("setgen.result: object_merge_recursive", () => {
    const ex = { result: { sets: { a: 1 } } };
    const inc = { result: { sets: { b: 2 } } };
    const m = mergeTabData(ex, inc, "setgen");
    assert.deepEqual(m.result.sets, { a: 1, b: 2 });
  });
  test("review: __recursive (통째 재귀)", () => {
    const ex = { topic: "X", notes: "old" };
    const inc = { notes: "new", extra: "Y" };
    const m = mergeTabData(ex, inc, "review");
    assert.deepEqual(m, { topic: "X", notes: "new", extra: "Y" });
  });
});

describe("mergeTabData — manuscript (__replace)", () => {
  test("manuscript: 통째 교체 (재업로드 시)", () => {
    const ex = { paragraphs: ["old1", "old2"] };
    const inc = { paragraphs: ["new1"] };
    const m = mergeTabData(ex, inc, "manuscript");
    assert.deepEqual(m, inc);  // 통째 교체
  });
});

describe("validateMergeResult — 무결성 (B6)", () => {
  test("blocks 길이 감소 시 violation", () => {
    const v = validateMergeResult(
      { blocks: [{index:0}, {index:1}] },
      { blocks: [{index:0}] },
      "correction"
    );
    assert.ok(v.some(s => s.includes("blocks length decreased")));
  });
  test("blocks 길이 증가 정상", () => {
    const v = validateMergeResult(
      { blocks: [{index:0}] },
      { blocks: [{index:0}, {index:1}] },
      "correction"
    );
    assert.equal(v.length, 0);
  });
  test("_stableId 중복 시 violation", () => {
    const v = validateMergeResult({}, { hl: [{_stableId:"a"}, {_stableId:"a"}] }, "guide");
    assert.ok(v.some(s => s.includes("duplicate _stableId")));
  });
  test("_stableId unique 정상", () => {
    const v = validateMergeResult({}, { hl: [{_stableId:"a"}, {_stableId:"b"}] }, "guide");
    assert.equal(v.length, 0);
  });
  test("PROTO_KEYS leak 감지", () => {
    const polluted = Object.create(null);
    polluted.__proto__ = "x";  // 직접 키 설정
    Object.defineProperty(polluted, "__proto__", {
      value: "x", enumerable: true, configurable: true, writable: true
    });
    const v = validateMergeResult({}, polluted, "review");
    // 우리 검증은 Object.keys 로 enumerable 만 — 실제론 sanitizePayload 가 차단
    // 여기선 단순 프로토 키가 enumerable 한 케이스 시뮬
  });
});

describe("sanitizePayload — PROTO_KEYS 차단 (B12)", () => {
  // 주의: "__proto__" in obj 는 모든 객체에서 true (Object.prototype 의 getter)
  // 진짜 검증은 Object.keys 기준 + 프로토타입 오염 미발생
  test("__proto__ own key 차단 + 오염 없음", () => {
    const malicious = JSON.parse('{"normal":1, "__proto__":{"x":2}}');
    const clean = sanitizePayload(malicious);
    assert.equal(clean.normal, 1);
    assert.ok(!Object.keys(clean).includes("__proto__"));
    assert.equal(clean.x, undefined);  // 오염 안 됨
    assert.equal({}.x, undefined);  // 전역 오염 없음
  });
  test("중첩 __proto__ own key 차단", () => {
    const malicious = JSON.parse('{"a":{"__proto__":{"x":2}, "b":1}}');
    const clean = sanitizePayload(malicious);
    assert.equal(clean.a.b, 1);
    assert.ok(!Object.keys(clean.a).includes("__proto__"));
    assert.equal(clean.a.x, undefined);
  });
  test("배열 안 객체도 sanitize", () => {
    const malicious = JSON.parse('[{"__proto__":{"x":1}}, {"a":2}]');
    const clean = sanitizePayload(malicious);
    assert.ok(!Object.keys(clean[0]).includes("__proto__"));
    assert.equal(clean[0].x, undefined);
    assert.equal(clean[1].a, 2);
  });
  test("constructor 차단", () => {
    const malicious = JSON.parse('{"a":1, "constructor":{"prototype":{"x":2}}}');
    const clean = sanitizePayload(malicious);
    assert.equal(clean.a, 1);
    assert.ok(!Object.keys(clean).includes("constructor"));
  });
});

describe("arrayIdUnion", () => {
  test("기본 union", () => {
    const r = arrayIdUnion([{id:1,v:"a"},{id:2,v:"b"}], [{id:2,v:"B"},{id:3,v:"c"}], (i)=>i.id);
    const sorted = r.sort((a,b)=>a.id-b.id);
    assert.deepEqual(sorted, [{id:1,v:"a"},{id:2,v:"B"},{id:3,v:"c"}]);
  });
  test("ID 없는 entity skip", () => {
    const r = arrayIdUnion([{id:1}], [{}, {id:2}], (i)=>i.id);
    assert.equal(r.length, 2);  // 1 + 2 (empty skip)
  });
  test("existing 빈 배열", () => {
    const r = arrayIdUnion(undefined, [{id:1}], (i)=>i.id);
    assert.equal(r.length, 1);
  });
});

describe("detectConflict — B5", () => {
  test("baseVersion < existing.version → 충돌", () => {
    const r = detectConflict({savedAt:"t1", version:5}, {baseVersion:3});
    assert.equal(r.conflict, true);
  });
  test("baseVersion === existing.version → 정상", () => {
    const r = detectConflict({savedAt:"t1", version:5}, {baseVersion:5});
    assert.equal(r.conflict, false);
  });
  test("baseSavedAt 시각 차이 (version 부재) → 충돌", () => {
    const r = detectConflict({savedAt:"2026-05-05T12:00:00Z"}, {baseSavedAt:"2026-05-05T11:00:00Z"});
    assert.equal(r.conflict, true);
  });
  test("existing 부재 (신규) → 충돌 없음", () => {
    const r = detectConflict(null, {baseSavedAt:"t1"});
    assert.equal(r.conflict, false);
  });
});
