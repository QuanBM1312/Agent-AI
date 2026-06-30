import { test } from "node:test";
import assert from "node:assert/strict";

import {
  canonicalizeBrand,
  extractEntities,
  normalizeBusinessText,
} from "./entity-normalizer.ts";

test("normalizes Vietnamese accents, explicit đ, and whitespace", () => {
  assert.equal(normalizeBusinessText("  Điều   hòa\nTỒN kho  "), "dieu hoa ton kho");
});

test("canonicalizes common brand typos", () => {
  assert.equal(canonicalizeBrand("pananonic"), "panasonic");
  assert.equal(canonicalizeBrand("tosiba"), "toshiba");
  assert.equal(canonicalizeBrand("mitsubisi"), "mitsubishi");
});

test("extracts typo-normalized brand entities", () => {
  const panasonic = extractEntities("hàng panasonic trong kho có bao nhiêu loại?");
  const typo = extractEntities("hàng pananonic trong kho có bao nhiêu loại?");

  assert.deepEqual(
    panasonic.filter((entity) => entity.kind === "brand").map((entity) => entity.normalized),
    ["panasonic"],
  );
  assert.deepEqual(
    typo.filter((entity) => entity.kind === "brand").map((entity) => entity.normalized),
    ["panasonic"],
  );
});

test("extracts RBC model and inventory product code", () => {
  const entities = extractEntities("Điều khiển RBC-AXU31-E mã H8BTDK0032 còn tồn bao nhiêu?");

  assert.ok(
    entities.some((entity) => entity.kind === "model" && entity.normalized === "rbc-axu31-e"),
  );
  assert.ok(
    entities.some((entity) => entity.kind === "product_code" && entity.normalized === "h8btdk0032"),
  );
});

test("lowercase dieu khien rbc extracts product type and model-ish token", () => {
  const entities = extractEntities("dieu khien rbc");

  assert.ok(
    entities.some((entity) => entity.kind === "product_type" && entity.normalized === "dieu khien"),
  );
  assert.ok(
    entities.some((entity) => entity.kind === "model" && entity.normalized === "rbc"),
  );
});
