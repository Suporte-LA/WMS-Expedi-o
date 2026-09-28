export function csvCell(value: unknown): string {
  let text = String(value ?? "");
  // Quoting alone does not prevent formulas from executing in spreadsheet apps.
  if (/^[\s]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
  return `"${text.replace(/"/g, '""')}"`;
}
