const FORBIDDEN = [
  "eval",
  "test",
  "judge",
  "experiment",
  "rubric",
  "score",
  "compare",
  "benchmark",
  "candidate",
  "arena",
] as const;
const FORBIDDEN_ZH = ["评测", "裁判", "评分表", "评分标准", "盲测", "候选者"] as const;
const INFLECTIONS = ["s", "es", "ed", "d", "ing", "er", "ers"] as const;

function tokens(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function matches(token: string, word: string): boolean {
  if (token === word) return true;
  return INFLECTIONS.some((suffix) => token === `${word}${suffix}`);
}

export function findBlindingLeaks(input: { paths: string[]; prompt: string; headings: string[] }): string[] {
  const leaks = new Set<string>();
  for (const path of input.paths) {
    for (const token of tokens(path)) {
      for (const word of FORBIDDEN) if (matches(token, word)) leaks.add(`${path}: ${word}`);
    }
  }
  for (const token of tokens(input.prompt)) {
    for (const word of FORBIDDEN) if (matches(token, word)) leaks.add(`prompt: ${word}`);
  }
  for (const heading of input.headings) {
    for (const word of FORBIDDEN_ZH) if (heading.includes(word)) leaks.add(`heading: ${word}`);
  }
  return [...leaks].sort();
}
