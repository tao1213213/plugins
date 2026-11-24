import { readFile } from "node:fs/promises";
import { assertPathWithin } from "./isolation";

const NETWORK_TOOLS = new Set(["WebFetch", "WebSearch", "mcp_call", "browser-use"]);

type ToolCall = {
  line: number;
  name: string;
  input: Record<string, unknown>;
};

export type TranscriptSummary = {
  tool_calls: ToolCall[];
  violations: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function collectTranscript(input: { transcriptPath: string; allowedRoot: string }): Promise<TranscriptSummary> {
  const violations: string[] = [];
  try {
    assertPathWithin(input.allowedRoot, input.transcriptPath);
  } catch {
    violations.push(`transcript escapes allowed root: ${input.transcriptPath}`);
    return { tool_calls: [], violations };
  }
  const text = await readFile(input.transcriptPath, "utf8");
  const toolCalls: ToolCall[] = [];
  const lines = text.split(/\r?\n/).filter(Boolean);
  for (const [index, line] of lines.entries()) {
    let row: unknown;
    try {
      row = JSON.parse(line);
    } catch {
      violations.push(`line ${index + 1}: invalid JSON`);
      continue;
    }
    if (!isRecord(row) || !isRecord(row.message) || !Array.isArray(row.message.content)) continue;
    for (const block of row.message.content) {
      if (!isRecord(block) || block.type !== "tool_use" || typeof block.name !== "string") continue;
      const data = isRecord(block.input) ? block.input : {};
      toolCalls.push({ line: index + 1, name: block.name, input: data });
      if (NETWORK_TOOLS.has(block.name) || block.name.toLowerCase().includes("browser")) {
        violations.push(`line ${index + 1}: network-capable tool ${block.name}`);
      }
      if (block.name === "Read" && typeof data.file_path === "string") {
        try {
          assertPathWithin(input.allowedRoot, data.file_path);
        } catch {
          violations.push(`line ${index + 1}: read escapes allowed root ${data.file_path}`);
        }
      }
      if (block.name === "Bash" && typeof data.command === "string" && /curl |wget |https?:\/\//.test(data.command)) {
        violations.push(`line ${index + 1}: network command`);
      }
    }
  }
  return { tool_calls: toolCalls, violations };
}
