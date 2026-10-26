#!/usr/bin/env node
/**
 * M12.2: native Obsidian Desktop scratch-vault acceptance via official CLI.
 * This is NOT run automatically on CI; it restarts a real desktop process.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, copyFileSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const MARKER = "NOX_M12_DESTRUCTIVE_SCRATCH_VAULT_ONLY";
const MARKER_FILE = ".obsidian/nox-m12-scratch-marker.txt";
const EVIDENCE_FILE = ".obsidian/nox-m12-native-evidence.json";
const PREFIX = "NOX_M12_RESULT:";
const ARTIFACTS = ["main.js", "manifest.json", "styles.css"];

function options(argv) {
  const result = {};
  for (const arg of argv) {
    const match = /^--([a-z-]+)=(.+)$/.exec(arg);
    if (!match || result[match[1]]) throw new Error("Use unique --key=value flags");
    result[match[1]] = match[2];
  }
  return result;
}
function hash(file) { return createHash("sha256").update(readFileSync(file)).digest("hex"); }
function cli(bin, vault, args, timeout = 20_000) {
  const call = spawnSync(bin, ["vault=" + vault, ...args], {
    encoding: "utf8", timeout, windowsHide: true, shell: false, maxBuffer: 2_000_000,
  });
  if (call.error || call.status !== 0) throw new Error(
    "Obsidian CLI failed (" + args[0] + "), exit " + (call.status ?? "unavailable"));
  return call.stdout.trim();
}
function parseProbe(output) {
  const match = new RegExp(PREFIX + "([A-Za-z0-9+/=]+)").exec(output);
  if (!match) throw new Error("CLI eval returned no structured Obsidian result");
  try {
    const data = JSON.parse(Buffer.from(match[1], "base64").toString("utf8"));
    if (!data || typeof data !== "object" || Array.isArray(data)) throw Error();
    return data;
  } catch { throw new Error("CLI eval returned invalid structured result"); }
}
function probe(bin, vault, expression) {
  const code = "(() => { const value=(" + expression + "); return " +
    JSON.stringify(PREFIX) + "+btoa(JSON.stringify(value)); })()";
  return parseProbe(cli(bin, vault, ["eval", "code=" + code]));
}
async function poll(read, accept, label, tries = 32) {
  for (let i = 0; i < tries; i++) {
    try {
      const value = read();
      if (accept(value)) return value;
    } catch { /* Desktop can disconnect during restart. */ }
    await delay(750);
  }
  throw new Error("Native Obsidian never reached: " + label);
}
const vaultExpr = '({path:app.vault.adapter.getBasePath?.()??null,origin:performance.timeOrigin})';
const snapshotExpr = '(() => {const p=app.plugins?.plugins?.nox;const d=p?.getBuildDiagnostics?.();return {' +
  'enabled:Boolean(p),sourceSha:d?.sourceSha??null,transport:d?.transport??null,' +
  'sessionId:p?.learning?.getSession?.()?.id??null,origin:performance.timeOrigin,' +
  'sidebar:app.workspace.getLeavesOfType("nox-sidebar").length,' +
  'root:Boolean(document.querySelector(".nox-root"))};})()';
const startExpr = '(() => {const p=app.plugins?.plugins?.nox;' +
  'if(!p?.learning?.newSession)return {started:false};' +
  'globalThis.__noxM12={status:"pending"};' +
  'void p.learning.newSession().then(x=>{globalThis.__noxM12={status:"done",id:x.id};})' +
  '.catch(()=>{globalThis.__noxM12={status:"error"};});return {started:true};})()';
const readResultExpr = '(globalThis.__noxM12??{status:"missing"})';
const norm = path => String(path).replace(/\\/g, "/").replace(/\/+$/,"").toLowerCase();

function validate({pre, created, post, disabled}) {
  if (!pre?.enabled || !pre.root || pre.sidebar < 1 ||
      !/^[a-f0-9]{40}$/i.test(pre.sourceSha ?? "")) {
    throw new Error("Native plugin did not boot and open its sidebar");
  }
  if (pre.transport !== "NOX_RUNTIME_TRANSPORT_V3:node-https-sse") {
    throw new Error("Installed transport provenance is invalid");
  }
  if (created?.status !== "done" || !created.id || created.id === pre.sessionId) {
    throw new Error("Native plugin failed to create a new session");
  }
  if (!post?.enabled || post.sourceSha !== pre.sourceSha ||
      post.sessionId !== created.id || post.origin === pre.origin ||
      !post.root || post.sidebar < 1) {
    throw new Error("Restart did not restore the same session/build in a new renderer");
  }
  if (disabled?.enabled !== false) throw new Error("Native plugin did not unload");
}
function selfTest() {
  const x = {enabled:true,root:true,sidebar:1,sourceSha:"a".repeat(40),
    transport:"NOX_RUNTIME_TRANSPORT_V3:node-https-sse",sessionId:"old",origin:1};
  const created = {status:"done",id:"new"};
  const y = {...x,origin:2,sessionId:"new"};
  assert.equal(parseProbe(PREFIX+Buffer.from(JSON.stringify(x)).toString("base64")).origin,1);
  assert.doesNotThrow(()=>validate({pre:x,created,post:y,disabled:{enabled:false}}));
  assert.throws(()=>validate({pre:x,created,post:{...y,origin:1},disabled:{enabled:false}}),/Restart/);
  assert.throws(()=>validate({pre:x,created,post:y,disabled:{enabled:true}}),/unload/);
  assert.throws(()=>parseProbe("PASS"),/no structured/);
  console.log("M12.2 runner offline contract checks PASSED; not native acceptance");
}
async function main() {
  const args = options(process.argv.slice(2));
  if (args["self-test"] === "true") return selfTest();
  for (const key of Object.keys(args)) {
    if (!["vault-dir","vault-name","artifact-dir","cli"].includes(key)) {
      throw new Error("Unknown option: " + key);
    }
  }
  const vault = args["vault-dir"];
  const name = args["vault-name"];
  if (!vault || !name || !isAbsolute(vault)) {
    throw new Error("Require absolute --vault-dir and --vault-name");
  }
  const markerPath = join(vault, MARKER_FILE);
  if (!existsSync(markerPath) || readFileSync(markerPath,"utf8").trim() !== MARKER) {
    throw new Error("Scratch vault marker absent; refusing any write or plugin enable");
  }
  const artifact = resolve(args["artifact-dir"]??"dist");
  const manifest = JSON.parse(readFileSync(join(artifact,"manifest.json"),"utf8"));
  if (manifest.id !== "nox" || manifest.isDesktopOnly !== true) {
    throw new Error("Invalid NOX production manifest");
  }
  for (const file of ARTIFACTS) if (!existsSync(join(artifact,file))) {
    throw new Error("Missing production artifact: " + file);
  }
  const binary = args.cli ?? process.env.OBSIDIAN_CLI ?? "obsidian";
  const target = probe(binary,name,vaultExpr);
  if (norm(target.path) !== norm(vault)) {
    throw new Error("Obsidian CLI is targeting another vault; refusing installation");
  }
  const dir = join(vault,".obsidian","plugins","nox");
  const owned = join(dir,".nox-m12-owned");
  if (existsSync(dir) && !existsSync(owned) && readdirSync(dir).length) {
    throw new Error("Refusing to overwrite an existing unmanaged NOX installation");
  }
  mkdirSync(dir,{recursive:true});
  for (const file of ARTIFACTS) copyFileSync(join(artifact,file),join(dir,file));
  writeFileSync(owned,MARKER+"\n");
  const bundleSha256 = hash(join(dir,"main.js"));
  if (bundleSha256 !== hash(join(artifact,"main.js"))) {
    throw new Error("Installed plugin bundle digest mismatch");
  }
  const evidencePath = join(vault,EVIDENCE_FILE);
  const evidence = {schema:"nox-m12-native-v1",status:"IN_PROGRESS",
    vault:basename(vault),sourceSha:null,bundleSha256,obsidianVersion:null,checks:[]};
  const save = () => writeFileSync(evidencePath,JSON.stringify(evidence,null,2)+"\n");
  save();
  try {
    evidence.obsidianVersion = cli(binary,name,["version"]);
    cli(binary,name,["plugins:restrict","off"]);
    cli(binary,name,["plugin:enable","id=nox","filter=community"]);
    await poll(()=>probe(binary,name,snapshotExpr),x=>x.enabled && x.sessionId,"initial boot");
    cli(binary,name,["command","id=nox:open-sidebar"]);
    const pre = await poll(()=>probe(binary,name,snapshotExpr),
      x=>x.root && x.sidebar>0 && x.sessionId,"sidebar");
    evidence.sourceSha = pre.sourceSha;
    evidence.checks.push({id:"installed-sidebar",status:"PASS"});
    // Exercise real vault I/O via Obsidian CLI using a unique scratch note.
    const note = "nox-m12-" + Date.now() + ".md";
    const fixture = "# NOX M12 acceptance\\n\\nNative vault persistence probe";
    cli(binary,name,["create","path="+note,"content="+fixture]);
    if (!cli(binary,name,["read","path="+note]).includes("Native vault persistence probe")) {
      throw new Error("Native Obsidian vault did not persist the scratch note");
    }
    evidence.checks.push({id:"native-vault-write-read",status:"PASS"});
    const screenshotPath = join(vault,".obsidian","nox-m12-sidebar.png");
    cli(binary,name,["dev:screenshot","path="+screenshotPath],30_000);
    if (!existsSync(screenshotPath) || readFileSync(screenshotPath).length < 1024) {
      throw new Error("Native desktop sidebar screenshot not captured");
    }
    evidence.screenshot = ".obsidian/nox-m12-sidebar.png";
    if (!probe(binary,name,startExpr).started) throw new Error("Cannot create native session");
    const created = await poll(()=>probe(binary,name,readResultExpr),
      x=>x.status==="done" || x.status==="error","new session");
    if (created.status !== "done") throw new Error("Native newSession rejected");
    evidence.checks.push({id:"session-created",status:"PASS"});
    cli(binary,name,["restart"],30_000);
    const restarted = await poll(()=>probe(binary,name,snapshotExpr),
      x=>x.enabled && x.sessionId===created.id && x.origin!==pre.origin,"full desktop restart");
    cli(binary,name,["command","id=nox:open-sidebar"]);
    const post = await poll(()=>probe(binary,name,snapshotExpr),
      x=>x.root && x.sidebar>0,"sidebar after restart");
    if (!cli(binary,name,["read","path="+note]).includes("Native vault persistence probe")) {
      throw new Error("Scratch vault note was lost on real Obsidian restart");
    }
    evidence.checks.push({id:"restart-recovered",status:"PASS"});
    cli(binary,name,["plugin:disable","id=nox","filter=community"]);
    const disabled = await poll(()=>probe(binary,name,snapshotExpr),
      x=>x.enabled===false,"plugin disable");
    validate({pre,created,post:{...restarted,...post},disabled});
    evidence.checks.push({id:"unloaded",status:"PASS"});
    evidence.status = "PASS";
    evidence.completedAt = new Date().toISOString();
    save();
    console.log("M12.2 REAL OBSIDIAN NATIVE ACCEPTANCE: PASS");
    console.log("Local evidence: " + evidencePath);
  } catch(error) {
    evidence.status = "FAIL";
    evidence.reason = error instanceof Error ? error.message.slice(0,200) : "Unknown error";
    evidence.completedAt = new Date().toISOString();
    save();
    throw error;
  }
}
main().catch(e=>{console.error("M12.2: "+(e instanceof Error?e.message:"Unknown"));process.exitCode=1;});
