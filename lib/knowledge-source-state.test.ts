import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildKnowledgeSourceState,
  isSpreadsheetCompatibleSource,
} from "./knowledge-source-state.ts";

test("drive-only files are visible but not usable for RAG or calculation", () => {
  const state = buildKnowledgeSourceState({
    driveVisible: true,
    metadataSaved: false,
  });

  assert.equal(state.status, "drive_only");
  assert.equal(state.statusMessage, "Co tren Drive - chua index.");
  assert.equal(state.usableForRag, false);
  assert.equal(state.usableForCalculation, false);
});

test("metadata rows without proven vector data are index pending", () => {
  const state = buildKnowledgeSourceState({
    driveVisible: true,
    metadataSaved: true,
    hasFileSearchStore: false,
    hasKnowledgeChunks: false,
  });

  assert.equal(state.status, "index_pending");
  assert.equal(state.vectorIndexed, false);
  assert.equal(state.n8nIngested, null);
  assert.equal(state.usableForRag, false);
});

test("metadata-only rows are not treated as pending Drive-ingested sources", () => {
  const state = buildKnowledgeSourceState({
    driveVisible: false,
    metadataSaved: true,
    hasFileSearchStore: false,
    hasKnowledgeChunks: false,
  });

  assert.equal(state.status, "metadata_only");
  assert.equal(state.vectorIndexed, false);
  assert.equal(state.usableForRag, false);
  assert.equal(state.usableForCalculation, false);
});

test("upload ingestion failed is explicit and blocks usability", () => {
  const state = buildKnowledgeSourceState({
    driveVisible: true,
    metadataSaved: true,
    n8nIngested: false,
    ingestionError: "HTTP 500",
  });

  assert.equal(state.status, "ingestion_failed");
  assert.match(state.statusMessage, /ingestion loi: HTTP 500/);
  assert.equal(state.usableForRag, false);
  assert.equal(state.usableForCalculation, false);
});

test("indexed non-spreadsheet files are RAG-ready", () => {
  const state = buildKnowledgeSourceState({
    driveVisible: true,
    metadataSaved: true,
    hasFileSearchStore: true,
    spreadsheetCompatible: false,
  });

  assert.equal(state.status, "rag_ready");
  assert.equal(state.usableForRag, true);
  assert.equal(state.usableForCalculation, false);
});

test("indexed spreadsheet without raw probe is calculation-unverified, not raw-unreadable", () => {
  const state = buildKnowledgeSourceState({
    driveVisible: true,
    metadataSaved: true,
    hasFileSearchStore: true,
    spreadsheetCompatible: true,
  });

  assert.equal(state.status, "calculation_unverified");
  assert.equal(state.rawReadChecked, false);
  assert.equal(state.usableForRag, true);
  assert.equal(state.usableForCalculation, false);
});

test("indexed spreadsheet with readable raw probe is calculation-ready", () => {
  const state = buildKnowledgeSourceState({
    driveVisible: true,
    metadataSaved: true,
    hasKnowledgeChunks: true,
    rawReadable: true,
    rawReadChecked: true,
    spreadsheetCompatible: true,
  });

  assert.equal(state.status, "calculation_ready");
  assert.equal(state.usableForRag, true);
  assert.equal(state.usableForCalculation, true);
});

test("raw probe failure marks indexed spreadsheet raw-unreadable", () => {
  const state = buildKnowledgeSourceState({
    driveVisible: true,
    metadataSaved: true,
    hasKnowledgeChunks: true,
    rawReadable: false,
    rawReadChecked: true,
    spreadsheetCompatible: true,
  });

  assert.equal(state.status, "raw_unreadable");
  assert.equal(state.usableForRag, true);
  assert.equal(state.usableForCalculation, false);
});

test("raw probe failure marks Drive-visible scanned PDFs raw-unreadable", () => {
  const state = buildKnowledgeSourceState({
    driveVisible: true,
    metadataSaved: false,
    rawReadable: false,
    rawReadChecked: true,
    spreadsheetCompatible: false,
  });

  assert.equal(state.status, "raw_unreadable");
  assert.match(state.statusMessage, /OCR\/vision/);
  assert.equal(state.usableForRag, false);
  assert.equal(state.usableForCalculation, false);
});

test("spreadsheet compatibility is explicit", () => {
  assert.equal(isSpreadsheetCompatibleSource("CSV"), true);
  assert.equal(isSpreadsheetCompatibleSource("xlsx"), true);
  assert.equal(isSpreadsheetCompatibleSource("PDF"), false);
  assert.equal(isSpreadsheetCompatibleSource("WEB_URL"), false);
});
