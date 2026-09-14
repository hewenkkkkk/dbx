# Monaco editor integration

## Runtime

- `loadMonaco()` loads the shared Monaco runtime only when an editor mounts.
- Monaco 0.56 uses exported paths such as `monaco-editor/editor/editor.api`,
  `monaco-editor/features/register.all`, and `monaco-editor/languages/definitions/sql/register`.
  Older examples using `monaco-editor/esm/vs/...` do not match this package's exports.
- Vite owns editor and JSON Worker URLs through `?worker` imports. No CDN or hard-coded
  `/assets` URLs are used. JSON schema network requests are disabled.
- The core editor features are native Monaco implementations. Only supported language
  registrations are imported; grammar modules and the JSON service load on demand.
- Theme colors are shared with DBX's existing settings. Monaco themes are global to a
  runtime, so mounted editors must use the same resolved application/editor theme.

## Model ownership

`useMonacoEditor` owns one editor and one unique `dbx:` model. Both are disposed on
scope destruction. An asynchronous mount cannot create an editor after disposal or
supersede a newer mount. Consumers attach disposable listeners through `onReady`.

External value updates do not echo `onChange`. They are undoable by default; callers
replacing the identity of a document must use a different model or explicitly reset
history. Language, read-only, wrapping, font and theme changes do not recreate models.

`createMonacoSqlCompletion` adapts the existing SQL candidates without changing their
generation or ranking. It preserves replacement boundaries, closing quotes, snippet
triggers, insertion spacing and untrusted documentation. `convertDbxSnippetToMonaco`
translates persisted DBX placeholders into Monaco tab stops, retaining field order
and linked fields while escaping literal SQL dollar parameters. The primary SQL
editor now uses these adapters through model-scoped native providers.

## Primary SQL editor

`QueryEditor.vue` now renders a real Monaco editor. Native completion, hover,
signature help, inlay hints, folding, find/replace, snippets and editing commands
replace the CodeMirror view and its UI extensions. Existing SQL candidate generation,
statement boundaries, execution snapshots and metadata lookups remain in place.

The existing SQL grammar runs in a headless CodeMirror state, not an EditorView.
Monaco model changes feed the parser incrementally; CRLF changes and full resets
resynchronize it. Background parsing publishes its tree through a state transaction.
This intentionally retains the grammar dependency and an extra document representation;
it is not evidence of a memory or typing-performance improvement.

Each component owns up to 16 native tab models with independent undo/redo and view
state. Model content subscriptions are registered after the parser subscription,
including after dialect changes. Using the editor-level change event here allowed
an outgoing parser snapshot to be emitted after undo on a restored model; the real
browser fixture covers that regression. Providers reject canceled, stale-version,
wrong-model and changed-connection results.

DOM listeners use `getContainerDomNode()`, not `getDomNode()`: Monaco replaces the
latter when a tab model changes. The browser fixture exercises checkbox keyboard
acceptance after switching away and back. Layout containment is deliberately omitted
from the editor root because it changes the containing block of fixed overflow widgets.

Column multiselect uses a cursor-anchored public `IContentWidget`, not a modal or an
extra completion command. It retains row checkboxes, drag selection with autoscroll,
Space toggling, arrow/page navigation, one-step Enter/Tab insertion, native INSERT
placeholders, and the first-candidate selection setting. Ordinary completions remain
native; column-context lists retain other candidates and render at most 16 rows.
Candidate display ranking does not reorder the selected columns' source order.

`monacoSnippetInsertion.ts` is an explicit internal-API boundary: standalone Monaco
has no public direct snippet insertion API, so the custom list calls the registered
`snippetController2` contribution. Monaco is pinned to 0.56.0, the contribution is
checked before changing the selection, and native insertion/Tab/undo behavior is
covered in the browser fixture. Revalidate this bridge when upgrading Monaco; do not
replace it with an extra confirmation step. No Monaco suggestion DOM is modified.

Vim loads `monaco-vim` 0.4.4 lazily. The bundler selects its ESM build and maps its
legacy imports to Monaco 0.56 exports. Disabling it restores cursor options; tab
changes reset the adapter. `:w` is routed to the owning editor's save event.

`MonacoDiffEditor` owns two read-only models. Monaco computes and renders the diff,
syncs scrolling, handles inline/side-by-side mode and navigates differences. DBX maps
the resulting line changes to its added/removed/modified summary.

## Validation

```sh
pnpm exec vitest run apps/desktop/src/composables/__tests__/useMonacoEditor.spec.ts apps/desktop/src/lib/editor/monaco/__tests__ apps/desktop/src/lib/__tests__/editorThemes.spec.ts
pnpm exec vue-tsc --noEmit --project apps/desktop/tsconfig.json
pnpm exec vue-tsc --noEmit --project apps/desktop/tests/tsconfig.json
pnpm exec vite build --config apps/desktop/vite.config.ts
pnpm exec vite --config apps/desktop/vite.config.ts --host 127.0.0.1 --port 5178 --strictPort
```

Open `http://127.0.0.1:5178/tests/monaco.html` for browser validation. The page reports
native command behavior, Vue synchronization, JSON Worker validation/formatting/folding,
SQL snippet acceptance and linked placeholders, diff Worker computation, read-only
updates, and model cleanup. It also mounts the real QueryEditor to check selection,
current/all execution, per-tab undo, business-provider snippets, CRLF/Unicode offsets,
SQL procedural folding and cached-model disposal. It leaves a SQL editor
for manual keyboard, find, selection and input checks. This is a test fixture, not a
production entry point or a performance benchmark.

## Migration status

The shared runtime, primary SQL rendering, KV editor, Nacos read-only viewer and Nacos
diff dialog use Monaco. The migration is still incomplete:

- Column multiselect is restored without a dialog. Broader original-editor regression
  coverage, drag/scroll edge cases, accessibility and custom acceptance shortcuts still
  need the migration audit.
- Vim attachment/disable, normal movement, insert/Escape and `:w` have browser evidence.
  Ctrl-[ did not leave insert mode in the manual browser check and needs investigation;
  readonly and tab-switch Vim keyboard behavior remain to be validated.
- The old CodeMirror-specific primary-editor tests need migration. The current run
  has 6 failed test files, 23 failed tests and 18 happy-dom canvas/runtime errors;
  some failures also cover the missing multi-column UI, not just old selectors.
- Cell-detail editing, the editable Nacos console and remaining CodeMirror UI
  entrances/helpers still need migration and dependency cleanup.
- Full primary-editor regressions, metadata-backed completion/navigation, large paste,
  native OS IME and platform behavior are not yet validated.

The previous focused SQL/Monaco/Nacos regression run passed 1,490 tests in 73 files.
The column-widget/Monaco/lifecycle suite passes 74 tests in 11 files, and the updated
browser fixture passes 54 checks, including metadata-fixture column insertion and
Vim attachment/disable. These results do not make the migration complete.
Browser validation does not prove Tauri platform compatibility or a performance gain;
packaged desktop validation and representative before/after benchmarks remain required.
