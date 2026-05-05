import { afterEach, describe, expect, it, vi } from "vitest";

type Listener = (event: unknown) => void;

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  clear(): void {
    this.map.clear();
  }
}

describe("labJobStore subscriptions", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("cleans up storage listeners across unmount/remount", async () => {
    const storageListeners = new Set<Listener>();
    const localStorage = new MemoryStorage();
    const sessionStorage = new MemoryStorage();
    const windowMock = {
      addEventListener: vi.fn((type: string, cb: Listener) => {
        if (type === "storage") storageListeners.add(cb);
      }),
      removeEventListener: vi.fn((type: string, cb: Listener) => {
        if (type === "storage") storageListeners.delete(cb);
      }),
      localStorage,
      sessionStorage,
    };

    vi.stubGlobal("window", windowMock);
    vi.stubGlobal("localStorage", localStorage);
    vi.stubGlobal("sessionStorage", sessionStorage);
    vi.stubGlobal("BroadcastChannel", undefined);

    const mod = await import("./labJobStore");
    const { subscribeLabJobs, setActiveLabJob, LAB_JOB_STORAGE_KEY } = mod;

    const cb = vi.fn();
    const unsub1 = subscribeLabJobs(cb);
    expect(storageListeners.size).toBe(1);
    unsub1();
    expect(storageListeners.size).toBe(0);

    const unsub2 = subscribeLabJobs(cb);
    expect(storageListeners.size).toBe(1);

    setActiveLabJob({
      id: "opt-1",
      type: "optimization",
      startedAt: Date.now(),
      updatedAt: Date.now(),
      status: "running",
      label: "Optimization",
      progress: { evaluations: 1, planned: 10, generation: 0 },
      ownerTabId: "tab-a",
    });
    expect(localStorage.getItem(LAB_JOB_STORAGE_KEY)).toContain("opt-1");

    // Simulate a storage event fired by the browser.
    for (const listener of storageListeners) listener({ storageArea: localStorage, key: LAB_JOB_STORAGE_KEY });
    expect(cb).toHaveBeenCalledTimes(2); // once from local write, once from simulated storage event

    unsub2();
    expect(storageListeners.size).toBe(0);
  });
});
