interface SnippetField {
  sequence: number | null;
  name: string;
  index: number;
}

function escapeSnippetText(value: string): string {
  return value.replace(/\\([{}])/g, "$1").replace(/[\\$}]/g, "\\$&");
}

export function escapeMonacoSnippetLiteral(value: string): string {
  return value.replace(/[\\$}]/g, "\\$&");
}

export function convertDbxSnippetToMonaco(template: string): string {
  const fields: SnippetField[] = [];
  const parts: Array<string | { field: SnippetField; placeholder: string }> = [];
  const placeholders = /[#$]\{(?:(\d+)(?::([^{}]*))?|((?:\\[{}]|[^{}])*))\}/g;
  let previousEnd = 0;
  for (const match of template.matchAll(placeholders)) {
    parts.push(escapeSnippetText(template.slice(previousEnd, match.index)));
    const sequence = match[1] === undefined ? null : Number(match[1]);
    const placeholder = match[2] || match[3] || "";
    const name = placeholder.replace(/\\([{}])/g, "$1");
    let field = fields.find((candidate) => (sequence !== null ? candidate.sequence === sequence : name !== "" && candidate.name === name));
    if (!field) {
      field = { sequence, name, index: 0 };
      fields.push(field);
    }
    parts.push({ field, placeholder });
    previousEnd = match.index + match[0].length;
  }
  parts.push(escapeSnippetText(template.slice(previousEnd)));
  fields.sort((left, right) => {
    if (left.sequence === null) return right.sequence === null ? 0 : 1;
    if (right.sequence === null) return -1;
    return left.sequence - right.sequence;
  });
  fields.forEach((field, index) => {
    field.index = index + 1;
  });
  return parts.map((part) => (typeof part === "string" ? part : `\${${part.field.index}:${escapeSnippetText(part.placeholder)}}`)).join("");
}
