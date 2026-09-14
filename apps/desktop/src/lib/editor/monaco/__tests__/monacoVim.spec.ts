import { afterEach, describe, expect, it, vi } from "vitest";
import type { editor } from "monaco-editor";
import { createMonacoVimController } from "../monacoVim";

const fake = vi.hoisted(() => ({ write: undefined as ((adapter: object) => void) | undefined, adapters: [] as { dispose: ReturnType<typeof vi.fn> }[] }));
vi.mock("monaco-vim", () => ({
  VimMode: {
    Vim: {
      defineEx: (_name: string, _alias: string, callback: (adapter: object) => void) => {
        fake.write = callback;
      },
    },
  },
  initVimMode: vi.fn(() => {
    const adapter = { dispose: vi.fn() };
    fake.adapters.push(adapter);
    return adapter;
  }),
}));

const controllers: ReturnType<typeof createMonacoVimController>[] = [];
function createController() {
  const status = { replaceChildren: vi.fn(), hidden: true } as unknown as HTMLElement;
  const instance = { getRawOptions: () => ({ cursorStyle: "line-thin", cursorWidth: 1 }), updateOptions: vi.fn() } as unknown as editor.IStandaloneCodeEditor;
  const save = vi.fn();
  const controller = createMonacoVimController(instance, status, save);
  controllers.push(controller);
  return { controller, instance, status, save };
}

afterEach(() => {
  for (const controller of controllers.splice(0)) controller.dispose();
});

describe("Monaco Vim lifecycle", () => {
  it("keeps disabled editors detached", async () => {
    const { controller, status } = createController();
    await controller.setEnabled(false);
    expect(controller.isActive()).toBe(false);
    expect(status.hidden).toBe(true);
  });

  it("does not attach after disable or destruction during lazy loading", async () => {
    const disabled = createController();
    const enabling = disabled.controller.setEnabled(true);
    await disabled.controller.setEnabled(false);
    await enabling;
    expect(disabled.controller.isActive()).toBe(false);
    const destroyed = createController();
    const loading = destroyed.controller.setEnabled(true);
    destroyed.controller.dispose();
    await loading;
    expect(destroyed.controller.isActive()).toBe(false);
  });

  it("routes :w only to the editor that owns the adapter", async () => {
    const first = createController();
    const second = createController();
    await first.controller.setEnabled(true);
    const firstAdapter = fake.adapters.at(-1)!;
    await second.controller.setEnabled(true);
    fake.write!(firstAdapter);
    expect(first.save).toHaveBeenCalledOnce();
    expect(second.save).not.toHaveBeenCalled();
    first.controller.dispose();
    fake.write!(firstAdapter);
    expect(first.save).toHaveBeenCalledOnce();
  });

  it("resets adapter state on model switches and restores cursor options on disable", async () => {
    const { controller, instance } = createController();
    await controller.setEnabled(true);
    const old = fake.adapters.at(-1)!;
    await controller.reset();
    expect(old.dispose).toHaveBeenCalledOnce();
    expect(controller.isActive()).toBe(true);
    await controller.setEnabled(false);
    expect(controller.isActive()).toBe(false);
    expect(instance.updateOptions).toHaveBeenCalledWith({ cursorStyle: "line-thin", cursorWidth: 1, cursorBlinking: "blink" });
  });

  it("coalesces concurrent enable requests into one adapter", async () => {
    const { controller } = createController();
    const before = fake.adapters.length;
    await Promise.all([controller.setEnabled(true), controller.setEnabled(true)]);
    expect(fake.adapters.length - before).toBe(1);
  });
});
