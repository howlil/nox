import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { runAgyQuotaCommands, runCodexQuotaRead, type QuotaSpawn } from "../../src/agent/QuotaProcess";

const usage = JSON.stringify({status:"SUCCESS",num_turns:0,conversation_id:"",
  command:{name:"usage",data:{groups:[{name:"Gemini Models",
    buckets:[{id:"5h",name:"5h limit",remaining_fraction:0.48}]}]}}});
const credits = JSON.stringify({status:"SUCCESS",num_turns:0,conversation_id:"",
  command:{name:"credits",data:{remaining:16}}});

function scriptedSpawn(frames: string[], calls: string[][]) {
  return ((_binary: string,args: string[]) => {
    calls.push(args);
    const child = new EventEmitter() as EventEmitter & {
      stdin: PassThrough; stdout: PassThrough;stderr: PassThrough;kill:()=>boolean;
    };
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;
    const data=frames.shift() ?? "";
    queueMicrotask(()=>{
      child.stdout.write(data);child.stdout.end();
      child.emit("close",0);
    });
    return child;
  }) as unknown as QuotaSpawn;
}

test("AGY refuses unsafe CLI versions without ever sending a model command",async()=>{
  const calls:string[][]=[];
  await assert.rejects(runAgyQuotaCommands("agy",undefined,undefined,
    scriptedSpawn(["agy 1.1.27\n"],calls)),/Update AGY/);
  assert.deepEqual(calls,[["--version"]]);
});

test("AGY only invokes explicit read-only quota slash commands with safe stdout framing",async()=>{
  const calls:string[][]=[];
  const result=await runAgyQuotaCommands("agy",undefined,undefined,
    scriptedSpawn(["agy 1.2.16\n",usage,credits],calls));
  assert.deepEqual(calls,[
    ["--version"],["--output-format","json","-p","/usage"],
    ["--output-format","json","-p","/credits"],
  ]);
  assert.equal((result.usage as {status:string}).status,"SUCCESS");
});

test("AGY detects accidental model turn and stops before querying credits",async()=>{
  const calls:string[][]=[];
  await assert.rejects(runAgyQuotaCommands("agy",undefined,undefined,
    scriptedSpawn(["agy 1.2.16\n",JSON.stringify({status:"SUCCESS",num_turns:1,
      conversation_id:"abc",response:"model output"})],calls)),/read-only/);
  assert.equal(calls.length,2);
});

test("Codex quota reader only performs initialize and account/rateLimits/read",async()=>{
  const messages: unknown[]=[];
  const spawnFn=((_binary:string,args:string[])=>{
    assert.deepEqual(args,["app-server","--listen","stdio://"]);
    const child=new EventEmitter() as EventEmitter & {
      stdin:PassThrough; stdout:PassThrough;stderr:PassThrough;kill:()=>boolean;
    };
    child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();
    child.kill=()=>true;
    let buffer="";
    child.stdin.on("data",(chunk:Buffer)=>{
      buffer+=chunk.toString();
      const lines=buffer.split("\n");buffer=lines.pop()||"";
      for(const line of lines){
        if(!line)continue;
        const req=JSON.parse(line) as {id?:number;method:string};
        messages.push(req.method);
        if(req.method==="initialize") queueMicrotask(()=>child.stdout.write(
          JSON.stringify({id:1,result:{userAgent:"codex"}})+"\n"));
        if(req.method==="account/rateLimits/read") queueMicrotask(()=>child.stdout.write(
          JSON.stringify({id:2,result:{rateLimits:{limitId:"codex",
            primary:{usedPercent:23}}}})+"\n"));
      }
    });
    return child;
  }) as unknown as QuotaSpawn;
  const readings=await runCodexQuotaRead("codex",undefined,undefined,spawnFn);
  assert.equal(readings[0].remainingPercent,77);
  assert.deepEqual(messages,["initialize","initialized","account/rateLimits/read"]);
});
