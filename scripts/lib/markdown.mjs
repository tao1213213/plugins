export function normalizeText(text) {
  return text.replaceAll("\r\n", "\n");
}

export function insertAdapterLine(text, line) {
  return normalizeText(text).replace(/^(# .*)\n+/m, `$1\n\n${line}\n\n`);
}
