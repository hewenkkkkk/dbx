import * as monaco from "monaco-editor/editor/editor.api";
import "monaco-editor/features/register.all";
import "monaco-editor/languages/definitions/sql/register";
import "monaco-editor/languages/definitions/mysql/register";
import "monaco-editor/languages/definitions/pgsql/register";
import "monaco-editor/languages/definitions/javascript/register";
import "monaco-editor/languages/definitions/redis/register";
import "monaco-editor/languages/definitions/yaml/register";
import "monaco-editor/languages/definitions/xml/register";
import "monaco-editor/languages/definitions/html/register";
import "monaco-editor/languages/definitions/ini/register";
import "monaco-editor/languages/definitions/shell/register";
import "monaco-editor/languages/definitions/dockerfile/register";
import { jsonDefaults } from "monaco-editor/languages/features/json/register";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import JsonWorker from "monaco-editor/languages/features/json/json.worker?worker";

globalThis.MonacoEnvironment = {
  ...globalThis.MonacoEnvironment,
  getWorker: (_moduleId, label) => (label === "json" ? new JsonWorker({ name: "dbx-json" }) : new EditorWorker({ name: "dbx-editor" })),
};

jsonDefaults.setDiagnosticsOptions({ validate: true, allowComments: false, enableSchemaRequest: false, schemas: [] });

monaco.languages.register({ id: "nginx" });
monaco.languages.setMonarchTokensProvider("nginx", {
  tokenizer: {
    root: [
      [/#.*$/, "comment"],
      [/\$[\w]+/, "variable"],
      [/"([^"\\]|\\.)*"|'([^'\\]|\\.)*'/, "string"],
      [/\b\d+[kmg]?\b/i, "number"],
      [/[{};]/, "delimiter"],
      [/^[ \t]*[\w_]+/, "keyword"],
    ],
  },
});
monaco.languages.setLanguageConfiguration("nginx", {
  comments: { lineComment: "#" },
  brackets: [["{", "}"]],
  autoClosingPairs: [
    { open: "{", close: "}" },
    { open: '"', close: '"' },
  ],
});

monaco.languages.register({ id: "toml" });
monaco.languages.setMonarchTokensProvider("toml", {
  tokenizer: {
    root: [
      [/#.*$/, "comment"],
      [/"""/, "string", "@multilineString"],
      [/'''/, "string", "@multilineLiteral"],
      [/"([^"\\]|\\.)*"|'[^']*'/, "string"],
      [/^\s*\[\[?.*?\]\]?/, "type"],
      [/[\w.-]+(?=\s*=)/, "property"],
      [/\b(true|false)\b/, "keyword"],
      [/[+-]?\d[\w.:+-]*/, "number"],
      [/[=,{}[\]]/, "delimiter"],
    ],
    multilineString: [
      [/"""/, "string", "@pop"],
      [/\\./, "string.escape"],
      [/./, "string"],
    ],
    multilineLiteral: [
      [/'''/, "string", "@pop"],
      [/./, "string"],
    ],
  },
});
monaco.languages.setLanguageConfiguration("toml", {
  comments: { lineComment: "#" },
  brackets: [
    ["[", "]"],
    ["{", "}"],
  ],
});

export { monaco };
