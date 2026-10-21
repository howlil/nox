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

test("a late previous clock read cannot overwrite the new session clock", async () => {
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true,
    value: { setInterval: () => 1, clearInterval: () => {} } });
  try {
    const initial = deferred<Awaited<ReturnType<LearningUiPort["readClock"]>>>();
    let loads = 0;
    const statuses: boolean[] = [];
    const root = {
      isConnected: true, toggleClass: (_name: string, hidden: boolean) => { statuses.push(hidden); },
      title: "",
    } as unknown as HTMLElement;
    const label = {textContent: ""} as HTMLElement;
    const button = {
      dataset: {}, setAttribute() {}, toggleClass() {}, textContent: "", title: "",
    } as unknown as HTMLButtonElement;
    const presenter = new LearningPresenter(port({
      readClock: () => ++loads === 1 ? initial.promise : Promise.resolve({
        budgetMs: 60_000, activeMs: 0, remainingMs: 20_000, aiWaitingMs: 0, status: "paused",
      }),
    }));
    presenter.startClock(root, label, button);
    const oldRead = presenter.refreshClock();
    presenter.reset();
    const newRead = presenter.refreshClock();
    await newRead;
    initial.resolve({ budgetMs: 60_000, activeMs: 30_000, remainingMs: 30_000,
      aiWaitingMs: 0, status: "active" });
    await oldRead;
    assert.equal(label.textContent, "Paused · 1m left");
    assert.deepEqual(statuses, [true, false]);
    presenter.dispose();
  } finally {
    if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
