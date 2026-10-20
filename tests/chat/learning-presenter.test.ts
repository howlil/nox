import assert from "node:assert/strict";
import test from "node:test";
import { LearningPresenter, type LearningUiPort } from "../../src/features/learning/view/LearningPresenter";

const connected = { isConnected: true, scrollTo() {}, prepend() {} } as unknown as HTMLElement;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function port(overrides: Partial<LearningUiPort> = {}): LearningUiPort {
  return {
    thread: () => connected,
    overview: async () => null,
    activity: async () => ({focusMinutes:0,waitingMinutes:0,sessions:0,activeDays:0,days:{},
      materials:[],objectives:[]}),
    readClock: async () => null,
    projectClock: snapshot => snapshot,
    mountMap: () => { throw new Error("Unexpected map render"); },
    mountActivity: () => { throw new Error("Unexpected activity render"); },
    onNext: () => {},
    onCommand: () => {},
    reportError: () => {},
    ...overrides,
  };
}

test("old learning map request cannot mount after view reset", async () => {
  const pending = deferred<null>();
  let mounted = 0;
  const presenter = new LearningPresenter(port({
    overview: () => pending.promise,
    mountMap: () => { mounted++; return connected; },
  }));
  const running = presenter.toggleMap();
  presenter.reset();
  pending.resolve(null);
  await running;
  assert.equal(mounted, 0);
});

test("older activity filter response cannot overwrite newer state", async () => {
  const first = deferred<Awaited<ReturnType<LearningUiPort["activity"]>>>();
  let renders = 0;
  const presenter = new LearningPresenter(port({
    activity: async scope => scope === "active" ? first.promise :
      {focusMinutes:1,waitingMinutes:0,sessions:1,activeDays:1,days:{},materials:[],objectives:[]},
    mountActivity: () => {
      renders++;
      return {isConnected:true,remove() {},scrollIntoView() {}} as unknown as HTMLElement;
    },
  }));
  const old = presenter.toggleActivity("active");
  await presenter.toggleActivity("all");
  first.resolve({focusMinutes:0,waitingMinutes:0,sessions:0,activeDays:0,days:{},materials:[],objectives:[]});
  await old;
  assert.equal(renders, 1);
});
