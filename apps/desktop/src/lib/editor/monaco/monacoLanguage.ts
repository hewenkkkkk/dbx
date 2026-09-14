export function monacoLanguageForFormat(format: string): string {
  switch (format.trim().toLowerCase()) {
    case "json":
    case "html":
    case "xml":
    case "yaml":
    case "sql":
    case "mysql":
    case "pgsql":
    case "javascript":
    case "redis":
    case "shell":
    case "dockerfile":
    case "nginx":
    case "toml":
      return format.trim().toLowerCase();
    case "yml":
    case "kubernetes":
      return "yaml";
    case "properties":
    case "props":
    case "ini":
      return "ini";
    default:
      return "plaintext";
  }
}
