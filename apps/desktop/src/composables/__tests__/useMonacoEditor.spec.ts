import { effectScope, nextTick, ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Monaco } from "@/lib/editor/monaco/monaco";
import { loadMonaco } from "@/lib/editor/monaco/monaco";
import { useMonacoEditor } from "../useMonacoEditor";

vi.mock("@/lib/editor/monaco/monaco", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/editor/monaco/monaco")>()),
  loadMonaco: vi.fn(),
}));

function createFakeRuntime() {
  const models: ReturnType<typeof createModel>[] = [];
  const editors: ReturnType<typeof createEditor>[] = [];
  function createModel(initial: string, language: string, uri: object) {
    let value = initial;
    let disposed = false;
    const changeListeners = new Set<() => void>();
    const model = {
      uri,
      language,
      changeListeners,
      getValue: () => value,
      getFullModelRange: () => ({ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: value.length + 1 }),
      getPositionAt: (offset: number) => ({ lineNumber: 1, column: Math.max(0, Math.min(offset, value.length)) + 1 }),
      isDisposed: () => disposed,
      dispose: vi.fn(() => {
        disposed = true;
      }),
      pushStackElement: vi.fn(),
      setValue: vi.fn((text: string) => {
        value = text;
        for (const listener of changeListeners) listener();
      }),
      pushEditOperations: vi.fn((_selection: unknown, changes: { text: string }[]) => {
        model.setValue(changes[0].text);
      }),
    };
    models.push(model);
    return model;
  }
  function createEditor(_parent: HTMLElement, options: { model: ReturnType<typeof createModel> }) {
    const model = options.model;
    const action = { isSupported: () => true, run: vi.fn(async () => {}) };
    const instance = {
      options,
      action,
      getValue: model.getValue,
      dispose: vi.fn(),
      setModel: vi.fn(),
      setSelection: vi.fn(),
      revealRangeInCenterIfOutsideViewport: vi.fn(),
      focus: vi.fn(),
      updateOptions: vi.fn(),
      getAction: vi.fn(() => action),
      onDidChangeModelContent: (listener: () => void) => {
        model.changeListeners.add(listener);
        return { dispose: () => model.changeListeners.delete(listener) };
      },
    };
    editors.push(instance);
    return instance;
  }
  const runtime = {
    Uri: { from: (value: object) => value },
    editor: {
      createModel: vi.fn(createModel),
      create: vi.fn(createEditor),
      defineTheme: vi.fn(),
      setTheme: vi.fn(),
      setModelLanguage: vi.fn(),
    },
  };
  return { runtime: runtime as unknown as Monaco, models, editors };
}

describe("Monaco editor ownership", () => {
  let fake: ReturnType<typeof createFakeRuntime>;
  const parent = {} as HTMLElement;

  beforeEach(() => {
    fake = createFakeRuntime();
    vi.mocked(loadMonaco).mockResolvedValue(fake.runtime);
  });

  it("does not create a model when disposed during runtime loading", async () => {
    let resolve!: (runtime: Monaco) => void;
    vi.mocked(loadMonaco).mockReturnValue(
      new Promise((ready) => {
        resolve = ready;
      }),
    );
    const controller = useMonacoEditor();
    const pending = controller.create(parent, "late");
    controller.destroy();
    resolve(fake.runtime);
    await pending;
    expect(fake.models).toHaveLength(0);
    expect(fake.editors).toHaveLength(0);
  });

  it("creates only the latest requested editor", async () => {
    const controller = useMonacoEditor();
    await Promise.all([controller.create(parent, "old"), controller.create(parent, "latest")]);
    expect(fake.models).toHaveLength(1);
    expect(controller.getValue()).toBe("latest");
    controller.destroy();
  });

  it("owns a unique model per editor and disposes it with its Vue scope", async () => {
    const scope = effectScope();
    const controllers = scope.run(() => [useMonacoEditor(), useMonacoEditor()])!;
    await Promise.all(controllers.map((controller) => controller.create(parent)));
    expect(fake.models[0].uri).not.toEqual(fake.models[1].uri);
    scope.stop();
    for (const model of fake.models) expect(model.dispose).toHaveBeenCalledOnce();
    for (const instance of fake.editors) expect(instance.dispose).toHaveBeenCalledOnce();
    controllers[0].destroy();
    expect(fake.models[0].dispose).toHaveBeenCalledOnce();
  });

  it("does not echo external values or reset an unchanged document", async () => {
    const value = ref("first");
    const onChange = vi.fn();
    const controller = useMonacoEditor({ value: () => value.value, onChange });
    await controller.create(parent);
    controller.setValue("first");
    expect(fake.models[0].pushEditOperations).not.toHaveBeenCalled();
    value.value = "external";
    await nextTick();
    expect(controller.getValue()).toBe("external");
    expect(onChange).not.toHaveBeenCalled();
    expect(fake.models[0].pushStackElement).toHaveBeenCalledTimes(2);
    fake.models[0].setValue("typed");
    expect(onChange).toHaveBeenCalledWith("typed");
    controller.destroy();
  });

  it("uses the latest content and settings after an async mount", async () => {
    const value = ref("before");
    const readOnly = ref(false);
    const language = ref("plaintext");
    const controller = useMonacoEditor({ value: () => value.value, language: () => language.value, options: () => ({ readOnly: readOnly.value }) });
    const pending = controller.create(parent);
    value.value = "after";
    readOnly.value = true;
    language.value = "json";
    await pending;
    expect(controller.getValue()).toBe("after");
    expect(fake.models[0].language).toBe("json");
    expect(fake.editors[0].options).toMatchObject({ readOnly: true });
    readOnly.value = false;
    await nextTick();
    expect(fake.editors[0].updateOptions).toHaveBeenCalledWith({ readOnly: false });
    expect(fake.models).toHaveLength(1);
    controller.destroy();
  });

  it("preserves selection direction without stealing focus from a search input", async () => {
    const controller = useMonacoEditor();
    await controller.create(parent, "abcdef");
    controller.selectRange(5, 2, { focus: false });
    expect(fake.editors[0].setSelection).toHaveBeenCalledWith({ selectionStartLineNumber: 1, selectionStartColumn: 6, positionLineNumber: 1, positionColumn: 3 });
    expect(fake.editors[0].focus).not.toHaveBeenCalled();
    controller.destroy();
  });

  it("uses the native find and replace commands", async () => {
    const controller = useMonacoEditor();
    expect(controller.openSearch()).toBe(false);
    await controller.create(parent);
    expect(controller.openSearch()).toBe(true);
    expect(controller.openReplace()).toBe(true);
    expect(fake.editors[0].getAction.mock.calls).toEqual([["actions.find"], ["editor.action.startFindReplaceAction"]]);
    controller.destroy();
  });

  it("cleans up the model if editor creation fails", async () => {
    vi.mocked(fake.runtime.editor.create).mockImplementation(() => {
      throw new Error("mount failed");
    });
    const controller = useMonacoEditor();
    await expect(controller.create(parent)).rejects.toThrow("mount failed");
    expect(fake.models[0].isDisposed()).toBe(true);
    controller.destroy();
  });

  it("disposes consumer listeners before destroying the editor", async () => {
    const dispose = vi.fn();
    const controller = useMonacoEditor({ onReady: () => ({ dispose }) });
    await controller.create(parent);
    controller.destroy();
    expect(dispose).toHaveBeenCalledOnce();
    expect(fake.models[0].changeListeners.size).toBe(0);
  });

  it("disposes a late consumer listener when onReady destroys the editor", async () => {
    const dispose = vi.fn();
    const controller = useMonacoEditor({
      onReady: () => {
        controller.destroy();
        return { dispose };
      },
    });
    await controller.create(parent);
    expect(dispose).toHaveBeenCalledOnce();
    expect(fake.models[0].isDisposed()).toBe(true);
  });
});
