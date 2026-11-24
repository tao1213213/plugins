export function parseFrontmatterName(text) {
  const block = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!block) return "";
  const raw = block[1].match(/^name:\s*(.*)$/m)?.[1]?.trim() ?? "";
  return raw.replace(/^(["'])(.*)\1$/, "$2");
}
