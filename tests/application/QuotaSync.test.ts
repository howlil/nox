import assert from "node:assert/strict";
import test from "node:test";
import { QuotaSync } from "../../src/application/QuotaSync";
import type { QuotaReading } from "../../src/types";

const agyReading:QuotaReading={provider:"agy",key:"gemini:5h",label:"Gemini 5h",kind:"window",remainingPercent:55,shared:true};
const codexReading:QuotaReading={provider:"codex",key:"codex:primary",label:"Codex 5h",kind:"window",remainingPercent:71,shared:true};

test("QuotaSync reads providers, caches data and deduplicates concurrent callers",async()=>{
  let now=100000,agyCalls=0,codexCalls=0;
  const sync=new QuotaSync({
    agy:async()=>{agyCalls++;return [agyReading]},
    codex:async()=>{codexCalls++;return [codexReading]},
  },()=>now,90_000,30_000);
  const [a,b]=await Promise.all([sync.read(),sync.read()]);
  assert.equal(a[0].status,"live");assert.equal(b[1].status,"live");
  assert.equal(agyCalls,1);assert.equal(codexCalls,1);
  now+=50_000;await sync.read();
  assert.equal(agyCalls,1);
  await sync.read(true);
  assert.equal(agyCalls,2);
  sync.dispose();
});

test("Failed refresh marks existing readings stale instead of claiming live balances",async()=>{
  let fail=false;
  const sync=new QuotaSync({
    agy:async()=>{if(fail)throw new Error("do not show credentials");return [agyReading]},
    codex:async()=>[],
  });
  const first=await sync.read();
  assert.equal(first[0].status,"live");
  fail=true;
  const second=await sync.read(true);
  assert.equal(second[0].status,"stale");
  assert.equal(second[0].readings[0].remainingPercent,55);
  assert.ok(!JSON.stringify(second).includes("credentials"));
  sync.dispose();
});

test("A failed provider is unavailable, never shown with invented remaining percentage",async()=>{
  const sync=new QuotaSync({
    agy:async()=>{throw new Error("token-secret")},
    codex:async()=>{throw new Error("private auth")},
  });
  const readings=await sync.read();
  assert.deepEqual(readings.map(x=>x.status),["unavailable","unavailable"]);
  assert.deepEqual(readings.map(x=>x.readings.length),[0,0]);
  assert.ok(!JSON.stringify(readings).includes("token-secret"));
  sync.dispose();
});
