import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { AgyAdapter } from "../../../src/agent/AgyAdapter";
import { collectEvents } from "../../support/collect-events";

class FakeInput extends EventEmitter {
  writes: string[] = [];
  end(value?: unknown) {
    if (value !== undefined) this.writes.push(String(value));
  }
}

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  stdin = new FakeInput();
  exitCode: number | null = null;
  killed = false;

  kill() {
    this.killed = true;
    return true;
  }
}

test("sends prompt/context through stdin instead of argv", async () => {
  const calls: Array<{
    command: string;
    args: readonly string[];
    child: FakeChild;
  }> = [];

  const fakeSpawn = ((command: string, args: readonly string[]) => {
    const child = new FakeChild();
    calls.push({ command, args, child });

    queueMicrotask(() => {
      const line = JSON.stringify({
        event: "result",
        result: {
          status: "SUCCESS",
          response: "done",
        },
      });
      const split = Math.floor(line.length / 2);
      child.stdout.emit("data", Buffer.from(line.slice(0, split)));
      child.stdout.emit("data", Buffer.from(line.slice(split) + "\n"));
      child.exitCode = 0;
      child.emit("close", 0);
    });

    return child;
  }) as never;

  const adapter = new AgyAdapter(
    undefined,
    () => ({ executablePath: "/agy" }),
    {
      spawn: fakeSpawn,
      existsSync: () => true,
      platform: "linux",
      homedir: () => "/home/test",
      env: {},
    },
  );

  const events = await collectEvents(
    adapter.send(
      {
        prompt: "SECRET PROMPT",
        context: [
          {
            type: "note",
            file: 'a&"<.md',
            content: "context body",
          },
        ],
      },
      { model: "model-a" },
      new AbortController().signal,
    ),
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.command, "/agy");
  assert.equal(
    calls[0]?.args.some((arg) => arg.includes("SECRET PROMPT")),
    false,
  );
  assert.deepEqual(calls[0]?.args, [
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--model",
    "model-a",
  ]);

  const stdin = calls[0]?.child.stdin.writes.join("") ?? "";
  const encoded = JSON.parse(stdin.trim());
  assert.match(encoded.message.content, /SECRET PROMPT/);
  assert.match(encoded.message.content, /context body/);
  assert.match(encoded.message.content, /a&amp;&quot;&lt;\.md/);

  assert.deepEqual(events, [
    { type: "text", content: "done" },
    { type: "completed", conversationId: undefined },
  ]);
});

test("aborted requests do not spawn a runtime process", async () => {
  let spawns = 0;
  const adapter = new AgyAdapter(
    undefined,
    () => ({ executablePath: "/agy" }),
    {
      spawn: (() => {
        spawns += 1;
        return new FakeChild();
      }) as never,
      existsSync: () => true,
      platform: "linux",
      homedir: () => "/home/test",
      env: {},
    },
  );

  const controller = new AbortController();
  controller.abort();
  const events = await collectEvents(
    adapter.send(
      { prompt: "x", context: [] },
      {},
      controller.signal,
    ),
  );

  assert.deepEqual(events, [{ type: "cancelled" }]);
  assert.equal(spawns, 0);
});

test("configured missing executable is reported as misconfigured", async () => {
  const adapter = new AgyAdapter(
    undefined,
    () => ({ executablePath: "/missing/agy" }),
    {
      spawn: (() => new FakeChild()) as never,
      existsSync: () => false,
      platform: "linux",
      homedir: () => "/home/test",
      env: {},
    },
  );

  const health = await adapter.check();
  assert.equal(health.status, "misconfigured");
});

test("model discovery ignores malformed rows", async () => {
  const fakeSpawn = ((_command: string, args: readonly string[]) => {
    const child = new FakeChild();
    assert.deepEqual(args, ["models"]);

    queueMicrotask(() => {
      child.stdout.emit(
        "data",
        Buffer.from("m1  Model One\ninvalid\nm2\tModel Two\n"),
      );
      child.exitCode = 0;
      child.emit("close", 0);
    });

    return child;
  }) as never;

  const adapter = new AgyAdapter(
    undefined,
    () => ({ executablePath: "/agy" }),
    {
      spawn: fakeSpawn,
      existsSync: () => true,
      platform: "linux",
      homedir: () => "/home/test",
      env: {},
    },
  );

  assert.deepEqual(await adapter.listModels(), [
    { id: "m1", name: "Model One" },
    { id: "m2", name: "Model Two" },
  ]);
});

test("agent subprocess stderr cannot leak secrets into a failure event", async () => {
  const secret = "Bearer TOP-SECRET-ACCESS-TOKEN";
  const adapter = new AgyAdapter(undefined, () => ({ executablePath: "/agy" }), {
    spawn: (() => {
      const child = new FakeChild();
      queueMicrotask(() => {
        child.stderr.emit("data", Buffer.from(secret));
        child.exitCode = 1;
        child.emit("close", 1);
      });
      return child;
    }) as never,
    existsSync: () => true, platform: "linux", homedir: () => "/home/test", env: {},
  });
  const events = await collectEvents(adapter.send(
    { prompt: "safe prompt", context: [] }, {}, new AbortController().signal));
  assert.equal(events.at(-1)?.type, "failed");
  assert.doesNotMatch(JSON.stringify(events), /TOP-SECRET-ACCESS-TOKEN/);
});
