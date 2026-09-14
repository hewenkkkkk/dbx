import { createApp, effectScope, h, nextTick, ref } from "vue";
import { createPinia } from "pinia";
import type { editor } from "monaco-editor";
import "../src/styles/globals.css";
import MonacoCodeEditor from "@/components/editor/MonacoCodeEditor.vue";
import MonacoDiffEditor from "@/components/editor/MonacoDiffEditor.vue";
import { loadMonaco } from "@/lib/editor/monaco/monaco";
import { useMonacoEditor } from "@/composables/useMonacoEditor";
import type { MonacoDiffSummary } from "@/lib/editor/monaco/monacoDiff";
import { createMonacoSqlCompletion } from "@/lib/editor/monaco/monacoSqlCompletion";
import { monacoSqlContextState } from "@/lib/editor/monaco/monacoSqlContext";
import { createI18n } from "vue-i18n";
import type { SqlExecutionOverride } from "@/lib/sql/sqlExecutionTarget";
import { useSettingsStore } from "@/stores/settingsStore";
import { installMonacoMetadataFixture } from "./monacoMetadata.fixture";
import en from "@/i18n/locales/en";

const output = document.getElementById("monaco-tests")!;
output.style.cssText = "padding:24px;display:grid;gap:16px;background:#f5f5f5;color:#171717;min-height:100vh";
const heading = document.createElement("h1");
heading.textContent = "DBX Monaco browser validation";
output.appendChild(heading);
const results = document.createElement("pre");
results.id = "results";
results.style.cssText = "white-space:pre-wrap;font-size:13px;height:40vh;overflow:auto";
output.appendChild(results);
const cases: { name: string; passed: boolean; detail?: string }[] = [];

function record(name: string, passed: boolean, detail?: string) {
  cases.push({ name, passed, detail });
  results.textContent = cases.map((item) => `${item.passed ? "PASS" : "FAIL"} ${item.name}${item.detail ? `: ${item.detail}` : ""}`).join("\n");
  results.dataset.status = cases.every((item) => item.passed) ? "passed" : "failed";
}

function host() {
  const element = document.createElement("div");
  element.style.cssText = "height:260px;min-height:260px;position:relative;border:1px solid #ddd";
  output.appendChild(element);
  return element;
}

function frame() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

async function run() {
  const started = performance.now();
  const monaco = await loadMonaco();
  const baseline = monaco.editor.getModels().length;
  record("lazy runtime loads", true, `${Math.round(performance.now() - started)}ms (development build, not a performance baseline)`);
  const source = ref("select id from users;\nselect id from orders;");
  const scope = effectScope();
  const controller = scope.run(() =>
    useMonacoEditor({
      value: () => source.value,
      language: () => "sql",
      onChange: (value) => {
        source.value = value;
      },
    }),
  )!;
  const element = host();
  await controller.create(element);
  const instance = controller.view.value!;
  await frame();
  record("editor has a measurable viewport", instance.getLayoutInfo().width > 100 && instance.getLayoutInfo().height >= 250);
  for (const action of ["actions.find", "editor.action.startFindReplaceAction", "editor.action.joinLines", "editor.action.transformToUppercase", "editor.action.addSelectionToNextFindMatch", "editor.action.selectHighlights", "editor.foldAll"]) {
    record(`native action ${action}`, Boolean(instance.getAction(action)));
  }
  controller.selectRange(0, 6);
  await instance.getAction("editor.action.transformToUppercase")!.run();
  await nextTick();
  record("native uppercase updates Vue model", source.value.startsWith("SELECT"));
  instance.trigger("browser-test", "undo", null);
  await nextTick();
  record("native undo preserves edit history", source.value.startsWith("select"));
  source.value = "external update";
  await nextTick();
  record("external model synchronization", instance.getValue() === "external update");
  source.value = "sf";
  await nextTick();
  instance.setPosition({ lineNumber: 1, column: 3 });
  instance.focus();
  const provider = monaco.languages.registerCompletionItemProvider("sql", {
    provideCompletionItems: (model) => ({
      suggestions:
        model === instance.getModel()
          ? [
              createMonacoSqlCompletion(
                monaco,
                model,
                {
                  label: "SELECT fields",
                  filterText: "sf",
                  type: "snippet",
                  boost: 0,
                  apply: "SELECT ${column} FROM ${table} ORDER BY ${column}",
                },
                { from: 0, to: 2, index: 0 },
              ),
            ]
          : [],
    }),
  });
  await instance.getAction("editor.action.triggerSuggest")!.run();
  const suggestionDeadline = performance.now() + 3_000;
  while (performance.now() < suggestionDeadline && !element.querySelector('[role="option"]')) await frame();
  instance.trigger("browser-test", "acceptSelectedSuggestion", null);
  await nextTick();
  record("SQL provider uses native snippet acceptance", instance.getValue() === "SELECT column FROM table ORDER BY column");
  const selectedPlaceholder = instance.getModel()!.getValueInRange(instance.getSelection()!);
  record("SQL snippet selects its first named placeholder", selectedPlaceholder === "column");
  instance.trigger("browser-test", "type", { text: "id" });
  record("SQL snippet preserves linked placeholders", instance.getValue() === "SELECT id FROM table ORDER BY id");
  provider.dispose();
  scope.stop();
  element.remove();
  record("scope disposal releases the text model", monaco.editor.getModels().length === baseline);

  const codeHost = host();
  const code = ref('{"items":[1,2],"active":true}');
  const readOnly = ref(false);
  let codeEditor: editor.IStandaloneCodeEditor | undefined;
  const codeApp = createApp({
    render: () =>
      h(MonacoCodeEditor, {
        modelValue: code.value,
        language: "json",
        readOnly: readOnly.value,
        onReady: (instance: editor.IStandaloneCodeEditor) => {
          codeEditor = instance;
        },
        "onUpdate:modelValue": (value: string) => {
          code.value = value;
        },
      }),
  });
  codeApp.use(createPinia());
  codeApp.mount(codeHost);
  await frame();
  if (!codeEditor) throw new Error("MonacoCodeEditor did not mount");
  const json = await import("monaco-editor/languages/features/json/register");
  const getWorker = await json.getWorker();
  const jsonModel = codeEditor.getModel()!;
  const worker = await getWorker(jsonModel.uri);
  const jsonDocument = await worker.parseJSONDocument(jsonModel.uri.toString());
  record("JSON language Worker starts and parses", jsonDocument?.root?.type === "object");
  const markerResult = new Promise<boolean>((resolve) => {
    const listener = monaco.editor.onDidChangeMarkers((resources) => {
      if (!resources.some((uri) => uri.toString() === jsonModel.uri.toString())) return;
      if (!monaco.editor.getModelMarkers({ resource: jsonModel.uri }).some((marker) => marker.severity === monaco.MarkerSeverity.Error)) return;
      clearTimeout(timeout);
      listener.dispose();
      resolve(true);
    });
    const timeout = setTimeout(() => {
      listener.dispose();
      resolve(false);
    }, 5_000);
  });
  code.value = '{"items": }';
  await nextTick();
  record("JSON validation publishes native error markers", await markerResult);
  code.value = '{"items":[1,2],"active":true}';
  await nextTick();
  await codeEditor.getAction("editor.action.formatDocument")!.run();
  record("native JSON formatting", codeEditor.getValue().includes("\n"));
  const expandedLastLineTop = codeEditor.getTopForLineNumber(jsonModel.getLineCount());
  const foldingDeadline = performance.now() + 3_000;
  while (performance.now() < foldingDeadline && codeEditor.getTopForLineNumber(jsonModel.getLineCount()) >= expandedLastLineTop) {
    await codeEditor.getAction("editor.foldAll")!.run();
    await frame();
  }
  const foldedLastLineTop = codeEditor.getTopForLineNumber(jsonModel.getLineCount());
  record("native JSON folding", foldedLastLineTop < expandedLastLineTop, `last line top ${expandedLastLineTop}px → ${foldedLastLineTop}px`);
  readOnly.value = true;
  await nextTick();
  record("read-only reacts without recreating the model", codeEditor.getOption(monaco.editor.EditorOption.readOnly) && codeEditor.getModel() === jsonModel);
  codeApp.unmount();
  codeHost.remove();
  record("component disposal releases JSON model", monaco.editor.getModels().length === baseline);

  const diffHost = host();
  let resolveDiff!: (summary: MonacoDiffSummary) => void;
  const diffResult = new Promise<MonacoDiffSummary>((resolve) => {
    resolveDiff = resolve;
  });
  const inline = ref(false);
  const diffApp = createApp({
    render: () =>
      h(MonacoDiffEditor, {
        before: "first\nold\nlast",
        after: "first\nnew\nlast",
        language: "text",
        inline: inline.value,
        onUpdated: (summary: MonacoDiffSummary | null) => {
          if (summary) resolveDiff(summary);
        },
      }),
  });
  diffApp.use(createPinia());
  diffApp.mount(diffHost);
  const timeout = new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("diff Worker timeout")), 10_000));
  const summary = await Promise.race([diffResult, timeout]);
  record("native diff Worker computes changed lines", summary.modified === 1 && summary.changes === 1);
  inline.value = true;
  await nextTick();
  await frame();
  record("inline diff keeps the same two models", monaco.editor.getModels().length === baseline + 2);
  diffApp.unmount();
  diffHost.remove();
  record("diff disposal releases both models", monaco.editor.getModels().length === baseline);

  const { default: QueryEditor } = await import("@/components/editor/QueryEditor.vue");
  const queryHost = host();
  const querySource = ref("SELECT 1;\nSELECT 2;");
  const queryTab = ref("native-query-a");
  const queryReadonly = ref(false);
  const queryDatabase = ref<string>();
  const queryComponent = ref<InstanceType<typeof QueryEditor>>();
  const executionRequests: SqlExecutionOverride[] = [];
  const queryApp = createApp({
    render: () =>
      h(QueryEditor, {
        ref: queryComponent,
        modelValue: querySource.value,
        tabId: queryTab.value,
        connectionId: "monaco-browser-fixture",
        databaseType: "mysql",
        dialect: "mysql",
        database: queryDatabase.value,
        readOnly: queryReadonly.value,
        "onUpdate:modelValue": (value: string) => {
          querySource.value = value;
        },
        onExecute: (request: SqlExecutionOverride) => executionRequests.push(request),
      }),
  });
  const queryPinia = createPinia();
  queryApp.use(queryPinia);
  const querySettings = useSettingsStore(queryPinia);
  installMonacoMetadataFixture(queryPinia);
  querySettings.editorSettings.selectFirstCompletionOnOpen = true;
  querySettings.editorSettings.snippets = [{ id: "native-test", label: "Native test snippet", prefix: "dbxsn", body: "SELECT ${column} FROM ${table} ORDER BY ${column}", enabled: true }];
  queryApp.use(createI18n({ legacy: false, locale: "en", missingWarn: false, fallbackWarn: false, messages: { en } }));
  queryApp.mount(queryHost);
  const mountDeadline = performance.now() + 15_000;
  while (!monaco.editor.getEditors().some((candidate) => candidate.getDomNode() && queryHost.contains(candidate.getDomNode())) && performance.now() < mountDeadline) await frame();
  const queryEditor = monaco.editor.getEditors().find((candidate) => candidate.getDomNode() && queryHost.contains(candidate.getDomNode()))!;
  record("primary QueryEditor renders Monaco, not CodeMirror", Boolean(queryEditor) && !queryHost.querySelector(".cm-editor"));
  const firstQueryModel = queryEditor.getModel()!;
  queryEditor.setSelection(new monaco.Selection(2, 1, 2, 10));
  queryComponent.value!.requestExecute({ bypassPicker: true });
  const selectedExecution = executionRequests[0];
  record("primary execution preserves explicit SQL selection", typeof selectedExecution === "object" && selectedExecution.fullSql === querySource.value && selectedExecution.selectedSql === "SELECT 2;" && selectedExecution.selectionFrom === 10 && selectedExecution.selectionTo === 19);
  queryEditor.setPosition({ lineNumber: 1, column: 3 });
  querySettings.editorSettings.executeMode = "current";
  queryComponent.value!.requestExecute({ bypassPicker: true });
  const currentExecution = executionRequests[1];
  record("primary current-statement execution retains SQL boundaries", typeof currentExecution === "object" && currentExecution.selectedSql === "SELECT 1" && currentExecution.selectionFrom === 0 && currentExecution.selectionTo === 8, JSON.stringify(currentExecution));
  querySettings.editorSettings.executeMode = "all";
  queryComponent.value!.requestExecute({ bypassPicker: true });
  const fullExecution = executionRequests[2];
  record("primary execute-all setting preserves the full script", typeof fullExecution === "object" && fullExecution.selectedSql === querySource.value);
  queryEditor.executeEdits("browser-test", [{ range: new monaco.Range(1, 8, 1, 9), text: "10" }]);
  queryEditor.pushUndoStop();
  await nextTick();
  record("primary edits update Vue and headless SQL context", querySource.value === "SELECT 10;\nSELECT 2;" && monacoSqlContextState(queryEditor as editor.IStandaloneCodeEditor).doc.toString() === querySource.value);
  const editedQuery = querySource.value;
  queryTab.value = "native-query-b";
  querySource.value = "SELECT 'tab b';";
  await nextTick();
  queryEditor.trigger("browser-test", "undo", null);
  await nextTick();
  record("new tab undo cannot restore another tab's SQL", queryEditor.getValue() === "SELECT 'tab b';");
  queryTab.value = "native-query-a";
  querySource.value = editedQuery;
  await nextTick();
  record("returning to a tab restores its own Monaco model", queryEditor.getModel() === firstQueryModel && queryEditor.getValue() === editedQuery);
  queryEditor.trigger("browser-test", "undo", null);
  await nextTick();
  await frame();
  record("tab-specific undo survives switching", querySource.value === "SELECT 1;\nSELECT 2;", JSON.stringify({ source: querySource.value, model: queryEditor.getValue() }));
  querySource.value = "dbxsn";
  await nextTick();
  queryEditor.setPosition({ lineNumber: 1, column: 6 });
  queryEditor.focus();
  await queryEditor.getAction("editor.action.triggerSuggest")!.run();
  const primarySuggestionDeadline = performance.now() + 5_000;
  while (!queryHost.querySelector('[role="option"]') && performance.now() < primarySuggestionDeadline) await frame();
  queryEditor.trigger("browser-test", "acceptSelectedSuggestion", null);
  await frame();
  record("primary SQL business provider accepts native snippets", queryEditor.getValue() === "SELECT column FROM table ORDER BY column", queryEditor.getValue());
  queryEditor.trigger("browser-test", "type", { text: "id" });
  await frame();
  record("primary native snippet linked placeholders stay synchronized", querySource.value === "SELECT id FROM table ORDER BY id");
  querySource.value = "SELECT '中文';\r\nSELECT '😀';";
  await nextTick();
  queryEditor.getModel()!.setEOL(monaco.editor.EndOfLineSequence.CRLF);
  queryEditor.setSelection(new monaco.Selection(2, 12, 2, 8));
  const unicodeSnapshot = queryComponent.value!.captureExecutionSnapshot();
  record("primary CRLF and backward Unicode selection preserve offsets", unicodeSnapshot?.selectedSql === "'😀'" && unicodeSnapshot.fullSql === queryEditor.getValue() && unicodeSnapshot.selectionFrom === queryEditor.getModel()!.getOffsetAt({ lineNumber: 2, column: 8 }));
  querySource.value = "BEGIN\n  SELECT 1;\nEND;";
  await nextTick();
  queryEditor.setPosition({ lineNumber: 1, column: 1 });
  const primaryExpandedTop = queryEditor.getTopForLineNumber(3);
  const primaryFoldDeadline = performance.now() + 5_000;
  while (queryEditor.getTopForLineNumber(3) >= primaryExpandedTop && performance.now() < primaryFoldDeadline) {
    await queryEditor.getAction("editor.foldAll")!.run();
    await frame();
  }
  record("primary SQL procedural blocks use native folding", queryEditor.getTopForLineNumber(3) < primaryExpandedTop);
  queryDatabase.value = "fixture";
  querySettings.editorSettings.sortCompletionColumnsAlphabetically = false;
  const openColumns = async (sql: string, position: number) => {
    querySource.value = sql;
    await nextTick();
    queryEditor.focus();
    queryEditor.setPosition(queryEditor.getModel()!.getPositionAt(position));
    queryHost.scrollIntoView({ block: "center" });
    await frame();
    await queryEditor.getAction("editor.action.triggerSuggest")!.run();
    const deadline = performance.now() + 5_000;
    while (!document.querySelector("[data-monaco-column-picker]") && performance.now() < deadline) await frame();
    await frame();
    return document.querySelector<HTMLElement>("[data-monaco-column-picker]");
  };
  const columnKey = async (key: string) => {
    document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    await nextTick();
  };
  const checkColumn = async (label: string) => {
    const checkbox = document.querySelector<HTMLInputElement>(`[data-monaco-column-picker] input[aria-label="${label}"]`);
    checkbox?.dispatchEvent(new PointerEvent("pointerdown", { button: 0, bubbles: true, cancelable: true }));
    window.dispatchEvent(new PointerEvent("pointerup"));
    await nextTick();
    return checkbox?.checked === true;
  };
  let columnPopup = await openColumns("SELECT  FROM users", 7);
  record("column checkboxes open directly beside the caret without a dialog", !!columnPopup && !document.querySelector('[role="dialog"]'));
  const popupBounds = columnPopup?.getBoundingClientRect();
  const caretBounds = queryEditor.getScrolledVisiblePosition(queryEditor.getPosition()!);
  const editorBounds = queryEditor.getDomNode()!.getBoundingClientRect();
  record("column completion widget is anchored to editor text", !!popupBounds && !!caretBounds && Math.abs(popupBounds.left - editorBounds.left - caretBounds.left) < 20 && popupBounds.height > 0, JSON.stringify({ popup: popupBounds, caret: caretBounds, editor: editorBounds }));
  record("column list renders a bounded window of a wide table", !!columnPopup && columnPopup.querySelectorAll('[role="option"]').length <= 16);
  record("checkbox toggles do not insert text or steal editor focus", (await checkColumn("id")) && (await checkColumn("name")) && querySource.value === "SELECT  FROM users" && queryEditor.hasTextFocus());
  await columnKey("Enter");
  record("one Enter inserts all checked SELECT fields", querySource.value === "SELECT id, name FROM users", querySource.value);
  queryEditor.trigger("fixture", "undo", null);
  await nextTick();
  record("batch SELECT insertion is one undo step", querySource.value === "SELECT  FROM users");
  columnPopup = await openColumns("INSERT INTO users ()", 19);
  await checkColumn("id");
  await checkColumn("name");
  await columnKey("Tab");
  record("one Tab inserts INSERT fields and starts native value placeholders", querySource.value === "INSERT INTO users (id, name) VALUES (value, value)" && queryEditor.getModel()!.getValueInRange(queryEditor.getSelection()!) === "value", querySource.value);
  queryEditor.trigger("fixture", "type", { text: "1" });
  queryEditor.trigger("fixture", "jumpToNextSnippetPlaceholder", null);
  record("batch INSERT Tab advances to the next native placeholder", queryEditor.getModel()!.getValueInRange(queryEditor.getSelection()!) === "value");
  queryEditor.trigger("fixture", "type", { text: "'Alice'" });
  queryEditor.trigger("fixture", "leaveSnippet", null);
  await nextTick();
  record("batch INSERT placeholder editing synchronizes Vue", querySource.value === "INSERT INTO users (id, name) VALUES (1, 'Alice')", querySource.value);
  querySettings.editorSettings.selectFirstCompletionOnOpen = false;
  columnPopup = await openColumns("SELECT  FROM users", 7);
  record("column popup honors disabled first-item selection", !!columnPopup && !columnPopup.querySelector('[aria-selected="true"]'));
  await columnKey("ArrowDown");
  await columnKey(" ");
  record("keyboard navigation and Space toggle a field", !!columnPopup?.querySelector("input:checked"));
  await columnKey("Escape");
  record("Escape closes column completion without inserting", !document.querySelector("[data-monaco-column-picker]") && querySource.value === "SELECT  FROM users");
  await openColumns("SELECT  FROM users", 7);
  queryTab.value = "native-query-popup-switch";
  await nextTick();
  record("tab switch invalidates pending column selection", !document.querySelector("[data-monaco-column-picker]"));
  querySettings.editorSettings.selectFirstCompletionOnOpen = true;
  const cursorStyleBeforeVim = queryEditor.getOption(monaco.editor.EditorOption.cursorStyle);
  querySettings.editorSettings.vimModeEnabled = true;
  const vimDeadline = performance.now() + 8_000;
  while (!queryHost.querySelector("[data-monaco-vim-status]")?.textContent?.includes("NORMAL") && performance.now() < vimDeadline) await frame();
  record("Vim adapter loads against Monaco 0.56 and enters normal mode", !!queryHost.querySelector("[data-monaco-vim-status]")?.textContent?.includes("NORMAL"));
  querySettings.editorSettings.vimModeEnabled = false;
  await nextTick();
  record("disabling Vim restores native cursor settings", queryEditor.getOption(monaco.editor.EditorOption.cursorStyle) === cursorStyleBeforeVim && queryHost.querySelector<HTMLElement>("[data-monaco-vim-status]")?.hidden === true);
  queryReadonly.value = true;
  await nextTick();
  record("primary readonly remains reactive", queryEditor.getOption(monaco.editor.EditorOption.readOnly));
  queryApp.unmount();
  queryHost.remove();
  record("primary disposal releases every cached tab model", monaco.editor.getModels().length === baseline);

  const previewHost = host();
  previewHost.style.height = "340px";
  const previewSource = ref("SELECT  FROM users;\n\nINSERT INTO users ();\n\n-- 在字段位置按 Alt+/，勾选后直接 Enter/Tab");
  const previewPinia = createPinia();
  const saveStatus = document.createElement("span");
  saveStatus.textContent = "No save requested";
  const preview = createApp({
    render: () =>
      h(QueryEditor, {
        modelValue: previewSource.value,
        database: "fixture",
        connectionId: "monaco-browser-preview",
        databaseType: "mysql",
        dialect: "mysql",
        tabId: "column-preview",
        onSave: () => {
          saveStatus.textContent = "Save requested";
        },
        "onUpdate:modelValue": (value: string) => {
          previewSource.value = value;
        },
      }),
  });
  preview.use(previewPinia);
  installMonacoMetadataFixture(previewPinia);
  const previewSettings = useSettingsStore(previewPinia);
  previewSettings.editorSettings.sortCompletionColumnsAlphabetically = false;
  preview.use(createI18n({ legacy: false, locale: "en", messages: { en } }));
  preview.mount(previewHost);
  const vimButton = document.createElement("button");
  vimButton.textContent = "Enable Vim";
  vimButton.onclick = () => {
    previewSettings.editorSettings.vimModeEnabled = !previewSettings.editorSettings.vimModeEnabled;
    vimButton.textContent = previewSettings.editorSettings.vimModeEnabled ? "Disable Vim" : "Enable Vim";
  };
  output.append(vimButton, saveStatus);
  document.title = cases.every((item) => item.passed) ? "PASS — DBX Monaco browser validation" : "FAIL — DBX Monaco browser validation";
  results.dataset.complete = "true";
}

void run().catch((error) => {
  record("browser validation completes", false, error instanceof Error ? error.stack : String(error));
  document.title = "FAIL — DBX Monaco browser validation";
  results.dataset.complete = "true";
});
