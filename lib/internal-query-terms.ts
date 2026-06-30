const INTERNAL_LOOKUP_INSTRUCTION_PHRASES = [
  /\bkhong\s+(?:su\s+dung|dung|lay|tra|tim)\s+(?:gia\s+)?(?:web|thi\s+truong|cong\s+khai|ben\s+ngoai|internet|google)(?:[\s/,-]+(?:web|internet|google|thi\s+truong|cong\s+khai|ben\s+ngoai))*\b/g,
  /\bkhong\s+(?:can|duoc|nen)?\s*(?:web|internet|google)\b/g,
];

export const INTERNAL_LOOKUP_INSTRUCTION_STOP_WORDS = new Set([
  "khong",
  "dung",
  "su",
  "lay",
  "tra",
  "tim",
  "web",
  "thi",
  "truong",
  "market",
  "internet",
  "google",
  "cong",
  "khai",
  "ben",
  "ngoai",
]);

export function removeInternalLookupInstructionPhrases(normalizedText: string) {
  return INTERNAL_LOOKUP_INSTRUCTION_PHRASES.reduce(
    (text, pattern) => text.replace(pattern, " "),
    normalizedText,
  )
    .replace(/\s+/g, " ")
    .trim();
}

export function isInternalLookupInstructionStopWord(term: string) {
  return INTERNAL_LOOKUP_INSTRUCTION_STOP_WORDS.has(term);
}
