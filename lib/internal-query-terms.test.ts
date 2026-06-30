import { test } from "node:test";
import assert from "node:assert/strict";

import { normalizeBusinessText } from "./entity-normalizer.ts";
import {
  isInternalLookupInstructionStopWord,
  removeInternalLookupInstructionPhrases,
} from "./internal-query-terms.ts";

test("internal lookup cleanup removes negated web and market-price instructions", () => {
  const cleaned = removeInternalLookupInstructionPhrases(
    normalizeBusinessText("Giá nội bộ Toshiba là bao nhiêu? Không dùng giá thị trường/web."),
  );

  assert.match(cleaned, /toshiba/);
  assert.doesNotMatch(cleaned, /khong/);
  assert.doesNotMatch(cleaned, /web/);
  assert.doesNotMatch(cleaned, /thi truong/);
  assert.equal(isInternalLookupInstructionStopWord("web"), true);
  assert.equal(isInternalLookupInstructionStopWord("toshiba"), false);
});

test("internal lookup cleanup preserves explicit public market-price wording", () => {
  const cleaned = removeInternalLookupInstructionPhrases(
    normalizeBusinessText("Giá thị trường Toshiba trên web hiện nay là bao nhiêu?"),
  );

  assert.match(cleaned, /gia thi truong/);
  assert.match(cleaned, /tren web/);
  assert.match(cleaned, /toshiba/);
});
