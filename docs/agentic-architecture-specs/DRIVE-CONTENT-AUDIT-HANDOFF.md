# Drive Content Audit Handoff

Purpose: hand off the remaining Drive-content validation work to a separate agent while the lead agent focuses on architecture review, code changes, and acceptance.

Do not paste, print, commit, or artifact raw credentials. Use environment files only as local inputs.

## Current Context

- Production Drive folder: `1lLpepdaj6n-cvoX9edLsQffrf5CQjCk-`
- Service account confirmed able to read folder: `ragagent@agent-ai-477502.iam.gserviceaccount.com`
- Production app: `https://aioperation.dieuhoathanglong.com.vn`
- Current n8n: `https://n8n-production-1affb.up.railway.app`
- Current agent0: `https://agent0-production-797d.up.railway.app`
- Existing content audit artifacts:
  - `/tmp/agent-ai-drive-content-audit/drive-content-audit.json`
  - `/tmp/agent-ai-drive-content-audit/drive-content-summary.md`
  - `/tmp/agent-ai-drive-content-audit/files/`

Credential know-how:

- `.vercel/.env.production.local` has the correct `GOOGLE_DRIVE_FOLDER_ID`, but `GDRIVE_JSON` / `GOOGLE_SERVICE_ACCOUNT_BASE64` were empty in the local pull checked by the lead.
- `/Users/tuannguyen/Agent-AI/.env` has a usable `GOOGLE_SERVICE_ACCOUNT_BASE64`, but its `GOOGLE_DRIVE_FOLDER_ID` was older.
- For audit scripts, use the service account from `/Users/tuannguyen/Agent-AI/.env` and force folder id `1lLpepdaj6n-cvoX9edLsQffrf5CQjCk-`.

## What Has Already Been Audited

Latest audit summary:

- Total Drive files: `42`
- Total folders: `8`
- Parsed successfully: `36`
- Unparsed: `6`
- Metadata-domain unknown: `0`
- Parsed but no useful content-domain: `5`, all are probe/system junk or `.DS_Store`.

Domain hits from parsed content:

- `product_price`: 27
- `installation`: 20
- `service_price`: 17
- `finance`: 16
- `maintenance`: 16
- `warranty`: 15
- `customer`: 15
- `repair`: 15
- `project`: 13
- `policy_hr`: 13
- `contract`: 12
- `sales_process`: 11
- `error_code`: 10
- `company_profile`: 9
- `inventory`: 7

Important interpretation:

- Content-domain detection is broad and keyword-based. A file can have many domains because contracts/templates mention price, warranty, installation, payment, etc.
- Source routing should remain intent-first and domain-first. Do not use content-domain count alone to route.
- Probe files and `.DS_Store` must be filtered out of usable source catalogs.

## Files Read Successfully

The audit parsed these real business files:

- `SALE/MẪU BÁO GIÁ DỰ TOÁN CÔNG TRÌNH.xlsx`
- `SALE/Kịch bản chăm sóc và liên hệ khách hàng- Nguyễn Hà.xlsx`
- `SALE/050924_BẢNG GIÁ NIÊM YẾT SỬA CHỮA, BẢO DƯỠNG, LẮP ĐẶT NHỎ LẺ.xlsx`
- `SALE/Kỹ năng đàm phán- Nguyễn Hà.doc`
- `SALE/BẢNG GIÁ T8.2025 CẬP NHẬT CHỈNH - Copy.xlsx`
- `SALE/MẪU BÁO GIÁ THIẾT BỊ.xlsx`
- `SALE/From.HĐ THI CÔNG LẮP ĐẶT ĐIỀU HÒA CP1.docx`
- `SALE/[2025.4.28]HỢP ĐỒNG MUA BÁN_FORM CẬP NHẬT 1.doc`
- `SALE/[2021.10.23]HỢP ĐỒNG DỊCH VỤ BẢO TRÌ_FORM (CP)1.docx`
- `SALE/QT.SA.01-Quy trình xử lý đơn hàng.docx`
- `SALE/QT.SA.01-Quy trình bán hàng Kinh doanh.docx`
- `HCNS/Sơ đồ tổ chức Công ty.docx`
- `HCNS/1. 2021 Quy chế Tài chính 31.03.2021.doc`
- `HCNS/HỒ SƠ NĂNG LỰC THĂNG LONG MỚI NHẤT T4.2025.pdf`
- `HCNS/4. 2021.03.31. Quy chế quỹ công đoàn.doc`
- `KỸ THUẬT/Quy trình BH sản phẩm/2023_Quy trình bảo hành 6.9.23.docx`
- `KỸ THUẬT/Hướng dẫn lắp đặt và vận hành/TLE-LAP ĐẶT.xlsx`
- `KỸ THUẬT/Hướng dẫn lắp đặt và vận hành/HƯỚNG DẪN LẮP ĐẶT 2020205_IM_1141001201-2_MMY-MUP_1HT8P-E_SMMSu_8-24_EN.pdf`
- `KỸ THUẬT/Bảng tra cứu mã lỗi/A1C-1401 PCB VRF - Smms-i.pdf`
- `KỸ THUẬT/Bảng tra cứu mã lỗi/itr830-0014-toshiba-vrf-ac-knx-gateway-ds2205110178ben.pdf`
- `KỸ THUẬT/Bảng tra cứu mã lỗi/smmse (Quick Reference Guide).pdf`
- `KỸ THUẬT/Bảng tra cứu mã lỗi/smmse (Quick Reference).pdf`
- `KỸ THUẬT/Bảng tra cứu mã lỗi/SMMSi Error Code Quick Reference.pdf`
- `KỸ THUẬT/Bảng tra cứu mã lỗi/SVM-SMMS-e.pdf`
- `KỸ THUẬT/Bảng tra cứu mã lỗi/SMMSi-E (1 Series) SHRM (2 Series)Service Manual.pdf`
- `KỸ THUẬT/Quy trình BT định kỳ/D5. QUY TRÌNH BẢO TRÌ , BẢO DƯỠNG ĐIỀU HÒA CỤC BỘ ĐỊNH KỲ.docx`
- `KỸ THUẬT/Quy trình BT định kỳ/D4. QUY TRÌNH BẢO TRÌ, BẢO DƯỠNG MÁY LẠNH VRV ĐỊNH KỲ.docx`
- `KỸ THUẬT/Quy trình BT định kỳ/Bao Duong.doc`
- `KỸ THUẬT/Quy trình BT định kỳ/DUNG CU.doc`
- `KỸ THUẬT/Quy trình BT định kỳ/TLE-CHECK LIST.xlsx`

The audit also parsed upload probes and `.DS_Store`, but these are not business knowledge and must be excluded from routing/eval.

## Files Not Yet Read As Text

These 6 PDFs were downloadable but `pdftotext` returned empty text. Treat them as raw-unreadable until OCR/vision parse succeeds:

- `KỸ THUẬT/Quy trình sửa chữa/thay máy nén VRF.pdf`
- `KỸ THUẬT/Quy trình sửa chữa/thay bo mạch VRF.pdf`
- `KỸ THUẬT/Quy trình sửa chữa/Thu hồi ga.pdf`
- `KỸ THUẬT/Hướng dẫn lắp đặt và vận hành/Hướng dẫn lắp đặt VRF Toshiba.pdf`
- `KỸ THUẬT/Hướng dẫn lắp đặt và vận hành/Address Setup - CÀI ĐẶT CHẠY MÁY (p1).pdf`
- `KỸ THUẬT/Hướng dẫn lắp đặt và vận hành/Address Setup - VRF Toshiba.pdf`

Likely reason: scanned/image PDFs, malformed PDFs, or no extractable text. Next agent should use OCR/vision or Agent0 raw-file visual/PDF tooling if available.

## Code Context Already Implemented

Recent local commits:

- `71349e3 Route internal document questions by real Drive taxonomy`
- `6a58c33 Prefer precise internal source families over noisy generic matches`

Relevant code:

- `lib/source-catalog.ts`
- `lib/source-orchestrator.ts`
- `lib/query-planner.ts`
- `lib/source-catalog.test.ts`
- `lib/source-orchestrator.test.ts`
- `lib/query-planner.test.ts`

Current behavior after local tests:

- Product price questions route to `internal_price_lookup` with product price candidates.
- Service price questions route to `internal_price_lookup` with service price candidates.
- Simple inventory total stays local DB.
- Per-warehouse/deep inventory routes Agent0 if inventory candidates exist; otherwise must say missing source/dimension.
- Technical error-code, installation, maintenance, warranty, repair, sales process, customer care, company profile, and policy/HR questions route to internal files / Agent0 deep lane.
- External market questions may use web; internal questions should block web fallback.

Verification already passed locally:

- `npm run test:unit` -> `107/107`
- `npm run typecheck -- --pretty false`
- Targeted eslint for planner/catalog/orchestrator

## Prompt For Next Agent: Drive Content Audit + Routing Corrections

Use this prompt as-is for the next agent.

```text
You are working in /Users/tuannguyen/.superset/worktrees/Agent-AI/immense-plantain.

Task: finish Drive content audit and improve backend source routing if real file contents show gaps. Do not deploy or push unless explicitly asked. Do not print or commit secrets.

Read these first:
- AGENTS.md
- docs/agentic-architecture-specs/DRIVE-CONTENT-AUDIT-HANDOFF.md
- docs/agentic-architecture-specs/SPEC-11-agent0-first-deep-reasoning-lane.md
- lib/source-catalog.ts
- lib/source-orchestrator.ts
- lib/query-planner.ts
- lib/source-catalog.test.ts
- lib/source-orchestrator.test.ts
- lib/query-planner.test.ts

Existing audit artifacts:
- /tmp/agent-ai-drive-content-audit/drive-content-audit.json
- /tmp/agent-ai-drive-content-audit/drive-content-summary.md
- /tmp/agent-ai-drive-content-audit/files/

Credentials/context:
- Correct Drive folder id is 1lLpepdaj6n-cvoX9edLsQffrf5CQjCk-
- Use local service account material from env files; do not print secrets.
- .vercel/.env.production.local has the correct folder id but local GDRIVE_JSON/GOOGLE_SERVICE_ACCOUNT_BASE64 may be empty.
- /Users/tuannguyen/Agent-AI/.env has GOOGLE_SERVICE_ACCOUNT_BASE64 but may point to an old folder id. Use the service account from there and force the correct folder id above.

Primary objective:
1. Confirm whether all 42 Drive files have been read deeply enough for routing/eval.
2. For the 6 unreadable PDFs, try OCR/vision or another local parse strategy. If impossible, mark them explicitly as raw-unreadable and propose how Agent0/prod should handle them.
3. Produce a concise per-file source map: path, type, parsed/readable status, source domains, best query intents, example user questions, and whether it is usable for RAG, calculation, or only citation/fallback.
4. Check current code taxonomy/routing against the content map. If a reusable gap exists, fix code with tests. Do not patch one prompt only.
5. Run verification.

Important acceptance:
- Internal docs must not fall back to web.
- Probe/upload files and .DS_Store must not be candidate sources.
- “giá lắp đặt/sửa chữa/bảo dưỡng nhỏ lẻ” should route to service price file, not installation manual.
- “giá sản phẩm/model/mã hàng” should route to product price files.
- “mã lỗi/error code/SMMS/SVM/Quick Reference” should route to error-code/manual files.
- “lắp đặt/cài đặt/chạy máy/address setup” should route to installation files.
- “bảo trì/bảo dưỡng định kỳ/checklist” should route to maintenance files.
- “bảo hành” should route to warranty file.
- “sửa chữa/thay bo/thay máy nén/thu hồi ga” should route to repair files; if the PDF is unreadable, response must say source unreadable/OCR needed, not hallucinate.
- “quy trình bán hàng/xử lý đơn hàng/kịch bản chăm sóc/đàm phán” should route to sale process/customer care docs.
- “hồ sơ năng lực/sơ đồ tổ chức/quy chế tài chính/quỹ công đoàn” should route to HCNS/company/policy docs.
- Per-warehouse inventory must not claim warehouse split unless source/DB has warehouse dimension.

Suggested commands:
- node --test lib/source-catalog.test.ts lib/query-planner.test.ts lib/source-orchestrator.test.ts
- npm run test:unit
- npm run typecheck -- --pretty false
- npx eslint lib/source-catalog.ts lib/source-orchestrator.ts lib/query-planner.ts lib/source-catalog.test.ts lib/source-orchestrator.test.ts lib/query-planner.test.ts

Output required:
- Summary of what files were fully read vs unreadable.
- Any code changes with file list.
- Test results.
- Remaining risks.
- Do not claim production/live unless you actually deploy and run live verification.
```

## Prompt For Reviewer Agent

```text
You are reviewing another agent's Drive content audit and routing changes.

Repo: /Users/tuannguyen/.superset/worktrees/Agent-AI/immense-plantain

Read:
- docs/agentic-architecture-specs/DRIVE-CONTENT-AUDIT-HANDOFF.md
- /tmp/agent-ai-drive-content-audit/drive-content-audit.json
- lib/source-catalog.ts
- lib/source-orchestrator.ts
- lib/query-planner.ts
- related tests

Review goals:
1. Verify the agent did not treat unreadable scanned PDFs as readable sources.
2. Verify taxonomy/routing is reusable by source family and intent, not prompt-specific.
3. Verify internal source questions block web fallback.
4. Verify service price vs product price vs installation manual are distinct.
5. Verify maintenance/warranty/repair/error-code/installation/sales/HCNS questions route to correct file families.
6. Verify tests cover realistic Vietnamese prompts, typos, and natural user wording.
7. Run the targeted tests and typecheck if possible.

Report findings first, ordered by severity. If no findings, say so and list residual risks.
```

