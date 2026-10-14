import assert from "node:assert/strict";
import test from "node:test";
import { parseAgyUsage, parseAgyCredits, parseCodexRateLimits, normalizeUsageModelId } from "../../src/agent/QuotaProtocol";

const agy = {
  conversation_id:"",status:"SUCCESS",num_turns:0,
  command: { name:"usage",data:{ groups:[
    {name:"Gemini Models",buckets:[
      {id:"5h",name:"5h limit",window:"5h",remaining_fraction:0.03,reset_time:"2026-10-15T08:00:00Z"},
      {id:"weekly",name:"Weekly limit",remaining_fraction:0.68,reset_time:"2026-10-20T08:00:00Z"},
    ]},
    {name:"Claude and GPT Models",buckets:[{id:"5h",remaining_fraction:1}]},
  ]}},
};

test("AGY read-only usage parser preserves distinct shared windows, reset and percent", () => {
  const parsed = parseAgyUsage(agy);
  assert.equal(parsed.length,3);
  assert.deepEqual(parsed.map(x=>x.remainingPercent),[3,68,100]);
  assert.deepEqual(parsed.map(x=>x.shared),[true,true,true]);
  assert.equal(parsed[0].resetAt,"2026-10-15T08:00:00.000Z");
  assert.match(parsed[0].label,/Gemini Models · 5h limit/);
});

test("AGY parser rejects a model turn or malformed command instead of treating it as quota", () => {
  for(const value of [
    {...agy,num_turns:1},
    {...agy,conversation_id:"thread-abc"},
    {...agy,command:{name:"models",data:{groups:[]}}},
    {...agy,command:{name:"usage",data:{}}},
    {...agy,status:"ERROR"},
  ]) assert.throws(()=>parseAgyUsage(value),/AGY/);
  assert.deepEqual(parseAgyCredits({status:"SUCCESS",num_turns:1,command:{
    name:"credits",data:{remaining:999},
  }}),[]);
});

test("AGY credits accepts only read-only validated numeric balance",()=>{
  const frame = (balance:unknown)=>({status:"SUCCESS",num_turns:0,conversation_id:"",
    command:{name:"credits",data:{remaining:balance}}});
  assert.equal(parseAgyCredits(frame(17))[0].amount,"17");
  assert.deepEqual(parseAgyCredits(frame("17")),[]);
  assert.deepEqual(parseAgyCredits(frame(-1)),[]);
});

test("Codex primary/secondary percentages are used percentages; credits are not guessed",()=>{
  const parsed = parseCodexRateLimits({
    rateLimits: {limitId:"codex",primary:{usedPercent:42,windowDurationMins:300,resetsAt:1792100000},
      secondary:{usedPercent:9},credits:{hasCredits:false,unlimited:false,balance:null}},
    rateLimitsByLimitId:null,
  });
  assert.equal(parsed.length,2);
  assert.equal(parsed[0].remainingPercent,58);
  assert.equal(parsed[1].remainingPercent,91);
  assert.equal(parsed[0].shared,true);
  assert.ok(parsed[0].resetAt);
  const withSpecific=parseCodexRateLimits({rateLimitsByLimitId:{
    custom:{limitId:"custom",normalModelSlug:"gpt-6",primary:{usedPercent:80},
      credits:{hasCredits:true,balance:"12.5"}},
  }});
  assert.equal(withSpecific[0].model,"gpt-6");
  assert.equal(withSpecific[1].amount,"12.5");
  assert.throws(()=>parseCodexRateLimits({rateLimits:{primary:{usedPercent:150}}}),/Codex/);
});

test("Fallback ledger model IDs are normalized without altering a real provider slug",()=>{
  assert.equal(normalizeUsageModelId("requested: gemini-3.8-flash-medium"),"gemini-3.8-flash-medium");
  assert.equal(normalizeUsageModelId("Gpt-6"),"Gpt-6");
});
