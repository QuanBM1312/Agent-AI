# Agent Prompts For Implementation

Use these prompts to assign one spec per agent. Do not give every agent the whole system to rewrite.

## Common Instructions For Every Agent

```text
You are working in the Agent-AI repo.

Read before changing code:
- AGENTS.md
- docs/reviewer-handoff.md
- docs/deep-codebase-audit.md
- docs/current-stack-improvement-plan.md
- docs/agentic-architecture-specs/README.md
- docs/agentic-architecture-specs/IMPLEMENTATION-PLAN.md
- the specific SPEC file assigned to you

Rules:
- Do not add credentials or secrets to docs/code.
- Do not create extra docs unless the assigned spec requires updating its own file.
- Do not patch one prompt/case if the spec requires a reusable layer.
- Do not use web fallback for internal business data unless the plan explicitly allows it.
- Add or update tests for behavior you change.
- Do not push or merge unless explicitly instructed.

Your final report must include:
- root cause confirmed
- files changed
- tests added/updated
- verification commands and results
- remaining risks
- why the solution is not a case-specific patch
```

## Prompt: SPEC-01 Source State

```text
Implement docs/agentic-architecture-specs/SPEC-01-source-state-knowledge.md.

Primary goal:
Make Knowledge UI and chat distinguish Drive-visible files from indexed/RAG/calculation-ready files.

Focus files:
- app/api/knowledge/sources/route.ts
- app/api/knowledge/upload/route.ts
- components/knowledge-portal.tsx
- app/api/chat/n8n/route.ts only where missing-source messaging uses source state

Do not change n8n or Agent0 in this task.

Acceptance:
- API returns sourceState.
- UI shows Drive-only vs ready vs ingestion failed.
- Chat does not treat Drive-only as verified evidence.
```

## Prompt: SPEC-02 Query Planner

```text
Implement docs/agentic-architecture-specs/SPEC-02-query-planner-entity-normalizer.md.

Primary goal:
Centralize intent/entity detection so semantic equivalents route the same way.

Focus files:
- lib/business-analysis-planner.ts
- lib/chat-inventory.ts
- app/api/chat/n8n/route.ts
- new lib/query-planner.ts if needed
- new lib/entity-normalizer.ts if needed

Acceptance:
- panasonic and pananonic produce same normalized brand.
- inventory/internal-price/profit/project/risk intents return structured QueryPlan.
- route.ts stops owning duplicate brand regex for core routing.
```

## Prompt: SPEC-03 Tool Router

```text
Implement docs/agentic-architecture-specs/SPEC-03-tool-router-execution-graph.md.

Primary goal:
Move tool dispatch out of the giant route into a reusable Tool Router.

Focus files:
- app/api/chat/n8n/route.ts
- lib/chat-inventory.ts
- lib/spreadsheet-calculation.ts
- lib/gemini-web-search.ts
- new lib/chat-tool-router.ts if needed

Acceptance:
- simple inventory uses DB deterministic path.
- internal price blocks web.
- n8n failure returns tool_unavailable/partial, not generic bluff.
- every tool result has status, routeHint, evidence/missingData/warnings/trace.
```

## Prompt: SPEC-04 n8n/Agent0 Contract

```text
Implement docs/agentic-architecture-specs/SPEC-04-n8n-agent0-contract.md.

Primary goal:
Make sure source_plan/files_context reaches Search_Agent0 when the app chooses Agent0/n8n.

Focus:
- live n8n workflow via n8n API/MCP
- docs/n8n-mcp-patch-recipes.md
- app/api/chat/n8n/route.ts payload construction
- scripts/probe-agent0-*.mjs if probe updates are needed

Do not assume exported docs are live state. Verify live workflow first.

Acceptance:
- live n8n execution shows Search_Agent0 receives source_plan/files_context.
- active caller does not hardcode files_context empty.
- failure path is explicit.
```

## Prompt: SPEC-05 Evidence Verifier

```text
Implement docs/agentic-architecture-specs/SPEC-05-evidence-verifier-answer-contract.md.

Primary goal:
Prevent unsupported business conclusions.

Focus files:
- lib/business-analysis-planner.ts
- lib/spreadsheet-calculation.ts
- lib/gemini-web-search.ts
- app/api/chat/n8n/route.ts
- components/chat-interface.tsx
- new lib/answer-contract.ts if needed

Acceptance:
- missing cost blocks profit conclusion.
- missing warehouse dimension blocks per-warehouse answer.
- every business response has verificationStatus.
- UI shows verified/partial/missing/tool-unavailable.
```

## Prompt: SPEC-06 Inventory Generalization

```text
Implement docs/agentic-architecture-specs/SPEC-06-inventory-domain-generalization.md.

Primary goal:
Extract inventory-specific typo/entity logic into shared entity normalization.

Focus files:
- lib/chat-inventory.ts
- lib/business-analysis-planner.ts
- app/api/chat/n8n/route.ts
- new lib/entity-normalizer.ts if not already created

Acceptance:
- inventory, price lookup, and planner use same normalized entities.
- panasonic/pananonic and toshiba/tosiba are tested.
- no duplicated brand lists remain in route-level core logic.
```

## Prompt: SPEC-07 Multi-File Business Reasoning

```text
Implement docs/agentic-architecture-specs/SPEC-07-multifile-spreadsheet-business-reasoning.md.

Primary goal:
Support multi-source business questions without pretending one spreadsheet is enough.

Focus files:
- lib/business-analysis-planner.ts
- lib/spreadsheet-calculation.ts
- app/api/chat/n8n/route.ts
- tool router/planner files if already created

Acceptance:
- profit/loss requires revenue and cost categories.
- contract/project/risk prompts produce subtasks.
- missing required source yields partial answer, not conclusion.
```

## Prompt: SPEC-08 Web Fallback Policy

```text
Implement docs/agentic-architecture-specs/SPEC-08-web-fallback-policy.md.

Primary goal:
Make web fallback policy explicit and safe.

Focus files:
- lib/gemini-web-search.ts
- app/api/chat/n8n/route.ts
- components/chat-interface.tsx
- query planner/tool router files if already created

Acceptance:
- internal data prompts never silently call web.
- web is allowed only for external intent or explicit consent.
- UI labels web answers clearly.
```

## Prompt: SPEC-09 UI Observability

```text
Implement docs/agentic-architecture-specs/SPEC-09-ui-observability-execution-trace.md.

Primary goal:
Expose actual execution trace to user/operator.

Focus files:
- lib/chat-observability.ts
- components/chat-interface.tsx
- app/api/chat/n8n/route.ts
- tool router files if already created

Acceptance:
- assistant response includes executionTrace.
- UI shows key steps and failed/partial states.
- routeHint is no longer the only debug signal.
```

## Prompt: SPEC-10 Business Eval

```text
Implement docs/agentic-architecture-specs/SPEC-10-business-eval-production-gate.md.

Primary goal:
Create evals that prove business correctness, not just HTTP 200.

Focus files:
- scripts/run-chat-eval.mjs
- e2e/chat.inventory-filter.spec.ts
- e2e/chat.complex-business-ui.spec.ts
- e2e/chat.spreadsheet-calculation.spec.ts
- package.json only if a script is needed

Acceptance:
- canonical business eval includes finance, inventory, project, contract, missing-data cases.
- pass criteria assert route/tool/evidence/no-web/formula/warning invariants.
- production UI subset can be run with existing Playwright stack.
```

## Prompt: SPEC-11 Agent0-First Deep Reasoning Lane

```text
Implement docs/agentic-architecture-specs/SPEC-11-agent0-first-deep-reasoning-lane.md.

Primary goal:
Make internal business questions route by intent/source requirements, not by keyword count. Many simple-looking prompts must use Agent0 when they require internal file discovery, multiple source categories, or raw file inspection.

Read before coding:
- AGENTS.md
- docs/agentic-architecture-specs/SPEC-00-system-architecture.md
- docs/agentic-architecture-specs/SPEC-03-tool-router-execution-graph.md
- docs/agentic-architecture-specs/SPEC-04-n8n-agent0-contract.md
- docs/agentic-architecture-specs/SPEC-07-multifile-spreadsheet-business-reasoning.md
- docs/agentic-architecture-specs/SPEC-10-business-eval-production-gate.md
- docs/agentic-architecture-specs/SPEC-11-agent0-first-deep-reasoning-lane.md

Focus files:
- lib/query-planner.ts
- lib/entity-normalizer.ts
- lib/business-analysis-planner.ts
- lib/chat-inventory.ts
- app/api/chat/n8n/route.ts
- scripts/run-chat-eval.mjs
- scripts/probe-n8n-agent0-contract.mjs
- spreadsheet/internal query helper files if needed

Credential/live guidance:
- Do not commit secrets.
- App prod URL: https://aioperation.dieuhoathanglong.com.vn
- Source app auth from /tmp/agent-live-app-auth.env and /tmp/agent-live-app-cookie.env if present.
- If cookie is stale, regenerate from the email/password env file using existing auth/eval helpers.
- n8n URL: https://n8n-production-1affb.up.railway.app
- n8n cookie file: /tmp/n8n_live.cookie
- n8n workflow IDs:
  - main: ENoKl0URvCxyiG40
  - Search_Agent0: HVdNNqHQl5wbscjY
- Drive folder: 1lLpepdaj6n-cvoX9edLsQffrf5CQjCk-
- Use RAILWAY_API_TOKEN, not RAILWAY_TOKEN, if Railway CLI checks are needed.

Implementation requirements:
1. Add or extend a Source Planner / classifier boundary that decides intent, required source categories, complexity, and recommended lane.
2. Route by source requirements, not by superficial keyword count.
3. Make Agent0 deep lane required for internal prompts that need source discovery, multi-file reasoning, or incomplete local data.
4. Preserve deterministic local DB answers when complete and authoritative.
5. Do not let Gemini/web answer candidate-rich internal prompts before Agent0 gets a chance.
6. Ensure app-originated n8n execution can carry non-empty candidate_files for at least one internal file prompt.
7. Prove Search_Agent0 received source_plan, candidate_files, and answer_contract.
8. Prove Agent0 attempted to read a candidate file or return explicit tool-unavailable/missing-source state.

Acceptance:
- A prompt that looks simple but needs internal files can route Agent0:
  "Phiếu tính giá của điều hòa Toshiba có những loại nào? Không dùng web."
- A multi-source prompt can route Agent0:
  "Tạo báo cáo ngắn gồm: tài chính, tồn kho, tiến độ, rủi ro."
- At least one app-originated Search_Agent0 execution has candidate_files.length > 0.
- Internal prompts do not return web/general bluff when source/tool is missing.
- npm run test:unit, npm run typecheck, targeted eslint pass.
- Live app eval/probe artifacts show route/source/tool proof, not only HTTP 200.

Reject:
- prompt-specific regex only
- "source_plan present" proof with empty candidate_files
- local/Gemini early return that prevents Agent0 deep lane for candidate-rich internal prompts
- web answer for internal price/inventory/project/finance without explicit public-market intent
```

## Reviewer Prompt

```text
Review the implementation against the assigned SPEC.

Reject if:
- it only adds a prompt-specific regex
- it hides missing source/tool failures
- it treats Drive-visible as indexed
- it lets internal business data fall back to web without consent
- it claims pass based only on HTTP 200

Accept only if:
- root cause is addressed at the right layer
- tests prove behavior
- route/source/evidence contracts are clearer than before
- remaining risks are explicit
```
