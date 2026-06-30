# Agentic Architecture Specs

Last updated: 2026-06-29

Purpose:

- turn the current "make it smarter" problem into concrete, reviewable engineering specs
- let multiple AI/Codex/Claude workers implement independent slices without patching random prompts
- preserve the current stack: Next.js app, Postgres/Supabase, Google Drive, n8n, Agent0, Gemini

These specs are intentionally implementation-oriented. Each spec has:

- problem
- user symptom
- current evidence
- root cause
- target design
- files to inspect
- implementation plan
- tests
- acceptance criteria
- anti-patterns to reject in review

## Reading Order

1. `SPEC-00-system-architecture.md`
2. `IMPLEMENTATION-PLAN.md`
3. `SPEC-01-source-state-knowledge.md`
4. `SPEC-02-query-planner-entity-normalizer.md`
5. `SPEC-03-tool-router-execution-graph.md`
6. `SPEC-04-n8n-agent0-contract.md`
7. `SPEC-05-evidence-verifier-answer-contract.md`
8. `SPEC-06-inventory-domain-generalization.md`
9. `SPEC-07-multifile-spreadsheet-business-reasoning.md`
10. `SPEC-08-web-fallback-policy.md`
11. `SPEC-09-ui-observability-execution-trace.md`
12. `SPEC-10-business-eval-production-gate.md`
13. `SPEC-11-agent0-first-deep-reasoning-lane.md`
14. `PROMPTS.md`
15. `AGENT-ASSIGNMENT-PROMPTS.md`

## System Constraints

- Agent-AI source does not call Agent0 directly.
- Agent-AI calls n8n.
- n8n decides whether to answer directly or call `Search_Agent0`.
- Google Drive "file visible" is not the same as "file indexed" or "usable for RAG/calculation".
- Internal business questions must not silently fall back to web answers.
- HTTP 200 is not sufficient evidence of answer quality.
- Many short/simple-looking internal questions still require source discovery and Agent0 deep reasoning. Route by intent and required source categories, not by surface keyword count.

## Review Rule

Reject any implementation that only adds one more prompt-specific regex without moving the logic into a reusable planner, source-state, tool-router, evidence, or eval layer.
