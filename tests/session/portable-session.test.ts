import assert from "node:assert/strict";
import test from "node:test";
import { SessionController } from "../../src/session/SessionController";
import { SessionStore } from "../../src/session/SessionStore";
import type { SessionDataPort } from "../../src/types";
import { PersistenceError as PortableError, LearningStateWriteConflict as PortableConflict } from "../../src/domain/persistence/errors";
import { PersistenceError as LegacyError, LearningStateWriteConflict as LegacyConflict } from "../../src/persistence/PersistenceError";

test("M1 old and portable error paths share the exact same constructors", () => {
  assert.equal(LegacyError, PortableError);
  assert.equal(LegacyConflict, PortableConflict);
});

test("M1 real session controller accepts a host-neutral transaction adapter", async () => {
  let durable: Record<string, unknown> = { "nox-settings": { provider: "agy" } };
  let failNext = false;
  const data: SessionDataPort = {
    read: async () => structuredClone(durable),
    update: async (mutate) => {
      const next = mutate(structuredClone(durable));
      if (failNext) { failNext = false; throw new Error("host storage unavailable"); }
      durable = structuredClone(next);
    },
  };
  const controller = new SessionController(data, new SessionStore({
    now: () => 1234, uuid: () => "portable-session",
  }));
  await controller.init();
  assert.equal(controller.getSession().messages.length, 0);
  failNext = true;
  await assert.rejects(controller.recordUserMessage("not committed"), PortableError);
  assert.equal(controller.getSession().messages.length, 0,
    "a rejected host store must not publish an unsaved transcript");
  assert.equal(durable["nox-sessions"], undefined);
  await controller.recordUserMessage("committed");
  assert.equal(controller.getSession().messages[0]?.content, "committed");
  assert.deepEqual(durable["nox-settings"], { provider: "agy" });
  assert.ok(durable["nox-sessions"], "session commits through the injected port");
});
