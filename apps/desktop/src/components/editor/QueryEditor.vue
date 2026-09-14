<script lang="ts">
// Replay guard for the toolbar format/compress requests. The ids are global
// monotonic counters shared by every tab, and ContentArea delivers them by
// gating the inactive tab's prop back to `undefined`; returning to the tab
// re-arms the same stale id on the reused editor instance (a replay, not a new
// command). The cursors live at module scope — not in `<script setup>` — so
// they also survive an editor unmount/remount (data-page switches), letting a
// freshly mounted editor consume the stale id instead of replaying it. The
// check is strictly monotonic (`>`), not `!==`: because ids are shared across
// tabs, a lower id is always an already-handled request from an active tab
// (delivery is same-tick), never a pending undelivered one.
let lastHandledFormatRequestId = 0;
let lastHandledCompressRequestId = 0;
</script>

<script setup lang="ts">
import { loadMonaco, createMonacoModel, applyMonacoTheme, monacoRangeFromOffsets, replaceMonacoModelValue, runMonacoAction, type Monaco } from "@/lib/editor/monaco/monaco";
import { attachMonacoSqlContext, monacoSqlContextState } from "@/lib/editor/monaco/monacoSqlContext";
import { applyMonacoOffsetEdits, monacoPositionAtCoords, monacoCoordsAtOffset, monacoVisibleOffsetRanges } from "@/lib/editor/monaco/monacoOffsetEdits";
import { createMonacoSqlCompletion, type MonacoCompletionCandidate } from "@/lib/editor/monaco/monacoSqlCompletion";
import { shortcutToMonacoKeybinding } from "@/lib/editor/monaco/monacoShortcuts";
import { useMonacoAppearance } from "@/composables/useMonacoAppearance";
import { createMonacoVimController } from "@/lib/editor/monaco/monacoVim";
import { recordCompletionSelection, shouldChainSqlCompletionAfterAccept } from "@/lib/sql/sqlCompletion";

import { ref, onMounted, onBeforeUnmount, onActivated, onDeactivated, watch, shallowRef, computed, nextTick } from "vue";
import { AlignLeft, Camera, CaseLower, CaseSensitive, CaseUpper, ClipboardPaste, Code2, Download, Eye, FileCode, Highlighter, MessageSquareText, Minimize2, Pencil, PencilRuler, Play, Copy, List, Scissors, Search, Sparkles, Table2, TextSelect, Trash2 } from "@lucide/vue";
import { useI18n } from "vue-i18n";

import type { EditorState, Text } from "@codemirror/state";
import { EditorSelection } from "@codemirror/state";
import { foldable, syntaxTree } from "@codemirror/language";
import { createSqlBlockFoldService } from "@/lib/editor/codemirrorSqlBlockFolding";
import { sqlSemanticTableNameSpansForSyntaxTree } from "@/lib/editor/codemirrorSqlSemanticHighlight";
import type { editor, IDisposable } from "monaco-editor";
import SqlExecutionTargetPicker from "./SqlExecutionTargetPicker.vue";
import DelimitedListDialog from "./DelimitedListDialog.vue";
import MonacoColumnPicker from "./MonacoColumnPicker.vue";
import { insertMonacoSnippet } from "@/lib/editor/monaco/monacoSnippetInsertion";
import { createMonacoColumnSelection, buildMonacoColumnInsertion, type MonacoColumnSelection } from "@/lib/editor/monaco/monacoColumnSelection";
import CodeSnapshotDialog from "@/components/codeSnapshot/CodeSnapshotDialog.vue";
import CustomContextMenu, { type ContextMenuItem } from "@/components/ui/CustomContextMenu.vue";
import type { CodeSnapshotSource } from "@/lib/codeSnapshot/codeSnapshot";
import { copyToClipboard, readTextFromClipboard } from "@/lib/common/clipboard";

import { executionCandidateForMode, resolveExecutableSql, type SqlExecutionSnapshot, type SqlExecutionOverride, type SqlExecutionCandidate } from "@/lib/sql/sqlExecutionTarget";
import { buildExecutionCandidates, hasMultipleExecutionTargets, supportsExecutionTargetPicker, type SqlTextRange } from "@/lib/sql/sqlStatementRanges";
import { executableStatementRangeAtCursor, executableStatementRangeCacheForDoc, executableStatementRangeStartingAt as executableStatementRangeStartingAtLine, type ExecutableStatementRangeCache } from "@/lib/sql/executableStatementRangeCache";
import { createDeferredEditorTask } from "@/lib/editor/deferredEditorTask";

import { looksLikeDmlStatement } from "@/lib/sql/dmlChangePreview";
import { expandToSqlStatementWindow, parseInsertValueHintsInRanges } from "@/lib/sql/insertValueHints";
import { insertValueHintColumnNames } from "@/lib/sql/insertValueHintColumns";
import { canFormatSqlForDatabaseType, formatSqlForDisplay, formatSqlForEditing, compressSqlText, sqlFormatDialectForDbType, type SqlFormatDialect } from "@/lib/sql/sqlFormatter";
import { omitDdlIdentifierQuotes } from "@/lib/sql/ddlDisplay";
import { detectAndFormatStructured } from "@/lib/sql/autoFormat";
import { enabledSqlParameterSyntaxes, resolveSqlVariableSyntaxToggles } from "@/lib/sql/sqlVariableSyntax";
import { blankLineDeletionChanges } from "@/lib/editor/queryEditorTextEdits";
import { createQueryEditorExecutionViewportOwnership } from "@/lib/editor/queryEditorExecutionViewport";

import { buildSqlInConditionFromPasteSource, insertTextForSqlInCondition } from "@/lib/sql/sqlInListPaste";

import { convertSqlSelectionCase, type SqlSelectionCaseMode } from "@/lib/sql/sqlSelectionCase";
import { convertToNextNamingStyle } from "@/lib/naming/namingStyleConverter";
import { formatMongoShellText } from "@/lib/mongo/mongoFormatter";
import { detectAndFormatElasticsearchRequests } from "@/lib/elasticsearch/elasticsearchFormatter";
import { useConnectionStore, COMPLETION_METADATA_CONCURRENCY } from "@/stores/connectionStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTheme } from "@/composables/useTheme";
import { useToast } from "@/composables/useToast";
import {
  buildSelectStarExpansion,
  buildSqlCompletionItemsFromContext,
  buildPostgresSequenceLiteralCompletionItems,
  getSqlFunctionSignatureHelp,
  getSqlCompletionContext,
  getPostgresSequenceLiteralCompletionContext,
  getSqlCompletionResultValidFor,
  isSqlCompletionSuppressedContext,
  isSqlLikeCompletionStatement,
  prepareSqlCompletionReplacement,
  selectStarResultColumnsMatch,
  shouldAutoOpenSqlCompletion,
  extractCteDefinitions,
} from "@/lib/sql/sqlCompletion";
import { originForSqlCompletionProvider, shouldAllowSqlCompletionTrigger, type SqlCompletionTriggerFacts, type SqlCompletionTriggerOrigin } from "@/lib/sql/sqlCompletionTriggerPolicy";
import { driverProfileHasCompletionCandidates } from "@/lib/database/driverProfileExtensions";
import { sqlCompletionContextFromSemantic, sqlSemanticSelectStarIsOnlyProjection, sqlSemanticSelectStarQualifierSql, sqlSemanticSelectStarTableSources } from "@/lib/sql/semantic/completion";
import { buildSqlSemanticModel } from "@/lib/sql/semantic/model";
import { mergeSqlSemanticReferenceAnalysis, resolveSqlSemanticNavigationTarget } from "@/lib/sql/semantic/references";
import { buildElasticsearchCompletionItemsFromContext, getElasticsearchCompletionContext, getElasticsearchCompletionResultValidFor, shouldAutoOpenElasticsearchCompletion, type ElasticsearchCompletionItem } from "@/lib/elasticsearch/elasticsearchCompletion";
import { buildMongoCompletionItemsFromContext, getMongoCompletionContext, getMongoCompletionResultValidFor, mongoCompletionNeedsCollections, mongoCompletionNeedsFields, shouldAutoOpenMongoCompletion, type MongoCompletionItem } from "@/lib/mongo/mongoCompletion";
import {
  buildSqlServerUseDatabaseCompletionItems,
  mergeSqlCompletionQualifierNames,
  resolveSqlCompletionRoutineLookupTarget,
  resolveSqlCompletionSchemaLookupDatabase,
  resolveSqlCompletionScope,
  resolveSqlCompletionTableLookupTarget,
  resolveSqlServerUseDatabaseCompletion,
  sqlServerUseCompletionDatabaseNames,
  sqlServerUseDatabaseBeforeCursor,
  type SqlCompletionScope,
} from "@/lib/sql/sqlCompletionLookupTarget";
import { usesOracleSessionCompletionColumns as shouldUseOracleSessionCompletionColumns } from "@/lib/sql/oracleCompletionSession";
import {
  extractIdentifierDetailsAt,
  extractQualifiedIdentifierAt,
  isSqlKeyword,
  matchSqlObject,
  matchTable,
  mergeSqlObjectNavigationType,
  resolveSqlObjectNavigationIdentity,
  splitQualifiedIdentifier,
  sqlObjectHoverDetail,
  sqlObjectNavigationSourceKind,
  sqlObjectNavigationTarget,
  sqlObjectNavigationTargetFromIdentity,
  sqlObjectNavigationTypeFromCompletionObjectType,
  type SqlObjectNavigationTarget,
} from "@/lib/sql/sqlNavigation";
import { buildHoverTableSql, ddlForHoverPreview, hoverTableMatchesScope, quoteIdentifier, quoteQualifiedName, reformatHoverDdl, scopeHoverTables, type HoverTableScope } from "@/lib/editor/hoverTableSql";

import { lineColumnToOffset, sqlErrorDecorationRange as resolveSqlErrorDecorationRange, sqlErrorSqlMatchesEditor } from "@/lib/sql/sqlDiagnostics";
import { analyzeMysqlRoutineSyntax, supportsMysqlRoutineSyntaxDiagnostics } from "@/lib/sql/mysqlRoutineSyntaxDiagnostics";
import { buildOracleSyntaxDiagnostics } from "@/lib/sql/oracleSyntaxDiagnostics";
import {
  DBX_TABLE_REFERENCE_MIME,
  DBX_TABLE_REFERENCE_DROP_EVENT,
  DBX_TABLE_REFERENCE_HOVER_EVENT,
  DBX_TABLE_REFERENCE_DRAG_END_EVENT,
  activeTableReferencePayloadValue,
  clearActiveTableReferencePayload,
  hasTableReferencePayloadType,
  parseTableReferencePayload,
  tableReferenceInsertText,
  type QueryEditorTableReferenceDropDetail,
  type QueryEditorTableReferenceHoverDetail,
  type QueryEditorTableReferencePayload,
} from "@/lib/editor/queryEditorTableDrop";
import { isPointOverElementRoot } from "@/lib/editor/tableReferenceDragFeedback";

import { copySqlAsRichText } from "@/lib/sql/sqlRichText";
import { EDITOR_FONT_FAMILY_CSS_VAR, EDITOR_FONT_SIZE_CSS_VAR, editorDiagnosticColors, editorThemeAppearanceFor } from "@/lib/editor/editorThemes";

import { shouldResolveSqlColumnCompletion } from "@/lib/editor/batchColumnSelection";
import { compareSqlCompletions } from "@/lib/editor/sqlCompletionPresentation";
import { clampEditorFontSize, createEditorWheelZoomGestureGuard, createEditorZoomCommitScheduler, fontSizeFromGestureScale, fontSizeFromWheelDelta } from "@/lib/editor/editorZoom";
import { enabledSqlShortcutActions, resolveSqlShortcutTemplate } from "@/lib/sql/sqlShortcutActions";
import { normalizeShortcutSettings } from "@/lib/editor/shortcutRegistry";

import { supportsInsertValueHints } from "@/lib/editor/codemirrorInsertValueHints";

import { createDbxCodeMirrorSqlDialect, type CodeMirrorSqlDialectName } from "@/lib/editor/codemirrorSqlDialect";

import { usesQueryEditorObjectNavigationModifier } from "@/lib/editor/queryEditorPointerSelection";

import { createQueryEditorPostCompositionKeyGuard } from "@/lib/editor/queryEditorExecutionShortcut";
import type { StatementExecutionMarker } from "@/lib/tabs/tabPresentation";
import { isSchemaAware, isSingleDatabase, supportsDatabaseNameCompletion, supportsDatabaseSchemaQualifier, supportsQueryEditorBlockComments, supportsSqlInListPaste } from "@/lib/database/databaseFeatureSupport";
import { metadataSchemaForConnection, sqlSnippetDatabaseTypeForConnection } from "@/lib/database/jdbcDialect";
import { usesLocalOnlyEditorCompletionMetadata, usesOnDemandOnlyEditorColumnMetadata } from "@/lib/metadata/completionMetadataPolicy";
import { loadTableMetadata } from "@/lib/metadata/tableMetadataCache";
import { analyzeIntentionActions, prepareExpandWildcardContext, buildExpandWildcardReplacement, type IntentionAction } from "@/lib/editor/sqlIntentionActions";
import { loadObjectDdl } from "@/lib/metadata/objectDdlCache";
import { loadObjectMetadataFacet } from "@/lib/metadata/objectMetadataCache";
import { queryContextObjectActions, queryContextObjectRoute, queryTableCandidateAtSqlPosition, queryTableNavigationTargetAtSqlPosition, resolveQueryContextCandidateDatabase, resolveQueryContextObjectTarget, type QueryContextObjectAction } from "@/lib/sql/queryCursorTableTarget";
import * as api from "@/lib/backend/api";
import { oracleDatabaseLinkCompletionContext, oracleDatabaseLinkCompletionItems } from "@/lib/sql/oracleDatabaseLinkCompletion";

import {
  areSqlSemanticDiagnosticsEqual,
  buildSqlParserErrorDiagnostic,
  buildSqlSemanticDiagnostics,
  isSqlSemanticDiagnosticInputContext,
  isSqlVirtualTableReference,
  shouldRunSqlSemanticDiagnostics,
  sqlSemanticDiagnosticRangesForViewport,
  tableReferenceKey,
  type SqlSemanticDiagnostic,
} from "@/lib/sql/semantic/diagnostics";
import { sqlReferenceAnalysisDialectFor } from "@/lib/sql/semantic/dialect";
import { buildRedisSyntaxDiagnostics, shouldRunRedisDiagnostics } from "@/lib/redis/redisSyntaxDiagnostics";
import { buildRedisCompletionItemsFromContext, getRedisCompletionContext, getRedisCompletionResultValidFor, shouldAutoOpenRedisCompletion, takesKeyArgument, type RedisCompletionItem } from "@/lib/redis/redisCompletion";
import type { SqlCompletionColumn, SqlCompletionContext, SqlCompletionForeignKey, SqlCompletionItem, SqlCompletionObject, SqlCompletionReferencedTable, SqlCompletionTable } from "@/lib/sql/sqlCompletion";
import type { CompletionAssistantObjectKind, ColumnInfo, DatabaseType, IndexInfo, SqlReferenceAnalysis, SqlServerCompletionContext, SqlTableReference, SqlTextSpan } from "@/types/database";

type EditorViewType = editor.IStandaloneCodeEditor;
type CompletionContext = { state: EditorState; pos: number; explicit: boolean; addEventListener: (event: "abort", callback: () => void) => void };

const props = defineProps<{
  modelValue: string;
  /** Identity of the tab owning the document. Changing it swaps in that tab's cached editor state (fresh undo history on first visit). */
  tabId?: string;
  connectionId?: string;
  catalog?: string;
  database?: string;
  schema?: string;
  clientSessionId?: string;
  completionContextVersion?: number;
  databaseType?: DatabaseType;
  dialect?: "mysql" | "postgres" | "sqlserver";
  syntaxDialect?: CodeMirrorSqlDialectName;
  formatDialect?: SqlFormatDialect;
  formatRequestId?: number;
  compressRequestId?: number;
  executionError?: string;
  executionErrorSql?: string;
  resultColumns?: string[];
  resultSourceStatement?: string;
  resultSourceFrom?: number;
  resultSourceTo?: number;
  readOnly?: boolean;
  autoFocus?: boolean;
  forceWordWrap?: boolean;
  hideExecutionControls?: boolean;
  enableExplainShortcut?: boolean;
  canExplain?: boolean;
  initialViewport?: { scrollTop: number; scrollLeft: number };
  initialSelection?: { anchor: number; head: number };
  statementExecutionMarkers?: StatementExecutionMarker[];
}>();

function sqlBehaviorDialect(): "mysql" | "postgres" | "sqlserver" | undefined {
  return props.syntaxDialect === "clickhouse" ? props.dialect : (props.syntaxDialect ?? props.dialect);
}

const COMPLETION_REMOTE_LATENCY_BUDGET_MS = 120;
const COMPLETION_DEBOUNCE_DELAY_MS = 150;

// Internal rollback switch: flip to false to route completion, diagnostics, and navigation through the legacy SQL context path.
const SEMANTIC_SQL_COMPLETION_ENABLED = true;

const emit = defineEmits<{
  "update:modelValue": [value: string];
  selectionChange: [value: string];
  cursorChange: [pos: number];
  previewChangesAvailable: [value: boolean];
  formatError: [message: string];
  execute: [source: SqlExecutionOverride];
  executeInNewResultTab: [source: SqlExecutionOverride];
  explain: [];
  exportQuery: [payload: { sql: string; format: "csv" | "xlsx" | "txt"; columnComments?: (string | null)[] }];
  save: [];
  clickTable: [target: SqlObjectNavigationTarget];
  viewTableData: [target: SqlObjectNavigationTarget];
  viewTableDdl: [target: SqlObjectNavigationTarget];
  editTableStructure: [target: SqlObjectNavigationTarget];
  openObjectSource: [target: SqlObjectNavigationTarget, initialEditing: boolean];
  clickColumn: [columns: Array<{ name: string; table: string; schema?: string }>, error?: string | undefined];
  closeColumnPanel: [];
  viewportChange: [viewport: { scrollTop: number; scrollLeft: number }, tabId?: string];
  selectionStateChange: [selection: { anchor: number; head: number }];
  editorStateFlushed: [];
  sendSelectionToAi: [sql: string];
}>();

const editorRef = ref<HTMLDivElement>();
const view = shallowRef<EditorViewType | null>(null);
const contextMenuOpen = ref(false);

let viewportOwnerTabId = props.tabId;
const viewportEmitTask = createDeferredEditorTask(() => {
  if (latestViewport) emitEditorViewport(latestViewport);
}, 150);
let viewportRestoreFrame: number | null = null;
let latestViewport: { scrollTop: number; scrollLeft: number } | undefined = props.initialViewport;
let lastEmittedViewport: { scrollTop: number; scrollLeft: number } | undefined = props.initialViewport;
let tabSwitchStateCaptured = false;
const executionViewportOwnership = createQueryEditorExecutionViewportOwnership();
let latestSelection: { anchor: number; head: number } | undefined = props.initialSelection;
let contextMenuDoc: Text | null = null;
let contextMenuDocText = "";
const connectionStore = useConnectionStore();
const settingsStore = useSettingsStore();

function sqlStatementParameterOptions() {
  const toggles = resolveSqlVariableSyntaxToggles(settingsStore.editorSettings.sqlVariableSyntaxOverrides, props.databaseType, settingsStore.editorSettings.sqlVariableSubstitutionEnabled);
  return {
    databaseType: props.databaseType,
    compatibilityMode: props.databaseType === "opengauss" ? connectionStore.databaseCompatibilityMode(props.connectionId, props.database) : undefined,
    enabledSyntaxes: enabledSqlParameterSyntaxes(toggles),
  };
}
const { isDark, themePalette, activeCustomUiColors } = useTheme();
const { t } = useI18n();
const { toast } = useToast();
const snippetDatabaseType = computed(() => {
  const connection = props.connectionId ? connectionStore.getConfig(props.connectionId) : undefined;
  return sqlSnippetDatabaseTypeForConnection(connection) ?? props.databaseType;
});
const sqlDriverProfile = computed(() => (props.connectionId ? connectionStore.getConfig(props.connectionId)?.driver_profile : undefined));

const SQL_FUNCTION_NAMES = [
  "COUNT",
  "SUM",
  "AVG",
  "MIN",
  "MAX",
  "GROUP_CONCAT",
  "STRING_AGG",
  "CONCAT",
  "CONCAT_WS",
  "SUBSTRING",
  "REPLACE",
  "TRIM",
  "UPPER",
  "LOWER",
  "LENGTH",
  "REGEXP_REPLACE",
  "DATE_FORMAT",
  "DATEDIFF",
  "DATE_ADD",
  "DATE_SUB",
  "EXTRACT",
  "NOW",
  "CURRENT_DATE",
  "CURRENT_TIME",
  "CURRENT_TIMESTAMP",
  "CURDATE",
  "CURTIME",
  "LOCALTIME",
  "LOCALTIMESTAMP",
  "UTC_DATE",
  "UTC_TIME",
  "UTC_TIMESTAMP",
  "SYSDATE",
  "DATE",
  "TIME",
  "TIMESTAMPDIFF",
  "YEAR",
  "MONTH",
  "DAY",
  "HOUR",
  "MINUTE",
  "SECOND",
  "DAYOFWEEK",
  "DAYOFYEAR",
  "LAST_DAY",
  "STR_TO_DATE",
  "IF",
  "LEFT",
  "RIGHT",
  "SUBSTRING_INDEX",
  "CHAR_LENGTH",
  "INSTR",
  "LOCATE",
  "LPAD",
  "RPAD",
  "FIND_IN_SET",
  "RAND",
  "MD5",
  "SHA1",
  "SHA2",
  "ROUND",
  "FLOOR",
  "CEIL",
  "ABS",
  "MOD",
  "COALESCE",
  "IFNULL",
  "NULLIF",
  "CAST",
  "JSON_EXTRACT",
  "JSON_VALUE",
  "JSON_OBJECT",
  "JSON_ARRAY",
] as const;

const completionTranslations = computed(() => ({
  nullValue: t("editor.completion.nullValue"),
  isNull: t("editor.completion.isNull"),
  isNotNull: t("editor.completion.isNotNull"),
  stringLiteral: t("editor.completion.stringLiteral"),
  numericLiteral: t("editor.completion.numericLiteral"),
  booleanValue: t("editor.completion.booleanValue"),
  starExpansionColumns: t("editor.completion.starExpansionColumns"),
  tableAlias: t("editor.completion.tableAlias"),
  functionDescriptions: Object.fromEntries(SQL_FUNCTION_NAMES.map((name) => [name, t(`editor.completion.functionDescriptions.${name}`)])) as Record<string, string>,
}));
const MAX_COMPLETION_TABLES = 200;
const PRESTO_ON_DEMAND_TABLE_COMPLETION_MIN_PREFIX = 2;
const PRESTO_ON_DEMAND_TABLE_COMPLETION_LIMIT = 20;
const MAX_SEMANTIC_DIAGNOSTIC_COLUMN_TABLES = 4;
const liveFontSize = ref(settingsStore.editorSettings.fontSize);
const gestureStartFontSize = ref(settingsStore.editorSettings.fontSize);
const isGestureZooming = ref(false);

const selectedSql = ref("");
const executableSql = ref("");
const previewContextSql = ref("");
const contextObjectTarget = ref<SqlObjectNavigationTarget | null>(null);

interface SelectStarExpansionTarget {
  from: number;
  to: number;
  references: SqlCompletionReferencedTable[];
  context: SqlCompletionContext;
  qualifierSql?: string;
  statementSql: string;
  allowResultColumnsFallback: boolean;
}

const selectStarExpansionTarget = ref<SelectStarExpansionTarget | null>(null);

const hasSelectedSql = computed(() => selectedSql.value.trim().length > 0);
const canCopySelectedSql = computed(() => selectedSql.value.length > 0);
const canExecuteContextSql = computed(() => executableSql.value.trim().length > 0);

// Execution target picker state
const pickerVisible = ref(false);
const pickerCandidates = ref<SqlExecutionCandidate[]>([]);
const pickerActiveIndex = ref(0);
const pickerAnchor = ref<{ left: number; top: number }>();

// Delimited list dialog state
const delimitedListOpen = ref(false);
const delimitedListSelectedText = ref("");
const codeSnapshotOpen = ref(false);
const codeSnapshotSource = ref<CodeSnapshotSource | null>(null);

function openDelimitedListDialog() {
  if (props.readOnly) return;
  if (!selectedSql.value.trim()) {
    toast(t("editor.delimitedList.selectFirst"), 3000);
    return;
  }
  delimitedListSelectedText.value = selectedSql.value;
  delimitedListOpen.value = true;
  focusEditor();
}

function applyDelimitedListResult(result: string) {
  const currentView = view.value;
  if (!currentView || props.readOnly) return;
  const selection = monacoSqlContextState(currentView).selection.main;
  if (selection.empty) return;
  applyMonacoOffsetEdits(monaco!, currentView, { changes: { from: selection.from, to: selection.to, insert: result }, selection: { anchor: selection.from, head: selection.from + result.length } });
  focusEditor();
}

// ==================== Intention Popup ====================

interface IntentionPopupState {
  visible: boolean;
  // 直接复用 IntentionAction 类型，避免手动重声明导致 replacements 等字段丢失（TS2551）
  actions: IntentionAction[];
  position: { x: number; y: number };
  selectedIndex: number;
}

const intentionPopup = ref<IntentionPopupState | null>(null);

function getIntentionActionLabel(kind: string): string {
  switch (kind) {
    case "expand_wildcard":
      return t("intentionExpandWildcard");
    case "qualify_identifier":
      return t("intentionQualifyIdentifier");
    case "unqualify_identifier":
      return t("intentionUnqualifyIdentifier");
    case "batch_qualify_identifiers":
      return t("intentionBatchQualifyIdentifiers");
    default:
      return kind;
  }
}

function closeIntentionPopup() {
  document.removeEventListener("keydown", onIntentionPopupKey);
  intentionPopup.value = null;
  focusEditor();
}

function onIntentionPopupKey(e: KeyboardEvent) {
  if (!intentionPopup.value?.visible) return;
  switch (e.key) {
    case "Escape":
      e.preventDefault();
      closeIntentionPopup();
      break;
    case "ArrowDown":
      e.preventDefault();
      intentionPopup.value.selectedIndex = Math.min(intentionPopup.value.selectedIndex + 1, intentionPopup.value.actions.length - 1);
      break;
    case "ArrowUp":
      e.preventDefault();
      intentionPopup.value.selectedIndex = Math.max(intentionPopup.value.selectedIndex - 1, 0);
      break;
    case "Enter":
      e.preventDefault();
      executeIntentionAction(intentionPopup.value.actions[intentionPopup.value.selectedIndex]);
      break;
  }
}

function executeIntentionAction(action: IntentionPopupState["actions"][number]) {
  if (!intentionPopup.value) return;
  closeIntentionPopup();

  const currentView = view.value;
  if (!currentView) return;

  switch (action.kind) {
    case "expand_wildcard": {
      const sql = monacoSqlContextState(currentView).doc.toString();
      const cursor = monacoSqlContextState(currentView).selection.main.head;
      void (async () => {
        try {
          const ctx = prepareExpandWildcardContext(sql, cursor, props.databaseType, sqlBehaviorDialect());
          if (!ctx) return;

          const replacement = await buildExpandWildcardReplacement(props.databaseType, ctx.rowSources, async (source) => {
            const schema = source.metadataTarget?.schema;
            const tableName = source.metadataTarget?.table ?? source.name;
            if (!tableName) return [];
            const result = await loadTableMetadata({
              connectionId: props.connectionId ?? "",
              database: props.database ?? "",
              schema,
              tableName,
              databaseType: props.databaseType ?? "mysql",
              force: false,
            });
            return result.metadata.columns.map((c) => c.name);
          });
          const activeView = view.value;
          if (!activeView || activeView !== currentView || monacoSqlContextState(activeView).doc.toString() !== sql) return;
          applyMonacoOffsetEdits(monaco!, activeView, { changes: { from: ctx.starSpan.start, to: ctx.starSpan.end, insert: replacement } });
        } catch {
          // metadata load failed
        }
      })();
      break;
    }
    case "qualify_identifier":
    case "unqualify_identifier":
      applyMonacoOffsetEdits(monaco!, currentView, {
        changes: { from: action.span.start, to: action.span.end, insert: action.replacement },
      });
      break;

    case "batch_qualify_identifiers": {
      // 按从后往前的顺序逐一替换，避免 offset 漂移
      const reps = action.replacements ?? [];
      for (let i = reps.length - 1; i >= 0; i--) {
        const r = reps[i];
        applyMonacoOffsetEdits(monaco!, currentView, {
          changes: { from: r.span.start, to: r.span.end, insert: r.replacement },
        });
      }
      break;
    }
  }
}

const executeContextMenuLabel = computed(() => t(hasSelectedSql.value ? "editor.contextMenu.executeSelection" : "editor.contextMenu.executeCurrent"));

interface EditorGestureEvent extends Event {
  scale?: number;
}

let semanticDiagnostics: SqlSemanticDiagnostic[] = [];
let semanticDiagnosticTimer: ReturnType<typeof setTimeout> | null = null;
let semanticDiagnosticRunId = 0;
let pendingSemanticDiagnosticPreserveOutsideRanges = false;
let deferredCompletionTriggerTimer: ReturnType<typeof setTimeout> | null = null;
let previewContextRefreshTimer: ReturnType<typeof setTimeout> | null = null;
let editorIsActive = true;
let tableReferenceDropListenerRegistered = false;
let imeCompositionActive = false;
let pendingImeModelEmit = false;
const postCompositionKeyGuard = createQueryEditorPostCompositionKeyGuard();
let postCompositionKeyGuardCleanup: (() => void) | null = null;

let executableStatementRangeCache: ExecutableStatementRangeCache | null = null;

const tableNavigationHoverClass = "query-editor--table-navigation-hover";

const BEFORE_TAB_SWITCH_EVENT = "dbx:before-tab-switch";

function editorThemeAppearance() {
  return editorThemeAppearanceFor(isDark.value ? "dark" : "light", themePalette.value, themePalette.value === "custom" ? activeCustomUiColors.value : undefined);
}

// Completion cache
let cachedTables: SqlCompletionTable[] = [];
const cachedCompletionObjectsByScope = new Map<string, SqlCompletionObject[]>();
// Persistent column cache keyed by "schema.table" or "table"
const cachedColumnsByTable = new Map<string, SqlCompletionColumn[]>();
const cachedPrefixColumnsByTable = new Map<string, SqlCompletionColumn[]>();
const cachedInsertValueHintColumnsByTable = new Map<string, string[]>();
const cachedForeignKeysByTable = new Map<string, SqlCompletionForeignKey[]>();
const loadedColumnsByTable = new Set<string>();

// Hover tooltip shares the persisted object cache with the DDL and structure views.

function sqlCompletionDialectOptions() {
  return {
    databaseType: props.databaseType,
    dialect: sqlBehaviorDialect(),
    editorState: view.value ? monacoSqlContextState(view.value) : undefined,
  };
}

let editorCompletionContextCache: {
  doc: Text;
  editorState: EditorState | undefined;
  position: number;
  databaseType: DatabaseType | undefined;
  dialect: string | undefined;
  context: ReturnType<typeof getSqlCompletionContext>;
} | null = null;

function getEditorSqlCompletionContext(sql: string, position: number, editorState = view.value ? monacoSqlContextState(view.value) : undefined): ReturnType<typeof getSqlCompletionContext> {
  const dialect = sqlBehaviorDialect();
  const doc = editorState?.doc;
  if (doc && editorCompletionContextCache?.doc === doc && editorCompletionContextCache.editorState === editorState && editorCompletionContextCache.position === position && editorCompletionContextCache.databaseType === props.databaseType && editorCompletionContextCache.dialect === dialect) {
    return editorCompletionContextCache.context;
  }

  const context = getSqlCompletionContext(sql, position, {
    databaseType: props.databaseType,
    dialect,
    editorState,
  });
  if (doc) {
    editorCompletionContextCache = {
      doc,
      editorState,
      position,
      databaseType: props.databaseType,
      dialect,
      context,
    };
  }
  return context;
}

function usesOracleSessionCompletionColumns(schema?: string | null): boolean {
  return shouldUseOracleSessionCompletionColumns({
    databaseType: props.databaseType,
    selectedSchema: props.schema,
    referenceSchema: schema,
    clientSessionId: props.clientSessionId,
  });
}

function completionColumnRequestContext(reference?: Pick<SqlCompletionReferencedTable, "nameQuoted" | "schemaQuoted">) {
  return {
    clientSessionId: props.clientSessionId,
    version: props.completionContextVersion,
    tableQuoted: reference?.nameQuoted,
    schemaQuoted: reference?.schemaQuoted,
  };
}

async function listCompletionColumnsForEditor(connectionId: string, database: string, table: string, schema?: string, catalog = props.catalog, reference?: Pick<SqlCompletionReferencedTable, "nameQuoted" | "schemaQuoted">, prefix?: string) {
  const requestedVersion = props.completionContextVersion;
  const sessionScoped = usesOracleSessionCompletionColumns(schema);
  let columns: SqlCompletionColumn[];
  if (prefix && prefix.length >= 2 && (props.databaseType === "postgres" || props.databaseType === "mysql")) {
    try {
      columns = await connectionStore.listCompletionColumnsByPrefix(connectionId, database, table, schema, prefix, catalog, completionColumnRequestContext(reference));
    } catch {
      columns = await connectionStore.listCompletionColumns(connectionId, database, table, schema, completionColumnRequestContext(reference), catalog);
    }
  } else {
    columns = await connectionStore.listCompletionColumns(connectionId, database, table, schema, completionColumnRequestContext(reference), catalog);
  }
  if (sessionScoped && requestedVersion !== props.completionContextVersion) throw new Error("Stale Oracle completion context");
  return columns;
}

async function refreshCompletionColumnsForEditor(connectionId: string, database: string, table: string, schema?: string, catalog = props.catalog, reference?: Pick<SqlCompletionReferencedTable, "nameQuoted" | "schemaQuoted">) {
  const requestedVersion = props.completionContextVersion;
  const sessionScoped = usesOracleSessionCompletionColumns(schema);
  const columns = await connectionStore.refreshCompletionColumns(connectionId, database, table, schema, completionColumnRequestContext(reference), catalog);
  if (sessionScoped && requestedVersion !== props.completionContextVersion) throw new Error("Stale Oracle completion context");
  return columns;
}

const zoomCommitScheduler = createEditorZoomCommitScheduler((fontSize) => {
  if (settingsStore.editorSettings.fontSize === fontSize) return;
  settingsStore.updateEditorSettings({ fontSize });
});
const wheelZoomGestureGuard = createEditorWheelZoomGestureGuard();

const queryEditorAppearanceSettings = computed(() => {
  const settings = settingsStore.editorSettings;
  return {
    fontFamily: settings.fontFamily,
    fontSize: settings.fontSize,
    theme: settings.theme,
    customThemeColors: settings.customThemeColors,
    customThemes: settings.customThemes,
    activeCustomThemeId: settings.activeCustomThemeId,
    wordWrap: settings.wordWrap,
    vimModeEnabled: settings.vimModeEnabled,
    autoCloseBrackets: settings.autoCloseBrackets,
    showLineNumbers: settings.showLineNumbers,
    shortcuts: settings.shortcuts,
    showStatementRunButtons: settings.showStatementRunButtons,
  };
});

function syncEditorFontCssVars(fontSize = liveFontSize.value, fontFamily = settingsStore.editorSettings.fontFamily) {
  if (!editorRef.value) return;
  editorRef.value.style.setProperty(EDITOR_FONT_SIZE_CSS_VAR, `${clampEditorFontSize(fontSize)}px`);
  editorRef.value.style.setProperty(EDITOR_FONT_FAMILY_CSS_VAR, fontFamily);
}

// Diagnostics render on the editor surface, so their marker colors follow the
// resolved editor appearance (which already adapts to custom backgrounds) via
// editor-scoped variables instead of the app-level warning/destructive tokens.
function syncEditorDiagnosticCssVars() {
  if (!editorRef.value) return;
  const colors = editorDiagnosticColors(editorThemeAppearance());
  editorRef.value.style.setProperty("--dbx-editor-diagnostic-error", colors.error);
  editorRef.value.style.setProperty("--dbx-editor-diagnostic-warning", colors.warning);
}

let pendingFontReconfig: { size: number; family: string } | null = null;
let fontReconfigScheduled = false;

function reconfigureFontTheme(size: number, family: string) {
  view.value?.updateOptions({ fontSize: size, fontFamily: family });
}

function scheduleFontThemeReconfig(size: number, family: string) {
  pendingFontReconfig = { size, family };
  if (fontReconfigScheduled) return;
  fontReconfigScheduled = true;
  requestAnimationFrame(() => {
    fontReconfigScheduled = false;
    const p = pendingFontReconfig;
    if (p) {
      pendingFontReconfig = null;
      reconfigureFontTheme(p.size, p.family);
    }
  });
}

function applyLiveFontSize(size: number) {
  const next = clampEditorFontSize(size);
  if (liveFontSize.value === next) return;
  liveFontSize.value = next;
  syncEditorFontCssVars(next);
  // Throttle compartment reconfiguration to at most once per animation
  // frame so that CSS variable changes remain smooth on every wheel tick,
  // while the CodeMirror measure → syncGutters path keeps gutters aligned.
  scheduleFontThemeReconfig(next, settingsStore.editorSettings.fontFamily);
}

function scheduleFontSizeCommit(size: number) {
  zoomCommitScheduler.schedule(size);
}

function onEditorGestureStart(event: EditorGestureEvent) {
  event.preventDefault();
  isGestureZooming.value = true;
  gestureStartFontSize.value = liveFontSize.value;
}

function onEditorGestureChange(event: EditorGestureEvent) {
  if (typeof event.scale !== "number") return;
  event.preventDefault();
  applyLiveFontSize(fontSizeFromGestureScale(gestureStartFontSize.value, event.scale));
}

function onEditorGestureEnd(event: Event) {
  event.preventDefault();
  isGestureZooming.value = false;
  zoomCommitScheduler.flush(liveFontSize.value);
}

// Resolve the indent unit (one Tab worth) from the SQL formatter settings so
// the Tab key, multi-line indent and auto-indent all honor the configured width.

// The Tab key is always wired up for indentation and snippet-field navigation,
// but it must only accept an open completion popup when the user's configured
// "accept completion" shortcut is actually Tab — otherwise a user who remapped
// that shortcut (e.g. to Enter) would find Tab silently accepting completions
// anyway, ignoring their setting (dbx#6236).

interface RequestExecuteOptions {
  ignoreSelection?: boolean;
  bypassPicker?: boolean;
  openInNewResultTab?: boolean;
}

function emitExecutionRequest(source: SqlExecutionOverride, openInNewResultTab = false) {
  if (typeof source === "string" || source.editorViewportRequestId === undefined) {
    executionViewportOwnership.cancelPendingRequest();
  }
  if (openInNewResultTab) {
    emit("executeInNewResultTab", source);
  } else {
    emit("execute", source);
  }
}

/**
 * Captures a manual selection before a toolbar click can cause a platform
 * focus transition. The snapshot is immutable, so downstream execution keeps
 * the exact SQL and source offsets that were visible when the button was
 * pressed.
 */
function captureExecutionSnapshot(): SqlExecutionSnapshot | undefined {
  const currentView = view.value;
  if (!currentView || monacoSqlContextState(currentView).selection.main.empty) return undefined;
  return sqlExecutionSnapshotFromView(currentView);
}

function requestExecute(options: RequestExecuteOptions = {}) {
  executionViewportOwnership.cancelPendingRequest();
  const currentView = view.value;
  if (!currentView) return false;
  currentView.focus();
  return requestExecuteFromView(currentView, monacoSqlContextState(currentView).selection.main.head, options);
}

function requestExecuteInNewResultTab() {
  return requestExecute({ bypassPicker: true, openInNewResultTab: true });
}

function requestExecuteFromView(currentView: EditorViewType, cursorPos: number, options: RequestExecuteOptions = {}) {
  const selection = monacoSqlContextState(currentView).selection.main;
  if (!options.ignoreSelection && !selection.empty) {
    // Has manual selection → execute directly, skip picker.
    emitExecutionRequest(sqlExecutionSnapshotFromView(currentView), options.openInNewResultTab);
    return true;
  }
  if (!supportsExecutionTargetPicker(props.databaseType)) {
    emitExecutionRequest(sqlExecutionSnapshotFromView(currentView), options.openInNewResultTab);
    return true;
  }
  // No selection → resolve the execution target, optionally via the picker.
  const doc = monacoSqlContextState(currentView).doc.toString();
  const parameterOptions = sqlStatementParameterOptions();
  const candidates = buildExecutionCandidates(doc, cursorPos, props.databaseType, parameterOptions);
  const executeMode = settingsStore.editorSettings.executeMode;
  if (candidates.length === 0) {
    if (executeMode === "current") toast(t("editor.noExecutableStatementAtCursor"), 3000);
    return true;
  }
  const candidate = executionCandidateForMode(candidates, executeMode, {
    executeAllOnBlankLine: settingsStore.editorSettings.executeAllOnBlankLine,
  });
  if (!candidate) {
    toast(t("editor.noExecutableStatementAtCursor"), 3000);
    return true;
  }
  // The execution shortcut keeps executing the configured target (cursor/all) directly:
  // it stays keyboard-driven and never pops the picker, which is reserved for click entry points.
  if (options.bypassPicker || !settingsStore.editorSettings.showExecutionTargetPicker || !hasMultipleExecutionTargets(doc, props.databaseType, parameterOptions)) {
    emitExecutionRequest(sqlExecutionSnapshotForRange(currentView, candidate), options.openInNewResultTab);
    return true;
  }
  closePicker();
  pickerCandidates.value = candidates;
  pickerActiveIndex.value = 0;
  pickerAnchor.value = executionPickerAnchor(currentView, cursorPos, candidates.length);
  pickerVisible.value = true;
  setPreviewRange({ from: candidates[0].from, to: candidates[0].to });
  return true;
}

function executionPickerAnchor(currentView: EditorViewType, cursorPos: number, candidateCount: number): { left: number; top: number } | undefined {
  const cursorRect = monacoCoordsAtOffset(currentView, cursorPos);
  const rootRect = editorRef.value?.getBoundingClientRect();
  if (!cursorRect || !rootRect) return undefined;

  const verticalGap = 8;
  const pickerHeight = 40 + Math.max(1, candidateCount) * 36;
  const verticalMargin = 12;
  const left = rootRect.width / 2;
  const cursorBottom = cursorRect.bottom - rootRect.top;
  const maxTop = Math.max(verticalMargin, rootRect.height - pickerHeight - verticalMargin);
  const top = Math.min(cursorBottom + verticalGap, maxTop);

  return { left, top };
}

function setPreviewRange(range: { from: number; to: number } | null) {
  setNativeRangeDecoration("preview", range);
}

function setResultSourceRange(range: { from: number; to: number } | null) {
  setNativeRangeDecoration("result", range);
}

function previewStatementRange(range: { from: number; to: number } | null) {
  const currentView = view.value;
  if (!range || !currentView) {
    setResultSourceRange(null);
    return;
  }

  const from = Math.max(0, Math.min(range.from, monacoSqlContextState(currentView).doc.length));
  const to = Math.max(from, Math.min(range.to, monacoSqlContextState(currentView).doc.length));
  if (from === to) {
    setResultSourceRange(null);
    return;
  }

  applyMonacoOffsetEdits(monaco!, currentView, {
    selection: { anchor: from },
    scrollIntoView: true,
  });
  setResultSourceRange({ from, to });
}

function focusStatementRange(range: { from: number; to: number } | null) {
  const currentView = view.value;
  if (!range || !currentView) {
    setResultSourceRange(null);
    return;
  }
  const from = Math.max(0, Math.min(range.from, monacoSqlContextState(currentView).doc.length));
  const to = Math.max(from, Math.min(range.to, monacoSqlContextState(currentView).doc.length));
  if (from === to) return;
  applyMonacoOffsetEdits(monaco!, currentView, {
    selection: { anchor: from, head: to },
    scrollIntoView: true,
  });
  setResultSourceRange({ from, to });
  currentView.focus();
}

function onPickerActiveIndexChange(index: number) {
  pickerActiveIndex.value = index;
  const candidate = pickerCandidates.value[index];
  if (candidate) {
    setPreviewRange({ from: candidate.from, to: candidate.to });
  }
}

function onPickerConfirm(candidate: SqlExecutionCandidate) {
  const currentView = view.value;
  closePicker();
  emit("execute", currentView ? sqlExecutionSnapshotForRange(currentView, candidate) : candidate.sql);
}

function closePicker() {
  pickerVisible.value = false;
  pickerAnchor.value = undefined;
  setPreviewRange(null);
  // Restore focus to the CodeMirror editor.
  view.value?.focus();
}

function currentEditorDocText(currentView: EditorViewType): string {
  const doc = monacoSqlContextState(currentView).doc;
  if (contextMenuDoc !== doc) {
    contextMenuDoc = doc;
    contextMenuDocText = doc.toString();
  }
  return contextMenuDocText;
}

function syncEditorSelectionState(currentView: EditorViewType) {
  selectedSql.value = selectedSqlFromView(currentView);
  executableSql.value = resolveExecutableSql(currentEditorDocText(currentView), selectedSql.value);
}

function syncContextMenuState(currentView: EditorViewType, starPosition?: number, previewPosition?: number) {
  syncEditorSelectionState(currentView);
  previewContextSql.value = resolvePreviewDmlCandidate(previewPosition);
  selectStarExpansionTarget.value = selectStarExpansionTargetForView(currentView, starPosition);
}

function clearScheduledPreviewContextRefresh() {
  if (previewContextRefreshTimer === null) return;
  clearTimeout(previewContextRefreshTimer);
  previewContextRefreshTimer = null;
}

function schedulePreviewContextRefresh(currentView: EditorViewType) {
  clearScheduledPreviewContextRefresh();
  const expectedDoc = monacoSqlContextState(currentView).doc;
  const expectedSelection = monacoSqlContextState(currentView).selection.main;
  previewContextRefreshTimer = setTimeout(() => {
    previewContextRefreshTimer = null;
    const currentSelection = monacoSqlContextState(currentView).selection.main;
    if (view.value !== currentView || monacoSqlContextState(currentView).doc !== expectedDoc || currentSelection.from !== expectedSelection.from || currentSelection.to !== expectedSelection.to || !editorIsActive) return;
    previewContextSql.value = resolvePreviewDmlCandidate();
    emit("previewChangesAvailable", !!previewContextSql.value);
  }, 120);
}

function selectStarExpansionTargetForView(currentView: EditorViewType, position?: number): SelectStarExpansionTarget | null {
  if (!props.connectionId || props.database == null || props.readOnly || !SEMANTIC_SQL_COMPLETION_ENABLED) return null;

  const sql = currentEditorDocText(currentView);
  const selection = monacoSqlContextState(currentView).selection.main;
  let cursor: number;
  if (position != null) {
    if (sql[position] === "*") {
      cursor = position + 1;
    } else if (sql[position - 1] === "*") {
      cursor = position;
    } else {
      return null;
    }
  } else if (!selection.empty) {
    if (monacoSqlContextState(currentView).sliceDoc(selection.from, selection.to) !== "*") return null;
    cursor = selection.to;
  } else if (sql[selection.head] === "*") {
    cursor = selection.head + 1;
  } else if (sql[selection.head - 1] === "*") {
    cursor = selection.head;
  } else {
    return null;
  }

  const model = buildSqlSemanticModel(sql, cursor, sqlCompletionDialectOptions());
  const intent = model.cursorIntent;
  if (intent.kind !== "star" || intent.confidence !== "high" || intent.replacementRange.end - intent.replacementRange.start !== 1 || sql.slice(intent.replacementRange.start, intent.replacementRange.end) !== "*") return null;
  if (position == null && !selection.empty && (selection.from !== intent.replacementRange.start || selection.to !== intent.replacementRange.end)) return null;

  const starToken = model.tokens.find((token) => token.span.start === intent.replacementRange.start && token.span.end === intent.replacementRange.end && token.text === "*");
  if (!starToken) return null;
  let isSelectProjection = false;
  for (let index = model.tokens.length - 1; index >= 0; index -= 1) {
    const token = model.tokens[index];
    if (!token || token.span.end > starToken.span.start || token.depth !== starToken.depth || token.kind !== "word") continue;
    if (token.normalized === "from") return null;
    if (token.normalized === "select") {
      isSelectProjection = true;
      break;
    }
  }
  if (!isSelectProjection) return null;

  const sources = sqlSemanticSelectStarTableSources(model);
  if (sources.length === 0) return null;

  const references = sources.map((source): SqlCompletionReferencedTable => {
    const identifierParts = source.qualifiedName?.parts ?? [];
    return {
      // Use the semantic metadata target instead of reparsing the table token at
      // its source span. The latter can resolve the alias token in aliased
      // sources, causing column metadata requests for `tv` instead of
      // `tVillage`.
      name: source.metadataTarget?.table ?? source.name,
      nameQuoted: !!identifierParts[identifierParts.length - 1]?.quote,
      database: source.metadataTarget?.database,
      schema: source.metadataTarget?.schema ?? source.qualifierParts[source.qualifierParts.length - 1],
      schemaQuoted: source.qualifierParts.length > 0 ? !!identifierParts[identifierParts.length - 2]?.quote : undefined,
      alias: source.alias,
      aliasSql: source.aliasSpan ? sql.slice(source.aliasSpan.start, source.aliasSpan.end) : source.alias,
    };
  });
  const legacyContext = getEditorSqlCompletionContext(sql, cursor);
  const context = sqlCompletionContextFromSemantic(model, legacyContext);
  if (context.statementKind !== "select" || !context.onStar) return null;

  return {
    from: intent.replacementRange.start,
    to: intent.replacementRange.end,
    references,
    context: { ...context, referencedTables: references },
    qualifierSql: sqlSemanticSelectStarQualifierSql(model),
    statementSql: model.statement.text,
    allowResultColumnsFallback: references.length === 1 && model.rowSources.length === 1 && sqlSemanticSelectStarIsOnlyProjection(model),
  };
}

function syncContextMenuStateAtEvent(currentView: EditorViewType, event: MouseEvent) {
  const pos = monacoPositionAtCoords(currentView, { x: event.clientX, y: event.clientY });
  clearScheduledPreviewContextRefresh();
  // 预览按“右键点击处”解析当前语句（执行按光标处），右键处与光标一致时才直觉一致。
  syncContextMenuState(currentView, pos ?? undefined, pos ?? undefined);
  if (pos == null) {
    contextObjectTarget.value = null;
    return;
  }

  const sql = currentEditorDocText(currentView);
  if (!props.connectionId || props.database == null) {
    const candidate = queryTableCandidateAtSqlPosition({
      connectionId: "",
      database: props.database ?? "",
      schema: props.schema,
      databaseType: props.databaseType,
      sql,
      position: pos,
    });
    contextObjectTarget.value = candidate
      ? {
          name: candidate.tableName,
          database: candidate.database,
          schema: candidate.schema,
        }
      : null;
    return;
  }

  const parsedCandidate = queryTableCandidateAtSqlPosition({
    connectionId: props.connectionId,
    database: props.database,
    schema: props.schema,
    databaseType: props.databaseType,
    sql,
    position: pos,
  });
  if (!parsedCandidate) {
    contextObjectTarget.value = null;
    return;
  }

  // Right-click must stay instant: resolve from completion/tree caches and keep the legacy table fallback when metadata is unavailable.
  const candidate = resolveQueryContextCandidateDatabase(parsedCandidate, connectionStore.lookupLocalCompletionDatabases(parsedCandidate.connectionId, parsedCandidate.database, MAX_COMPLETION_TABLES));
  const tables = connectionStore.lookupLocalCompletionTables(candidate.connectionId, candidate.database, candidate.tableName, MAX_COMPLETION_TABLES, candidate.schema, props.catalog);
  contextObjectTarget.value = resolveQueryContextObjectTarget(candidate, tables);
}

function focusEditor() {
  view.value?.focus();
}

function clearTableNavigationHover() {
  editorRef.value?.classList.remove(tableNavigationHoverClass);
}

function tableNavigationIdentifierAt(currentView: EditorViewType, event: MouseEvent): string | null {
  if (!props.connectionId || props.database == null) return null;
  const pos = monacoPositionAtCoords(currentView, { x: event.clientX, y: event.clientY });
  if (pos == null) return null;
  const extracted = extractIdentifierDetailsAt(monacoSqlContextState(currentView).doc.toString(), pos);
  if (!extracted || (!extracted.quoted && isSqlKeyword(extracted.identifier))) return null;
  return extracted.identifier;
}

function updateTableNavigationHover(currentView: EditorViewType, event: MouseEvent) {
  if (!usesQueryEditorObjectNavigationModifier(event)) {
    clearTableNavigationHover();
    return false;
  }
  const identifier = tableNavigationIdentifierAt(currentView, event);
  editorRef.value?.classList.toggle(tableNavigationHoverClass, !!identifier);
  return !!identifier;
}

function executeFromContextMenu() {
  if (!canExecuteContextSql.value) return;
  requestExecute();
  focusEditor();
}

function executeInNewResultTabFromContextMenu() {
  if (!canExecuteContextSql.value) return;
  requestExecuteInNewResultTab();
  focusEditor();
}

function exportQueryFromContextMenu(format: "csv" | "xlsx" | "txt") {
  const sql = executableSql.value;
  if (!sql.trim()) return;
  emit("exportQuery", { sql, format, columnComments: undefined });
}

// 与「执行」使用同一套候选解析：选区优先，否则取 position（右键点击处）/ 光标处的单条语句。
// 注意：不跟随 executeAllOnBlankLine 回退到“整篇文档”（那会包含多条语句）。
function resolvePreviewDmlCandidate(position?: number): string {
  const currentView = view.value;
  if (!currentView) return "";
  const selection = monacoSqlContextState(currentView).selection.main;
  if (!selection.empty) {
    const text = monacoSqlContextState(currentView).sliceDoc(selection.from, selection.to);
    return looksLikeDmlStatement(text) ? text : "";
  }
  const cursorPos = position ?? selection.head;
  executableStatementRangeCache = executableStatementRangeCacheForDoc(executableStatementRangeCache, monacoSqlContextState(currentView).doc, props.databaseType, sqlStatementParameterOptions());
  const cursorRange = executableStatementRangeAtCursor(executableStatementRangeCache, cursorPos);
  return cursorRange && looksLikeDmlStatement(cursorRange.sql) ? cursorRange.sql : "";
}

function emitModelValue(currentView: EditorViewType): string {
  const sql = currentEditorDocText(currentView);
  emit("update:modelValue", sql);
  return sql;
}

// 「预览变更」：把当前 DML 语句改写为只读 SELECT，作为新结果标签执行（干跑，不写库）。
async function requestPreviewChanges(stackSql?: string) {
  let sql = (stackSql ?? "").trim();
  // 永远只预览“单条语句”：禁用整篇文档回退（那会包含多条语句）。
  if (!sql) sql = resolvePreviewDmlCandidate();
  if (!sql) {
    toast(t("editor.previewChangesNoStatement"), 3000);
    return false;
  }
  try {
    const identifierQuote = props.connectionId ? connectionStore.connectionIdentifierQuote?.(props.connectionId) : undefined;
    // 第一次：生成基础预览 SELECT，并拿到目标表引用。
    let preview = await api.buildDmlChangePreviewSql({ sql, databaseType: props.databaseType, identifierQuote });
    // 单表 UPDATE：拉取目标表列元数据，让「新值」列紧跟其原值列（交错展开）。
    if (preview.tables.length === 1 && props.connectionId && props.database) {
      const tableRef = preview.tables[0];
      if (tableRef.table) {
        const columns = await api
          .getColumns(props.connectionId, props.database, tableRef.schema ?? "", tableRef.table, tableRef.catalog)
          .then((infos) => infos.map((column) => column.name))
          .catch(() => undefined);
        if (columns?.length) {
          preview = await api.buildDmlChangePreviewSql({ sql, databaseType: props.databaseType, identifierQuote, columns });
        }
      }
    }
    // 前置注释标注干跑预览（引擎会忽略注释），并在新结果标签中展示受影响行 + 新值列。
    emit("executeInNewResultTab", `/* ${t("editor.previewChangesComment", { operation: preview.operation })} */\n${preview.sql}`);
    return true;
  } catch (error: any) {
    // http 层抛 BackendErrorException（Error），tauri 层拒绝时是 String。
    const message = error instanceof Error ? error.message : typeof error === "string" ? error : t("editor.previewChangesFailed");
    toast(message, 4000);
    return false;
  }
}

async function copySelectedSqlFromContextMenu() {
  if (!canCopySelectedSql.value) return;
  try {
    await copyToClipboard(selectedSql.value);
    toast(t("grid.copied"));
    focusEditor();
  } catch (e: any) {
    toast(t("grid.copyFailed", { message: e?.message || String(e) }), 5000);
  }
}

// 富文本复制：写入 text/html + text/plain，粘贴到邮件/Word/IM 时保留语法高亮。
async function copySelectedSqlAsRichTextFromContextMenu() {
  if (!canCopySelectedSql.value) return;
  try {
    await copySqlAsRichText(selectedSql.value);
    toast(t("grid.copied"));
    focusEditor();
  } catch (e: any) {
    toast(t("grid.copyFailed", { message: e?.message || String(e) }), 5000);
  }
}

async function cutSelectedSqlFromContextMenu() {
  if (!canCopySelectedSql.value) return;
  const currentView = view.value;
  if (!currentView) return;
  try {
    await copyToClipboard(selectedSql.value);
    // 剪切：复制后删除选中内容
    const selection = monacoSqlContextState(currentView).selection.main;
    if (!selection.empty) {
      applyMonacoOffsetEdits(monaco!, currentView, {
        changes: { from: selection.from, to: selection.to },
        selection: { anchor: selection.from, head: selection.from },
        scrollIntoView: true,
        userEvent: "input.cut",
      });
    }
    toast(t("grid.cut"));
    focusEditor();
  } catch (e: any) {
    toast(t("grid.copyFailed", { message: e?.message || String(e) }), 5000);
  }
}

async function pasteClipboardSqlFromContextMenu() {
  if (props.readOnly) return;
  const currentView = view.value;
  if (!currentView) return;
  try {
    const text = await readTextFromClipboard();
    if (!text) return;
    const selection = monacoSqlContextState(currentView).selection.main;
    // 粘贴：替换选中内容或在光标处插入
    applyMonacoOffsetEdits(monaco!, currentView, {
      changes: { from: selection.from, to: selection.to, insert: text },
      selection: { anchor: selection.from + text.length, head: selection.from + text.length },
      scrollIntoView: true,
      userEvent: "input.paste",
    });
    focusEditor();
  } catch (e: any) {
    toast(t("editor.contextMenu.pasteClipboardReadFailed", { message: e?.message || String(e) }), 5000);
  }
}

function toggleCommentFromContextMenu() {
  if (!props.readOnly) runMonacoAction(view.value, "editor.action.commentLine");
  focusEditor();
}

function toggleBlockCommentFromContextMenu() {
  if (!props.readOnly) runMonacoAction(view.value, "editor.action.blockComment");
  focusEditor();
}

function selectAllSqlFromContextMenu() {
  view.value?.trigger("dbx", "editor.action.selectAll", null);
  focusEditor();
}

function convertSelectedSqlCase(mode: SqlSelectionCaseMode): boolean {
  const currentView = view.value;
  if (!currentView || props.readOnly) return false;

  const state = monacoSqlContextState(currentView);
  const documentText = state.doc.toString();
  const transaction = state.changeByRange((range) => {
    if (range.empty) return { range };

    const convertedText = convertSqlSelectionCase(documentText, { from: range.from, to: range.to }, mode, sqlBehaviorDialect());
    return {
      changes: { from: range.from, to: range.to, insert: convertedText },
      range: EditorSelection.range(range.from, range.from + convertedText.length),
    };
  });

  if (!transaction.changes.empty) {
    applyMonacoOffsetEdits(monaco!, currentView, {
      ...transaction,
      scrollIntoView: true,
      userEvent: "input",
    });
    focusEditor();
    return true;
  }
  return false;
}

function convertSelectedNamingStyle(): boolean {
  const currentView = view.value;
  if (!currentView || props.readOnly) return false;

  const state = monacoSqlContextState(currentView);
  const transaction = state.changeByRange((range) => {
    if (range.empty) return { range };

    const selectedText = state.doc.sliceString(range.from, range.to);
    const result = convertToNextNamingStyle(selectedText);
    return {
      changes: { from: range.from, to: range.to, insert: result.text },
      range: EditorSelection.range(range.from, range.from + result.text.length),
    };
  });

  if (!transaction.changes.empty) {
    applyMonacoOffsetEdits(monaco!, currentView, {
      ...transaction,
      scrollIntoView: true,
      userEvent: "input",
    });
    focusEditor();
    return true;
  }
  return false;
}

async function pasteClipboardAsSqlInCondition(): Promise<boolean> {
  if (!supportsSqlInListPaste(props.databaseType)) return false;
  if (props.readOnly) return false;
  const currentView = view.value;
  if (!currentView) return false;

  const selection = monacoSqlContextState(currentView).selection.main;
  const selectedSource = selection.empty ? "" : monacoSqlContextState(currentView).sliceDoc(selection.from, selection.to);
  let source = selectedSource;
  if (!source) {
    try {
      source = await readTextFromClipboard();
    } catch (e: any) {
      toast(
        t("editor.exPasteClipboardReadFailed", {
          message: e?.message || String(e),
        }),
        5000,
      );
      focusEditor();
      return false;
    }
  }

  const result = buildSqlInConditionFromPasteSource(source, settingsStore.editorSettings.sqlFormatter.keywordCase);
  if (!result.ok) {
    const key = result.reason === "too-large" ? "editor.exPasteTooLarge" : result.reason === "too-many-values" ? "editor.exPasteTooManyValues" : result.reason === "not-list" ? "editor.exPasteNotList" : "editor.exPasteNoValues";
    toast(t(key, { limit: result.limit ?? 0 }), 5000);
    focusEditor();
    return false;
  }

  if (view.value !== currentView || props.readOnly) return false;
  const state = monacoSqlContextState(currentView);
  const line = state.doc.lineAt(selection.from);
  const prefix = state.sliceDoc(line.from, selection.from);
  const insertText = insertTextForSqlInCondition(result.sql, prefix);

  applyMonacoOffsetEdits(monaco!, currentView, {
    changes: { from: selection.from, to: selection.to, insert: insertText },
    selection: { anchor: selection.from + insertText.length },
    scrollIntoView: true,
    userEvent: "input.paste",
  });
  currentView.focus();
  toast(t("editor.exPastePasted", { count: result.valueCount }), 2000);
  return true;
}

// See queryEditorPasteCaretResync.ts for why this nudge is needed (WebKit-only caret bug).

function deleteEmptyLines() {
  const currentView = view.value;
  if (!currentView || props.readOnly) return;

  const state = monacoSqlContextState(currentView);
  const selection = state.selection.main;
  const changes = blankLineDeletionChanges(state.doc, selection);
  if (changes.length === 0) return;

  applyMonacoOffsetEdits(monaco!, currentView, {
    changes,
    scrollIntoView: true,
  });
  focusEditor();
}

function openFindReplaceFromContextMenu() {
  openSearch();
}

function emitContextObjectAction(action: QueryContextObjectAction) {
  if (!contextObjectTarget.value) return;
  const route = queryContextObjectRoute(action, contextObjectTarget.value);
  switch (route.event) {
    case "viewTableData":
      emit("viewTableData", route.payload[0]);
      break;
    case "editTableStructure":
      emit("editTableStructure", route.payload[0]);
      break;
    case "openObjectSource":
      emit("openObjectSource", route.payload[0], route.payload[1]);
      break;
    case "viewTableDdl":
      emit("viewTableDdl", route.payload[0]);
      break;
  }
  focusEditor();
}

function contextObjectMenuItem(action: QueryContextObjectAction): ContextMenuItem {
  const disabled = !contextObjectTarget.value;
  switch (action) {
    case "view-data":
      return {
        label: t("contextMenu.viewData"),
        action: () => emitContextObjectAction(action),
        disabled,
        icon: Table2,
      };
    case "edit-table-structure":
      return {
        label: t("contextMenu.editStructure"),
        action: () => emitContextObjectAction(action),
        disabled,
        icon: PencilRuler,
      };
    case "edit-view":
      return {
        label: t("contextMenu.editView"),
        action: () => emitContextObjectAction(action),
        disabled,
        icon: Pencil,
      };
    case "view-source":
      return {
        label: t("contextMenu.viewSource"),
        action: () => emitContextObjectAction(action),
        disabled,
        icon: Code2,
      };
    case "view-ddl":
      return {
        label: t("contextMenu.viewDdl"),
        action: () => emitContextObjectAction(action),
        disabled,
        icon: FileCode,
      };
  }
}

function executableStatementRangeStartingAt(currentView: EditorViewType, lineFrom: number) {
  executableStatementRangeCache = executableStatementRangeCacheForDoc(executableStatementRangeCache, monacoSqlContextState(currentView).doc, props.databaseType, sqlStatementParameterOptions());
  return executableStatementRangeStartingAtLine(executableStatementRangeCache, lineFrom);
}

function executeSqlStatementFromGutter(currentView: EditorViewType, line: { from: number; to: number }, event: Event): boolean {
  if (!(event instanceof MouseEvent) || event.button !== 0) return false;
  const statementRange = executableStatementRangeStartingAt(currentView, line.from);
  if (!statementRange) return false;
  event.preventDefault();
  event.stopPropagation();
  // Gutter play is always scoped to the statement/command for that line, even
  // when the main editor execute action would run the full document.
  const editorViewportRequestId = executionViewportOwnership.beginRequest();
  emitExecutionRequest({ ...sqlExecutionSnapshotForRange(currentView, statementRange), editorViewportRequestId });
  // 不主动聚焦编辑器，否则 CodeMirror 会把屏幕滚回之前的光标位置。
  // currentView.focus();
  return true;
}

const contextMenuItems = computed<ContextMenuItem[]>(() => {
  const shortcuts = normalizeShortcutSettings(settingsStore.editorSettings.shortcuts);
  // The menu closes before running its action, so retain this right-click's
  // resolved target instead of reading state after the close handler runs.
  const starExpansionTarget = selectStarExpansionTarget.value;
  return [
    ...(props.hideExecutionControls
      ? []
      : [
          {
            label: executeContextMenuLabel.value,
            action: executeFromContextMenu,
            disabled: !canExecuteContextSql.value,
            icon: Play,
            shortcut: shortcuts.executeSql,
          },
          {
            label: t("settings.shortcutExecuteSqlInNewResultTab"),
            action: executeInNewResultTabFromContextMenu,
            disabled: !canExecuteContextSql.value,
            icon: Play,
            shortcut: shortcuts.executeSqlInNewResultTab,
          },
          {
            label: t("editor.previewChanges"),
            action: () => void requestPreviewChanges(previewContextSql.value),
            disabled: !previewContextSql.value,
            icon: Eye,
          },
          {
            label: t("editor.contextMenu.export"),
            icon: Download,
            disabled: !canExecuteContextSql.value,
            children: [
              { label: t("editor.contextMenu.exportQueryResultTo", { format: "CSV" }), action: () => exportQueryFromContextMenu("csv") },
              { label: t("editor.contextMenu.exportQueryResultTo", { format: "XLSX" }), action: () => exportQueryFromContextMenu("xlsx") },
              { label: t("editor.contextMenu.exportQueryResultTo", { format: "TXT" }), action: () => exportQueryFromContextMenu("txt") },
            ],
          },
        ]),
    ...queryContextObjectActions(contextObjectTarget.value?.type).map(contextObjectMenuItem),
    {
      label: t("editor.contextMenu.expandSelectStar"),
      action: () => void expandSelectStar(starExpansionTarget),
      disabled: !starExpansionTarget,
      icon: Table2,
      shortcut: shortcuts.expandSelectStar,
    },
    { label: "", separator: true },
    {
      label: t("editor.contextMenu.commentSelection"),
      action: toggleCommentFromContextMenu,
      disabled: props.readOnly || !canCopySelectedSql.value,
      icon: MessageSquareText,
      shortcut: shortcuts.toggleLineComment,
    },
    {
      label: t("editor.contextMenu.blockCommentSelection"),
      action: toggleBlockCommentFromContextMenu,
      disabled: props.readOnly || !canCopySelectedSql.value || !supportsQueryEditorBlockComments(props.databaseType),
      icon: MessageSquareText,
      shortcut: shortcuts.toggleBlockComment,
    },
    {
      label: t("editor.contextMenu.formatSelectionSql"),
      action: () => void formatCurrentSql(),
      disabled: props.readOnly || !canCopySelectedSql.value || !canFormatSqlForDatabaseType(props.databaseType),
      icon: AlignLeft,
      shortcut: shortcuts.formatSql,
    },
    {
      label: t("editor.contextMenu.compressSelectionSql"),
      action: compressCurrentSql,
      disabled: props.readOnly || !canCopySelectedSql.value,
      icon: Minimize2,
    },
    {
      label: t("editor.contextMenu.copySelection"),
      action: copySelectedSqlFromContextMenu,
      disabled: !canCopySelectedSql.value,
      icon: Copy,
      shortcut: "Mod+C",
    },
    {
      label: t("editor.contextMenu.copySelectionAsRichText"),
      action: copySelectedSqlAsRichTextFromContextMenu,
      disabled: !canCopySelectedSql.value,
      icon: Highlighter,
    },
    {
      label: t("editor.contextMenu.screenshotSelection"),
      action: () => {
        if (selectedSql.value.trim()) {
          codeSnapshotSource.value = { code: selectedSql.value, lang: "sql" };
          codeSnapshotOpen.value = true;
        }
      },
      disabled: !canCopySelectedSql.value,
      icon: Camera,
    },
    {
      label: t("editor.contextMenu.cutSelection"),
      action: cutSelectedSqlFromContextMenu,
      disabled: !canCopySelectedSql.value || props.readOnly,
      icon: Scissors,
      shortcut: "Mod+X",
    },
    {
      label: t("editor.contextMenu.pasteFromClipboard"),
      action: pasteClipboardSqlFromContextMenu,
      disabled: props.readOnly,
      icon: ClipboardPaste,
      shortcut: "Mod+V",
    },
    {
      label: t("editor.contextMenu.sendToAi"),
      action: () => {
        if (selectedSql.value.trim()) emit("sendSelectionToAi", selectedSql.value);
      },
      disabled: !canCopySelectedSql.value,
      icon: Sparkles,
      shortcut: shortcuts.sendSelectionToAi,
    },
    {
      label: t("editor.contextMenu.uppercaseSelection"),
      action: () => convertSelectedSqlCase("upper"),
      disabled: !canCopySelectedSql.value,
      icon: CaseUpper,
      shortcut: shortcuts.uppercaseSelection,
    },
    {
      label: t("editor.contextMenu.lowercaseSelection"),
      action: () => convertSelectedSqlCase("lower"),
      disabled: !canCopySelectedSql.value,
      icon: CaseLower,
      shortcut: shortcuts.lowercaseSelection,
    },
    {
      label: t("editor.contextMenu.convertNamingStyle"),
      action: convertSelectedNamingStyle,
      disabled: !canCopySelectedSql.value,
      icon: CaseSensitive,
      shortcut: shortcuts.convertNamingStyle,
    },
    {
      label: t("editor.contextMenu.delimitedList"),
      action: openDelimitedListDialog,
      disabled: props.readOnly || !canCopySelectedSql.value,
      icon: List,
    },
    {
      label: t("editor.contextMenu.addNextSelectionOccurrence"),
      action: addNextSelectionOccurrenceFromContextMenu,
      icon: TextSelect,
      shortcut: shortcuts.addNextSelectionOccurrence,
    },
    {
      label: t("editor.contextMenu.selectAllSelectionOccurrences"),
      action: selectAllSelectionOccurrencesFromContextMenu,
      icon: TextSelect,
      shortcut: shortcuts.selectAllSelectionOccurrences,
    },
    { label: "", separator: true },
    {
      label: t("editor.contextMenu.findReplace"),
      action: openFindReplaceFromContextMenu,
      icon: Search,
      shortcut: shortcuts.find,
    },
    {
      label: t("editor.contextMenu.deleteEmptyLines"),
      action: deleteEmptyLines,
      disabled: props.readOnly,
      icon: Trash2,
    },
    { label: "", separator: true },
    {
      label: t("editor.contextMenu.selectAll"),
      action: selectAllSqlFromContextMenu,
      icon: TextSelect,
      shortcut: shortcuts.selectAll,
    },
  ];
});

function currentContextMenuItems(): ContextMenuItem[] {
  return contextMenuItems.value;
}

function handleSqlIntentionActions(currentView: EditorViewType): boolean {
  if (props.readOnly) return false;
  try {
    const sql = monacoSqlContextState(currentView).doc.toString();
    const sel = monacoSqlContextState(currentView).selection.main;

    const actions = analyzeIntentionActions({
      sql,
      cursor: sel.head,
      databaseType: props.databaseType,
      dialect: sqlBehaviorDialect(),
      selection: sel.from !== sel.to ? { from: sel.from, to: sel.to } : undefined,
    });

    if (actions.length === 0) return false;

    // 计算光标视口坐标，用于定位弹出菜单
    const coords = monacoCoordsAtOffset(currentView, sel.head);
    if (!coords) return false;

    // 显示弹出菜单（参考 DataGrip Alt+Enter 意图操作弹出菜单）
    intentionPopup.value = {
      visible: true,
      actions,
      position: { x: coords.right + 8, y: coords.bottom + 4 },
      selectedIndex: 0,
    };
    document.addEventListener("keydown", onIntentionPopupKey);
    return true;
  } catch (err) {
    console.error("[SQL Intention] error:", err);
    return false;
  }
}

function runSqlShortcutAction(action: ReturnType<typeof enabledSqlShortcutActions>[number], currentView: EditorViewType, event?: KeyboardEvent): boolean {
  if (shouldBlockExecutionShortcut(event, currentView)) return true;
  if (props.readOnly) return true;
  const { from, to, empty } = monacoSqlContextState(currentView).selection.main;
  if (empty) return false;
  const selected = monacoSqlContextState(currentView).sliceDoc(from, to).trim();
  if (!selected) return false;
  const sql = resolveSqlShortcutTemplate(action.sql, selected);
  emitExecutionRequest(sql);
  return true;
}

function addNextSelectionOccurrenceFromContextMenu() {
  runMonacoAction(view.value, "editor.action.addSelectionToNextFindMatch");
  focusEditor();
}

function selectAllSelectionOccurrencesFromContextMenu() {
  runMonacoAction(view.value, "editor.action.selectHighlights");
  focusEditor();
}

function selectedSqlFromView(currentView: EditorViewType): string {
  const selection = monacoSqlContextState(currentView).selection.main;
  return monacoSqlContextState(currentView).sliceDoc(selection.from, selection.to);
}

function sqlExecutionSnapshotFromView(currentView: EditorViewType): SqlExecutionSnapshot {
  const selection = monacoSqlContextState(currentView).selection.main;
  return {
    fullSql: monacoSqlContextState(currentView).doc.toString(),
    selectedSql: selectedSqlFromView(currentView),
    cursorPos: selection.head,
    selectionFrom: selection.from,
    selectionTo: selection.to,
  };
}

function sqlExecutionSnapshotForRange(currentView: EditorViewType, range: Pick<SqlExecutionCandidate, "sql" | "from" | "to">): SqlExecutionSnapshot {
  return {
    fullSql: monacoSqlContextState(currentView).doc.toString(),
    selectedSql: range.sql,
    cursorPos: monacoSqlContextState(currentView).selection.main.head,
    selectionFrom: range.from,
    selectionTo: range.to,
  };
}

/**
 * Locate the qualified identifier at `pos`, delegating to the same quote-aware
 * parser used by Ctrl+click navigation. A plain word-character scan (the
 * previous approach here) breaks on quoted identifiers containing characters
 * outside `[\w$]` (hyphens, spaces, ...), e.g. `schema."my-table"`.
 *
 * Every part is re-quoted in the returned text (regardless of whether it was
 * originally quoted) so downstream re-parsing via `splitQualifiedIdentifier`
 * round-trips correctly even when a part's raw value isn't a bare word.
 */
function identifierRangeAt(sql: string, pos: number): { from: number; to: number; text: string } | null {
  const located = extractQualifiedIdentifierAt(sql, pos);
  if (!located) return null;
  if (located.parts.length === 1 && !located.parts[0].quoted && isSqlKeyword(located.parts[0].value)) return null;
  const text = located.parts.map((part) => quoteIdentifier(part.value)).join(".");
  if (!text) return null;
  return { from: located.start, to: located.end, text };
}

type CompletionMetadataScope = Pick<SqlCompletionScope, "database" | "schema">;

function completionCacheKey(table: { name: string; catalog?: string | null; database?: string | null; schema?: string | null; nameQuoted?: boolean; schemaQuoted?: boolean }, scope?: CompletionMetadataScope) {
  const schema = table.schema ?? scope?.schema ?? props.schema;
  const scopedDatabase = scope && scope.database !== props.database ? scope.database : undefined;
  const database = supportsDatabaseSchemaQualifierCompletion() ? (table.database ?? scopedDatabase) : undefined;
  const baseKey = schema ? `${database ? `${database}.` : ""}${schema}.${table.name}` : table.name;
  if (props.databaseType !== "postgres" || (!table.nameQuoted && !table.schemaQuoted)) return baseKey;
  return `${baseKey}:quoted:s=${table.schemaQuoted ? "1" : "0"}:t=${table.nameQuoted ? "1" : "0"}`;
}

function completionPrefixCacheKey(table: { name: string; catalog?: string | null; database?: string | null; schema?: string | null; nameQuoted?: boolean; schemaQuoted?: boolean }, scope: CompletionMetadataScope | undefined, prefix: string) {
  return `${completionCacheKey(table, scope)}:prefix:${prefix.trim().toLowerCase()}`;
}

function lookupCachedPrefixColumns(table: { name: string; catalog?: string | null; database?: string | null; schema?: string | null; nameQuoted?: boolean; schemaQuoted?: boolean }, scope: CompletionMetadataScope | undefined, prefix: string): SqlCompletionColumn[] | undefined {
  const normalizedPrefix = prefix.trim().toLowerCase();
  const exactKey = completionPrefixCacheKey(table, scope, normalizedPrefix);
  const exact = cachedPrefixColumnsByTable.get(exactKey);
  if (exact) return exact;

  const marker = `${completionCacheKey(table, scope)}:prefix:`;
  let best: { prefix: string; columns: SqlCompletionColumn[] } | undefined;
  for (const [key, columns] of cachedPrefixColumnsByTable) {
    if (!key.startsWith(marker)) continue;
    const cachedPrefix = key.slice(marker.length);
    if (!normalizedPrefix.startsWith(cachedPrefix) || (best && cachedPrefix.length <= best.prefix.length)) continue;
    best = { prefix: cachedPrefix, columns };
  }
  if (!best) return undefined;
  return best.columns.filter((column) => column.name.toLowerCase().startsWith(normalizedPrefix));
}

const pendingInsertValueHintColumnLoads = new Set<string>();

function insertHintCacheKey(table: { name: string; schema?: string | null; database?: string | null }) {
  if (table.database) {
    return table.schema ? `${table.database}.${table.schema}.${table.name}` : `${table.database}.${table.name}`;
  }
  return completionCacheKey(table);
}

function insertHintMetadataTarget(table: { name: string; schema?: string | null; database?: string | null }): { database: string; schema?: string; catalog?: string } | null {
  if (props.database == null) return null;
  if (table.database) {
    return { database: table.database, schema: table.schema ?? undefined, catalog: props.catalog };
  }
  return completionMetadataTarget(table);
}

function getInsertValueHintTableColumns(table: string, schema?: string, database?: string): string[] | undefined {
  const cacheKey = insertHintCacheKey({ name: table, schema, database });
  if (props.databaseType === "sqlserver") return cachedInsertValueHintColumnsByTable.get(cacheKey);
  const cached = cachedColumnsByTable.get(cacheKey);
  if (!cached) return undefined;
  return cached.map((column) => column.name);
}

function requestInsertValueHintTableColumns(table: string, schema?: string, database?: string) {
  if (!props.connectionId || props.database == null) return;
  if (!supportsInsertValueHints(props.databaseType)) return;
  const cacheKey = insertHintCacheKey({ name: table, schema, database });
  const hasCachedColumns = props.databaseType === "sqlserver" ? cachedInsertValueHintColumnsByTable.has(cacheKey) : cachedColumnsByTable.has(cacheKey);
  if (hasCachedColumns || pendingInsertValueHintColumnLoads.has(cacheKey)) return;
  const target = insertHintMetadataTarget({ name: table, schema, database });
  if (!target) return;
  pendingInsertValueHintColumnLoads.add(cacheKey);
  const connectionId = props.connectionId;
  const databaseType = props.databaseType;
  const loadColumns = async () => {
    if (databaseType === "sqlserver") {
      const querySchema = metadataSchemaForConnection(connectionStore.getConfig(connectionId), target.database, target.schema);
      const columns = await api.getSqlServerColumnMetadata(connectionId, target.database, querySchema, table);
      cachedInsertValueHintColumnsByTable.set(cacheKey, insertValueHintColumnNames(databaseType, columns));
      return;
    }
    const columns = await listCompletionColumnsForEditor(connectionId, target.database, table, target.schema, target.catalog);
    cachedColumnsByTable.set(cacheKey, columns);
  };
  void loadColumns()
    .then(() => {
      loadedColumnsByTable.add(cacheKey.toLowerCase());
      if (view.value) refreshNativeInlayHints();
    })
    .catch(() => {})
    .finally(() => {
      pendingInsertValueHintColumnLoads.delete(cacheKey);
    });
}

function supportsDatabaseQualifierCompletion(): boolean {
  return !!props.databaseType && !isSchemaAware(props.databaseType) && !isSingleDatabase(props.databaseType);
}

function supportsDatabaseSchemaQualifierCompletion(): boolean {
  return supportsDatabaseSchemaQualifier(props.databaseType);
}

function usesLocalOnlyCompletionMetadata(): boolean {
  return usesLocalOnlyEditorCompletionMetadata(props.databaseType);
}

function usesOnDemandOnlyCompletionColumns(): boolean {
  return usesOnDemandOnlyEditorColumnMetadata(props.databaseType);
}

function allowsOnDemandQualifiedTableCompletion(prefix: string): boolean {
  if (!usesLocalOnlyCompletionMetadata()) return false;
  if (props.databaseType !== "prestosql" && props.databaseType !== "trino") return false;
  return prefix.trim().length >= PRESTO_ON_DEMAND_TABLE_COMPLETION_MIN_PREFIX;
}

function completionMetadataTarget(table: { name: string; catalog?: string | null; database?: string | null; schema?: string | null }, scope?: CompletionMetadataScope): { database: string; schema?: string; catalog?: string } | null {
  const currentDatabase = scope?.database ?? props.database;
  if (currentDatabase == null) return null;
  // SQL Server metadata queries require a schema even when the SQL uses an
  // unqualified table name. The query editor commonly has no schema selected
  // when the user is working from a database-level tab, so use the same
  // default as the table/DDL metadata paths instead of returning no columns.
  const selectedSchema = table.schema ?? scope?.schema ?? props.schema;
  const effectiveSchema = selectedSchema ?? (props.databaseType === "sqlserver" ? metadataSchemaForConnection(connectionStore.getConfig(props.connectionId ?? ""), currentDatabase, undefined) : undefined);
  if (supportsDatabaseSchemaQualifierCompletion() && table.database) {
    return { database: table.database, schema: effectiveSchema, catalog: table.catalog ?? props.catalog };
  }
  if (supportsDatabaseQualifierCompletion() && effectiveSchema) {
    return { database: effectiveSchema, catalog: table.catalog ?? props.catalog };
  }
  return { database: currentDatabase, schema: effectiveSchema, catalog: table.catalog ?? props.catalog };
}

function isVirtualCompletionTableReference(table: { name: string; database?: string | null; schema?: string | null }): boolean {
  return isSqlVirtualTableReference(table, props.databaseType);
}

function completionQualifiedTableTarget(completionContext: ReturnType<typeof getSqlCompletionContext>): { name: string; database?: string; schema: string } | null {
  if (!completionContext.suggestColumns) return null;
  const parts = completionContext.qualifierParts ?? completionContext.qualifier?.split(".").filter(Boolean) ?? [];
  if (parts.length < 2) return null;
  const name = parts[parts.length - 1];
  const schema = parts[parts.length - 2];
  if (!name || !schema) return null;
  const database = supportsDatabaseSchemaQualifierCompletion() && parts.length >= 3 ? parts[parts.length - 3] : undefined;
  return { name, database, schema };
}

function completionTablesMatch(left: { name: string; catalog?: string | null; database?: string | null; schema?: string | null }, right: { name: string; catalog?: string | null; database?: string | null; schema?: string | null }) {
  if (left.name.toLowerCase() !== right.name.toLowerCase()) return false;
  if (left.catalog && right.catalog && left.catalog.toLowerCase() !== right.catalog.toLowerCase()) return false;
  if (left.database && right.database && left.database.toLowerCase() !== right.database.toLowerCase()) return false;
  if (!left.schema || !right.schema) return true;
  return left.schema.toLowerCase() === right.schema.toLowerCase();
}

async function findExactSemanticDiagnosticTable(table: SqlTableReference, scope?: CompletionMetadataScope): Promise<SqlCompletionTable | null> {
  if (!props.connectionId || props.database == null) return null;
  const target = completionMetadataTarget(table, scope);
  if (!target) return null;
  const localMatches = connectionStore.lookupLocalCompletionTables(props.connectionId, target.database, table.name, MAX_COMPLETION_TABLES, target.schema, target.catalog);
  const localExact = localMatches.find((item) => completionTablesMatch(item, table));
  if (localExact) {
    cachedTables = mergeCompletionTables(cachedTables, [localExact]);
    return localExact;
  }

  const remoteMatches = await connectionStore.listCompletionTables(props.connectionId, target.database, table.name, MAX_COMPLETION_TABLES, target.schema, false, scope?.schema ?? props.schema, target.catalog, {
    verifySchemaMetadata: !!target.schema,
  });
  cachedTables = mergeCompletionTables(cachedTables, remoteMatches);
  return remoteMatches.find((item) => completionTablesMatch(item, table)) ?? null;
}

async function ensureColumnsForTable(table: { name: string; database?: string | null; schema?: string | null }, reference?: Pick<SqlCompletionReferencedTable, "nameQuoted" | "schemaQuoted">, scope?: CompletionMetadataScope): Promise<boolean> {
  if (isVirtualCompletionTableReference(table)) return false;
  const cacheKey = completionCacheKey(table, scope);
  if (cachedColumnsByTable.has(cacheKey)) return true;
  if (!props.connectionId || props.database == null) return false;
  const target = completionMetadataTarget(table, scope);
  if (!target) return false;
  const localColumns = connectionStore.lookupLocalCompletionColumns(props.connectionId, target.database, table.name, target.schema, target.catalog, completionColumnRequestContext(reference));
  if (localColumns.length > 0) {
    cachedColumnsByTable.set(cacheKey, localColumns);
    loadedColumnsByTable.add(cacheKey.toLowerCase());
    return true;
  }
  let columns = await listCompletionColumnsForEditor(props.connectionId, target.database, table.name, target.schema, target.catalog, reference);

  // A schema-aware connection can legitimately return an empty result when
  // the editor has no selected schema. Resolve the physical table from the
  // local/remote table cache and retry with its schema before reporting that
  // star expansion is unavailable. This is especially important for aliased
  // sources because the alias itself must never be sent as the table name.
  if (columns.length === 0 && !table.schema && !target.schema && !supportsDatabaseQualifierCompletion()) {
    const schemaCandidates: string[] = [];
    const seenSchemas = new Set<string>();
    const addSchema = (schema?: string | null) => {
      const normalized = schema?.trim();
      if (!normalized) return;
      const key = normalized.toLowerCase();
      if (seenSchemas.has(key)) return;
      seenSchemas.add(key);
      schemaCandidates.push(normalized);
    };

    if (props.databaseType === "sqlserver") {
      addSchema(metadataSchemaForConnection(connectionStore.getConfig(props.connectionId), target.database, undefined));
    }

    const localTables = connectionStore.lookupLocalCompletionTables(props.connectionId, target.database, table.name, MAX_COMPLETION_TABLES, undefined, target.catalog);
    localTables.forEach((candidate) => {
      if (candidate.name.toLowerCase() === table.name.toLowerCase()) addSchema(candidate.schema);
    });
    if (schemaCandidates.length === 0 && !usesLocalOnlyCompletionMetadata()) {
      const remoteTables = await connectionStore.listCompletionTables(props.connectionId, target.database, table.name, MAX_COMPLETION_TABLES, undefined, false, undefined, target.catalog);
      remoteTables.forEach((candidate) => {
        if (candidate.name.toLowerCase() === table.name.toLowerCase()) addSchema(candidate.schema);
      });
    }

    for (const schema of schemaCandidates) {
      const schemaTarget = completionMetadataTarget({ ...table, schema }, scope);
      if (!schemaTarget) continue;
      const retryColumns = await listCompletionColumnsForEditor(props.connectionId, schemaTarget.database, table.name, schemaTarget.schema, schemaTarget.catalog, reference);
      if (retryColumns.length > 0) {
        columns = retryColumns;
        break;
      }
    }
  }
  // Do not memoize an empty response as a successful load. Empty results are
  // commonly caused by a temporarily unresolved schema; keeping that value
  // would prevent the next expansion attempt from retrying after metadata has
  // become available.
  if (columns.length > 0) {
    cachedColumnsByTable.set(cacheKey, columns);
    loadedColumnsByTable.add(cacheKey.toLowerCase());
  } else {
    cachedColumnsByTable.delete(cacheKey);
    loadedColumnsByTable.delete(cacheKey.toLowerCase());
  }
  return true;
}

function resultColumnsForSelectStar(target: SelectStarExpansionTarget, sql: string): SqlCompletionColumn[] {
  if (
    !target.allowResultColumnsFallback ||
    target.references.length !== 1 ||
    !selectStarResultColumnsMatch({
      currentSql: sql,
      targetFrom: target.from,
      targetTo: target.to,
      statementSql: target.statementSql,
      sourceStatement: props.resultSourceStatement,
      sourceFrom: props.resultSourceFrom,
      sourceTo: props.resultSourceTo,
    })
  )
    return [];
  return (props.resultColumns ?? [])
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => ({ name, table: target.references[0]!.name, schema: target.references[0]!.schema }));
}

async function expandSelectStar(target = selectStarExpansionTarget.value) {
  const currentView = view.value;
  if (!currentView || props.readOnly) return;
  if (!target) return;

  const originalDocument = monacoSqlContextState(currentView).doc.toString();
  try {
    await Promise.all(target.references.map((reference) => ensureColumnsForTable(reference, reference)));
  } catch (error) {
    console.warn("expandSelectStar: failed to load columns", error);
    toast(t("editor.contextMenu.expandSelectStarUnavailable"), 3000);
    return;
  }

  if (view.value !== currentView || monacoSqlContextState(currentView).doc.toString() !== originalDocument || monacoSqlContextState(currentView).sliceDoc(target.from, target.to) !== "*") return;
  const columnsByReference = new Map<string, SqlCompletionColumn[]>();
  for (const reference of target.references) {
    const columns = cachedColumnsByTable.get(completionCacheKey(reference));
    const expansionColumns = columns?.length ? columns : target.references.length === 1 ? resultColumnsForSelectStar(target, originalDocument) : [];
    if (expansionColumns.length === 0) {
      toast(t("editor.contextMenu.expandSelectStarUnavailable"), 3000);
      return;
    }
    columnsByReference.set(completionCacheKey(reference), expansionColumns);
  }
  const expansion = buildSelectStarExpansion(target.context, columnsByReference, props.dialect, target.qualifierSql, props.databaseType);
  if (!expansion) {
    toast(t("editor.contextMenu.expandSelectStarUnavailable"), 3000);
    return;
  }

  applyMonacoOffsetEdits(monaco!, currentView, {
    changes: { from: target.from, to: target.to, insert: expansion },
    selection: { anchor: target.from + expansion.length },
    scrollIntoView: true,
    userEvent: "input.expandSelectStar",
  });
  currentView.focus();
}

function isMissingTableMetadataError(error: unknown) {
  const message = String(error instanceof Error ? error.message : error).toLowerCase();
  return message.includes("42s02") || message.includes("1146") || message.includes("doesn't exist") || message.includes("does not exist") || message.includes("unknown table");
}

async function ensureForeignKeysForTable(table: { name: string; database?: string | null; schema?: string | null }) {
  if (isVirtualCompletionTableReference(table)) return;
  const cacheKey = completionCacheKey(table);
  if (cachedForeignKeysByTable.has(cacheKey) || !props.connectionId || props.database == null) return;
  const target = completionMetadataTarget(table);
  if (!target) return;
  try {
    const foreignKeys = await connectionStore.listCompletionForeignKeys(props.connectionId, target.database, table.name, target.schema);
    cachedForeignKeysByTable.set(cacheKey, foreignKeys);
  } catch (e) {
    console.warn(`[DBX] Failed to load foreign keys for ${cacheKey}:`, e);
    cachedForeignKeysByTable.set(cacheKey, []);
  }
}

async function ensureForeignKeysForTables(tables: Array<{ name: string; database?: string | null; schema?: string | null }>) {
  const seen = new Set<string>();
  const uniqueTables = tables.filter((table) => {
    const key = completionCacheKey(table).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  for (let index = 0; index < uniqueTables.length; index += COMPLETION_METADATA_CONCURRENCY) {
    await Promise.all(uniqueTables.slice(index, index + COMPLETION_METADATA_CONCURRENCY).map((table) => ensureForeignKeysForTable(table)));
  }
}

function createHoverDom(title: string, detail: string, sqlContent?: string, rows: string[] = []): import("monaco-editor").IMarkdownString[] {
  return [{ value: escapeMonacoMarkdown(title), isTrusted: false }, { value: escapeMonacoMarkdown(detail), isTrusted: false }, ...rows.map((row) => ({ value: escapeMonacoMarkdown(row), isTrusted: false })), ...(sqlContent ? [{ value: monacoSqlCodeBlock(sqlContent), isTrusted: false }] : [])];
}

async function resolveSqlHoverTooltip(currentView: EditorViewType, pos: number) {
  if (!props.connectionId || props.database == null || contextMenuOpen.value) return null;

  const sql = monacoSqlContextState(currentView).doc.toString();
  const range = identifierRangeAt(sql, pos);
  if (!range) return null;

  const identifier = range.text;
  const parts = splitQualifiedIdentifier(identifier);
  const name = parts[parts.length - 1] ?? identifier;
  const qualifier = parts.length > 1 ? parts[parts.length - 2] : undefined;
  let semanticModel: ReturnType<typeof buildSqlSemanticModel> | null = null;
  if (SEMANTIC_SQL_COMPLETION_ENABLED) {
    try {
      semanticModel = buildSqlSemanticModel(sql, pos, sqlCompletionDialectOptions());
    } catch (error) {
      semanticModel = null;
      console.warn(`[DBX] Failed to build semantic model for hover tooltip:`, error);
    }
  }
  const semanticTarget = semanticModel ? resolveSqlSemanticNavigationTarget(semanticModel, parts) : null;
  const semanticQualifierIsRowSource = !!qualifier && !!semanticTarget && (semanticTarget.alias?.toLowerCase() === qualifier.toLowerCase() || semanticTarget.source.name.toLowerCase() === qualifier.toLowerCase());
  const tableLookupName = semanticTarget && !semanticQualifierIsRowSource ? semanticTarget.name : name;
  const qualifiedTableLookup = semanticTarget?.schema ? `${semanticTarget.schema}.${semanticTarget.name}` : identifier;

  const hoverTarget = completionMetadataTarget({
    name: tableLookupName,
    catalog: props.catalog,
    database: semanticTarget?.database,
    schema: semanticTarget?.schema,
  });
  if (!hoverTarget) return null;
  const hoverScope: HoverTableScope = {
    catalog: hoverTarget.catalog,
    database: hoverTarget.database,
    schema: hoverTarget.schema,
  };

  try {
    let hoverTables = cachedTables.filter((table) => hoverTableMatchesScope(table, hoverScope));
    let table = matchTable(qualifiedTableLookup, hoverTables) ?? matchTable(tableLookupName, hoverTables) ?? matchTable(identifier, hoverTables) ?? matchTable(name, hoverTables);
    if (!table) {
      const localTables = connectionStore.lookupLocalCompletionTables(props.connectionId, hoverScope.database, tableLookupName, MAX_COMPLETION_TABLES, hoverScope.schema, hoverScope.catalog);
      const localHoverTables = scopeHoverTables(localTables, hoverScope);
      hoverTables = mergeCompletionTables(localHoverTables, hoverTables);
      cachedTables = mergeCompletionTables(localHoverTables, cachedTables);
      table = matchTable(qualifiedTableLookup, hoverTables) ?? matchTable(tableLookupName, hoverTables) ?? matchTable(identifier, hoverTables) ?? matchTable(name, hoverTables);
    }
    if (!table && !usesLocalOnlyCompletionMetadata()) {
      const loadedTables = await connectionStore.listCompletionTables(props.connectionId, hoverScope.database, tableLookupName, MAX_COMPLETION_TABLES, hoverScope.schema, false, hoverScope.schema, hoverScope.catalog);
      const remoteHoverTables = scopeHoverTables(loadedTables, hoverScope);
      hoverTables = mergeCompletionTables(hoverTables, remoteHoverTables);
      cachedTables = mergeCompletionTables(cachedTables, remoteHoverTables);
      table = matchTable(qualifiedTableLookup, hoverTables) ?? matchTable(tableLookupName, hoverTables) ?? matchTable(identifier, hoverTables) ?? matchTable(name, hoverTables);
    }
    if (table && settingsStore.editorSettings.showTableDdlHoverPreview && !semanticQualifierIsRowSource && (!qualifier || table.schema?.toLowerCase() === qualifier.toLowerCase() || table.name === name)) {
      const hoverDatabase = hoverScope.database;
      const hoverSchema = hoverScope.schema ?? table.schema ?? "";
      const hoverQualifiedName = [hoverScope.catalog, hoverDatabase, hoverSchema, table.name].filter(Boolean).join(".");
      const objectMetadataRequest = {
        connectionId: props.connectionId,
        database: hoverDatabase,
        schema: hoverSchema,
        tableName: table.name,
        catalog: hoverScope.catalog,
        objectType: sqlObjectNavigationSourceKind(table),
      };
      let sqlContent: string | undefined;
      const formatDialect = props.formatDialect ?? sqlFormatDialectForDbType(props.databaseType);
      let metadataLoadFailed = false;

      // The persisted display DDL is canonical across the full-page and hover
      // views. Hover only removes PostgreSQL's appended access-control tail.
      try {
        const { ddl } = await loadObjectDdl(objectMetadataRequest);
        const rawDdl = ddlForHoverPreview(ddl);
        if (rawDdl && rawDdl.trim()) {
          // A view's display DDL wraps the raw (often single-line) view source
          // in `CREATE ... VIEW ... AS`; the table-oriented reformatter cannot
          // lay out a SELECT body, so views reuse the shared display formatter
          // (the same one the sidebar/object-source viewers use). Tables keep
          // the aligned column layout from reformatHoverDdl.
          const isViewObject = objectMetadataRequest.objectType === "VIEW" || objectMetadataRequest.objectType === "MATERIALIZED_VIEW";
          const formatted = isViewObject ? await formatSqlForDisplay(rawDdl, formatDialect, settingsStore.editorSettings.sqlFormatter) : reformatHoverDdl(rawDdl, quoteQualifiedName(hoverQualifiedName));
          sqlContent = settingsStore.editorSettings.generateSqlQuoteIdentifiers ? formatted : omitDdlIdentifierQuotes(formatted, formatDialect);
        }
      } catch (error) {
        console.warn(`[DBX] Failed to load table DDL for ${hoverDatabase}.${hoverSchema}.${table.name}:`, error);
      }

      // Fallback path: rebuild the DDL from cached table metadata when the
      // backend DDL is unavailable (empty result or request failure).
      if (!sqlContent) {
        let fullColumns: ColumnInfo[] = [];
        let fullIndexes: IndexInfo[] = [];
        let tableComment: string | undefined;
        try {
          const [columnsResult, indexesResult] = await Promise.all([
            loadObjectMetadataFacet(objectMetadataRequest, "columns", () => api.getColumns(props.connectionId!, hoverDatabase, hoverSchema, table.name, hoverScope.catalog)),
            loadObjectMetadataFacet(objectMetadataRequest, "indexes", () => api.listIndexes(props.connectionId!, hoverDatabase, hoverSchema, table.name, hoverScope.catalog)).catch(() => ({ value: [] as IndexInfo[], cacheStatus: "remote" as const })),
          ]);
          fullColumns = columnsResult.value;
          fullIndexes = indexesResult.value;
        } catch (error) {
          metadataLoadFailed = true;
          console.warn(`[DBX] Failed to load table metadata for ${hoverDatabase}.${hoverSchema}.${table.name}:`, error);
        }
        if (!metadataLoadFailed) {
          try {
            const commentResult = await loadObjectMetadataFacet(objectMetadataRequest, "comment", () => api.getTableComment(props.connectionId!, hoverDatabase, hoverSchema, table.name, hoverScope.catalog));
            if (commentResult.value) tableComment = commentResult.value;
          } catch (error) {
            console.warn(`[DBX] Failed to load table comment for ${hoverDatabase}.${hoverSchema}.${table.name}:`, error);
          }
        }
        if (fullColumns.length > 0) {
          sqlContent = buildHoverTableSql(quoteQualifiedName(hoverQualifiedName), fullColumns, fullIndexes, tableComment);
          if (!settingsStore.editorSettings.generateSqlQuoteIdentifiers) sqlContent = omitDdlIdentifierQuotes(sqlContent, formatDialect);
          metadataLoadFailed = false;
        }
      }
      // Re-check after async metadata load — the context menu may have opened
      // while the DDL request was in flight, and we must not display a hover
      // tooltip on top of an open context menu.
      if (contextMenuOpen.value) return null;
      return {
        pos: range.from,
        end: range.to,
        create: () => createHoverDom(table.name, sqlObjectHoverDetail(table), sqlContent, metadataLoadFailed ? ["[DBX] Failed to load table structure — check connection"] : undefined),
      };
    }

    const legacyContext = getEditorSqlCompletionContext(sql, pos);
    const context = semanticModel ? sqlCompletionContextFromSemantic(semanticModel, legacyContext) : legacyContext;
    const candidates = qualifier ? context.referencedTables.filter((rt) => rt.alias?.toLowerCase() === qualifier.toLowerCase() || rt.name.toLowerCase() === qualifier.toLowerCase()) : context.referencedTables;

    for (const refTable of candidates) {
      const columns: SqlCompletionColumn[] =
        refTable.columns?.map((columnName) => ({
          name: columnName,
          table: refTable.name,
          ...(refTable.schema ? { schema: refTable.schema } : {}),
        })) ?? [];
      if (columns.length === 0) {
        await ensureColumnsForTable(refTable);
        columns.push(...(cachedColumnsByTable.get(completionCacheKey(refTable)) ?? []));
      }
      const column = columns.find((col) => col.name.toLowerCase() === name.toLowerCase());
      if (!column) continue;
      return {
        pos: range.from,
        end: range.to,
        create: () => createHoverDom(column.name, column.dataType || "column", undefined, [column.schema ? `${column.schema}.${column.table}` : column.table, ...(column.comment?.trim() ? [column.comment.trim()] : [])]),
      };
    }
  } catch {
    return null;
  }

  return null;
}

function sqlErrorDecorationRange(currentState: import("@codemirror/state").EditorState) {
  if (!props.executionError) return [];
  if (!props.executionErrorSql || !sqlErrorSqlMatchesEditor(currentState.doc.toString(), props.executionErrorSql)) return [];
  const range = resolveSqlErrorDecorationRange(currentState.doc.toString(), props.executionError);
  if (!range) return [];
  return [
    {
      ...range,
      message: props.executionError,
    },
  ];
}

function sqlTextSpanToRange(sql: string, span: SqlTextSpan): { from: number; to: number } | null {
  if (!span.start_line || !span.start_column) return null;
  const from = lineColumnToOffset(sql, {
    line: span.start_line - 1,
    column: span.start_column - 1,
  });
  const to = lineColumnToOffset(sql, {
    line: Math.max(span.end_line - 1, span.start_line - 1),
    column: Math.max(span.end_column, span.start_column),
  });
  if (from == null || to == null || to <= from) return null;
  return { from, to };
}

function sqlSemanticDecorationRanges(currentState: import("@codemirror/state").EditorState) {
  const sql = currentState.doc.toString();
  return semanticDiagnostics
    .map((diagnostic) => {
      const range = sqlTextSpanToRange(sql, diagnostic.span);
      return range
        ? {
            ...range,
            message: diagnostic.message,
            severity: diagnostic.severity,
          }
        : null;
    })
    .filter(
      (
        range,
      ): range is {
        from: number;
        to: number;
        message: string;
        severity: "error" | "warning";
      } => !!range,
    );
}

function reconfigureDiagnostics() {
  const currentView = view.value;
  const model = currentView?.getModel();
  if (!monaco || !currentView || !model) return;
  const state = monacoSqlContextState(currentView);
  const ranges = sqlSemanticDecorationRanges(state);
  const error = sqlErrorDecorationRange(state);
  for (const item of error) ranges.push({ ...item, message: props.executionError ?? "", severity: "error" });
  monaco.editor.setModelMarkers(
    model,
    "dbx-sql",
    ranges.map((item) => ({ ...monacoRangeFromOffsets(model, item.from, item.to), severity: item.severity === "error" ? monaco!.MarkerSeverity.Error : monaco!.MarkerSeverity.Warning, message: item.message })),
  );
}

function setSemanticDiagnostics(next: SqlSemanticDiagnostic[]) {
  if (areSqlSemanticDiagnosticsEqual(semanticDiagnostics, next)) return;
  semanticDiagnostics = next;
  reconfigureDiagnostics();
}

function clearScheduledSemanticDiagnostics() {
  semanticDiagnosticRunId++;
  if (semanticDiagnosticTimer) clearTimeout(semanticDiagnosticTimer);
  semanticDiagnosticTimer = null;
  pendingSemanticDiagnosticPreserveOutsideRanges = false;
}

function invalidateSemanticDiagnosticsForDocumentChange() {
  semanticDiagnosticRunId++;
  semanticDiagnostics = [];
}

function shouldSkipSqlSemanticDiagnostics() {
  return props.databaseType === "victoriametrics" || (props.databaseType !== "redis" && !settingsStore.editorSettings.sqlSemanticDiagnosticsEnabled);
}

function rangesOverlap(left: { from: number; to: number }, right: { from: number; to: number }): boolean {
  return left.from < right.to && right.from < left.to;
}

function sqlLineColumnAtOffset(sql: string, offset: number): { line: number; column: number } {
  const safeOffset = Math.max(0, Math.min(offset, sql.length));
  let line = 1;
  let lineStart = 0;
  for (let index = 0; index < safeOffset; index += 1) {
    if (sql[index] === "\n") {
      line += 1;
      lineStart = index + 1;
    }
  }
  return { line, column: safeOffset - lineStart + 1 };
}

function offsetSqlTextSpan(span: SqlTextSpan, rangeStart: { line: number; column: number }): SqlTextSpan {
  const offsetLine = (line: number) => rangeStart.line + line - 1;
  const offsetColumn = (line: number, column: number) => (line === 1 ? rangeStart.column + column - 1 : column);
  return {
    start_line: offsetLine(span.start_line),
    start_column: offsetColumn(span.start_line, span.start_column),
    end_line: offsetLine(span.end_line),
    end_column: offsetColumn(span.end_line, span.end_column),
  };
}

function offsetSqlSemanticDiagnostics(diagnostics: readonly SqlSemanticDiagnostic[], range: SqlTextRange, fullSql: string): SqlSemanticDiagnostic[] {
  const rangeStart = sqlLineColumnAtOffset(fullSql, range.from);
  return diagnostics.map((diagnostic) => ({
    ...diagnostic,
    span: offsetSqlTextSpan(diagnostic.span, rangeStart),
  }));
}

function replaceSemanticDiagnosticsInRanges(next: SqlSemanticDiagnostic[], ranges: readonly SqlTextRange[], fullSql: string) {
  const retained = semanticDiagnostics.filter((diagnostic) => {
    const diagnosticRange = sqlTextSpanToRange(fullSql, diagnostic.span);
    return !diagnosticRange || !ranges.some((range) => rangesOverlap(diagnosticRange, range));
  });
  setSemanticDiagnostics([...retained, ...next].sort(compareSqlSemanticDiagnostics));
}

function compareSqlSemanticDiagnostics(left: SqlSemanticDiagnostic, right: SqlSemanticDiagnostic): number {
  return left.span.start_line - right.span.start_line || left.span.start_column - right.span.start_column || left.span.end_line - right.span.end_line || left.span.end_column - right.span.end_column || left.message.localeCompare(right.message);
}

function semanticDiagnosticMetadataScope(sql: string, range: SqlTextRange): CompletionMetadataScope {
  const selectedDatabase = props.database!;
  const parsedDatabase = props.databaseType === "sqlserver" ? sqlServerUseDatabaseBeforeCursor(sql, range.from) : undefined;
  if (!parsedDatabase || !props.connectionId) return { database: selectedDatabase, schema: props.schema };
  const database = connectionStore.lookupLocalCompletionDatabases(props.connectionId, parsedDatabase, MAX_COMPLETION_TABLES).find((candidate) => candidate.toLowerCase() === parsedDatabase.toLowerCase()) ?? parsedDatabase;
  return {
    database,
    schema: metadataSchemaForConnection(connectionStore.getConfig(props.connectionId), database, undefined),
  };
}

function semanticDiagnosticTablesForScope(tables: SqlTableReference[], scope: CompletionMetadataScope): SqlTableReference[] {
  if (props.databaseType !== "sqlserver" || scope.database === props.database) return tables;
  return tables.map((table) => (table.database ? table : { ...table, database: scope.database, schema: table.schema ?? scope.schema }));
}

async function enrichSemanticDiagnosticTables(tables: SqlTableReference[], scope?: CompletionMetadataScope): Promise<{ tables: SqlTableReference[]; missingTables: Set<string> }> {
  if (!props.connectionId || props.database == null) return { tables, missingTables: new Set() };

  const enriched: SqlTableReference[] = [];
  const missingTables = new Set<string>();
  for (const table of tables) {
    if (isStatementLocalSemanticTable(table) || isSqlVirtualTableReference(table, props.databaseType)) {
      enriched.push(table);
      continue;
    }
    if (usesOracleSessionCompletionColumns(table.schema)) {
      enriched.push(table);
      continue;
    }
    try {
      const match = await findExactSemanticDiagnosticTable(table, scope);
      if (!match) missingTables.add(tableReferenceKey(table));
      enriched.push(match?.schema ? { ...table, schema: match.schema } : table);
    } catch {
      enriched.push(table);
    }
  }
  return { tables: enriched, missingTables };
}

async function ensureColumnsForSemanticDiagnostics(tables: SqlTableReference[], scope?: CompletionMetadataScope): Promise<Set<string>> {
  const missingTables = new Set<string>();
  const seen = new Set<string>();
  const targets: SqlTableReference[] = [];
  for (const table of tables) {
    if (isStatementLocalSemanticTable(table) || isSqlVirtualTableReference(table, props.databaseType)) continue;
    const tableWithInlineColumns = table as SqlTableReference & {
      columns?: string[];
    };
    if (tableWithInlineColumns.columns && tableWithInlineColumns.columns.length > 0) continue;
    const cacheKey = completionCacheKey(table, scope);
    if (cachedColumnsByTable.has(cacheKey)) continue;
    const normalizedKey = cacheKey.toLowerCase();
    if (seen.has(normalizedKey)) continue;
    seen.add(normalizedKey);
    targets.push(table);
    if (targets.length >= MAX_SEMANTIC_DIAGNOSTIC_COLUMN_TABLES) break;
  }
  await Promise.all(
    targets.map(async (table) => {
      try {
        await ensureColumnsForTable(table, undefined, scope);
      } catch (error) {
        if (isMissingTableMetadataError(error)) {
          missingTables.add(tableReferenceKey(table));
        }
      }
    }),
  );
  return missingTables;
}

function isStatementLocalSemanticTable(table: SqlTableReference): boolean {
  const kind = (table as SqlTableReference & { semanticSourceKind?: string }).semanticSourceKind;
  return kind === "cte" || kind === "subquery" || kind === "table_function";
}

async function refreshSemanticDiagnostics(options: { preserveOutsideRanges?: boolean } = {}) {
  const currentView = view.value;
  const runId = ++semanticDiagnosticRunId;
  if (!currentView || !props.connectionId || props.database == null) {
    setSemanticDiagnostics([]);
    return;
  }

  const sql = monacoSqlContextState(currentView).doc.toString();
  if (!sql.trim()) {
    setSemanticDiagnostics([]);
    return;
  }
  if (props.databaseType === "mongodb" || props.databaseType === "elasticsearch" || props.databaseType === "easysearch" || props.databaseType === "meilisearch" || props.databaseType === "victoriametrics") {
    setSemanticDiagnostics([]);
    return;
  }
  if (props.databaseType === "redis") {
    // Redis has no SQL semantics; run command-name / arity / quote / danger checks instead.
    if (!shouldRunRedisDiagnostics(sql, monacoSqlContextState(currentView).selection.main.head)) {
      scheduleSemanticDiagnostics(900, {
        preserveOutsideRanges: options.preserveOutsideRanges,
      });
      return;
    }
    setSemanticDiagnostics(buildRedisSyntaxDiagnostics(sql));
    return;
  }
  if (shouldSkipSqlSemanticDiagnostics()) {
    setSemanticDiagnostics([]);
    return;
  }
  if (!shouldRunSqlSemanticDiagnostics(sql, monacoSqlContextState(currentView).selection.main.head, { databaseType: props.databaseType })) {
    scheduleSemanticDiagnostics(1200, {
      preserveOutsideRanges: options.preserveOutsideRanges,
    });
    return;
  }
  if (activeCompletionOrigin && isSqlSemanticDiagnosticInputContext(sql, monacoSqlContextState(currentView).selection.main.head, { databaseType: props.databaseType })) {
    scheduleSemanticDiagnostics(900, {
      preserveOutsideRanges: options.preserveOutsideRanges,
    });
    return;
  }

  const visibleRanges = monacoVisibleOffsetRanges(currentView).length > 0 ? monacoVisibleOffsetRanges(currentView) : [{ from: 0, to: 0 }];
  if (props.databaseType !== "sqlserver") {
    executableStatementRangeCache = executableStatementRangeCacheForDoc(executableStatementRangeCache, monacoSqlContextState(currentView).doc, props.databaseType, sqlStatementParameterOptions());
  }
  const diagnosticRanges = sqlSemanticDiagnosticRangesForViewport(sql, visibleRanges, props.databaseType, props.databaseType === "sqlserver" ? undefined : executableStatementRangeCache?.ranges, sqlStatementParameterOptions());
  if (diagnosticRanges.length === 0) {
    if (!options.preserveOutsideRanges) setSemanticDiagnostics([]);
    return;
  }

  const nextDiagnostics: SqlSemanticDiagnostic[] = [];
  const oracleSyntaxDiagnostics = buildOracleSyntaxDiagnostics(sql, props.databaseType);
  nextDiagnostics.push(
    ...oracleSyntaxDiagnostics.filter((diagnostic) => {
      const diagnosticRange = sqlTextSpanToRange(sql, diagnostic.span);
      return !!diagnosticRange && diagnosticRanges.some((range) => rangesOverlap(diagnosticRange, range));
    }),
  );
  const mysqlRoutineAnalysis = props.databaseType === "mysql" && supportsMysqlRoutineSyntaxDiagnostics(sqlDriverProfile.value) ? analyzeMysqlRoutineSyntax(sql) : null;
  if (mysqlRoutineAnalysis) {
    nextDiagnostics.push(
      ...mysqlRoutineAnalysis.diagnostics.filter((diagnostic) => {
        const diagnosticRange = sqlTextSpanToRange(sql, diagnostic.span);
        return !!diagnosticRange && diagnosticRanges.some((range) => rangesOverlap(diagnosticRange, range));
      }),
    );
  }
  for (const range of diagnosticRanges) {
    if (mysqlRoutineAnalysis?.routineRanges.some((routineRange) => rangesOverlap(routineRange, range))) continue;
    try {
      const analysis = await api.analyzeSqlReferences(
        range.sql,
        sqlReferenceAnalysisDialectFor({
          databaseType: props.databaseType,
          identifierQuote: connectionStore.connectionIdentifierQuote(props.connectionId),
          fallbackDialect: props.formatDialect ?? props.dialect ?? "generic",
        }),
      );
      if (runId !== semanticDiagnosticRunId) return;

      const semanticCursor = Math.max(0, Math.min(monacoSqlContextState(currentView).selection.main.head - range.from, range.sql.length));
      const semanticModel = SEMANTIC_SQL_COMPLETION_ENABLED
        ? buildSqlSemanticModel(range.sql, semanticCursor, {
            databaseType: props.databaseType,
            dialect: sqlBehaviorDialect(),
          })
        : null;
      const semanticAnalysis = semanticModel ? mergeSqlSemanticReferenceAnalysis(analysis, semanticModel) : analysis;
      const metadataScope = semanticDiagnosticMetadataScope(sql, range);
      const scopedAnalysis = {
        ...semanticAnalysis,
        tables: semanticDiagnosticTablesForScope(semanticAnalysis.tables, metadataScope),
      };
      const { tables, missingTables } = await enrichSemanticDiagnosticTables(scopedAnalysis.tables, metadataScope);
      const columnMetadataMissingTables = await ensureColumnsForSemanticDiagnostics(tables, metadataScope);
      for (const tableKey of columnMetadataMissingTables) missingTables.add(tableKey);
      if (runId !== semanticDiagnosticRunId) return;

      const enrichedAnalysis: SqlReferenceAnalysis = {
        ...scopedAnalysis,
        tables,
      };
      nextDiagnostics.push(
        ...offsetSqlSemanticDiagnostics(
          buildSqlSemanticDiagnostics(enrichedAnalysis, {
            tables: cachedTables,
            columnsByTable: cachedColumnsByTable,
            missingTables,
            loadedColumnTables: loadedColumnsByTable,
            sql: range.sql,
            databaseType: props.databaseType,
          }),
          range,
          sql,
        ),
      );
    } catch (error) {
      if (runId !== semanticDiagnosticRunId) return;
      const diagnostic = buildSqlParserErrorDiagnostic(error, range.sql);
      if (diagnostic) nextDiagnostics.push(...offsetSqlSemanticDiagnostics([diagnostic], range, sql));
    }
  }
  if (options.preserveOutsideRanges) {
    replaceSemanticDiagnosticsInRanges(nextDiagnostics, diagnosticRanges, sql);
  } else {
    setSemanticDiagnostics(nextDiagnostics.sort(compareSqlSemanticDiagnostics));
  }
}

function scheduleSemanticDiagnostics(delay = 500, options: { preserveOutsideRanges?: boolean } = {}) {
  if (!editorIsActive) return;
  if (shouldSkipSqlSemanticDiagnostics()) {
    clearScheduledSemanticDiagnostics();
    setSemanticDiagnostics([]);
    return;
  }
  pendingSemanticDiagnosticPreserveOutsideRanges = !!options.preserveOutsideRanges;
  if (semanticDiagnosticTimer) clearTimeout(semanticDiagnosticTimer);
  semanticDiagnosticTimer = setTimeout(() => {
    const preserveOutsideRanges = pendingSemanticDiagnosticPreserveOutsideRanges;
    pendingSemanticDiagnosticPreserveOutsideRanges = false;
    semanticDiagnosticTimer = null;
    void refreshSemanticDiagnostics({ preserveOutsideRanges });
  }, delay);
}

async function formatCurrentSql() {
  if (props.readOnly) return;
  if (!canFormatSqlForDatabaseType(props.databaseType)) return;
  const currentView = view.value;
  if (!currentView) return;

  const originalState = monacoSqlContextState(currentView);
  const originalModel = currentView.getModel();
  const originalVersion = originalModel?.getVersionId();
  const selection = originalState.selection.main;
  const formatsSelection = !selection.empty;
  const from = formatsSelection ? selection.from : 0;
  const to = formatsSelection ? selection.to : originalState.doc.length;
  const source = originalState.sliceDoc(from, to);
  if (!source.trim()) return;

  try {
    let formatted: string;
    if (props.databaseType === "mongodb") {
      formatted = formatMongoShellText(source, settingsStore.editorSettings.sqlFormatter);
    } else {
      const esRequest = detectAndFormatElasticsearchRequests(source, props.databaseType, settingsStore.editorSettings.sqlFormatter.tabWidth);
      if (esRequest.kind === "elasticsearch") {
        formatted = esRequest.formatted;
      } else if (esRequest.kind === "unsupported") {
        toast(t("toolbar.formatAutoDetectFailed"), 3000);
        return;
      } else {
        const structured = detectAndFormatStructured(source, {
          indentSize: settingsStore.editorSettings.sqlFormatter.tabWidth,
          useTabs: settingsStore.editorSettings.sqlFormatter.useTabs,
        });
        if (structured.kind === "json" || structured.kind === "xml") {
          formatted = structured.formatted;
        } else if (structured.kind === "unsupported") {
          // Keep invalid structured text untouched — the SQL formatter would
          // silently corrupt XML-looking content.
          toast(t("toolbar.formatAutoDetectFailed"), 3000);
          return;
        } else {
          formatted = await formatSqlForEditing(source, props.formatDialect ?? props.dialect ?? "generic", settingsStore.editorSettings.sqlFormatter);
        }
      }
    }
    if (view.value !== currentView || props.readOnly || currentView.getModel() !== originalModel || originalModel?.getVersionId() !== originalVersion || !monacoSqlContextState(currentView).selection.eq(originalState.selection) || monacoSqlContextState(currentView).sliceDoc(from, to) !== source) {
      return;
    }
    if (formatted === source) return;
    applyMonacoOffsetEdits(monaco!, currentView, {
      changes: { from, to, insert: formatted },
      selection: formatsSelection ? { anchor: from, head: from + formatted.length } : { anchor: from + formatted.length },
    });
  } catch (e: any) {
    emit("formatError", String(e?.message || e));
  }
}

function compressCurrentSql() {
  if (props.readOnly) return;
  const currentView = view.value;
  if (!currentView) return;

  const originalState = monacoSqlContextState(currentView);
  const selection = originalState.selection.main;
  const compressesSelection = !selection.empty;
  const from = compressesSelection ? selection.from : 0;
  const to = compressesSelection ? selection.to : originalState.doc.length;
  const source = originalState.sliceDoc(from, to);
  if (!source.trim()) return;

  const compressed = compressSqlText(source, props.formatDialect ?? props.dialect ?? "generic");
  if (currentView !== view.value || monacoSqlContextState(currentView) !== originalState || monacoSqlContextState(currentView).sliceDoc(from, to) !== source) {
    return;
  }
  if (compressed === source) return;
  applyMonacoOffsetEdits(monaco!, currentView, {
    changes: { from, to, insert: compressed },
    selection: compressesSelection ? { anchor: from, head: from + compressed.length } : { anchor: from + compressed.length },
  });
}

function droppedTableReference(event: DragEvent) {
  return activeTableReferencePayloadValue() ?? parseTableReferencePayload(event.dataTransfer?.getData(DBX_TABLE_REFERENCE_MIME));
}

function hasDroppedTableReference(event: DragEvent) {
  return !!activeTableReferencePayloadValue() || hasTableReferencePayloadType(event.dataTransfer?.types);
}

function insertTableReferencePayload(currentView: EditorViewType, payload: QueryEditorTableReferencePayload, coords?: { clientX: number; clientY: number }): boolean {
  if (props.readOnly) return false;
  const insertText = tableReferenceInsertText(payload, props.databaseType, {
    tableNameSeparator: settingsStore.editorSettings.sidebarCopyTableNameSeparator,
    columnNameSeparator: settingsStore.editorSettings.sidebarCopyTableNameSeparator,
    includeTableSchema: settingsStore.editorSettings.sidebarCopyTableNameIncludeSchema,
  });
  const dropPos = coords ? monacoPositionAtCoords(currentView, { x: coords.clientX, y: coords.clientY }) : null;
  const selection = monacoSqlContextState(currentView).selection.main;
  const from = dropPos ?? selection.from;
  const to = dropPos == null && !selection.empty ? selection.to : from;
  applyMonacoOffsetEdits(monaco!, currentView, {
    changes: { from, to, insert: insertText },
    selection: { anchor: from + insertText.length },
    scrollIntoView: true,
    userEvent: "input.drop",
  });
  clearActiveTableReferencePayload(payload);
  hideQueryEditorDropCaret();
  currentView.focus();
  return true;
}

function insertDroppedTableReference(currentView: EditorViewType, event: DragEvent): boolean {
  const payload = droppedTableReference(event);
  if (!payload) return false;

  event.preventDefault();
  event.stopPropagation();
  return insertTableReferencePayload(currentView, payload, {
    clientX: event.clientX,
    clientY: event.clientY,
  });
}

function onTableReferenceDropEvent(event: Event) {
  const currentView = view.value;
  if (!currentView || props.readOnly || !(event instanceof CustomEvent)) return;
  const detail = event.detail as QueryEditorTableReferenceDropDetail | undefined;
  if (!detail?.payload) return;
  // elementFromPoint 被透明覆盖层拦截时回退为编辑器根节点包围盒判定（见 isPointOverElementRoot）。
  if (isPointOverElementRoot(detail.clientX, detail.clientY, editorRef.value)) {
    insertTableReferencePayload(currentView, detail.payload, detail);
  }
}

// --- 表引用拖拽悬停时的插入光标线（指针模拟拖拽经 window 事件驱动） ---
const queryEditorDropCaret = ref<{ left: number; top: number; height: number } | null>(null);
const queryEditorDropCaretStyle = computed(() => {
  const caret = queryEditorDropCaret.value;
  return caret ? { left: `${caret.left}px`, top: `${caret.top}px`, height: `${caret.height}px` } : {};
});

function showQueryEditorDropCaretAt(clientX: number, clientY: number) {
  const currentView = view.value;
  if (!currentView || props.readOnly || !editorRef.value) {
    hideQueryEditorDropCaret();
    return;
  }
  let dropPos: number | null = null;
  try {
    dropPos = monacoPositionAtCoords(currentView, { x: clientX, y: clientY });
  } catch {
    dropPos = null;
  }
  if (dropPos == null) {
    hideQueryEditorDropCaret();
    return;
  }
  const coords = monacoCoordsAtOffset(currentView, dropPos);
  if (!coords) {
    hideQueryEditorDropCaret();
    return;
  }
  const rect = editorRef.value.getBoundingClientRect();
  queryEditorDropCaret.value = { left: coords.left - rect.left, top: coords.top - rect.top, height: Math.max(coords.bottom - coords.top, 0) };
}

function hideQueryEditorDropCaret() {
  queryEditorDropCaret.value = null;
}

function onTableReferenceHoverEvent(event: Event) {
  if (!(event instanceof CustomEvent)) return;
  const detail = event.detail as QueryEditorTableReferenceHoverDetail | undefined;
  if (!detail) return;
  // elementFromPoint 被透明覆盖层拦截时回退为编辑器根节点包围盒判定（见 isPointOverElementRoot）。
  if (!isPointOverElementRoot(detail.clientX, detail.clientY, editorRef.value)) {
    hideQueryEditorDropCaret();
    return;
  }
  showQueryEditorDropCaretAt(detail.clientX, detail.clientY);
}

function onTableReferenceDragEndEvent() {
  hideQueryEditorDropCaret();
}

function registerTableReferenceDropListener() {
  if (tableReferenceDropListenerRegistered) return;
  window.addEventListener(DBX_TABLE_REFERENCE_DROP_EVENT, onTableReferenceDropEvent);
  window.addEventListener(DBX_TABLE_REFERENCE_HOVER_EVENT, onTableReferenceHoverEvent);
  window.addEventListener(DBX_TABLE_REFERENCE_DRAG_END_EVENT, onTableReferenceDragEndEvent);
  tableReferenceDropListenerRegistered = true;
}

function unregisterTableReferenceDropListener() {
  if (!tableReferenceDropListenerRegistered) return;
  window.removeEventListener(DBX_TABLE_REFERENCE_DROP_EVENT, onTableReferenceDropEvent);
  window.removeEventListener(DBX_TABLE_REFERENCE_HOVER_EVENT, onTableReferenceHoverEvent);
  window.removeEventListener(DBX_TABLE_REFERENCE_DRAG_END_EVENT, onTableReferenceDragEndEvent);
  tableReferenceDropListenerRegistered = false;
}

let completionEpoch = 0;
let tableCompletionRefreshActive = false;
let latestTableCompletionRefresh: (() => Promise<void>) | null = null;

function queueTableCompletionRefresh(task: () => Promise<void>): void {
  latestTableCompletionRefresh = task;
  if (tableCompletionRefreshActive) return;
  tableCompletionRefreshActive = true;
  void (async () => {
    while (latestTableCompletionRefresh) {
      const next = latestTableCompletionRefresh;
      latestTableCompletionRefresh = null;
      await next();
    }
  })().finally(() => {
    tableCompletionRefreshActive = false;
  });
}

let typedCompletionActivationUntil = 0;

let activeCompletionOrigin: SqlCompletionTriggerOrigin | null = null;

type QueryCompletionItem = SqlCompletionItem | ElasticsearchCompletionItem | RedisCompletionItem | MongoCompletionItem;

function isTypedCompletionActivation(explicit: boolean) {
  return explicit && typedCompletionActivationUntil >= Date.now();
}

function buildCompletionResult(items: QueryCompletionItem[], from: number, validFor?: RegExp, prefix?: string) {
  if (!items.length) return null;
  return { from, to: undefined as number | undefined, options: items.map(completionOptionForItem), validFor, prefix };
}

function buildSqlCompletionResult(items: SqlCompletionItem[], completionContext: SqlCompletionContext, fullDoc: string, position: number) {
  const replacement = prepareSqlCompletionReplacement(fullDoc, position, completionContext, items);
  return buildCompletionResult(replacement.items, replacement.from, getSqlCompletionResultValidFor(fullDoc, position), completionContext.prefix);
}

// CodeMirror's built-in matcher only matches single-character queries against
// the label start, and cannot match pinyin initials against Han labels. Our
// provider already filters and ranks items itself (substring + pinyin), so
// skip the second-stage filter exactly in the cases it would break.

function localCompletionDatabaseNames(completionContext: ReturnType<typeof getSqlCompletionContext>): string[] {
  if (!supportsDatabaseNameCompletion(props.databaseType) || !completionContext.suggestTables || completionContext.insertTable || !props.connectionId) return [];
  return connectionStore.lookupLocalCompletionDatabases(props.connectionId, completionContext.qualifier || completionContext.prefix, MAX_COMPLETION_TABLES);
}

function mayCompleteDatabaseSchemaQualifier(completionContext: ReturnType<typeof getSqlCompletionContext>): boolean {
  if (!supportsDatabaseNameCompletion(props.databaseType) || !supportsDatabaseSchemaQualifierCompletion() || !completionContext.suggestTables || completionContext.insertTable) return false;
  return (completionContext.qualifierParts?.filter(Boolean).length ?? completionContext.qualifier?.split(".").filter(Boolean).length ?? 0) === 1;
}

function localCompletionSchemasForDatabaseDisambiguation(completionContext: ReturnType<typeof getSqlCompletionContext>, databaseNames: string[], scope?: CompletionMetadataScope): string[] {
  const currentDatabase = scope?.database ?? props.database;
  const currentSchema = scope?.schema ?? props.schema;
  if (!props.connectionId || currentDatabase == null || !mayCompleteDatabaseSchemaQualifier(completionContext)) return [];
  const database = resolveSqlCompletionSchemaLookupDatabase({
    supportsDatabaseSchemaQualifier: true,
    completionContext,
    knownDatabases: databaseNames,
  });
  if (!database) return [];
  return mergeSqlCompletionQualifierNames(currentSchema ? [currentSchema] : [], connectionStore.lookupLocalCompletionSchemas(props.connectionId, currentDatabase, completionContext.qualifier, MAX_COMPLETION_TABLES));
}

function shouldInsertSqlCompletionSpace(): boolean {
  return props.databaseType !== "mongodb" && props.databaseType !== "redis" && props.databaseType !== "elasticsearch" && props.databaseType !== "easysearch" && props.databaseType !== "meilisearch" && props.databaseType !== "victoriametrics";
}

// Snippet expansion normally follows from the item type; a provider can also
// opt a differently-typed item in so its `${}` fields still expand on accept.
function shouldApplyCompletionAsSnippet(item: QueryCompletionItem): boolean {
  if ("applyAsSnippet" in item && item.applyAsSnippet === true) return true;
  return item.type === "snippet" || item.type === "function";
}

function completionOptionForItem(item: QueryCompletionItem): MonacoCompletionCandidate {
  return { ...item, applyAsSnippet: shouldApplyCompletionAsSnippet(item) };
}

async function provideElasticsearchCompletions(currentState: import("@codemirror/state").EditorState, position: number, explicit: boolean) {
  if (!props.connectionId) return null;
  const epoch = ++completionEpoch;
  const fullDoc = currentState.doc.toString();
  if (!explicit && !shouldAutoOpenElasticsearchCompletion(fullDoc, position)) return null;

  const completionContext = getElasticsearchCompletionContext(fullDoc, position);
  let indices: string[] = [];
  if (props.database != null && completionContext.mode === "path") {
    try {
      indices = await connectionStore.listElasticsearchCompletionIndices(props.connectionId, props.database);
    } catch {
      indices = [];
    }
  }
  if (epoch !== completionEpoch) return null;

  const items = buildElasticsearchCompletionItemsFromContext(completionContext, { indices });
  return buildCompletionResult(items, completionContext.from, getElasticsearchCompletionResultValidFor());
}

async function provideRedisCompletions(currentState: import("@codemirror/state").EditorState, position: number, explicit: boolean) {
  if (!props.connectionId) return null;
  const epoch = ++completionEpoch;
  const fullDoc = currentState.doc.toString();
  if (!explicit && !shouldAutoOpenRedisCompletion(fullDoc, position)) return null;

  let commands;
  try {
    commands = await connectionStore.listRedisCompletionCommandDocs(props.connectionId, props.database ?? "0");
  } catch {
    // Completion is deliberately instance-driven: do not substitute a bundled
    // command list when the server does not expose command metadata.
    return null;
  }
  if (epoch !== completionEpoch) return null;

  const completionInput = { commands };
  const completionContext = getRedisCompletionContext(fullDoc, position, completionInput);
  // Key-name completion needs a reliable db index; props.database may briefly be "" on
  // the New Query path before the active db resolves, and only key-argument commands warrant it.
  let keys: string[] = [];
  if (completionContext.mode === "argument" && props.database && takesKeyArgument(completionContext.commandName, completionInput, completionContext.argumentIndex, completionContext.argumentValues)) {
    try {
      keys = await connectionStore.listRedisCompletionKeys(props.connectionId, props.database);
    } catch {
      keys = [];
    }
  }
  if (epoch !== completionEpoch) return null;

  const items = buildRedisCompletionItemsFromContext(completionContext, {
    keys,
    commands,
  });
  if (items.length === 0) return null;
  // Use the built-in filter (the default) so typing narrows the list and moves
  // the selection synchronously. `filter: false` + `validFor` are mutually
  // exclusive (the latter is ignored), which would leave the menu frozen while
  // typing — hence we build the result here instead of via buildCompletionResult.
  return {
    from: completionContext.from,
    options: items.map((item) => completionOptionForItem(item)),
    validFor: getRedisCompletionResultValidFor(),
  };
}

async function provideMongoCompletions(currentState: import("@codemirror/state").EditorState, position: number, explicit: boolean) {
  if (!props.connectionId) return null;
  const epoch = ++completionEpoch;
  const fullDoc = currentState.doc.toString();
  if (!explicit && !shouldAutoOpenMongoCompletion(fullDoc, position)) return null;

  const completionContext = getMongoCompletionContext(fullDoc, position);
  let collections: string[] = [];
  let fields: Awaited<ReturnType<typeof connectionStore.listMongoCompletionFields>> = [];

  if (props.database && mongoCompletionNeedsCollections(completionContext.mode)) {
    try {
      collections = await connectionStore.listMongoCompletionCollections(props.connectionId, props.database);
    } catch {
      collections = [];
    }
  }

  if (props.database && mongoCompletionNeedsFields(completionContext.mode) && completionContext.collection) {
    try {
      fields = await connectionStore.listMongoCompletionFields(props.connectionId, props.database, completionContext.collection);
    } catch {
      fields = [];
    }
  }

  if (epoch !== completionEpoch) return null;

  const items = buildMongoCompletionItemsFromContext(completionContext, {
    collections,
    fields,
  });
  if (items.length === 0) return null;
  return {
    from: completionContext.from,
    options: items.map((item) => completionOptionForItem(item)),
    validFor: getMongoCompletionResultValidFor(completionContext),
  };
}

async function provideSqlCompletions(context: CompletionContext) {
  const currentState = context.state;
  const position = context.pos;
  const explicit = context.explicit;
  const typedActivation = isTypedCompletionActivation(explicit);
  if (imeCompositionActive || view.value?.inComposition) return null;
  if (!props.connectionId) return null;
  const fullDoc = currentState.doc.toString();
  if (props.databaseType === "mongodb") {
    return provideMongoCompletions(currentState, position, explicit);
  }
  if (props.databaseType === "meilisearch") return null;
  if (props.databaseType === "elasticsearch" || props.databaseType === "easysearch") {
    if (!isSqlLikeCompletionStatement(fullDoc, position, sqlCompletionDialectOptions())) {
      return provideElasticsearchCompletions(currentState, position, explicit);
    }
  }
  if (props.databaseType === "redis") {
    return provideRedisCompletions(currentState, position, explicit);
  }
  if (props.databaseType === "victoriametrics") return null;
  const hasDatabase = props.database != null;
  const sequenceLiteralContext = getPostgresSequenceLiteralCompletionContext(fullDoc, position, props.databaseType);
  const databaseLinkContext = oracleDatabaseLinkCompletionContext(fullDoc, position, props.databaseType);

  const epoch = ++completionEpoch;

  try {
    // 1. Suppressed context (comment / string literal) rejects everything, including explicit.
    if (isSqlCompletionSuppressedContext(fullDoc, position, { databaseType: props.databaseType, editorState: currentState }) && !sequenceLiteralContext) return null;

    // 2. Determine completion origin (session-level marker).
    activeCompletionOrigin = originForSqlCompletionProvider(activeCompletionOrigin, context.explicit);
    const origin = activeCompletionOrigin;

    // 3. Explicit (manual shortcut) -> always proceed. No mode gating.
    // 4. For typing sessions, apply mode gating with lazy fact computation.
    const useDatabaseCompletion = resolveSqlServerUseDatabaseCompletion({
      sql: fullDoc,
      cursor: position,
      databaseType: props.databaseType,
    });
    const useDatabasePrefix = useDatabaseCompletion?.prefix ?? null;

    if (origin !== "explicit") {
      const mode = settingsStore.editorSettings.completionTriggerMode;

      // manual: never auto-open. Return before computing any context.
      if (mode === "manual") return null;

      // require-prefix: only compute local facts (no positionalEligible).
      if (mode === "require-prefix") {
        const ctx = databaseLinkContext ?? sequenceLiteralContext ?? getEditorSqlCompletionContext(fullDoc, position);
        const prevChar = fullDoc[position - 1] ?? "";
        const facts: SqlCompletionTriggerFacts = {
          origin,
          hasIdentifierPrefix: ctx.prefix.length > 0,
          qualifierTriggered: !!databaseLinkContext || (prevChar === "." && ("schema" in ctx ? ctx.schema != null : "qualifier" in ctx && ctx.qualifier != null)),
          useDatabasePrefix,
        };
        if (!shouldAllowSqlCompletionTrigger(mode, facts)) return null;
      }

      // positional: compute positionalEligible (lazy).
      if (mode === "positional") {
        const ctx = databaseLinkContext ?? sequenceLiteralContext ?? getEditorSqlCompletionContext(fullDoc, position);
        const prevChar = fullDoc[position - 1] ?? "";
        const positionalEligible = shouldAutoOpenSqlCompletion(fullDoc, position, sqlCompletionDialectOptions());
        const facts: SqlCompletionTriggerFacts = {
          origin,
          hasIdentifierPrefix: ctx.prefix.length > 0,
          qualifierTriggered: !!databaseLinkContext || (prevChar === "." && ("schema" in ctx ? ctx.schema != null : "qualifier" in ctx && ctx.qualifier != null)),
          useDatabasePrefix,
          positionalEligible,
        };
        if (!shouldAllowSqlCompletionTrigger(mode, facts)) return null;
      }
    }

    if (useDatabaseCompletion) {
      const currentDatabase = props.database ?? "";
      if (!currentDatabase) return null;
      let sqlServerContext: SqlServerCompletionContext;
      try {
        sqlServerContext = await connectionStore.getSqlServerCompletionContext(props.connectionId, currentDatabase);
      } catch {
        // Without a server-reported capability, do not suggest a USE target
        // that the current SQL Server session may be unable to switch to.
        return null;
      }
      if (sqlServerContext.supports_session_database_switch) {
        try {
          await connectionStore.listCompletionDatabases(props.connectionId);
        } catch {
          // Keep locally indexed database names available when metadata refresh fails.
        }
      }
      if (epoch !== completionEpoch) return null;
      const databaseNames = sqlServerUseCompletionDatabaseNames({
        databaseNames: connectionStore.lookupLocalCompletionDatabases(props.connectionId, useDatabaseCompletion.prefix, MAX_COMPLETION_TABLES),
        currentDatabase,
        supportsSessionDatabaseSwitch: sqlServerContext.supports_session_database_switch,
      });
      const items = buildSqlServerUseDatabaseCompletionItems(databaseNames, useDatabaseCompletion);
      return buildCompletionResult(items, useDatabaseCompletion.from, undefined, useDatabaseCompletion.prefix);
    }

    if (databaseLinkContext) {
      if (!hasDatabase) return null;
      const links = await connectionStore.listOracleDatabaseLinks(props.connectionId, props.database!);
      if (epoch !== completionEpoch) return null;
      return {
        from: databaseLinkContext.from,
        to: databaseLinkContext.to,
        options: oracleDatabaseLinkCompletionItems(links, databaseLinkContext.prefix).map((item) => ({ ...item, type: "text" as const, boost: 0 })),
        validFor: /^[A-Za-z0-9_$#.]*$/,
      };
    }

    if (sequenceLiteralContext) {
      if (!hasDatabase) return null;
      const sequences = await connectionStore.listCompletionObjects(props.connectionId, props.database!, sequenceLiteralContext.prefix, MAX_COMPLETION_TABLES, sequenceLiteralContext.schema, undefined, false, undefined, ["sequence"], sequenceLiteralContext.nameQuoted);
      if (epoch !== completionEpoch) return null;
      return buildCompletionResult(buildPostgresSequenceLiteralCompletionItems(sequenceLiteralContext, sequences), sequenceLiteralContext.from, undefined, sequenceLiteralContext.prefix);
    }

    const legacyCompletionContext = getEditorSqlCompletionContext(fullDoc, position);
    const semanticModel = SEMANTIC_SQL_COMPLETION_ENABLED ? buildSqlSemanticModel(fullDoc, position, sqlCompletionDialectOptions()) : null;
    let completionContext = semanticModel ? sqlCompletionContextFromSemantic(semanticModel, legacyCompletionContext) : legacyCompletionContext;

    if (!hasDatabase) {
      const items = buildSqlCompletionItemsFromContext(completionContext, {
        tables: [],
        objects: [],
        columnsByTable: new Map(),
        schemas: [],
        translations: completionTranslations.value,
        snippets: settingsStore.editorSettings.snippets,
        dialect: props.dialect,
        databaseType: snippetDatabaseType.value,
        driverProfile: sqlDriverProfile.value,
        currentSchema: props.schema,
        keywordCase: settingsStore.editorSettings.sqlFormatter.keywordCase,
        functionCase: settingsStore.editorSettings.sqlFormatter.functionCase,
        autoAliasTables: settingsStore.editorSettings.autoAliasTables,
      });
      return buildSqlCompletionResult(items, completionContext, fullDoc, position);
    }

    const useDatabase = props.databaseType === "sqlserver" ? sqlServerUseDatabaseBeforeCursor(fullDoc, position) : undefined;
    let knownUseDatabases: string[] | undefined;
    let supportsSessionDatabaseSwitch: boolean | undefined;
    let useDatabaseDefaultSchema: string | undefined;
    if (useDatabase) {
      try {
        const currentContext = await connectionStore.getSqlServerCompletionContext(props.connectionId, props.database!);
        supportsSessionDatabaseSwitch = currentContext.supports_session_database_switch;
        knownUseDatabases = [props.database!];
        if (supportsSessionDatabaseSwitch) {
          knownUseDatabases = mergeSqlCompletionQualifierNames(knownUseDatabases, connectionStore.lookupLocalCompletionDatabases(props.connectionId, "", MAX_COMPLETION_TABLES));
          if (!knownUseDatabases.some((database) => database.toLowerCase() === useDatabase.toLowerCase())) {
            knownUseDatabases = mergeSqlCompletionQualifierNames(knownUseDatabases, await connectionStore.listCompletionDatabases(props.connectionId));
          }
        }
        const targetDatabase = knownUseDatabases.find((database) => database.toLowerCase() === useDatabase.toLowerCase());
        if (targetDatabase) {
          const targetContext = targetDatabase.toLowerCase() === props.database!.toLowerCase() ? currentContext : await connectionStore.getSqlServerCompletionContext(props.connectionId, targetDatabase);
          useDatabaseDefaultSchema = targetContext.default_schema;
        }
      } catch {
        // An unverified USE target must not replace the selected database.
      }
      if (epoch !== completionEpoch) return null;
    }

    const completionScope = resolveSqlCompletionScope({
      sql: fullDoc,
      cursor: position,
      databaseType: props.databaseType,
      currentDatabase: props.database!,
      currentSchema: props.schema,
      knownDatabases: knownUseDatabases,
      supportsSessionDatabaseSwitch,
      useDatabaseDefaultSchema,
      completionContext,
    });
    completionContext = completionScope.completionContext;

    const needsAsyncData =
      completionContext.suggestTables || completionContext.suggestRoutines || completionContext.exclusiveRoutineSuggestions || !!completionContext.qualifier || !!completionContext.insertTable || completionContext.exclusiveColumnSuggestions || completionContext.referencedTables.length > 0;

    if (!needsAsyncData) {
      const items = buildSqlCompletionItemsFromContext(completionContext, {
        tables: [],
        objects: [],
        columnsByTable: new Map(),
        schemas: [],
        translations: completionTranslations.value,
        snippets: settingsStore.editorSettings.snippets,
        dialect: props.dialect,
        databaseType: snippetDatabaseType.value,
        driverProfile: sqlDriverProfile.value,
        currentSchema: props.schema,
        keywordCase: settingsStore.editorSettings.sqlFormatter.keywordCase,
        functionCase: settingsStore.editorSettings.sqlFormatter.functionCase,
        autoAliasTables: settingsStore.editorSettings.autoAliasTables,
      });
      return buildSqlCompletionResult(items, completionContext, fullDoc, position);
    }

    const tableNameCompletion = isTableNameCompletionContext(completionContext);
    const shouldResolveColumnCompletion = shouldResolveSqlColumnCompletion({
      suggestColumns: completionContext.suggestColumns,
      hasReferencedTables: completionContext.referencedTables.length > 0,
      prefix: completionContext.prefix,
      typedActivation,
      selectListColumnContext: completionContext.selectListColumnContext,
    });
    const shouldResolveAsyncCompletion = tableNameCompletion || shouldResolveColumnCompletion;
    const localResult = buildLocalSqlCompletionResult(completionContext, fullDoc, position, completionScope);
    if (localResult) {
      scheduleCompletionMetadataRefresh(completionContext, fullDoc, position, completionScope);
      const hasLocalColumnResult = localResult.options.some((option) => option.type === "column");
      if ((!explicit || typedActivation) && (!shouldResolveColumnCompletion || hasLocalColumnResult)) return localResult;
    }
    if ((!explicit || typedActivation) && !shouldResolveAsyncCompletion) {
      scheduleCompletionMetadataRefresh(completionContext, fullDoc, position, completionScope);
      return null;
    }

    context.addEventListener("abort", () => {
      if (epoch === completionEpoch) completionEpoch++;
    });
    return (await performAsyncCompletionWithResult(epoch, completionContext, fullDoc, position, completionScope)) ?? localResult;
  } catch {
    return null;
  }
}

function isEditorComposing(currentView: EditorViewType): boolean {
  return imeCompositionActive || currentView.inComposition;
}

// Manual-trigger shortcut (default Alt+/). Opens the completion popup on the
// explicit path so auto-trigger mode gating is bypassed. Unlike
// scheduleSqlCompletionStart, it must NOT mark the activation as typed, or the
// session would be misclassified as typing and gated for 500ms.
function triggerSqlCompletion(currentView: EditorViewType): boolean {
  if (isEditorComposing(currentView)) return false;
  activeCompletionOrigin = "explicit";
  return runMonacoAction(currentView, "editor.action.triggerSuggest");
}

function scheduleSqlCompletionStart(currentView: EditorViewType, delay = 50) {
  clearDeferredCompletionTrigger();
  deferredCompletionTriggerTimer = setTimeout(() => {
    deferredCompletionTriggerTimer = null;
    if (view.value !== currentView || !editorIsActive || isEditorComposing(currentView)) return;
    activeCompletionOrigin = "typing";
    runMonacoAction(currentView, "editor.action.triggerSuggest");
  }, delay);
}

function clearDeferredCompletionTrigger() {
  if (deferredCompletionTriggerTimer === null) return;
  clearTimeout(deferredCompletionTriggerTimer);
  deferredCompletionTriggerTimer = null;
}

function flushImeComposition() {
  const currentView = view.value;
  if (!currentView || !pendingImeModelEmit) return;
  pendingImeModelEmit = false;
  emitModelValue(currentView);
  invalidateSemanticDiagnosticsForDocumentChange();
  scheduleSemanticDiagnostics();
  syncEditorSelectionState(currentView);
  schedulePreviewContextRefresh(currentView);
  emit("selectionChange", selectedSqlFromView(currentView));
  emit("cursorChange", monacoSqlContextState(currentView).selection.main.head);
  latestSelection = readEditorSelection(currentView);
  if (editorIsActive) emitEditorSelection(latestSelection);
  const fullDoc = monacoSqlContextState(currentView).doc.toString();
  const position = monacoSqlContextState(currentView).selection.main.head;
  if (shouldTriggerSqlCompletionForPosition(fullDoc, position)) {
    scheduleSqlCompletionStart(currentView);
  }
}

/**
 * Returns true when the current SQL position should trigger completion under the active trigger mode.
 * Used by flushImeComposition and shouldStartSqlCompletionAfterInput.
 */
function shouldTriggerSqlCompletionForPosition(fullDoc: string, position: number): boolean {
  const sequenceLiteralContext = getPostgresSequenceLiteralCompletionContext(fullDoc, position, props.databaseType);
  const databaseLinkContext = oracleDatabaseLinkCompletionContext(fullDoc, position, props.databaseType);
  if (isSqlCompletionSuppressedContext(fullDoc, position, { databaseType: props.databaseType, editorState: view.value ? monacoSqlContextState(view.value) : undefined }) && !sequenceLiteralContext) return false;
  const mode = settingsStore.editorSettings.completionTriggerMode;
  if (mode === "manual") return false;

  const useDatabaseCompletion = resolveSqlServerUseDatabaseCompletion({
    sql: fullDoc,
    cursor: position,
    databaseType: props.databaseType,
  });
  const useDatabasePrefix = useDatabaseCompletion?.prefix ?? null;

  if (mode === "require-prefix") {
    const ctx = databaseLinkContext ?? sequenceLiteralContext ?? getEditorSqlCompletionContext(fullDoc, position);
    const prevChar = fullDoc[position - 1] ?? "";
    const facts: SqlCompletionTriggerFacts = {
      origin: "typing",
      hasIdentifierPrefix: ctx.prefix.length > 0,
      qualifierTriggered: !!databaseLinkContext || (prevChar === "." && ("schema" in ctx ? ctx.schema != null : "qualifier" in ctx && ctx.qualifier != null)),
      useDatabasePrefix,
    };
    return shouldAllowSqlCompletionTrigger(mode, facts);
  }

  // positional
  const ctx = databaseLinkContext ?? sequenceLiteralContext ?? getEditorSqlCompletionContext(fullDoc, position);
  const prevChar = fullDoc[position - 1] ?? "";
  const positionalEligible = shouldAutoOpenSqlCompletion(fullDoc, position, sqlCompletionDialectOptions());
  const facts: SqlCompletionTriggerFacts = {
    origin: "typing",
    hasIdentifierPrefix: ctx.prefix.length > 0,
    qualifierTriggered: !!databaseLinkContext || (prevChar === "." && ("schema" in ctx ? ctx.schema != null : "qualifier" in ctx && ctx.qualifier != null)),
    useDatabasePrefix,
    positionalEligible,
  };
  return shouldAllowSqlCompletionTrigger(mode, facts);
}

function buildLocalSqlCompletionResult(completionContext: ReturnType<typeof getSqlCompletionContext>, fullDoc: string, position: number, scope: CompletionMetadataScope) {
  if (!props.connectionId || props.database == null) return null;
  const databaseNames = localCompletionDatabaseNames(completionContext);
  const currentDatabaseSchemaNames = localCompletionSchemasForDatabaseDisambiguation(completionContext, databaseNames, scope);
  const schemaLookupDatabase = resolveSqlCompletionSchemaLookupDatabase({
    supportsDatabaseSchemaQualifier: supportsDatabaseSchemaQualifierCompletion(),
    completionContext,
    knownDatabases: databaseNames,
    knownSchemas: currentDatabaseSchemaNames,
  });
  const shouldLoadTables = !schemaLookupDatabase && (completionContext.suggestTables || (!!completionContext.qualifier && !isReferencedTableQualifier(completionContext)));
  const tableLookupTarget = resolveSqlCompletionTableLookupTarget({
    currentDatabase: scope.database,
    currentSchema: scope.schema,
    supportsDatabaseQualifier: supportsDatabaseQualifierCompletion(),
    supportsDatabaseSchemaQualifier: supportsDatabaseSchemaQualifierCompletion(),
    completionContext,
    knownDatabases: databaseNames,
  });
  const globalOracleTableSearch = props.databaseType === "oracle" && completionContext.suggestTables && !completionContext.qualifier;
  const tables = schemaLookupDatabase ? [] : shouldLoadTables ? connectionStore.lookupLocalCompletionTables(props.connectionId, tableLookupTarget.database, tableLookupTarget.filter, MAX_COMPLETION_TABLES, globalOracleTableSearch ? undefined : tableLookupTarget.schema, props.catalog) : cachedTables;

  const shouldLoadObjects = shouldLoadCompletionObjects(completionContext);
  const completionObjectScope = routineCompletionScopeForContext(completionContext, scope);
  const scopedCachedCompletionObjects = completionObjectsForScope(completionObjectScope);
  const completionObjects = shouldLoadObjects ? lookupLocalCompletionObjectsForContext(completionContext, scope) : scopedCachedCompletionObjects;

  const schemaNames =
    completionContext.suggestTables && !completionContext.insertTable
      ? schemaLookupDatabase
        ? connectionStore.lookupLocalCompletionSchemas(props.connectionId, schemaLookupDatabase, completionContext.prefix, MAX_COMPLETION_TABLES)
        : !completionContext.qualifier
          ? mergeSqlCompletionQualifierNames(connectionStore.lookupLocalCompletionSchemas(props.connectionId, scope.database, completionContext.prefix, MAX_COMPLETION_TABLES), databaseNames)
          : []
      : [];

  const columnsByTable = new Map<string, SqlCompletionColumn[]>();
  if (completionContext.insertTable) {
    const insertDatabase = (supportsDatabaseSchemaQualifierCompletion() ? completionContext.insertDatabase : undefined) ?? scope.database;
    const insertSchema = completionContext.insertSchema ?? scope.schema;
    const insertColumns = usesOracleSessionCompletionColumns(insertSchema) ? [] : connectionStore.lookupLocalCompletionColumns(props.connectionId, insertDatabase, completionContext.insertTable, insertSchema, props.catalog);
    if (insertColumns.length > 0) {
      columnsByTable.set(completionCacheKey({ name: completionContext.insertTable, database: completionContext.insertDatabase, schema: insertSchema }, scope), insertColumns);
    }
  }

  const qualifiedColumnTarget = completionQualifiedTableTarget(completionContext);
  if (qualifiedColumnTarget) {
    const reference = completionContext.referencedTables.find((table) => completionTablesMatch(table, qualifiedColumnTarget));
    const qualifiedCacheTable = { ...qualifiedColumnTarget, nameQuoted: reference?.nameQuoted, schemaQuoted: reference?.schemaQuoted };
    const cacheKey = completionCacheKey(qualifiedCacheTable, scope);
    const cachedPrefix = completionContext.prefix.length >= 2 && (props.databaseType === "postgres" || props.databaseType === "mysql") ? lookupCachedPrefixColumns(qualifiedCacheTable, scope, completionContext.prefix) : undefined;
    const cached = cachedPrefix ?? cachedColumnsByTable.get(cacheKey);
    if (cached) {
      columnsByTable.set(cacheKey, cached);
    } else {
      const target = completionMetadataTarget(qualifiedColumnTarget, scope);
      const prefixColumns =
        target && completionContext.prefix.length >= 2 && (props.databaseType === "postgres" || props.databaseType === "mysql")
          ? connectionStore.lookupLocalCompletionColumnsByPrefix(props.connectionId, target.database, qualifiedColumnTarget.name, target.schema, completionContext.prefix, target.catalog, completionColumnRequestContext(reference))
          : [];
      const localColumns =
        prefixColumns.length > 0
          ? prefixColumns
          : target && !usesOracleSessionCompletionColumns(target.schema)
            ? connectionStore.lookupLocalCompletionColumns(props.connectionId, target.database, qualifiedColumnTarget.name, target.schema, target.catalog, completionColumnRequestContext(reference))
            : [];
      if (localColumns.length > 0) {
        columnsByTable.set(cacheKey, localColumns);
      }
    }
  }

  const cteDefs = extractCteDefinitions(fullDoc);
  for (const refTable of completionContext.referencedTables) {
    if (refTable.columns?.length) {
      columnsByTable.set(
        refTable.name,
        refTable.columns.map((name) => ({ name, table: refTable.name, schema: refTable.schema })),
      );
      continue;
    }
    if (isVirtualCompletionTableReference(refTable)) continue;
    const cteDef = cteDefs.find((c) => c.name.toLowerCase() === refTable.name.toLowerCase());
    if (cteDef) {
      columnsByTable.set(
        refTable.name,
        cteDef.columns.map((name) => ({
          name,
          table: refTable.name,
          dataType: undefined,
        })),
      );
      continue;
    }
    const cacheKey = completionCacheKey(refTable, scope);
    const prefixCompletion =
      (props.databaseType === "postgres" || props.databaseType === "mysql") &&
      completionContext.qualifier &&
      completionContext.prefix.length >= 2 &&
      isReferencedTableQualifier(completionContext) &&
      (refTable.alias?.toLowerCase() === completionContext.qualifier.toLowerCase() || refTable.name.toLowerCase() === completionContext.qualifier.toLowerCase())
        ? completionContext.prefix
        : undefined;
    const cached = (prefixCompletion ? lookupCachedPrefixColumns(refTable, scope, prefixCompletion) : undefined) ?? cachedColumnsByTable.get(cacheKey);
    if (cached) {
      columnsByTable.set(cacheKey, cached);
      continue;
    }
    const target = completionMetadataTarget(refTable, scope);
    const prefixColumns = target && prefixCompletion ? connectionStore.lookupLocalCompletionColumnsByPrefix(props.connectionId, target.database, refTable.name, target.schema, prefixCompletion, target.catalog, refTable) : [];
    const localColumns = prefixColumns.length > 0 ? prefixColumns : target && !usesOracleSessionCompletionColumns(target.schema) ? connectionStore.lookupLocalCompletionColumns(props.connectionId, target.database, refTable.name, target.schema, target.catalog, refTable) : [];
    if (localColumns.length > 0) {
      columnsByTable.set(cacheKey, localColumns);
    }
    const localForeignKeys = target ? connectionStore.lookupLocalCompletionForeignKeys(props.connectionId, target.database, refTable.name, target.schema) : [];
    if (localForeignKeys.length > 0) {
      cachedForeignKeysByTable.set(cacheKey, localForeignKeys);
    }
  }

  if (
    tables.length === 0 &&
    completionObjects.length === 0 &&
    schemaNames.length === 0 &&
    columnsByTable.size === 0 &&
    !driverProfileHasCompletionCandidates(sqlDriverProfile.value, completionContext) &&
    (completionContext.exclusiveTableSuggestions || completionContext.exclusiveColumnSuggestions || completionContext.exclusiveRoutineSuggestions)
  ) {
    return null;
  }

  const items = buildSqlCompletionItemsFromContext(completionContext, {
    tables,
    objects: completionObjects,
    columnsByTable,
    foreignKeysByTable: cachedForeignKeysByTable,
    schemas: schemaNames,
    translations: completionTranslations.value,
    snippets: settingsStore.editorSettings.snippets,
    dialect: props.dialect,
    databaseType: snippetDatabaseType.value,
    driverProfile: sqlDriverProfile.value,
    currentSchema: scope.schema,
    keywordCase: settingsStore.editorSettings.sqlFormatter.keywordCase,
    functionCase: settingsStore.editorSettings.sqlFormatter.functionCase,
    autoAliasTables: settingsStore.editorSettings.autoAliasTables,
  });

  return buildSqlCompletionResult(items, completionContext, fullDoc, position);
}

function scheduleCompletionMetadataRefresh(completionContext: ReturnType<typeof getSqlCompletionContext>, fullDoc: string, position: number, scope: CompletionMetadataScope) {
  if (!props.connectionId || props.database == null) return;
  const localOnlyMetadata = usesLocalOnlyCompletionMetadata();
  const onDemandOnlyColumns = usesOnDemandOnlyCompletionColumns();
  const tableNameCompletion = isTableNameCompletionContext(completionContext);
  const connectionId = props.connectionId;
  const database = scope.database;
  const databaseNames = localCompletionDatabaseNames(completionContext);
  const currentDatabaseSchemaNames = localCompletionSchemasForDatabaseDisambiguation(completionContext, databaseNames, scope);
  const schemaLookupDatabase = resolveSqlCompletionSchemaLookupDatabase({
    supportsDatabaseSchemaQualifier: supportsDatabaseSchemaQualifierCompletion(),
    completionContext,
    knownDatabases: databaseNames,
    knownSchemas: currentDatabaseSchemaNames,
  });
  const tableLookupTarget = resolveSqlCompletionTableLookupTarget({
    currentDatabase: database,
    currentSchema: scope.schema,
    supportsDatabaseQualifier: supportsDatabaseQualifierCompletion(),
    supportsDatabaseSchemaQualifier: supportsDatabaseSchemaQualifierCompletion(),
    completionContext,
    knownDatabases: databaseNames,
  });
  if (!localOnlyMetadata && !schemaLookupDatabase && (completionContext.suggestTables || (!!completionContext.qualifier && !isReferencedTableQualifier(completionContext)))) {
    const globalOracleTableSearch = props.databaseType === "oracle" && completionContext.suggestTables && !completionContext.qualifier;
    const refreshEpoch = completionEpoch;
    queueTableCompletionRefresh(async () => {
      if (refreshEpoch !== completionEpoch) return;
      try {
        const tables = await connectionStore.refreshCompletionTables(connectionId, tableLookupTarget.database, tableLookupTarget.filter, MAX_COMPLETION_TABLES, tableLookupTarget.schema, globalOracleTableSearch, scope.schema, props.catalog);
        if (refreshEpoch !== completionEpoch) return;
        const scopedTables = tables.map((table) => ({ ...table, database: table.database ?? tableLookupTarget.database }));
        cachedTables = mergeCompletionTables(cachedTables, scopedTables);
        if (completionContext.suggestJoinConditions && completionContext.referencedTables.length > 0) {
          void ensureForeignKeysForTables(completionContext.referencedTables);
        }
      } catch {
        // Local candidates remain available when the remote refresh fails.
      }
    });
  }
  if (!localOnlyMetadata && shouldLoadCompletionObjects(completionContext)) {
    const completionObjectScope = routineCompletionScopeForContext(completionContext, scope);
    void listCompletionObjectsForContext(completionContext, scope)
      .then((objects) => {
        const cachedObjects = completionObjectsForScope(completionObjectScope);
        const merged = mergeCompletionObjects(cachedObjects, objects);
        const changed = completionObjectsDiffer(cachedObjects, merged);
        cachedCompletionObjectsByScope.set(completionObjectScopeKey(completionObjectScope), merged);
        if (changed) refreshActiveSqlCompletion(fullDoc, position, completionContext);
      })
      .catch(() => {});
  }
  if (!localOnlyMetadata && completionContext.suggestTables && !completionContext.insertTable) {
    if (schemaLookupDatabase) {
      void connectionStore.refreshCompletionSchemas(connectionId, schemaLookupDatabase).catch(() => {});
    } else if (!completionContext.qualifier) {
      void connectionStore.refreshCompletionSchemas(connectionId, database).catch(() => {});
      if (supportsDatabaseNameCompletion(props.databaseType)) {
        void connectionStore.refreshCompletionDatabases(connectionId).catch(() => {});
      }
    }
  }
  if (!onDemandOnlyColumns && completionContext.insertTable) {
    const insertTable = completionContext.insertTable;
    const insertDatabase = (supportsDatabaseSchemaQualifierCompletion() ? completionContext.insertDatabase : undefined) ?? database;
    void refreshCompletionColumnsForEditor(connectionId, insertDatabase, insertTable, completionContext.insertSchema ?? scope.schema)
      .then((columns) => {
        const insertSchema = completionContext.insertSchema ?? scope.schema;
        cachedColumnsByTable.set(completionCacheKey({ name: insertTable, database: completionContext.insertDatabase, schema: insertSchema }, scope), columns);
      })
      .catch(() => {});
  }
  const qualifiedColumnTarget = completionQualifiedTableTarget(completionContext);
  const qualifiedColumnCacheKey = qualifiedColumnTarget ? completionCacheKey(qualifiedColumnTarget, scope) : undefined;
  if (!onDemandOnlyColumns && qualifiedColumnTarget && qualifiedColumnCacheKey && !cachedColumnsByTable.has(qualifiedColumnCacheKey)) {
    const target = completionMetadataTarget(qualifiedColumnTarget, scope);
    if (target) {
      void refreshCompletionColumnsForEditor(connectionId, target.database, qualifiedColumnTarget.name, target.schema, target.catalog)
        .then((columns) => {
          if (columns.length > 0) cachedColumnsByTable.set(qualifiedColumnCacheKey, columns);
        })
        .catch(() => {});
    }
  }
  if (!onDemandOnlyColumns && !tableNameCompletion) {
    for (const refTable of completionContext.referencedTables) {
      if (isVirtualCompletionTableReference(refTable)) continue;
      if (refTable.columns && refTable.columns.length > 0) continue;
      const cacheKey = completionCacheKey(refTable, scope);
      if (cacheKey === qualifiedColumnCacheKey) continue;
      if (cachedColumnsByTable.has(cacheKey)) continue;
      const target = completionMetadataTarget(refTable, scope);
      if (!target) continue;
      void refreshCompletionColumnsForEditor(connectionId, target.database, refTable.name, target.schema, target.catalog, refTable)
        .then((columns) => {
          if (columns.length > 0) cachedColumnsByTable.set(cacheKey, columns);
        })
        .catch(() => {});
    }
  }
  if (!tableNameCompletion && completionContext.suggestJoinConditions && completionContext.referencedTables.length > 0) {
    void ensureForeignKeysForTables(completionContext.referencedTables);
  }
}

function mergeCompletionTables(existing: SqlCompletionTable[], incoming: SqlCompletionTable[]): SqlCompletionTable[] {
  const merged = [...existing];
  const indexes = new Map(existing.map((table, index) => [`${table.catalog ?? ""}.${table.database ?? ""}.${table.schema ?? ""}.${table.name}`.toLowerCase(), index]));
  for (const table of incoming) {
    const key = `${table.catalog ?? ""}.${table.database ?? ""}.${table.schema ?? ""}.${table.name}`.toLowerCase();
    const index = indexes.get(key);
    if (index == null) {
      indexes.set(key, merged.length);
      merged.push(table);
    } else {
      const existing = merged[index];
      // Preserve the more specific tree type if an older metadata endpoint reports a materialized view as VIEW.
      merged[index] = {
        ...existing,
        ...table,
        type: mergeSqlObjectNavigationType(existing.type, table.type),
      };
    }
  }
  return merged;
}

function withCompletionLatencyBudget<T>(remote: Promise<T>, local: T): Promise<T> {
  return Promise.race([remote, new Promise<T>((resolve) => setTimeout(() => resolve(local), COMPLETION_REMOTE_LATENCY_BUDGET_MS))]);
}

function listCompletionTablesWithLatencyBudget(connectionId: string, database: string, filter: string, limit: number, schema?: string, globalSearch = false, catalog = props.catalog, currentSchema = props.schema): Promise<SqlCompletionTable[]> {
  const local = connectionStore.lookupLocalCompletionTables(connectionId, database, filter, limit, globalSearch ? undefined : schema, catalog).map((table) => ({ ...table, catalog: table.catalog ?? catalog, database: table.database ?? database }));
  const remote = connectionStore.listCompletionTables(connectionId, database, filter, limit, schema, globalSearch, currentSchema, catalog).then((tables) => {
    const scopedTables = tables.map((table) => ({ ...table, catalog: table.catalog ?? catalog, database: table.database ?? database }));
    cachedTables = mergeCompletionTables(cachedTables, scopedTables);
    return scopedTables;
  });
  if (local.length === 0) return remote;
  return withCompletionLatencyBudget(remote, local);
}

interface RoutineCompletionTarget {
  schema?: string;
  parentName?: string;
  globalSearch?: boolean;
}

function shouldLoadCompletionObjects(completionContext: ReturnType<typeof getSqlCompletionContext>): boolean {
  // Doris/StarRocks external catalogs currently expose table and column
  // metadata through catalog-aware APIs. The generic routine/object endpoint
  // is catalogless and would query the internal catalog, aborting completion.
  if (props.catalog) return false;
  const routineContext = completionContext.suggestRoutines || completionContext.exclusiveRoutineSuggestions || (!!completionContext.qualifier && !completionContext.exclusiveColumnSuggestions);
  return routineContext && !isReferencedTableQualifier(completionContext);
}

/**
 * Databases whose qualified routine completion treats the first qualifier as a
 * package (Oracle) or as a package-or-schema in A compatibility mode
 * (openGauss). The backend re-validates: non-package parents fall through to
 * the ordinary routine search, so routing is safe even when the compatibility
 * map is not yet warm. openGauss keeps the package-aware routing while the
 * mode is unknown (cold start, so A-mode completion works immediately after
 * connect) and once the mode is known to be A; a known B/PG mode skips the
 * extra package-style queries entirely.
 */
function usesPackageAwareRoutineCompletion(): boolean {
  if (props.databaseType === "oracle") return true;
  if (props.databaseType !== "opengauss") return false;
  const mode = connectionStore.databaseCompatibilityMode(props.connectionId, props.database)?.trim().toUpperCase();
  return mode === undefined || mode === "A";
}

function oracleRoutineCompletionTargets(completionContext: ReturnType<typeof getSqlCompletionContext>): RoutineCompletionTarget[] {
  const parts = (completionContext.qualifierParts?.length ? completionContext.qualifierParts : completionContext.qualifier?.split("."))?.filter(Boolean) ?? [];
  if (parts.length === 0) {
    // Oracle resolves unqualified routines across all schemas (owner semantics).
    // openGauss keeps the PG search_path scope for the unqualified case.
    if (props.databaseType === "oracle") return [{ schema: props.schema, globalSearch: true }];
    return [{ schema: props.schema }];
  }
  if (parts.length === 1) {
    return [{ schema: props.schema, parentName: parts[0] }, { schema: parts[0] }];
  }
  return [{ schema: parts[parts.length - 2], parentName: parts[parts.length - 1] }];
}

function routineCompletionTargetForContext(completionContext: ReturnType<typeof getSqlCompletionContext>, scope: CompletionMetadataScope) {
  return resolveSqlCompletionRoutineLookupTarget({
    currentDatabase: scope.database,
    currentSchema: scope.schema,
    supportsDatabaseSchemaQualifier: supportsDatabaseSchemaQualifierCompletion(),
    completionContext,
  });
}

function routineCompletionScopeForContext(completionContext: ReturnType<typeof getSqlCompletionContext>, scope: CompletionMetadataScope): CompletionMetadataScope {
  if (usesPackageAwareRoutineCompletion()) return scope;
  const target = routineCompletionTargetForContext(completionContext, scope);
  return { database: target.database, schema: target.schema };
}

function lookupLocalCompletionObjectsForContext(completionContext: ReturnType<typeof getSqlCompletionContext>, scope: CompletionMetadataScope): SqlCompletionObject[] {
  if (!props.connectionId || props.database == null) return [];
  if (usesPackageAwareRoutineCompletion()) {
    return connectionStore.lookupLocalCompletionObjects(props.connectionId, scope.database, completionContext.prefix, MAX_COMPLETION_TABLES);
  }
  const target = routineCompletionTargetForContext(completionContext, scope);
  return connectionStore.lookupLocalCompletionObjects(props.connectionId, target.database, target.mask, MAX_COMPLETION_TABLES, target.schema);
}

async function listCompletionObjectsForContext(completionContext: ReturnType<typeof getSqlCompletionContext>, scope: CompletionMetadataScope): Promise<SqlCompletionObject[]> {
  if (!props.connectionId || props.database == null) return [];
  const objectKinds = completionObjectKindsForContext(completionContext);
  if (!usesPackageAwareRoutineCompletion()) {
    const target = routineCompletionTargetForContext(completionContext, scope);
    return connectionStore.listCompletionObjects(props.connectionId, target.database, target.mask, MAX_COMPLETION_TABLES, target.schema, undefined, false, scope.schema, objectKinds);
  }
  const groups = await Promise.all(
    oracleRoutineCompletionTargets(completionContext).map((target) => connectionStore.listCompletionObjects(props.connectionId!, scope.database, completionContext.prefix, MAX_COMPLETION_TABLES, target.schema, target.parentName, target.globalSearch, scope.schema, objectKinds)),
  );
  return groups.reduce((objects, group) => mergeCompletionObjects(objects, group), [] as SqlCompletionObject[]);
}

function completionObjectKindsForContext(completionContext: ReturnType<typeof getSqlCompletionContext>): CompletionAssistantObjectKind[] {
  if (completionContext.contextKind === "exec") return ["procedure"];
  if (completionContext.suggestColumns && completionContext.referencedTables.length > 0 && !completionContext.qualifier) return ["function"];
  return ["routine"];
}

async function performAsyncCompletionWithResult(epoch: number, completionContext: ReturnType<typeof getSqlCompletionContext>, fullDoc: string, position: number, scope: CompletionMetadataScope) {
  const localOnlyMetadata = usesLocalOnlyCompletionMetadata();
  const onDemandOnlyColumns = usesOnDemandOnlyCompletionColumns();
  // Handle INSERT column list: fetch columns for the target table
  let insertColumnsByTable = new Map<string, SqlCompletionColumn[]>();
  if (completionContext.insertTable) {
    try {
      const insertDatabase = (supportsDatabaseSchemaQualifierCompletion() ? completionContext.insertDatabase : undefined) ?? scope.database;
      const insertCols = await listCompletionColumnsForEditor(props.connectionId!, insertDatabase, completionContext.insertTable, completionContext.insertSchema ?? scope.schema);
      if (epoch !== completionEpoch) return null;
      if (insertCols.length > 0) {
        const insertSchema = completionContext.insertSchema ?? scope.schema;
        const insertKey = completionCacheKey({ name: completionContext.insertTable, database: completionContext.insertDatabase, schema: insertSchema }, scope);
        insertColumnsByTable.set(insertKey, insertCols);
      }
    } catch {
      // ignore
    }
  }

  let databaseNames = localCompletionDatabaseNames(completionContext);
  let currentDatabaseSchemaNames = localCompletionSchemasForDatabaseDisambiguation(completionContext, databaseNames, scope);
  const mayCompleteDatabaseSchema = mayCompleteDatabaseSchemaQualifier(completionContext);
  if (!localOnlyMetadata && supportsDatabaseNameCompletion(props.databaseType) && completionContext.suggestTables && !completionContext.insertTable && (!completionContext.qualifier || mayCompleteDatabaseSchema)) {
    const [databasesResult, schemasResult] = await Promise.allSettled([connectionStore.listCompletionDatabases(props.connectionId!), mayCompleteDatabaseSchema ? connectionStore.listCompletionSchemas(props.connectionId!, scope.database) : Promise.resolve(currentDatabaseSchemaNames)]);
    databaseNames = databasesResult.status === "fulfilled" ? databasesResult.value : [];
    if (schemasResult.status === "fulfilled") currentDatabaseSchemaNames = mergeSqlCompletionQualifierNames(scope.schema ? [scope.schema] : [], schemasResult.value);
    if (epoch !== completionEpoch) return null;
  }
  const schemaLookupDatabase = resolveSqlCompletionSchemaLookupDatabase({
    supportsDatabaseSchemaQualifier: supportsDatabaseSchemaQualifierCompletion(),
    completionContext,
    knownDatabases: databaseNames,
    knownSchemas: currentDatabaseSchemaNames,
  });
  const shouldLoadTables = !schemaLookupDatabase && (completionContext.suggestTables || (!!completionContext.qualifier && !isReferencedTableQualifier(completionContext)));
  const tableLookupTarget = resolveSqlCompletionTableLookupTarget({
    currentDatabase: scope.database,
    currentSchema: scope.schema,
    supportsDatabaseQualifier: supportsDatabaseQualifierCompletion(),
    supportsDatabaseSchemaQualifier: supportsDatabaseSchemaQualifierCompletion(),
    completionContext,
    knownDatabases: databaseNames,
  });
  const globalOracleTableSearch = props.databaseType === "oracle" && completionContext.suggestTables && !completionContext.qualifier;
  let tables = schemaLookupDatabase
    ? []
    : shouldLoadTables
      ? localOnlyMetadata
        ? connectionStore.lookupLocalCompletionTables(props.connectionId!, tableLookupTarget.database, tableLookupTarget.filter, MAX_COMPLETION_TABLES, globalOracleTableSearch ? undefined : tableLookupTarget.schema, props.catalog)
        : await listCompletionTablesWithLatencyBudget(props.connectionId!, tableLookupTarget.database, tableLookupTarget.filter, MAX_COMPLETION_TABLES, tableLookupTarget.schema, globalOracleTableSearch, props.catalog, scope.schema)
      : cachedTables;
  if (localOnlyMetadata && tables.length === 0 && supportsDatabaseSchemaQualifierCompletion() && (completionContext.qualifierParts?.length ?? 0) >= 2 && allowsOnDemandQualifiedTableCompletion(completionContext.prefix)) {
    tables = await listCompletionTablesWithLatencyBudget(props.connectionId!, tableLookupTarget.database, tableLookupTarget.filter, PRESTO_ON_DEMAND_TABLE_COMPLETION_LIMIT, tableLookupTarget.schema, false, props.catalog, scope.schema);
  }
  if (epoch !== completionEpoch) return null;

  const shouldLoadObjects = shouldLoadCompletionObjects(completionContext);
  const completionObjectScope = routineCompletionScopeForContext(completionContext, scope);
  const scopedCachedCompletionObjects = completionObjectsForScope(completionObjectScope);
  let completionObjects = shouldLoadObjects ? (localOnlyMetadata ? lookupLocalCompletionObjectsForContext(completionContext, scope) : await listCompletionObjectsForContext(completionContext, scope)) : scopedCachedCompletionObjects;
  if (epoch !== completionEpoch) return null;

  if (!props.catalog && props.databaseType !== "oracle" && !localOnlyMetadata && completionContext.qualifier && completionObjects.length === 0) {
    const target = routineCompletionTargetForContext(completionContext, scope);
    const schemaObjects = await connectionStore.listCompletionObjects(props.connectionId!, target.database, target.mask, MAX_COMPLETION_TABLES, target.schema, undefined, false, scope.schema);
    if (schemaObjects.length > 0) {
      completionObjects = schemaObjects;
    }
    if (epoch !== completionEpoch) return null;
  }
  cachedCompletionObjectsByScope.set(completionObjectScopeKey(completionObjectScope), mergeCompletionObjects(scopedCachedCompletionObjects, completionObjects));

  // Fetch schemas for schema completion
  let schemaNames: string[] = [];
  if (completionContext.suggestTables && !completionContext.insertTable && (schemaLookupDatabase || !completionContext.qualifier)) {
    const database = schemaLookupDatabase ?? scope.database;
    if (localOnlyMetadata) {
      const schemas = connectionStore.lookupLocalCompletionSchemas(props.connectionId!, database, completionContext.prefix, MAX_COMPLETION_TABLES);
      schemaNames = schemaLookupDatabase ? schemas : mergeSqlCompletionQualifierNames(schemas, databaseNames);
    } else {
      try {
        const schemas = await connectionStore.listCompletionSchemas(props.connectionId!, database);
        schemaNames = schemaLookupDatabase ? schemas : mergeSqlCompletionQualifierNames(schemas, databaseNames);
        if (epoch !== completionEpoch) return null;
      } catch {
        schemaNames = schemaLookupDatabase ? [] : databaseNames;
      }
    }
  }

  // If qualifier didn't match any table names, try it as a schema name
  let qualifierIsSchema = false;
  if (completionContext.qualifier && !schemaLookupDatabase && !tableLookupTarget.qualifierDatabase && !isReferencedTableQualifier(completionContext) && tables.length === 0 && (completionContext.suggestTables || completionContext.exclusiveColumnSuggestions)) {
    let schemaTables = connectionStore.lookupLocalCompletionTables(props.connectionId!, scope.database, completionContext.prefix, MAX_COMPLETION_TABLES, completionContext.qualifier, props.catalog);
    if (!localOnlyMetadata) {
      schemaTables = await listCompletionTablesWithLatencyBudget(props.connectionId!, scope.database, completionContext.prefix, MAX_COMPLETION_TABLES, completionContext.qualifier, false, props.catalog, scope.schema);
    } else if (schemaTables.length === 0 && allowsOnDemandQualifiedTableCompletion(completionContext.prefix)) {
      schemaTables = await listCompletionTablesWithLatencyBudget(props.connectionId!, scope.database, completionContext.prefix, PRESTO_ON_DEMAND_TABLE_COMPLETION_LIMIT, completionContext.qualifier, false, props.catalog, scope.schema);
    }
    if (schemaTables.length > 0) {
      tables = schemaTables;
      qualifierIsSchema = true;
    }
    if (epoch !== completionEpoch) return null;
  }

  // Collect referenced tables — enrich with schema from filtered table lookup
  let refs = completionContext.referencedTables.map((rt) => {
    if (usesOracleSessionCompletionColumns(rt.schema)) return rt;
    if (!rt.schema) {
      const cached = tables.find((t) => t.name.toLowerCase() === rt.name.toLowerCase());
      if (cached && cached.schema) {
        return { ...rt, schema: cached.schema };
      }
    }
    return rt;
  });
  const unresolvedRefs = refs.filter((rt) => !usesOracleSessionCompletionColumns(rt.schema) && !rt.schema && !rt.columns && !isVirtualCompletionTableReference(rt));
  if (!localOnlyMetadata && unresolvedRefs.length > 0) {
    const lookupGroups = await Promise.all(
      unresolvedRefs.map((rt) => {
        const target = completionMetadataTarget(rt, scope);
        return connectionStore.listCompletionTables(props.connectionId!, target?.database ?? scope.database, rt.name, 20, target?.schema ?? scope.schema, false, scope.schema, target?.catalog ?? props.catalog);
      }),
    );
    if (epoch !== completionEpoch) return null;
    const lookupTables = lookupGroups.flat();
    refs = refs.map((rt) => {
      if (usesOracleSessionCompletionColumns(rt.schema)) return rt;
      if (rt.schema || rt.columns) return rt;
      const matched = lookupTables.find((table) => table.name.toLowerCase() === rt.name.toLowerCase());
      return matched?.schema ? { ...rt, schema: matched.schema } : rt;
    });
  }

  // If no referenced tables but qualifier exists, infer table from tables list
  if (refs.length === 0 && completionContext.qualifier) {
    const q = completionContext.qualifier.toLowerCase();
    const matched = tables.filter((t) => t.name.toLowerCase() === q || t.name.toLowerCase().endsWith("." + q));
    refs = matched.map((t) => ({ name: t.name, schema: t.schema }));
  }

  const qualifiedColumnTarget = completionQualifiedTableTarget(completionContext);
  if (qualifiedColumnTarget && !refs.some((ref) => completionTablesMatch(ref, qualifiedColumnTarget))) {
    refs.push(qualifiedColumnTarget);
  }

  // Populate CTE columns from parsed definitions
  const cteDefs = extractCteDefinitions(fullDoc);
  for (const refTable of refs) {
    if (refTable.columns) continue;
    const cteDef = cteDefs.find((c) => c.name.toLowerCase() === refTable.name.toLowerCase());
    if (cteDef) {
      refTable.columns = cteDef.columns;
    }
  }

  const tableNameCompletion = isTableNameCompletionContext(completionContext);
  const shouldFetchColumnsForCompletion = !tableNameCompletion && (!onDemandOnlyColumns || completionContext.suggestColumns || completionContext.exclusiveColumnSuggestions || !!completionContext.insertTable);
  const hasQualifiedColumnPrefix = (props.databaseType === "postgres" || props.databaseType === "mysql") && completionContext.qualifier && completionContext.prefix.length >= 2 && isReferencedTableQualifier(completionContext);
  const columnRefs = hasQualifiedColumnPrefix
    ? refs.filter((refTable) => refTable.alias?.toLowerCase() === completionContext.qualifier!.toLowerCase() || refTable.name.toLowerCase() === completionContext.qualifier!.toLowerCase() || (!!qualifiedColumnTarget && completionTablesMatch(refTable, qualifiedColumnTarget)))
    : refs.slice(0, 4);
  if (shouldFetchColumnsForCompletion) {
    await Promise.all(
      columnRefs.map(async (refTable) => {
        if (isVirtualCompletionTableReference(refTable)) return;
        if (refTable.columns && refTable.columns.length > 0) return;
        const cacheKey = completionCacheKey(refTable, scope);
        const prefixCompletion = hasQualifiedColumnPrefix ? completionContext.prefix : undefined;
        const prefixCacheKey = prefixCompletion ? completionPrefixCacheKey(refTable, scope, prefixCompletion) : undefined;
        if (prefixCompletion ? lookupCachedPrefixColumns(refTable, scope, prefixCompletion) : cachedColumnsByTable.has(cacheKey)) return;
        try {
          const target = completionMetadataTarget(refTable, scope);
          if (!target) return;
          const columns = await listCompletionColumnsForEditor(props.connectionId!, target.database, refTable.name, target.schema, target.catalog, refTable, prefixCompletion);
          if (epoch !== completionEpoch) return;
          if (columns.length === 0) return;
          if (prefixCacheKey) cachedPrefixColumnsByTable.set(prefixCacheKey, columns);
          else cachedColumnsByTable.set(cacheKey, columns);
        } catch (e) {
          console.error(`[DBX] Failed to load columns for ${cacheKey}:`, e);
        }
      }),
    );
  }
  if (epoch !== completionEpoch) return null;

  if (!tableNameCompletion && completionContext.suggestJoinConditions && refs.length > 0) {
    await ensureForeignKeysForTables(refs.filter((table) => !("columns" in table) || !table.columns || table.columns.length === 0));
    if (epoch !== completionEpoch) return null;
  }

  // Build columnsByTable — from cache or CTE definitions
  const columnsByTable = new Map<string, SqlCompletionColumn[]>();
  const foreignKeysByTable = new Map<string, SqlCompletionForeignKey[]>();
  if (insertColumnsByTable.size > 0) {
    for (const [key, cols] of insertColumnsByTable.entries()) {
      columnsByTable.set(key, cols);
    }
  } else {
    for (const refTable of refs) {
      if (hasQualifiedColumnPrefix && !columnRefs.includes(refTable)) continue;
      if (refTable.columns && refTable.columns.length > 0) {
        const key = refTable.name;
        columnsByTable.set(
          key,
          refTable.columns.map((name) => ({
            name,
            table: refTable.name,
            dataType: undefined,
          })),
        );
        continue;
      }
      const cacheKey = completionCacheKey(refTable, scope);
      const prefixCompletion =
        (props.databaseType === "postgres" || props.databaseType === "mysql") &&
        completionContext.qualifier &&
        completionContext.prefix.length >= 2 &&
        isReferencedTableQualifier(completionContext) &&
        (refTable.alias?.toLowerCase() === completionContext.qualifier.toLowerCase() || refTable.name.toLowerCase() === completionContext.qualifier.toLowerCase())
          ? completionContext.prefix
          : undefined;
      const cached = (prefixCompletion ? lookupCachedPrefixColumns(refTable, scope, prefixCompletion) : undefined) ?? cachedColumnsByTable.get(cacheKey);
      if (cached) {
        columnsByTable.set(cacheKey, cached);
      }
      let cachedForeignKeys = cachedForeignKeysByTable.get(cacheKey);
      if (!cachedForeignKeys) {
        const target = completionMetadataTarget(refTable, scope);
        cachedForeignKeys = target ? connectionStore.lookupLocalCompletionForeignKeys(props.connectionId!, target.database, refTable.name, target.schema) : [];
        if (cachedForeignKeys.length > 0) cachedForeignKeysByTable.set(cacheKey, cachedForeignKeys);
      }
      if (cachedForeignKeys) {
        foreignKeysByTable.set(cacheKey, cachedForeignKeys);
      }
    }
  }

  const effectiveContext = qualifierIsSchema
    ? {
        ...completionContext,
        qualifier: undefined,
        suggestTables: true,
        suggestColumns: false,
        exclusiveColumnSuggestions: false,
      }
    : completionContext;

  const items = buildSqlCompletionItemsFromContext(effectiveContext, {
    tables,
    objects: completionObjects,
    columnsByTable,
    foreignKeysByTable,
    schemas: schemaNames,
    translations: completionTranslations.value,
    snippets: settingsStore.editorSettings.snippets,
    dialect: props.dialect,
    databaseType: snippetDatabaseType.value,
    driverProfile: sqlDriverProfile.value,
    currentSchema: scope.schema,
    keywordCase: settingsStore.editorSettings.sqlFormatter.keywordCase,
    functionCase: settingsStore.editorSettings.sqlFormatter.functionCase,
    autoAliasTables: settingsStore.editorSettings.autoAliasTables,
  });

  return buildSqlCompletionResult(items, completionContext, fullDoc, position);
}

function isReferencedTableQualifier(completionContext: ReturnType<typeof getSqlCompletionContext>): boolean {
  if (!completionContext.qualifier) return false;
  const qualifier = completionContext.qualifier.toLowerCase();
  const qualifiedColumnTarget = completionQualifiedTableTarget(completionContext);
  return completionContext.referencedTables.some((table) => table.alias?.toLowerCase() === qualifier || table.name.toLowerCase() === qualifier || (!!qualifiedColumnTarget && completionTablesMatch(table, qualifiedColumnTarget)));
}

function isTableNameCompletionContext(completionContext: ReturnType<typeof getSqlCompletionContext>): boolean {
  return completionContext.suggestTables || completionContext.exclusiveTableSuggestions;
}

function mergeCompletionObjects(existing: SqlCompletionObject[], incoming: SqlCompletionObject[]) {
  const merged = [...existing];
  const indexes = new Map(existing.map((object, index) => [completionObjectIdentityKey(object), index]));
  for (const object of incoming) {
    const key = completionObjectIdentityKey(object);
    const index = indexes.get(key);
    if (index == null) {
      indexes.set(key, merged.length);
      merged.push(object);
    } else {
      merged[index] = { ...merged[index], ...object };
    }
  }
  return merged;
}

function completionObjectScopeKey(scope: CompletionMetadataScope): string {
  return `${scope.database}:${scope.schema ?? ""}`.toLowerCase();
}

function completionObjectsForScope(scope: CompletionMetadataScope): SqlCompletionObject[] {
  return cachedCompletionObjectsByScope.get(completionObjectScopeKey(scope)) ?? [];
}

function completionObjectIdentityKey(object: SqlCompletionObject): string {
  return `${object.type}:${object.schema ?? ""}:${object.name}:${object.parentName ?? ""}:${object.signature?.trim() ?? ""}`.toLowerCase();
}

function completionObjectsDiffer(existing: SqlCompletionObject[], incoming: SqlCompletionObject[]): boolean {
  if (existing.length !== incoming.length) return true;
  return existing.some((object, index) => {
    const other = incoming[index];
    return (
      !other ||
      object.name !== other.name ||
      object.schema !== other.schema ||
      object.type !== other.type ||
      object.parentSchema !== other.parentSchema ||
      object.parentName !== other.parentName ||
      object.dataType !== other.dataType ||
      object.signature !== other.signature ||
      object.comment !== other.comment ||
      object.applyName !== other.applyName ||
      object.boost !== other.boost
    );
  });
}

function refreshActiveSqlCompletion(fullDoc: string, position: number, completionContext: ReturnType<typeof getSqlCompletionContext>) {
  const currentView = view.value;
  if (!currentView || activeCompletionOrigin === null) return;
  if (monacoSqlContextState(currentView).doc.toString() !== fullDoc || monacoSqlContextState(currentView).selection.main.head !== position) return;
  const currentContext = getSqlCompletionContext(fullDoc, position);
  if (currentContext.prefix !== completionContext.prefix || currentContext.contextKind !== completionContext.contextKind) return;
  scheduleSqlCompletionStart(currentView);
}

function refreshCompletionCache() {
  cachedTables = [];
  cachedCompletionObjectsByScope.clear();
  cachedColumnsByTable.clear();
  cachedPrefixColumnsByTable.clear();
  cachedInsertValueHintColumnsByTable.clear();
  loadedColumnsByTable.clear();
  cachedForeignKeysByTable.clear();
}

// When completionTriggerMode changes, close any open typing session
// that would no longer be allowed under the new mode.

// A single editor instance serves every tab, so the document swap on tab
// switches must not push "previous tab's content → new content" onto a shared
// undo history (one undo in the new tab restored the old tab's text). Each
// tab's editor state — including its undo history — is cached per tabId and
// reinstalled with setState; first-seen tabs get the document swapped in with a
// transaction excluded from history, and the history extension is dropped and
// re-added in two separate transactions (a compartment reconfigure alone keeps
// the old field value) so the previous tab's edits cannot leak in.

function activateTabDocument(prevTabId: string | undefined, tabId: string | undefined, doc: string) {
  activateNativeDocument(prevTabId, tabId, doc);
}

watch([() => props.tabId, () => props.modelValue], ([tabId, val], [prevTabId]) => {
  if (!view.value) return;
  if (tabId !== prevTabId) {
    activateTabDocument(prevTabId, tabId, val);
    if (props.autoFocus) restoreEditorFocus();
    return;
  }
  if (val !== currentEditorDocText(view.value)) {
    if (isEditorComposing(view.value)) return;
    applyMonacoOffsetEdits(monaco!, view.value, {
      changes: { from: 0, to: monacoSqlContextState(view.value).doc.length, insert: val },
    });
    scheduleSemanticDiagnostics();
  }
});

watch(
  () => props.initialViewport,
  (viewport, previousViewport) => {
    if (!view.value || !viewport || previousViewport) return;
    // Saved SQL content can hydrate after the editor has already mounted. In
    // that case the initial prop was undefined and the mount-time restore had
    // nothing to apply.
    latestViewport = { ...viewport };
    lastEmittedViewport = { ...viewport };
    restoreEditorViewport(viewport);
  },
  { deep: true },
);

watch(
  () => props.initialSelection,
  (selection, previousSelection) => {
    if (!view.value || !selection || previousSelection) return;
    // Keep the cursor and viewport in sync when a saved SQL tab hydrates after
    // the editor component has already been mounted.
    restoreEditorSelection(selection, !props.initialViewport);
  },
  { deep: true },
);

watch(
  () => props.formatRequestId,
  (val) => {
    if (val && val > lastHandledFormatRequestId) {
      lastHandledFormatRequestId = val;
      formatCurrentSql();
    }
  },
);

watch(
  () => props.compressRequestId,
  (val) => {
    if (val && val > lastHandledCompressRequestId) {
      lastHandledCompressRequestId = val;
      compressCurrentSql();
    }
  },
);

watch(
  () => props.executionError,
  () => {
    reconfigureDiagnostics();
  },
);

watch(
  () => props.connectionId,
  () => {
    refreshCompletionCache();
    setSemanticDiagnostics([]);
    scheduleSemanticDiagnostics();
  },
);

watch(
  () => props.database,
  () => {
    refreshCompletionCache();
    setSemanticDiagnostics([]);
    scheduleSemanticDiagnostics();
  },
);

watch(
  () => props.catalog,
  () => {
    refreshCompletionCache();
    setSemanticDiagnostics([]);
    scheduleSemanticDiagnostics();
  },
);

watch(
  () => props.schema,
  () => {
    refreshCompletionCache();
    setSemanticDiagnostics([]);
    scheduleSemanticDiagnostics();
  },
);

watch(
  () => connectionStore.completionCacheRevision(props.connectionId, props.database),
  () => {
    completionEpoch++;
    refreshCompletionCache();
    setSemanticDiagnostics([]);
    scheduleSemanticDiagnostics();
  },
);

watch([() => props.clientSessionId, () => props.completionContextVersion], () => {
  completionEpoch++;
  refreshCompletionCache();
  setSemanticDiagnostics([]);
  scheduleSemanticDiagnostics();
});

// openGauss compatibility mode is loaded asynchronously from the backend into a
// dedicated store map (not the sidebar tree). A restored tab may open before the
// map is warm; when the mode arrives, re-derive statement boundaries and
// diagnostics so package DDL is parsed with the correct PL/SQL rules.
watch(
  () => (props.databaseType === "opengauss" ? connectionStore.databaseCompatibilityMode(props.connectionId, props.database) : undefined),
  (now, before) => {
    if (now === before) return;
    executableStatementRangeCache = null;
    if (props.databaseType !== "opengauss") return;
    if (!view.value) return;
    refreshCompletionCache();
    setSemanticDiagnostics([]);
    scheduleSemanticDiagnostics(0);
  },
);

// Derive current custom theme colors from settingsStore

// Reactively apply editor settings changes. Also called after restoring a
// cached per-tab state, whose compartments predate any settings changed while
// another tab was active.
function applyEditorAppearance() {
  applyNativeAppearance();
}

watch(
  [queryEditorAppearanceSettings, () => isDark.value, () => themePalette.value, editorThemeAppearance],
  () => {
    void applyEditorAppearance();
  },
  { deep: true },
);

// Re-sync shortcut-driven keymap compartments; shared with per-tab state restore.
function applyEditorShortcutKeymaps() {
  applyNativeShortcuts();
}

watch(
  () => [settingsStore.editorSettings.shortcuts, settingsStore.editorSettings.sqlShortcuts],
  () => {
    applyEditorShortcutKeymaps();
  },
  { deep: true },
);

// Re-sync the indent compartment; shared with per-tab state restore.
function applyEditorIndentExtension() {
  applyNativeAppearance();
}

watch(
  () => [settingsStore.editorSettings.sqlFormatter.tabWidth, settingsStore.editorSettings.sqlFormatter.useTabs],
  () => {
    applyEditorIndentExtension();
  },
);

// Re-sync the completion compartment; shared with per-tab state restore.
function applyEditorCompletionExtension() {
  completionEpoch++;
  applyNativeAppearance();
}

watch(
  () => [settingsStore.editorSettings.snippets, settingsStore.editorSettings.sortCompletionColumnsAlphabetically, settingsStore.editorSettings.selectFirstCompletionOnOpen],
  () => {
    applyEditorCompletionExtension();
  },
  { deep: true },
);

watch(
  () => settingsStore.editorSettings.sqlSemanticDiagnosticsEnabled,
  (enabled) => {
    if (props.databaseType === "redis" || props.databaseType === "victoriametrics") return;
    if (!shouldSkipSqlSemanticDiagnostics() && enabled) {
      scheduleSemanticDiagnostics(0);
      return;
    }
    clearScheduledSemanticDiagnostics();
    setSemanticDiagnostics([]);
  },
);

watch(
  () => settingsStore.editorSettings.showInsertValueHints,
  () => {
    if (view.value) refreshNativeInlayHints();
  },
);

function pauseQueryEditorBackgroundWork() {
  clearNativeColumnSelection();
  const stateWasCapturedBeforeTabSwitch = tabSwitchStateCaptured;
  tabSwitchStateCaptured = false;
  // A KeepAlive-evicted editor can be unmounted after it was already
  // deactivated. Its DOM scroll position has been reset by then, so flushing
  // that inactive view would overwrite the saved viewport with zero.
  if (editorIsActive && !stateWasCapturedBeforeTabSwitch) {
    flushEditorViewport();
    flushEditorSelection();
    emit("editorStateFlushed");
  }
  clearTableNavigationHover();

  clearDeferredCompletionTrigger();
  clearScheduledPreviewContextRefresh();
  executionViewportOwnership.reset();
  editorIsActive = false;
  clearScheduledSemanticDiagnostics();
  completionEpoch++;
  unregisterTableReferenceDropListener();
}

function captureEditorStateBeforeTabSwitch(event: Event) {
  const fromTabId = (event as CustomEvent<{ fromTabId?: string }>).detail?.fromTabId;
  if (!view.value || !fromTabId || fromTabId !== props.tabId) return;
  // Capture while the outgoing editor is still visible. Once KeepAlive starts
  // deactivating the surface, WebKit can report a reset scrollTop of zero.
  flushEditorViewport();
  flushEditorSelection();
  emit("editorStateFlushed");
  tabSwitchStateCaptured = true;
}

function resumeQueryEditorBackgroundWork() {
  editorIsActive = true;
  registerTableReferenceDropListener();
  scheduleSemanticDiagnostics();
  if (view.value) schedulePreviewContextRefresh(view.value);
  restoreEditorSelection(undefined, !props.initialViewport);
  restoreEditorFocus();
  restoreEditorViewport();
}

onActivated(resumeQueryEditorBackgroundWork);

onDeactivated(pauseQueryEditorBackgroundWork);

onMounted(() => {
  if (typeof window === "undefined") return;
  window.addEventListener(BEFORE_TAB_SWITCH_EVENT, captureEditorStateBeforeTabSwitch);
});

function readEditorViewport(currentView: EditorViewType) {
  return { scrollTop: Math.max(0, currentView.getScrollTop()), scrollLeft: Math.max(0, currentView.getScrollLeft()) };
}

function sameEditorViewport(a: { scrollTop: number; scrollLeft: number } | undefined, b: { scrollTop: number; scrollLeft: number }) {
  return a?.scrollTop === b.scrollTop && a.scrollLeft === b.scrollLeft;
}

function normalizedEditorSelection(selection: { anchor: number; head: number } | undefined, docLength: number) {
  if (!selection) return undefined;
  return {
    anchor: Math.min(Math.max(0, selection.anchor), docLength),
    head: Math.min(Math.max(0, selection.head), docLength),
  };
}

function readEditorSelection(currentView: EditorViewType) {
  const selection = monacoSqlContextState(currentView).selection.main;
  return {
    anchor: selection.anchor,
    head: selection.head,
  };
}

function emitEditorSelection(selection: { anchor: number; head: number }) {
  emit("selectionStateChange", selection);
}

function flushEditorSelection() {
  if (view.value) latestSelection = readEditorSelection(view.value);
  if (latestSelection) emitEditorSelection(latestSelection);
}

function restoreEditorSelection(selection = props.initialSelection ?? latestSelection, scrollIntoView = false) {
  const normalizedSelection = normalizedEditorSelection(selection, props.modelValue.length);
  if (!view.value || !normalizedSelection) return;
  applyMonacoOffsetEdits(monaco!, view.value, { selection: normalizedSelection, scrollIntoView });
}

function restoreEditorFocus() {
  if (editorIsActive && props.autoFocus) nextTick(() => view.value?.focus());
}

function emitEditorViewport(viewport: { scrollTop: number; scrollLeft: number }) {
  if (sameEditorViewport(lastEmittedViewport, viewport)) return;
  lastEmittedViewport = { ...viewport };
  emit("viewportChange", viewport, viewportOwnerTabId);
}

function scheduleEditorViewportEmit() {
  if (!view.value || !editorIsActive) return;
  latestViewport = readEditorViewport(view.value);
  scheduleSemanticDiagnostics(700, { preserveOutsideRanges: true });
  viewportEmitTask.schedule();
}

function flushEditorViewport() {
  if (view.value) latestViewport = readEditorViewport(view.value);
  viewportEmitTask.flush();
  if (latestViewport) emitEditorViewport(latestViewport);
}

function restoreEditorViewport(viewport = props.initialViewport ?? latestViewport) {
  if (!view.value || !viewport) return;
  view.value.setScrollPosition(viewport);
}

function openSearch(): boolean {
  return runMonacoAction(view.value, "actions.find");
}

function openReplace(): boolean {
  return !props.readOnly && runMonacoAction(view.value, "editor.action.startFindReplaceAction");
}

function scrollCursorIntoView() {
  const preserve = executionViewportOwnership.consumeCompletionPreservation();
  const currentView = view.value;
  const position = currentView?.getPosition();
  if (currentView && position && editorIsActive && !preserve) currentView.revealPositionInCenterIfOutsideViewport(position);
}

function beginExecutionViewportTracking() {
  executionViewportOwnership.beginExecution();
}

function recordExecutionViewportInteraction() {
  executionViewportOwnership.recordUserInteraction();
}

function dismissHoverTooltip() {
  view.value?.trigger("dbx", "editor.action.hideHover", null);
}

function acceptGutterExecutionViewport(requestId: number) {
  return executionViewportOwnership.acceptRequest(requestId);
}

function cancelGutterExecutionViewport(requestId: number) {
  return executionViewportOwnership.cancelPendingRequest(requestId);
}

function shouldBlockExecutionShortcut(event?: KeyboardEvent, currentView: EditorViewType | null = view.value): boolean {
  return (currentView ? isEditorComposing(currentView) : false) || !!event?.isComposing || event?.keyCode === 229 || (event ? postCompositionKeyGuard.blocks(event) : false);
}

defineExpose({
  openSearch,
  openReplace,
  scrollCursorIntoView,
  beginExecutionViewportTracking,
  acceptGutterExecutionViewport,
  cancelGutterExecutionViewport,
  shouldBlockExecutionShortcut,
  requestExecute,
  requestExecuteInNewResultTab,
  requestPreviewChanges,
  captureExecutionSnapshot,
  pasteClipboardAsSqlInCondition,
  focusStatementRange,
  previewStatementRange,
  refreshCompletionCache,
});

function onNativeObjectMouseDown(event: MouseEvent) {
  clearTableNavigationHover();
  dismissHoverTooltip();
  const currentView = view.value;
  // Alt belongs to CodeMirror's rectangular and multi-cursor gestures,
  // even when Cmd/Ctrl is held at the same time.
  if (!usesQueryEditorObjectNavigationModifier(event)) {
    // Click without modifier -> close column panel
    if (!event.metaKey && !event.ctrlKey && event.button === 0) {
      emit("closeColumnPanel");
    }
    return false;
  }
  if (event.button !== 0) return false;

  if (!currentView || !props.connectionId || props.database == null) {
    return false;
  }

  // Use posAtCoords for accurate click position
  const coords = { x: event.clientX, y: event.clientY };
  const pos = monacoPositionAtCoords(currentView, coords);
  if (pos == null) {
    return false;
  }

  const doc = monacoSqlContextState(currentView).doc.toString();
  const extracted = extractIdentifierDetailsAt(doc, pos);
  if (!extracted) {
    return false;
  }
  if (!extracted.quoted && isSqlKeyword(extracted.identifier)) {
    return false;
  }
  const identifier = extracted.identifier;

  // Prevent default, resolve async
  event.preventDefault();
  setTimeout(async () => {
    try {
      // Single identity model: quote flags + role (relation column list vs routine call vs unknown).
      const identity = resolveSqlObjectNavigationIdentity(doc, pos);
      if (!identity) return;

      const identifierParts = identity.parts.map((part) => part.value);
      const tableLookupFilter = identity.name;
      const objectNameFilter = identity.name;
      // 3-part schema.package.member; 2-part stays ambiguous until metadata resolves it.
      const objectParentHint = identity.parts.length >= 3 ? identity.qualifier : undefined;
      const objectSchemaHint = identity.parts.length >= 3 ? identity.schema : identity.parts.length === 1 ? props.schema : undefined;
      const isRoutineCall = identity.role === "routine_call";
      const isRelationColumnList = identity.role === "relation_column_list";
      const relationNavigationTarget = (target: SqlObjectNavigationTarget) =>
        queryTableNavigationTargetAtSqlPosition(
          {
            connectionId: props.connectionId!,
            database: props.database!,
            schema: props.schema,
            databaseType: props.databaseType,
            sql: doc,
            position: pos,
          },
          target,
        );

      // 1. Local table cache (sync). Relation column lists always prefer tables over routines.
      if (cachedTables.length === 0) {
        cachedTables = connectionStore.lookupLocalCompletionTables(props.connectionId!, props.database!, tableLookupFilter, MAX_COMPLETION_TABLES, props.schema, props.catalog);
      }

      let matchedTable = matchTable(identifier, cachedTables);
      if (matchedTable) {
        emit("clickTable", relationNavigationTarget(matchedTable));
        return;
      }

      const preserveOracleStoreCase = (value?: string) => !!value && value !== value.toUpperCase();
      const openMatchedObject = (matchedObject: { name: string; schema?: string; type: string; signature?: string; parentName?: string; parentSchema?: string }) => {
        const navigationType = sqlObjectNavigationTypeFromCompletionObjectType(matchedObject.type);
        if (!navigationType) return false;
        // Metadata names are store-correct; mark mixed-case (or click-quoted) so Oracle normalize won't force UPPER.
        emit(
          "openObjectSource",
          sqlObjectNavigationTarget({
            name: matchedObject.name,
            schema: matchedObject.schema,
            type: navigationType,
            signature: matchedObject.signature,
            parentName: matchedObject.parentName,
            parentSchema: matchedObject.parentSchema,
            nameQuoted: identity.nameQuoted || preserveOracleStoreCase(matchedObject.name),
            schemaQuoted: matchedObject.schema ? identity.schemaQuoted || identity.qualifierQuoted || preserveOracleStoreCase(matchedObject.schema) : undefined,
            parentNameQuoted: matchedObject.parentName ? identity.qualifierQuoted || preserveOracleStoreCase(matchedObject.parentName) : undefined,
            parentSchemaQuoted: matchedObject.parentSchema ? identity.schemaQuoted || preserveOracleStoreCase(matchedObject.parentSchema) : undefined,
          }),
          false,
        );
        return true;
      };

      // 1b. Local routine cache — skip for pure relation column lists (INSERT INTO t(...)).
      if (!isRelationColumnList) {
        const localObjects = connectionStore.lookupLocalCompletionObjects(props.connectionId!, props.database!, objectNameFilter, MAX_COMPLETION_TABLES, props.schema);
        let matchedObject = matchSqlObject(identifier, localObjects);
        if (matchedObject && openMatchedObject(matchedObject)) return;

        if (!usesLocalOnlyCompletionMetadata()) {
          // Disambiguate schema.routine vs package.member with small scoped lookups (no global scan).
          if (identity.parts.length === 2 && identity.qualifier) {
            // Prefer package.member under session schema (Oracle common: PKG.MEMBER()).
            const packageObjects = await connectionStore.listCompletionObjects(props.connectionId!, props.database!, objectNameFilter, 20, props.schema, identity.qualifier, false, props.schema, ["routine"]);
            matchedObject = matchSqlObject(identifier, packageObjects);
            if (matchedObject && openMatchedObject(matchedObject)) return;

            // Then schema.routine with qualifier as owner.
            const schemaObjects = await connectionStore.listCompletionObjects(props.connectionId!, props.database!, objectNameFilter, 20, identity.qualifier, undefined, false, props.schema, ["routine"]);
            matchedObject = matchSqlObject(identifier, schemaObjects);
            if (matchedObject && openMatchedObject(matchedObject)) return;
          } else {
            const scopedObjects = await connectionStore.listCompletionObjects(props.connectionId!, props.database!, objectNameFilter, 20, objectSchemaHint, objectParentHint, false, props.schema, ["routine"]);
            matchedObject = matchSqlObject(identifier, scopedObjects);
            if (matchedObject && openMatchedObject(matchedObject)) return;
          }
        }
      }

      // 1c. Remote table metadata — never skip for relation column lists or unknown identifiers.
      // Routine-call sites may still hit this when a table and procedure share a name and
      // local caches were empty; table wins only if listed as a relation.
      if (!usesLocalOnlyCompletionMetadata() && (!isRoutineCall || isRelationColumnList || identity.role === "unknown")) {
        cachedTables = await connectionStore.listCompletionTables(props.connectionId!, props.database!, tableLookupFilter, MAX_COMPLETION_TABLES, props.schema, false, props.schema, props.catalog);
        matchedTable = matchTable(identifier, cachedTables);
        if (matchedTable) {
          emit("clickTable", relationNavigationTarget(matchedTable));
          return;
        }
      } else if (!usesLocalOnlyCompletionMetadata() && isRoutineCall) {
        // Lightweight table check so INSERT INTO ORDERS(…) is not the only guarded path —
        // still avoid global scans: only session-scoped prefix lookup.
        cachedTables = await connectionStore.listCompletionTables(props.connectionId!, props.database!, tableLookupFilter, 20, props.schema, false, props.schema, props.catalog);
        matchedTable = matchTable(identifier, cachedTables);
        if (matchedTable) {
          emit("clickTable", relationNavigationTarget(matchedTable));
          return;
        }
      }

      // 1d. Optimistic routine open only for confirmed call sites after metadata + table checks.
      if (isRoutineCall) {
        const optimistic = sqlObjectNavigationTargetFromIdentity(identity, {
          fallbackSchema: props.schema,
          preferType: "procedure",
          // 2-part: package.member under session schema (not schema.routine).
          asPackageMember: identity.twoPartAmbiguous,
        });
        if (optimistic) {
          emit("openObjectSource", optimistic, false);
          return;
        }
      }

      // 2. Parse SQL at click position to get referenced tables
      const context = getSqlCompletionContext(doc, pos);
      let referencedTables: Array<SqlCompletionReferencedTable & Pick<SqlCompletionTable, "type">> = context.referencedTables;
      // Enrich referenced tables with schema from cachedTables
      referencedTables = referencedTables.map((rt) => {
        if (usesOracleSessionCompletionColumns(rt.schema)) return rt;
        const cached = cachedTables.find((ct) => ct.name.toLowerCase() === rt.name.toLowerCase() && (!rt.schema || !ct.schema || ct.schema.toLowerCase() === rt.schema.toLowerCase()));
        if (!cached) return rt;
        return {
          ...rt,
          ...(!rt.schema && cached.schema ? { schema: cached.schema } : {}),
          ...(cached.type ? { type: cached.type } : {}),
        };
      });

      // Check if identifier has a qualifier (e.g., c.card_name or schema.table)
      const qualifier = identifierParts.length >= 2 ? identifierParts[identifierParts.length - 2] : null;

      const matchedRef = matchTable(identifier, referencedTables);
      if (matchedRef) {
        emit("clickTable", relationNavigationTarget(matchedRef));
        return;
      }
      const colName = identifierParts[identifierParts.length - 1] ?? identifier;
      const colLower = colName.toLowerCase();

      if (referencedTables.length === 0) {
        return;
      }
      // 3. Fetch columns — if qualifier, only check matching table; otherwise check all
      const tablesToCheck = qualifier ? referencedTables.filter((rt) => rt.alias?.toLowerCase() === qualifier.toLowerCase() || rt.name.toLowerCase() === qualifier.toLowerCase()) : referencedTables;

      if (tablesToCheck.length === 0 && qualifier) {
        return;
      }

      const matchedCols: Array<{
        name: string;
        table: string;
        schema?: string;
      }> = [];

      for (const refTable of tablesToCheck) {
        const cacheKey = completionCacheKey(refTable);

        // Use persistent column cache; fetch only if missing
        let cols = cachedColumnsByTable.get(cacheKey);
        if (!cols) {
          try {
            const target = completionMetadataTarget(refTable);
            if (!target) continue;
            cols = await listCompletionColumnsForEditor(props.connectionId!, target.database, refTable.name, target.schema, target.catalog, refTable);
            cachedColumnsByTable.set(cacheKey, cols);
          } catch {
            continue;
          }
        }
        for (const col of cols) {
          if (col.name.toLowerCase() === colLower) {
            matchedCols.push({
              name: col.name,
              table: refTable.name,
              schema: col.schema || refTable.schema,
            });
          }
        }
      }

      if (matchedCols.length > 0) {
        emit("clickColumn", matchedCols);
      }
    } catch (e) {
      console.error("[DBX] Ctrl+click error:", e);
    }
  }, 0);
  return true;
}

let monaco: Monaco | null = null;
let sqlGrammar: typeof import("@codemirror/lang-sql") | null = null;
let nativeDestroyed = false;
let nativeModelChangeSuppressed = false;
let nativeContextEpoch = 0;
const nativeAppearance = useMonacoAppearance();
const nativeDisposables: IDisposable[] = [];
let nativeShortcuts: IDisposable[] = [];
const nativeModels = new Map<string | undefined, { model: editor.ITextModel; parser: IDisposable; changeListener: IDisposable; state: editor.ICodeEditorViewState | null }>();
const nativeRangeDecorations = new Map<string, editor.IEditorDecorationsCollection>();
let nativeGutterDecorations: editor.IEditorDecorationsCollection | null = null;
let nativeStatementDecoration: editor.IEditorDecorationsCollection | null = null;
let nativeSemanticDecorations: editor.IEditorDecorationsCollection | null = null;
let nativeSemanticWindowKey = "";
let nativeKeyEvent: KeyboardEvent | undefined;
const nativeInlayListeners = new Set<() => void>();
const nativeVimStatus = ref<HTMLElement>();
let nativeVim: ReturnType<typeof createMonacoVimController> | null = null;

function reportNativeVimError(error: unknown) {
  console.error("[DBX] Monaco Vim initialization failed", error);
  toast(`Vim: ${String(error)}`, 5000);
}
const nativeColumnPicker = shallowRef<{ selection: MonacoColumnSelection; candidates: MonacoCompletionCandidate[]; model: editor.ITextModel; version: number; epoch: number } | null>(null);
const nativeColumnPickerComponent = ref<InstanceType<typeof MonacoColumnPicker>>();
const nativeColumnWidgetHost = shallowRef<HTMLElement>();
let nativeColumnWidget: editor.IContentWidget | null = null;
let nativeColumnFrame = 0;

function layoutNativeColumnPicker() {
  if (nativeColumnWidget) view.value?.layoutContentWidget(nativeColumnWidget);
}

function clearNativeColumnSelection() {
  cancelAnimationFrame(nativeColumnFrame);
  nativeColumnFrame = 0;
  nativeColumnPicker.value = null;
  layoutNativeColumnPicker();
}

function closeNativeColumnPicker() {
  clearNativeColumnSelection();
  focusEditor();
}

function currentNativeColumnRequest() {
  const request = nativeColumnPicker.value;
  const instance = view.value;
  if (!request || !instance || props.readOnly || instance.getModel() !== request.model || request.model.getVersionId() !== request.version || request.epoch !== nativeContextEpoch) {
    clearNativeColumnSelection();
    return null;
  }
  return request;
}

function acceptNativeColumnCandidate(candidate: MonacoCompletionCandidate) {
  const request = currentNativeColumnRequest();
  const instance = view.value;
  if (!request || !instance) return;
  const completion = createMonacoSqlCompletion(monaco!, request.model, candidate, { from: request.selection.from, to: request.selection.to, index: 0, insertSpace: shouldInsertSqlCompletionSpace() && settingsStore.editorSettings.insertSpaceAfterCompletion });
  const range = completion.range as editor.IIdentifiedSingleEditOperation["range"];
  clearNativeColumnSelection();
  if (completion.insertTextRules === monaco!.languages.CompletionItemInsertTextRule.InsertAsSnippet) {
    if (!insertMonacoSnippet(instance, range, completion.insertText)) return;
  } else {
    const from = request.model.getOffsetAt({ lineNumber: range.startLineNumber, column: range.startColumn });
    const to = request.model.getOffsetAt({ lineNumber: range.endLineNumber, column: range.endColumn });
    applyMonacoOffsetEdits(monaco!, instance, { changes: { from, to, insert: completion.insertText }, selection: { anchor: from + completion.insertText.length }, scrollIntoView: true });
  }
  recordCompletionSelection(candidate.label, candidate.type);
  activeCompletionOrigin = null;
  instance.focus();
  if (shouldChainSqlCompletionAfterAccept(candidate)) scheduleSqlCompletionStart(instance);
}

function confirmNativeColumnSelection(keys: string[]) {
  const request = currentNativeColumnRequest();
  const instance = view.value;
  if (!request || !instance) return;
  const insertion = buildMonacoColumnInsertion(request.selection, keys, settingsStore.editorSettings.sqlFormatter.keywordCase === "lower" ? "values" : "VALUES");
  if (!insertion) return;
  clearNativeColumnSelection();
  if (insertion.monacoSnippet === undefined) {
    applyMonacoOffsetEdits(monaco!, instance, { changes: { from: insertion.from, to: insertion.to, insert: insertion.text }, selection: { anchor: insertion.from + insertion.text.length }, scrollIntoView: true });
    focusEditor();
    return;
  }
  insertMonacoSnippet(instance, monacoRangeFromOffsets(request.model, insertion.from, insertion.to), insertion.monacoSnippet);
}

function escapeMonacoMarkdown(value: string) {
  return value.replace(/[\\`*_{}[\]()#+.!<>|~-]/g, "\\$&");
}

function monacoSqlCodeBlock(value: string) {
  const fence = "`".repeat(Array.from(value.matchAll(/`+/g)).reduce((length, match) => Math.max(length, match[0].length + 1), 3));
  return `${fence}sql\n${value}\n${fence}`;
}

function nativeLanguage() {
  if (props.databaseType === "mongodb") return "javascript";
  if (props.databaseType === "redis") return "redis";
  return props.dialect === "postgres" ? "pgsql" : props.dialect === "mysql" ? "mysql" : "sql";
}

function queryEditorSelectionLanguage(): "sql" | "text" {
  return ["redis", "mongodb", "elasticsearch", "easysearch", "meilisearch", "victoriametrics"].includes(props.databaseType ?? "") ? "text" : "sql";
}

function listenToNativeModel(model: editor.ITextModel) {
  return model.onDidChangeContent(() => {
    if (view.value?.getModel() === model) onNativeModelContentChanged();
  });
}

function nativeParserExtension() {
  return sqlGrammar ? [sqlGrammar.sql({ dialect: createDbxCodeMirrorSqlDialect(sqlGrammar, props.syntaxDialect ?? props.dialect, props.databaseType, sqlDriverProfile.value) }).language, createSqlBlockFoldService(props.databaseType)] : [];
}

function acquireNativeModel(tabId: string | undefined, value: string) {
  let entry = nativeModels.get(tabId);
  if (entry) {
    nativeModels.delete(tabId);
    nativeModels.set(tabId, entry);
    replaceMonacoModelValue(entry.model, value);
    return entry;
  }
  const model = createMonacoModel(monaco!, value, nativeLanguage(), "query");
  entry = { model, parser: attachMonacoSqlContext(model, nativeParserExtension()), changeListener: listenToNativeModel(model), state: null };
  nativeModels.set(tabId, entry);
  return entry;
}

function activateNativeDocument(prevTabId: string | undefined, tabId: string | undefined, value: string) {
  const instance = view.value;
  if (!instance || !monaco) return;
  clearNativeColumnSelection();
  if (!tabSwitchStateCaptured) {
    flushEditorViewport();
    flushEditorSelection();
  }
  const previous = nativeModels.get(prevTabId);
  if (previous) previous.state = instance.saveViewState();
  nativeContextEpoch++;
  completionEpoch++;
  clearDeferredCompletionTrigger();
  clearScheduledPreviewContextRefresh();
  activeCompletionOrigin = null;
  viewportOwnerTabId = tabId;
  tabSwitchStateCaptured = false;
  latestViewport = props.initialViewport ?? { scrollTop: 0, scrollLeft: 0 };
  latestSelection = props.initialSelection ?? { anchor: 0, head: 0 };
  lastEmittedViewport = undefined;
  nativeModelChangeSuppressed = true;
  try {
    const entry = acquireNativeModel(tabId, value);
    instance.setModel(entry.model);
    void nativeVim?.reset().catch(reportNativeVimError);
    if (entry.state) instance.restoreViewState(entry.state);
    else restoreEditorSelection(latestSelection, !props.initialViewport);
    if (!entry.state || props.initialViewport) restoreEditorViewport(latestViewport);
    for (const decoration of nativeRangeDecorations.values()) decoration.clear();
    while (nativeModels.size > 16) {
      const oldest = nativeModels.keys().next().value;
      const evicted = nativeModels.get(oldest)!;
      evicted.changeListener.dispose();
      evicted.parser.dispose();
      evicted.model.dispose();
      nativeModels.delete(oldest);
    }
  } finally {
    nativeModelChangeSuppressed = false;
  }
  executableStatementRangeCache = null;
  refreshCompletionCache();
  setSemanticDiagnostics([]);
  applyNativeAppearance();
  syncContextMenuState(instance);
  syncNativeSelection();
  refreshNativeGutter();
  emit("previewChangesAvailable", !!previewContextSql.value);
  scheduleSemanticDiagnostics();
}

function setNativeRangeDecoration(kind: string, range: { from: number; to: number } | null) {
  const instance = view.value;
  const model = instance?.getModel();
  if (!instance || !model) return;
  let collection = nativeRangeDecorations.get(kind);
  if (!collection) {
    collection = instance.createDecorationsCollection();
    nativeRangeDecorations.set(kind, collection);
  }
  collection.set(range ? [{ range: monacoRangeFromOffsets(model, range.from, range.to), options: { className: kind === "preview" ? "dbx-monaco-preview" : "dbx-monaco-result", isWholeLine: false } }] : []);
}

function applyNativeAppearance() {
  const instance = view.value;
  if (!instance || !monaco) return;
  const settings = settingsStore.editorSettings;
  if (!isGestureZooming.value && !zoomCommitScheduler.hasPendingCommit()) liveFontSize.value = settings.fontSize;
  applyMonacoTheme(monaco, nativeAppearance.theme.value);
  instance.updateOptions({
    ...nativeAppearance.options.value,
    fontSize: liveFontSize.value,
    readOnly: !!props.readOnly,
    wordWrap: props.forceWordWrap || settings.wordWrap ? "on" : "off",
    lineNumbers: settings.showLineNumbers ? "on" : "off",
    glyphMargin: !props.hideExecutionControls && settings.showStatementRunButtons,
    quickSuggestions: settings.completionTriggerMode === "manual" ? false : { other: "on", comments: "off", strings: "on" },
    quickSuggestionsDelay: COMPLETION_DEBOUNCE_DELAY_MS,
    suggestOnTriggerCharacters: settings.completionTriggerMode !== "manual",
    suggest: { selectionMode: settings.selectFirstCompletionOnOpen ? "always" : "never", showWords: false },
    wordBasedSuggestions: "off",
    tabCompletion: "off",
    tabSize: settings.sqlFormatter.tabWidth,
    insertSpaces: !settings.sqlFormatter.useTabs,
    parameterHints: { enabled: true },
  });
  instance.getModel()?.updateOptions({ tabSize: settings.sqlFormatter.tabWidth, insertSpaces: !settings.sqlFormatter.useTabs });
  syncEditorFontCssVars(liveFontSize.value, settings.fontFamily);
  syncEditorDiagnosticCssVars();
  const tableColor = nativeAppearance.theme.value.rules.find((rule) => rule.token === "table")?.foreground;
  if (tableColor) editorRef.value?.style.setProperty("--dbx-monaco-table-color", `#${tableColor.replace(/^#/, "")}`);
  refreshNativeGutter();
}

function applyNativeShortcuts() {
  for (const disposable of nativeShortcuts) disposable.dispose();
  nativeShortcuts = [];
  const instance = view.value;
  if (!instance || !monaco) return;
  const shortcuts = normalizeShortcutSettings(settingsStore.editorSettings.shortcuts);
  const bind = (name: string, shortcut: string, run: () => unknown, precondition = "editorTextFocus") => {
    const keybinding = shortcutToMonacoKeybinding(monaco!, shortcut);
    if (keybinding === undefined) return;
    nativeShortcuts.push(
      instance.addAction({
        id: `dbx.${name}`,
        label: name,
        keybindings: [keybinding],
        precondition,
        run: () => {
          if (!shouldBlockExecutionShortcut(nativeKeyEvent)) void run();
        },
      }),
    );
  };
  const commands: Partial<Record<keyof typeof shortcuts, string>> = {
    indentMore: "editor.action.indentLines",
    indentLess: "editor.action.outdentLines",
    insertLineBelow: "editor.action.insertLineAfter",
    joinLines: "editor.action.joinLines",
    duplicateLine: "editor.action.copyLinesDownAction",
    deleteLine: "editor.action.deleteLines",
    moveLineUp: "editor.action.moveLinesUpAction",
    moveLineDown: "editor.action.moveLinesDownAction",
    copyLineUp: "editor.action.copyLinesUpAction",
    copyLineDown: "editor.action.copyLinesDownAction",
    undo: "undo",
    redo: "redo",
    selectAll: "editor.action.selectAll",
    extendSelection: "editor.action.smartSelect.expand",
    addNextSelectionOccurrence: "editor.action.addSelectionToNextFindMatch",
    selectAllSelectionOccurrences: "editor.action.selectHighlights",
    toggleLineComment: "editor.action.commentLine",
    toggleBlockComment: "editor.action.blockComment",
    toggleFold: "editor.toggleFold",
  };
  for (const [name, command] of Object.entries(commands)) bind(name, shortcuts[name as keyof typeof shortcuts], () => instance.trigger("dbx", command!, null));
  if (!props.hideExecutionControls) {
    bind("executeSql", shortcuts.executeSql, () => requestExecute({ bypassPicker: true }));
    bind("executeSqlInNewResultTab", shortcuts.executeSqlInNewResultTab, requestExecuteInNewResultTab);
  }
  if (props.enableExplainShortcut)
    bind("explainSql", shortcuts.explainSql, () => {
      if (props.canExplain) emit("explain");
    });
  bind("saveSql", shortcuts.saveSql, () => emit("save"));
  bind("formatSql", shortcuts.formatSql, formatCurrentSql);
  bind("replace", shortcuts.replace, openReplace);
  bind("expandSelectStar", shortcuts.expandSelectStar, () => expandSelectStar(selectStarExpansionTargetForView(instance)));
  bind("uppercaseSelection", shortcuts.uppercaseSelection, () => convertSelectedSqlCase("upper"));
  bind("lowercaseSelection", shortcuts.lowercaseSelection, () => convertSelectedSqlCase("lower"));
  bind("convertNamingStyle", shortcuts.convertNamingStyle, convertSelectedNamingStyle);
  bind("exPasteSqlInCondition", shortcuts.exPasteSqlInCondition, pasteClipboardAsSqlInCondition);
  bind("sqlIntentionActions", shortcuts.sqlIntentionActions, () => handleSqlIntentionActions(instance));
  bind("sendSelectionToAi", shortcuts.sendSelectionToAi, () => {
    const sql = selectedSqlFromView(instance);
    if (sql.trim()) emit("sendSelectionToAi", sql);
  });
  bind("triggerCompletion", shortcuts.triggerCompletion, () => triggerSqlCompletion(instance));
  bind("nativeTriggerCompletion", "Ctrl+Space", () => triggerSqlCompletion(instance));
  bind("acceptCompletion", shortcuts.acceptCompletion, () => instance.trigger("dbx", "acceptSelectedSuggestion", null), "editorTextFocus && suggestWidgetVisible && suggestWidgetHasFocusedSuggestion");
  for (const action of enabledSqlShortcutActions(settingsStore.editorSettings.sqlShortcuts)) bind(`sqlShortcut.${action.id}`, action.shortcut, () => runSqlShortcutAction(action, instance));
}

function onNativeModelContentChanged() {
  const instance = view.value;
  if (!instance || nativeModelChangeSuppressed) return;
  if (nativeColumnPicker.value) {
    clearNativeColumnSelection();
    scheduleSqlCompletionStart(instance);
  }
  if (isEditorComposing(instance)) pendingImeModelEmit = true;
  else emitModelValue(instance);
  invalidateSemanticDiagnosticsForDocumentChange();
  scheduleSemanticDiagnostics();
  syncNativeSelection();
  refreshNativeGutter();
}

function syncNativeSelection() {
  const instance = view.value;
  if (!instance || nativeModelChangeSuppressed) return;
  syncEditorSelectionState(instance);
  schedulePreviewContextRefresh(instance);
  emit("selectionChange", selectedSql.value);
  emit("cursorChange", monacoSqlContextState(instance).selection.main.head);
  latestSelection = readEditorSelection(instance);
  if (editorIsActive) emitEditorSelection(latestSelection);
  refreshNativeStatementFrame();
}

function refreshNativeStatementFrame() {
  const instance = view.value;
  const model = instance?.getModel();
  if (!instance || !model || !nativeStatementDecoration) return;
  const state = monacoSqlContextState(instance);
  executableStatementRangeCache = executableStatementRangeCacheForDoc(executableStatementRangeCache, state.doc, props.databaseType, sqlStatementParameterOptions());
  const range = settingsStore.editorSettings.showCurrentStatementFrame && state.selection.main.empty ? executableStatementRangeAtCursor(executableStatementRangeCache, state.selection.main.head) : null;
  nativeStatementDecoration.set(range ? [{ range: monacoRangeFromOffsets(model, range.from, range.to), options: { blockClassName: "dbx-monaco-statement-frame", blockPadding: [0, 0, 0, 0] } }] : []);
}

function refreshNativeGutter() {
  const instance = view.value;
  const model = instance?.getModel();
  if (!instance || !model || !nativeGutterDecorations || !monaco) return;
  const decorations: editor.IModelDeltaDecoration[] = [];
  if (!props.hideExecutionControls && settingsStore.editorSettings.showStatementRunButtons) {
    const state = monacoSqlContextState(instance);
    for (const visible of instance.getVisibleRanges()) {
      for (let lineNumber = visible.startLineNumber; lineNumber <= visible.endLineNumber; lineNumber++) {
        const line = state.doc.line(lineNumber);
        if (executableStatementRangeStartingAt(instance, line.from)) decorations.push({ range: new monaco.Range(lineNumber, 1, lineNumber, 1), options: { glyphMarginClassName: "dbx-monaco-run-statement", glyphMarginHoverMessage: { value: t("editor.contextMenu.executeCurrent") } } });
      }
    }
  }
  for (const marker of props.statementExecutionMarkers ?? []) {
    const position = model.getPositionAt(marker.from);
    decorations.push({
      range: new monaco.Range(position.lineNumber, 1, position.lineNumber, 1),
      options: { glyphMarginClassName: `dbx-monaco-statement-${marker.status}`, glyphMargin: { position: monaco.editor.GlyphMarginLane.Right }, glyphMarginHoverMessage: { value: `${marker.status}: ${marker.successCount} / ${marker.errorCount}` } },
    });
  }
  nativeGutterDecorations.set(decorations);
  if (!nativeSemanticDecorations) return;
  const ranges = monacoVisibleOffsetRanges(instance);
  const key = `${model.uri}:${model.getVersionId()}:${ranges.map((range) => `${range.from}-${range.to}`).join(",")}:${nativeContextEpoch}`;
  if (key === nativeSemanticWindowKey) return;
  nativeSemanticWindowKey = key;
  const state = monacoSqlContextState(instance);
  const sql = currentEditorDocText(instance);
  const spans = queryEditorSelectionLanguage() === "sql" ? ranges.flatMap((range) => sqlSemanticTableNameSpansForSyntaxTree(sql, expandToSqlStatementWindow(sql, range.from, range.to), syntaxTree(state), sqlCompletionDialectOptions())) : [];
  nativeSemanticDecorations.set(spans.map((span) => ({ range: monacoRangeFromOffsets(model, span.start, span.end), options: { inlineClassName: "dbx-monaco-table-name" } })));
}

function refreshNativeInlayHints() {
  for (const listener of nativeInlayListeners) listener();
}

function registerNativeLanguageProviders() {
  const runtime = monaco!;
  const selector = ["sql", "mysql", "pgsql", "javascript", "redis"];
  const owns = (model: editor.ITextModel) => !nativeDestroyed && editorIsActive && view.value?.getModel() === model;
  const completionCommand = `dbx.acceptCompletion.${view.value!.getId()}`;
  nativeDisposables.push(
    runtime.editor.registerCommand(completionCommand, (_accessor, item: MonacoCompletionCandidate, uri: string) => {
      const instance = view.value;
      if (!instance || instance.getModel()?.uri.toString() !== uri) return;
      recordCompletionSelection(item.label, item.type);
      activeCompletionOrigin = null;
      if (shouldChainSqlCompletionAfterAccept(item)) scheduleSqlCompletionStart(instance);
    }),
  );
  nativeDisposables.push(
    runtime.languages.registerFoldingRangeProvider(["sql", "mysql", "pgsql"], {
      provideFoldingRanges(model, _context, token) {
        if (!owns(model)) return null;
        const state = monacoSqlContextState(view.value!);
        const ranges = [];
        for (let lineNumber = 1; lineNumber <= state.doc.lines; lineNumber++) {
          if (token.isCancellationRequested) return null;
          const line = state.doc.line(lineNumber);
          const folded = foldable(state, line.from, line.to);
          if (folded) ranges.push({ start: lineNumber, end: state.doc.lineAt(folded.to).number });
        }
        return ranges;
      },
    }),
  );
  nativeDisposables.push(
    runtime.languages.registerCompletionItemProvider(selector, {
      triggerCharacters: [".", " ", '"', "`", "[", "@"],
      async provideCompletionItems(model, position, context, token) {
        const instance = view.value;
        if (!instance || !owns(model) || isEditorComposing(instance)) return null;
        const epoch = nativeContextEpoch;
        const version = model.getVersionId();
        const abortListeners: IDisposable[] = [];
        try {
          const result = await provideSqlCompletions({
            state: monacoSqlContextState(instance),
            pos: model.getOffsetAt(position),
            explicit: context.triggerKind === runtime.languages.CompletionTriggerKind.Invoke && activeCompletionOrigin !== "typing",
            addEventListener: (_event, callback) => {
              abortListeners.push(token.onCancellationRequested(callback));
            },
          });
          if (!result || token.isCancellationRequested || !owns(model) || version !== model.getVersionId() || epoch !== nativeContextEpoch) return null;
          const candidates = [...result.options].sort((left, right) => (right.boost ?? 0) - (left.boost ?? 0) || compareSqlCompletions(left, right, settingsStore.editorSettings.sortCompletionColumnsAlphabetically));
          const to = "to" in result && typeof result.to === "number" ? result.to : model.getOffsetAt(position);
          const columnSelection = props.readOnly ? null : createMonacoColumnSelection(result.options, model.getValue(), result.from, to);
          if (columnSelection) {
            nativeColumnPicker.value = { selection: columnSelection, candidates, model, version, epoch };
            void nextTick(layoutNativeColumnPicker);
            cancelAnimationFrame(nativeColumnFrame);
            nativeColumnFrame = requestAnimationFrame(() => {
              nativeColumnFrame = 0;
              if (!nativeColumnPicker.value || !owns(model) || version !== model.getVersionId()) return;
              instance.trigger("dbx", "hideSuggestWidget", null);
              layoutNativeColumnPicker();
            });
            return { suggestions: [] };
          }
          clearNativeColumnSelection();
          return {
            incomplete: true,
            suggestions: candidates.map((item, index) =>
              createMonacoSqlCompletion(runtime, model, item, {
                from: result.from,
                to,
                index,
                insertSpace: shouldInsertSqlCompletionSpace() && settingsStore.editorSettings.insertSpaceAfterCompletion,
                command: { id: completionCommand, title: "Accept DBX completion", arguments: [item, model.uri.toString()] },
              }),
            ),
          };
        } finally {
          for (const listener of abortListeners) listener.dispose();
        }
      },
    }),
  );
  nativeDisposables.push(
    runtime.languages.registerHoverProvider(selector, {
      async provideHover(model, position, token) {
        if (!owns(model)) return null;
        const epoch = nativeContextEpoch;
        const version = model.getVersionId();
        const tooltip = await resolveSqlHoverTooltip(view.value!, model.getOffsetAt(position));
        if (!tooltip || token.isCancellationRequested || !owns(model) || version !== model.getVersionId() || epoch !== nativeContextEpoch) return null;
        return { range: monacoRangeFromOffsets(model, tooltip.pos, tooltip.end ?? tooltip.pos), contents: tooltip.create() };
      },
    }),
  );
  nativeDisposables.push(
    runtime.languages.registerSignatureHelpProvider(selector, {
      signatureHelpTriggerCharacters: ["(", ","],
      signatureHelpRetriggerCharacters: [")"],
      provideSignatureHelp(model, position) {
        if (!owns(model)) return null;
        const signature = getSqlFunctionSignatureHelp(model.getValue(), model.getOffsetAt(position), props.databaseType, sqlDriverProfile.value);
        if (!signature) return null;
        return {
          value: {
            activeSignature: signature.activeOverload,
            activeParameter: signature.overloads[signature.activeOverload]?.activeParameter ?? 0,
            signatures: signature.overloads.map((overload) => ({ label: overload.signature, parameters: overload.parameterGroups.flat().map((label) => ({ label })), activeParameter: overload.activeParameter })),
          },
          dispose() {},
        };
      },
    }),
  );
  nativeDisposables.push(
    runtime.languages.registerInlayHintsProvider(selector, {
      onDidChangeInlayHints: (listener) => {
        nativeInlayListeners.add(listener);
        return { dispose: () => nativeInlayListeners.delete(listener) };
      },
      provideInlayHints(model, range) {
        if (!owns(model) || !settingsStore.editorSettings.showInsertValueHints || !supportsInsertValueHints(props.databaseType)) return { hints: [], dispose() {} };
        const sql = model.getValue();
        const window = expandToSqlStatementWindow(sql, model.getOffsetAt(range.getStartPosition()), model.getOffsetAt(range.getEndPosition()));
        const hints = parseInsertValueHintsInRanges(sql, [window], {
          resolveTableColumns: (table, schema, database) => {
            const columns = getInsertValueHintTableColumns(table, schema, database);
            if (!columns) requestInsertValueHintTableColumns(table, schema, database);
            return columns;
          },
        });
        return { hints: hints.map((hint) => ({ position: model.getPositionAt(hint.from), label: `${hint.column}:`, kind: runtime.languages.InlayHintKind.Parameter, paddingRight: true })), dispose() {} };
      },
    }),
  );
}

onMounted(async () => {
  const [runtime, grammar] = await Promise.all([loadMonaco(), import("@codemirror/lang-sql")]);
  if (nativeDestroyed || !editorRef.value) return;
  monaco = runtime;
  sqlGrammar = grammar;
  const entry = acquireNativeModel(props.tabId, props.modelValue);
  const instance = runtime.editor.create(editorRef.value, {
    model: entry.model,
    automaticLayout: true,
    minimap: { enabled: false },
    contextmenu: false,
    scrollBeyondLastLine: false,
    fixedOverflowWidgets: true,
    padding: { top: 6, bottom: 6 },
    theme: applyMonacoTheme(runtime, nativeAppearance.theme.value),
  });
  view.value = instance;
  const columnWidgetHost = document.createElement("div");
  nativeColumnWidgetHost.value = columnWidgetHost;
  nativeColumnWidget = {
    getId: () => `dbx.columns.${instance.getId()}`,
    getDomNode: () => columnWidgetHost,
    allowEditorOverflow: true,
    suppressMouseDown: true,
    getPosition: () => (nativeColumnPicker.value ? { position: nativeColumnPicker.value.model.getPositionAt(nativeColumnPicker.value.selection.from), preference: [runtime.editor.ContentWidgetPositionPreference.BELOW, runtime.editor.ContentWidgetPositionPreference.ABOVE] } : null),
  };
  instance.addContentWidget(nativeColumnWidget);
  nativeDisposables.push({
    dispose: () => {
      if (nativeColumnWidget) instance.removeContentWidget(nativeColumnWidget);
      nativeColumnWidget = null;
      nativeColumnWidgetHost.value = undefined;
    },
  });
  nativeGutterDecorations = instance.createDecorationsCollection();
  nativeStatementDecoration = instance.createDecorationsCollection();
  nativeSemanticDecorations = instance.createDecorationsCollection();
  nativeDisposables.push(
    instance.onDidChangeCursorSelection(() => {
      const request = nativeColumnPicker.value;
      if (request && (instance.getSelection()?.isEmpty() !== true || (instance.getPosition() && request.model.getOffsetAt(instance.getPosition()!) !== request.selection.to))) clearNativeColumnSelection();
      queueMicrotask(() => {
        if (!nativeDestroyed) syncNativeSelection();
      });
    }),
    instance.onDidScrollChange(() => {
      contextMenuOpen.value = false;
      scheduleEditorViewportEmit();
      refreshNativeGutter();
    }),
    instance.onDidCompositionStart(() => {
      imeCompositionActive = true;
      clearNativeColumnSelection();
    }),
    instance.onDidCompositionEnd(() => {
      imeCompositionActive = false;
      flushImeComposition();
    }),
    instance.onKeyDown((event) => {
      if (!event.ctrlKey && !event.metaKey && event.browserEvent.key.length === 1) activeCompletionOrigin = "typing";
    }),
    instance.onDidBlurEditorText(() => {
      activeCompletionOrigin = null;
      clearNativeColumnSelection();
    }),
    instance.onMouseDown((event) => {
      if (event.target.type === runtime.editor.MouseTargetType.GUTTER_GLYPH_MARGIN && event.target.position) {
        executeSqlStatementFromGutter(instance, monacoSqlContextState(instance).doc.line(event.target.position.lineNumber), event.event.browserEvent);
      }
    }),
  );
  const container = instance.getContainerDomNode();
  postCompositionKeyGuardCleanup = postCompositionKeyGuard.attach(container);
  const listen = <Name extends keyof HTMLElementEventMap>(name: Name, listener: (event: HTMLElementEventMap[Name]) => void, options?: AddEventListenerOptions) => {
    container.addEventListener(name, listener, options);
    nativeDisposables.push({ dispose: () => container.removeEventListener(name, listener, options) });
  };
  listen("mousedown", onNativeObjectMouseDown);
  listen(
    "keydown",
    (event) => {
      nativeKeyEvent = event;
      if (nativeColumnPicker.value && !isEditorComposing(instance) && nativeColumnPickerComponent.value?.onKeyDown(event)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      queueMicrotask(() => {
        if (nativeKeyEvent === event) nativeKeyEvent = undefined;
      });
    },
    { capture: true },
  );
  listen("mousemove", (event) => updateTableNavigationHover(instance, event));
  listen("mouseleave", clearTableNavigationHover);
  listen("drop", (event) => {
    hideQueryEditorDropCaret();
    insertDroppedTableReference(instance, event);
  });
  listen("dragover", (event) => {
    if (!props.readOnly && hasDroppedTableReference(event)) {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      showQueryEditorDropCaretAt(event.clientX, event.clientY);
    }
  });
  listen("dragleave", hideQueryEditorDropCaret);
  listen(
    "wheel",
    (event) => {
      if (wheelZoomGestureGuard.accepts(event)) {
        event.preventDefault();
        const size = fontSizeFromWheelDelta(liveFontSize.value, event.deltaY);
        applyLiveFontSize(size);
        scheduleFontSizeCommit(size);
      }
    },
    { passive: false, capture: true },
  );
  registerNativeLanguageProviders();
  applyNativeAppearance();
  applyNativeShortcuts();
  if (nativeVimStatus.value) {
    nativeVim = createMonacoVimController(instance, nativeVimStatus.value, () => emit("save"));
    void nativeVim.setEnabled(settingsStore.editorSettings.vimModeEnabled).catch(reportNativeVimError);
  }
  restoreEditorSelection(props.initialSelection, !props.initialViewport);
  restoreEditorViewport();
  syncContextMenuState(instance);
  syncNativeSelection();
  registerTableReferenceDropListener();
  scheduleSemanticDiagnostics();
  restoreEditorFocus();
});

watch([() => props.databaseType, () => props.dialect, () => props.syntaxDialect, sqlDriverProfile, () => props.connectionId, () => props.database, () => props.schema, () => props.catalog, () => props.clientSessionId, () => props.completionContextVersion], () => {
  clearNativeColumnSelection();
  nativeContextEpoch++;
  completionEpoch++;
  executableStatementRangeCache = null;
  const entry = nativeModels.get(props.tabId);
  if (entry && monaco) {
    entry.changeListener.dispose();
    entry.parser.dispose();
    entry.parser = attachMonacoSqlContext(entry.model, nativeParserExtension());
    entry.changeListener = listenToNativeModel(entry.model);
    monaco.editor.setModelLanguage(entry.model, nativeLanguage());
  }
  refreshNativeInlayHints();
});
watch([() => props.readOnly, () => props.forceWordWrap, () => settingsStore.editorSettings.completionTriggerMode], applyNativeAppearance);
watch(
  () => props.readOnly,
  (readOnly) => {
    if (readOnly) clearNativeColumnSelection();
  },
);
watch(() => props.statementExecutionMarkers, refreshNativeGutter, { deep: true });
watch(() => settingsStore.editorSettings.showCurrentStatementFrame, refreshNativeStatementFrame);
watch(
  () => settingsStore.editorSettings.vimModeEnabled,
  (enabled) => {
    void nativeVim?.setEnabled(enabled).catch(reportNativeVimError);
  },
);

onBeforeUnmount(() => {
  nativeDestroyed = true;
  nativeContextEpoch++;
  pauseQueryEditorBackgroundWork();
  viewportEmitTask.cancel();
  if (viewportRestoreFrame !== null) cancelAnimationFrame(viewportRestoreFrame);
  for (const disposable of [...nativeShortcuts, ...nativeDisposables]) disposable.dispose();
  nativeInlayListeners.clear();
  postCompositionKeyGuardCleanup?.();
  zoomCommitScheduler.dispose();
  window.removeEventListener(BEFORE_TAB_SWITCH_EVENT, captureEditorStateBeforeTabSwitch);
  nativeVim?.dispose();
  nativeVim = null;
  view.value?.dispose();
  view.value = null;
  for (const entry of nativeModels.values()) {
    entry.changeListener.dispose();
    entry.parser.dispose();
    entry.model.dispose();
  }
  nativeModels.clear();
});
</script>

<template>
  <div class="h-full w-full overflow-hidden relative" @wheel="recordExecutionViewportInteraction" @pointerdown="recordExecutionViewportInteraction" @gesturestart="onEditorGestureStart" @gesturechange="onEditorGestureChange" @gestureend="onEditorGestureEnd">
    <CustomContextMenu :items="currentContextMenuItems" @close="contextMenuOpen = false" v-slot="{ onContextMenu }">
      <div
        ref="editorRef"
        data-query-editor-root
        class="h-full w-full overflow-hidden"
        :style="settingsStore.editorSettings.vimModeEnabled ? { height: 'calc(100% - 24px)' } : undefined"
        @contextmenu="
          (e: MouseEvent) => {
            if (view) {
              syncContextMenuStateAtEvent(view, e);
              dismissHoverTooltip();
            }
            onContextMenu(e);
            contextMenuOpen = true;
          }
        "
      />
    </CustomContextMenu>
    <div ref="nativeVimStatus" v-show="settingsStore.editorSettings.vimModeEnabled" data-monaco-vim-status class="flex h-6 items-center gap-3 overflow-hidden border-t bg-muted px-2 font-mono text-xs" />
    <div v-show="queryEditorDropCaret" data-query-editor-drop-caret class="pointer-events-none absolute z-20 w-0.5 rounded-full bg-primary/70" :style="queryEditorDropCaretStyle" />
    <SqlExecutionTargetPicker v-if="pickerVisible" :candidates="pickerCandidates" :active-index="pickerActiveIndex" :anchor="pickerAnchor" @update:active-index="onPickerActiveIndexChange" @confirm="onPickerConfirm" @cancel="closePicker" />
    <DelimitedListDialog v-model:open="delimitedListOpen" :selected-text="delimitedListSelectedText" @confirm="applyDelimitedListResult" />
    <Teleport v-if="nativeColumnWidgetHost && nativeColumnPicker" :to="nativeColumnWidgetHost">
      <MonacoColumnPicker
        ref="nativeColumnPickerComponent"
        :selection="nativeColumnPicker.selection"
        :candidates="nativeColumnPicker.candidates"
        :select-first="settingsStore.editorSettings.selectFirstCompletionOnOpen"
        @close="closeNativeColumnPicker"
        @confirm="confirmNativeColumnSelection"
        @accept="acceptNativeColumnCandidate"
        @layout="layoutNativeColumnPicker"
      />
    </Teleport>
    <CodeSnapshotDialog v-model:open="codeSnapshotOpen" :source="codeSnapshotSource" />
    <!-- SQL 意图操作弹出菜单（参考 DataGrip Alt+Enter） -->
    <Teleport to="body">
      <div v-if="intentionPopup?.visible" class="intention-popup-overlay" @click.self="closeIntentionPopup">
        <div class="intention-popup" :style="{ left: intentionPopup.position.x + 'px', top: intentionPopup.position.y + 'px' }">
          <div v-for="(action, i) in intentionPopup.actions" :key="i" class="intention-popup-item" :class="{ 'intention-popup-item--active': i === intentionPopup.selectedIndex }" @click="executeIntentionAction(action)" @mouseenter="intentionPopup.selectedIndex = i">
            <span class="intention-popup-item__icon">💡</span>
            <span class="intention-popup-item__label">{{ action.label || getIntentionActionLabel(action.kind) }}</span>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
[data-query-editor-root] > :deep(.monaco-editor) {
  contain: size style;
}
.query-editor--table-navigation-hover :deep(.view-line) {
  cursor: pointer;
}
:deep(.dbx-monaco-preview) {
  background: color-mix(in srgb, var(--primary) 25%, transparent);
}
:deep(.dbx-monaco-result) {
  background: color-mix(in srgb, var(--primary) 20%, transparent);
}
:deep(.dbx-monaco-table-name) {
  color: var(--dbx-monaco-table-color);
}
:deep(.dbx-monaco-statement-frame) {
  border: 1px solid rgb(34 197 94 / 0.65);
  border-radius: 2px;
  pointer-events: none;
}
:deep(.dbx-monaco-run-statement) {
  cursor: pointer;
  color: var(--primary);
}
:deep(.dbx-monaco-run-statement::after) {
  content: "▶";
  font-size: 10px;
}
:deep(.dbx-monaco-statement-success::after) {
  content: "●";
  color: #10b981;
  font-size: 9px;
}
:deep(.dbx-monaco-statement-error::after) {
  content: "●";
  color: #ef4444;
  font-size: 9px;
}
:deep(.dbx-monaco-statement-running::after) {
  content: "●";
  color: var(--primary);
  font-size: 9px;
}
</style>

<style>
.intention-popup-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: transparent;
}

.intention-popup {
  position: fixed;
  z-index: 10000;
  min-width: 220px;
  max-width: 360px;
  background: var(--popover);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
  padding: 4px 0;
  overflow: hidden;
}

.intention-popup-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  cursor: pointer;
  color: var(--foreground);
  font-size: 13px;
  line-height: 1.5;
  transition: background 0.1s;
}

.intention-popup-item:hover,
.intention-popup-item--active {
  background: var(--accent);
  color: var(--accent-foreground);
}

.intention-popup-item__icon {
  font-size: 14px;
  flex-shrink: 0;
}

.intention-popup-item__label {
  white-space: nowrap;
  text-overflow: ellipsis;
  overflow: hidden;
}
</style>
