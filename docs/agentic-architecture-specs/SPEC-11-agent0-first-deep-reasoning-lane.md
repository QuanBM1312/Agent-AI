# SPEC-11: Agent0-First Deep Reasoning Lane

## Problem

The system has source-plan plumbing, n8n pass-through, and local deterministic lanes, but it still does not prove that Agent0 can autonomously inspect one or more real Drive files for internal business questions.

Current live evidence shows:

- app-originated n8n executions can carry `source_plan` and `answer_contract`
- n8n no longer drops the contract fields
- `candidate_files` was still `[]` for prompts that reached Search_Agent0
- candidate-rich spreadsheet prompts often resolve locally or via Gemini before n8n/Agent0

This means Agent0 is structurally present, but not yet the primary deep reasoning worker for many internal questions.

## User Goal

For internal company questions, the assistant should behave like an agent:

1. understand whether the question needs internal data
2. find relevant files or DB sources
3. decide whether local deterministic answer is enough
4. if not enough, route to Agent0 with source plan and candidate files
5. Agent0 opens/reads the files with tools
6. answer cites sources, formulas, missing data, and assumptions

This applies not only to obviously complex multi-file questions. Many "basic" internal questions should also use Agent0 when they require file inspection or non-trivial source discovery.

Examples:

- "Giá nội bộ hàng Toshiba là bao nhiêu?"
- "Phiếu tính giá của điều hòa Toshiba có những loại nào?"
- "Hàng Panasonic trong kho có bao nhiêu loại?"
- "Quý gần nhất công ty đang lời hay lỗ?"
- "Tạo báo cáo ngắn gồm tài chính, tồn kho, tiến độ, rủi ro."
- "Dự án X còn hạng mục nào chưa xong?"
- "Hợp đồng nào đã hoàn thành nhưng chưa quyết toán?"

## Non-Goals

- Do not make every public/general question use Agent0.
- Do not use web for internal business data unless the user explicitly asks for market/public information.
- Do not replace deterministic DB answers when they are complete and more reliable.
- Do not claim Agent0 deep reasoning is complete without execution proof that Agent0 received non-empty candidates and used file/tool context.

## Current Architecture Evidence

Inspect these files first:

- `app/api/chat/n8n/route.ts`
- `lib/query-planner.ts`
- `lib/business-analysis-planner.ts`
- `lib/spreadsheet-calculation.ts`
- `lib/internal-query-terms.ts`
- `lib/chat-inventory.ts`
- `scripts/run-chat-eval.mjs`
- `scripts/probe-n8n-agent0-contract.mjs`
- `docs/artifacts/live-n8n/agent0-contract-probe.json`
- `/tmp/agent-d-app-originated-n8n-contract-proof.json` if present

Known current code points:

- candidate discovery: `resolveCalculationDriveCandidates(...)`
- Agent0 file-read instruction block: `buildCalculationDriveContext(...)`
- raw Drive preview fallback: `buildCalculationRawDriveContext(...)`
- n8n payload fields: `source_plan`, `candidate_files`, `answer_contract`
- app-side source plan serializer: `buildN8nSourcePlanPayload(...)`

## Target Design

```text
User prompt
  -> QueryPlan
  -> AI Source Planner / Classifier
  -> Source Resolver
  -> Tool Router
     -> deterministic local DB answer if complete and authoritative
     -> deterministic spreadsheet answer if one file/table is confidently enough
     -> Agent0 Deep Reasoning Lane if:
        - internal data is required, AND
        - answer needs file/source discovery, OR
        - answer needs multiple sources, OR
        - deterministic local answer is incomplete/partial, OR
        - source confidence is low but candidate files exist
     -> web only for explicit external/public intent
  -> Evidence Verifier
  -> UI answer with trace/source state
```

The key design requirement is intent/source classification, not keyword routing. A short user question can be "simple" linguistically but complex operationally because it requires discovering and comparing multiple internal files.

Examples:

| User prompt | Looks simple? | Source reality | Correct lane |
| --- | --- | --- | --- |
| "Hàng Panasonic trong kho có bao nhiêu loại?" | yes | needs inventory source, brand normalization, product grouping, possibly DB + Drive cross-check | local DB if complete, otherwise Agent0 |
| "Giá Toshiba là bao nhiêu?" | yes | ambiguous: internal service price, product price, quote sheet, market price? | ask clarifying or Agent0 internal lookup if internal context implied |
| "Quý này lời hay lỗ?" | yes | needs revenue + cost + period source | Agent0 deep lane unless complete finance tables are proven |
| "Dự án X xong chưa?" | yes | needs task/progress/deadline/report files | Agent0 deep lane |
| "Báo cáo hôm nay" | yes | multi-domain summary | Agent0 deep lane |

## Agent0-First Routing Policy

Create a reusable routing policy, not route-local special cases.

The policy must produce a field similar to:

```ts
type Agent0DeepRoutingPolicy = {
  shouldUseAgent0DeepLane: boolean;
  reason:
    | "internal_file_lookup"
    | "multi_source_business_analysis"
    | "source_discovery_required"
    | "local_answer_partial"
    | "ambiguous_internal_question"
    | "operator_requested_deep_analysis";
  minCandidateFiles: number;
  maxCandidateFiles: number;
  allowLocalShortCircuit: boolean;
  requireExecutionProof: boolean;
};
```

## AI Source Planner / Classifier

Add a small planner layer before source resolution. It may be deterministic with strong tests at first, but the architecture must allow an LLM classifier for ambiguous prompts.

Purpose:

- infer the business intent
- infer required source categories
- infer whether the answer can be trusted from DB/local deterministic tools
- infer whether files must be opened
- infer whether multiple files/categories are likely required
- decide whether to ask a follow-up, use local answer, or route Agent0

Input:

```ts
type SourcePlannerInput = {
  prompt: string;
  normalizedEntities: Array<{
    type: "brand" | "product_code" | "project" | "contract" | "person" | "period" | "unknown";
    value: string;
    confidence: number;
  }>;
  chatHistorySummary?: string;
  sourceCatalogSummary: Array<{
    sourceId: string;
    name: string;
    sourceState: "drive_only" | "rag_ready" | "calculation_ready" | "calculation_unverified" | "raw_unreadable";
    likelyDomains: Array<"price" | "inventory" | "finance" | "project" | "contract" | "report" | "unknown">;
    indexed: boolean;
    rawReadable?: boolean;
  }>;
};
```

Output:

```ts
type SourcePlannerDecision = {
  intent:
    | "inventory_lookup"
    | "internal_price_lookup"
    | "profit_loss"
    | "project_progress"
    | "contract_status"
    | "risk_summary"
    | "general_internal"
    | "external_web"
    | "smalltalk";
  complexity: "simple_answer" | "single_source" | "multi_source" | "ambiguous";
  sourceRequirements: Array<{
    category: "inventory" | "price" | "revenue" | "cost" | "project_progress" | "contract_status" | "report";
    required: boolean;
    reason: string;
  }>;
  recommendedLane:
    | "local_db"
    | "single_file_deterministic"
    | "agent0_deep"
    | "ask_followup"
    | "web"
    | "missing_source";
  agent0Required: boolean;
  followupQuestions: string[];
  noWeb: boolean;
  confidence: number;
};
```

Initial implementation may be deterministic, but the boundary should support an LLM classifier:

- Use a cheap model only for classification, not final answer.
- The classifier must output JSON matching `SourcePlannerDecision`.
- If classifier JSON is invalid, fail closed to deterministic planner.
- Do not let classifier authorize web for internal prompts unless the prompt is explicitly external/public.
- Cache/source-catalog summary should be bounded; do not send raw file contents to classifier.

Classifier prompt contract:

```text
You are a routing classifier, not an answer generator.
Given the user question and internal source catalog summary, decide which sources/tools are required.
Never answer the business question.
Return strict JSON only.
If a question looks simple but requires internal files to verify, choose agent0_deep.
If source categories are missing, choose ask_followup or missing_source.
If the user asks internal price/inventory/project/finance, block web unless explicitly asked for market/public info.
```

Baseline rules:

| Prompt type | Preferred behavior |
| --- | --- |
| Complete DB inventory total | local DB allowed |
| Inventory by warehouse but DB has no warehouse dimension | local partial answer + explicit missing dimension; optionally Agent0 if Drive candidates exist |
| Internal price/quote lookup | Agent0 or deterministic spreadsheet before any web/general fallback |
| Profit/loss | Agent0 deep lane unless complete revenue+cost data is already proven |
| Risk summary/report | Agent0 deep lane |
| Project progress/deadline/owner | Agent0 deep lane unless project DB is complete |
| Public market price/news | web allowed, Agent0 not required |
| Greeting/simple chat | no Agent0 required |

## Source Catalog Context

The planner needs a compact memory of what files/sources exist. Without this, it cannot know whether a simple question needs Agent0 or whether no internal source exists.

Build a bounded source catalog from:

- Knowledge API source state
- Drive folder listing
- DB metadata tables such as `file_search_storage`
- known app DB domains: inventory, projects, reports, customers, jobs

Catalog entries should include:

- file/source name
- source type and state
- likely domain tags
- whether raw spreadsheet read is possible
- whether vector/RAG index exists
- last seen/update time if available

Do not include raw document contents in the catalog. Contents are read later by deterministic parser or Agent0 tools.

The catalog should allow decisions like:

- "There are price files, so internal price lookup should use Agent0/local file, not web."
- "There is inventory DB, so inventory total can be local."
- "Warehouse dimension is absent in DB; if Drive inventory files exist, use Agent0, otherwise return partial."
- "Finance/cost source is not indexed/readable, so do not conclude profit."

## Source Resolver Requirements

The app must create non-empty `candidate_files` for internal file questions when relevant Drive files exist.

Candidate object shape:

```ts
type CandidateFile = {
  driveFileId: string;
  driveName: string;
  mimeType?: string;
  source: "drive_index" | "drive_fallback" | "file_search_storage" | "manual_upload";
  reason: string;
  confidence: number;
  matchedTerms: string[];
  expectedUse:
    | "price_lookup"
    | "inventory_lookup"
    | "profit_loss_revenue"
    | "profit_loss_cost"
    | "project_progress"
    | "contract_status"
    | "risk_summary"
    | "general_internal_file";
};
```

Rules:

- Candidate terms must come from normalized business entities, not instruction text.
- Negative instructions like "không dùng web" must not become lookup terms.
- Drive-visible files are allowed as candidates, but the answer must distinguish whether they are indexed/raw-readable.
- Candidate resolver must prefer real business files over upload probes.
- Candidate resolver must not silently use stale folder IDs. Production folder is `GOOGLE_DRIVE_FOLDER_ID=1lLpepdaj6n-cvoX9edLsQffrf5CQjCk-`.

## n8n / Agent0 Contract Requirements

When the app chooses Agent0 deep lane, the n8n request must include:

- `source_plan`: non-empty JSON string
- `candidate_files`: non-empty JSON string array when Drive candidates exist
- `answer_contract`: non-empty JSON string array
- `files_context`: optional, but if present must be source-derived and not stale

Search_Agent0 must receive these fields unchanged.

Agent0 message must include a deterministic structured block:

```text
[SOURCE_PLAN_BEGIN]
intent: ...
reason: ...
candidate_files:
- driveFileId: ...
  driveName: ...
  expectedUse: ...
answer_contract:
- separate_verified_missing_inferred
- cite_internal_sources
- do_not_use_web_for_internal_data
[SOURCE_PLAN_END]
```

If Agent0 supports explicit tool payload fields, use those too. If it only accepts `{ message }`, the structured block is required.

## Agent0 Tool Behavior Required

Agent0 must be instructed and verified to do at least one of:

- call `/a0/tools/read_drive_file.py --file-id <id> ...`
- call an equivalent Drive/raw-file read tool
- cite a file/sheet/row/column that could only come from reading the provided candidate

For multi-file prompts, acceptance requires at least two candidate files read or an explicit explanation that only one candidate was relevant/readable.

## Implementation Plan

### Phase 1: Planner Policy

1. Extend `lib/query-planner.ts` with `Agent0DeepRoutingPolicy`.
2. Make `buildQueryRoutingPolicy(...)` return whether Agent0 deep lane is required.
3. Add tests for:
   - internal price lookup -> Agent0 eligible
   - risk summary -> Agent0 required
   - profit/loss -> Agent0 required unless complete local source available
   - simple greeting -> Agent0 not required
   - public market price -> web allowed, Agent0 not required

### Phase 2: Candidate Resolver

1. Move candidate file shaping into a reusable function.
2. Exclude upload-probe/test files unless prompt explicitly names them.
3. Score candidates by intent + entity + source category.
4. Add tests proving:
   - Toshiba internal price returns price/quote candidates
   - RBC inventory returns inventory candidates if Drive files exist
   - risk summary returns finance/inventory/project/report candidate groups when available
   - no-web instruction terms are not in candidate search terms

### Phase 3: Tool Router

1. In `app/api/chat/n8n/route.ts`, compute QueryPlan and candidate files before local/Gemini early returns for internal deep intents.
2. If `shouldUseAgent0DeepLane` and `candidate_files.length > 0`, route to n8n/Agent0 before Gemini raw/file-search fallback.
3. Keep deterministic DB answers for complete inventory facts.
4. Keep deterministic spreadsheet answers for simple one-file calculations only when confidence is high.
5. Return explicit missing-source state if Agent0 is required but no candidates exist.

### Phase 4: n8n Execution Proof

1. Run `npm run probe:n8n:agent0-contract`.
2. Run at least one app-originated prompt that should reach Search_Agent0 with non-empty `candidate_files`.
3. Inspect n8n execution, sanitized only:
   - source_plan present and length > 0
   - candidate_files present and parsed length > 0
   - answer_contract present and length > 0
   - Setup message includes structured source plan block
4. Do not dump full workflow JSON or raw business data into docs.

### Phase 5: Agent0 Tool Proof

1. Inspect Agent0 response/runtime logs if available.
2. Prove at least one file-read tool was attempted for a candidate file.
3. If tool logs are not available, add a safe trace field that records tool name/file id presence only, not contents.
4. Add eval artifact showing:
   - app prompt
   - routeHint Agent0/deep path
   - candidate count
   - file-read count or explicit unavailable reason
   - final answer source citations

### Phase 6: Eval Gate

Add business eval cases:

- "Phiếu tính giá của điều hòa Toshiba có những loại nào? Không dùng web."
- "Quý gần nhất công ty đang lời hay lỗ? Nêu công thức và nguồn dữ liệu."
- "Tạo báo cáo ngắn gồm: tài chính, tồn kho, tiến độ, rủi ro."
- "Dự án [X] đã xong chưa? Nếu chưa còn hạng mục nào?"

Pass criteria:

- HTTP 2xx is not enough.
- For Agent0-required cases:
  - route/metadata shows Agent0 deep lane or explicit tool unavailable
  - no web use
  - candidate_files non-empty when Drive has matching files
  - answer separates verified/missing/inferred
  - answer cites internal source or refuses with precise missing source category

## Live Credentials / Environment Guidance

Do not commit credentials. Load them from local env files or shell.

App auth:

```bash
export CHAT_EVAL_BASE_URL="https://aioperation.dieuhoathanglong.com.vn"
source /tmp/agent-live-app-auth.env 2>/dev/null || true
source /tmp/agent-live-app-cookie.env 2>/dev/null || true
```

If `CHAT_EVAL_COOKIE` is stale, regenerate it using the email/password variables from `/tmp/agent-live-app-auth.env` using the existing eval/auth helper scripts. Do not use stale `playwright/.auth/production-user.json`.

n8n:

```bash
export LIVE_N8N_BASE_URL="https://n8n-production-1affb.up.railway.app"
export LIVE_N8N_COOKIE_FILE="/tmp/n8n_live.cookie"
export LIVE_N8N_MAIN_WORKFLOW_ID="ENoKl0URvCxyiG40"
export LIVE_N8N_SUB_WORKFLOW_ID="HVdNNqHQl5wbscjY"
npm run probe:n8n:agent0-contract
```

Drive:

```bash
export GOOGLE_DRIVE_FOLDER_ID="1lLpepdaj6n-cvoX9edLsQffrf5CQjCk-"
```

Use existing `GDRIVE_JSON` / `GOOGLE_SERVICE_ACCOUNT_JSON` from environment or Vercel pull. Do not paste JSON into docs.

Railway:

Use `RAILWAY_API_TOKEN`, not `RAILWAY_TOKEN`, if Railway CLI checks are needed.

## Required Verification Commands

Local:

```bash
npm run test:unit
npm run typecheck
npx eslint app/api/chat/n8n/route.ts lib/query-planner.ts lib/spreadsheet-calculation.ts lib/internal-query-terms.ts scripts/run-chat-eval.mjs
```

n8n:

```bash
npm run probe:n8n:agent0-contract
```

Production app eval:

```bash
npm run eval:chat -- --cases business
```

If the exact eval command differs, inspect `package.json` and `scripts/run-chat-eval.mjs`; do not invent a new script unless necessary.

## Acceptance Criteria

The work is not complete until all are true:

1. At least one app-originated internal prompt reaches Search_Agent0 with `candidate_files.length > 0`.
2. n8n execution proof confirms Search_Agent0 received non-empty `source_plan`, `candidate_files`, and `answer_contract`.
3. Agent0 proof confirms it attempted to read at least one candidate file, or reports a precise tool-unavailable state.
4. For multi-file prompts, Agent0 reads at least two files or explicitly states why only one was relevant/readable.
5. Internal prompts do not fall back to web/general answer when internal files are missing or unreadable.
6. UI/API response distinguishes:
   - verified internal answer
   - partial answer
   - missing source
   - tool unavailable
   - web answer
7. Business evals fail if the system returns HTTP 200 with a low-quality or unsupported answer.

## Anti-Patterns To Reject

- Adding one more regex for Toshiba/Panasonic/RBC instead of reusable policy.
- Treating `source_plan` present as proof when `candidate_files` is empty.
- Claiming Agent0 works because n8n shape probe passes.
- Letting Gemini answer candidate-rich internal prompts before Agent0 gets a chance.
- Hiding tool failure behind a polite generic answer.
- Using web results for internal price/inventory/project questions without explicit user consent.
- Dumping full n8n workflow JSON or secrets into docs/artifacts.

## Final Report Required From Implementing Agent

The implementing agent must report:

- root cause confirmed
- exact files changed
- route policy before/after
- app-originated n8n execution IDs inspected
- Search_Agent0 candidate count proof
- Agent0 file-read/tool proof
- eval artifacts path
- tests run and pass/fail
- remaining risks
- whether code was pushed/deployed or left local only
