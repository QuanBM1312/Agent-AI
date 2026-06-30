import { NextResponse } from "next/server";
import { google } from "googleapis";
import { db as prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { getCurrentUserWithRole } from "@/lib/auth-utils";
import {
  buildKnowledgeSourceState,
  isSpreadsheetCompatibleSource,
  type KnowledgeSourceState,
} from "@/lib/knowledge-source-state";

/**
 * @swagger
 * /api/knowledge/sources:
 *   get:
 *     summary: List knowledge sources
 *     tags: [Knowledge Base]
 *     responses:
 *       200:
 *         description: List of sources
 *   post:
 *     summary: Add a knowledge source
 *     tags: [Knowledge Base]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - drive_name
 *               - drive_file_id
 *             properties:
 *               drive_name:
 *                 type: string
 *               drive_file_id:
 *                 type: string
 *     responses:
 *       201:
 *         description: Source added
 */
import { getPaginationParams, formatPaginatedResponse } from "@/lib/pagination";

type KnowledgeSourceRow = Record<string, unknown> & {
  full_count: number | bigint | null;
};

type KnowledgeSourceItem = Record<string, unknown> & {
  id?: string | null;
  drive_file_id?: string | null;
  sheet_name?: string | null;
  sourceState?: KnowledgeSourceState;
};

type SourceIndexFact = {
  hasFileSearchStore: boolean;
  hasKnowledgeChunks: boolean;
};

type RawReadProbeResult = {
  checked: boolean;
  readable: boolean;
  reason?: string;
};

const DRIVE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const GOOGLE_SHEET_MIME_TYPE = "application/vnd.google-apps.spreadsheet";
const RAW_READ_PROBE_TIMEOUT_MS = 2_500;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseDriveServiceAccountCredentials() {
  const rawJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || process.env.GDRIVE_JSON;
  const base64Json = process.env.GOOGLE_SERVICE_ACCOUNT_BASE64;

  if (rawJson) {
    return JSON.parse(rawJson);
  }

  if (base64Json) {
    return JSON.parse(Buffer.from(base64Json, "base64").toString("utf8"));
  }

  return null;
}

function buildDriveReadonlyAuthCandidates() {
  const authCandidates = [];
  const serviceAccount = parseDriveServiceAccountCredentials();

  if (serviceAccount?.client_email && serviceAccount?.private_key) {
    authCandidates.push(new google.auth.JWT({
      email: serviceAccount.client_email,
      key: serviceAccount.private_key,
      scopes: ["https://www.googleapis.com/auth/drive.readonly"],
    }));
  }

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;

  if (clientId && clientSecret && refreshToken) {
    const auth = new google.auth.OAuth2(
      clientId,
      clientSecret,
      "https://developers.google.com/oauthplayground",
    );
    auth.setCredentials({ refresh_token: refreshToken });
    authCandidates.push(auth);
  }

  return authCandidates;
}

function inferDriveSheetName(file: {
  name?: string | null;
  mimeType?: string | null;
}) {
  if (file.mimeType === "application/vnd.google-apps.spreadsheet") {
    return "GOOGLE_SHEET";
  }

  if (file.mimeType === "text/html") {
    return "WEB_URL";
  }

  return file.name?.split(".").pop()?.toUpperCase() || "FILE";
}

function isUserVisibleDriveFile(fileName?: string | null) {
  const name = (fileName || "").trim();
  return Boolean(name) && !name.startsWith(".") && !/^upload-probe-/i.test(name);
}

function mergeKnowledgeSources(
  dbSources: KnowledgeSourceItem[],
  driveSources: KnowledgeSourceItem[],
) {
  const seen = new Set<string>();
  const merged: KnowledgeSourceItem[] = [];
  const driveByKey = new Map<string, KnowledgeSourceItem>();

  for (const source of driveSources) {
    const key = source.drive_file_id || source.id || "";
    if (key) {
      driveByKey.set(key, source);
    }
  }

  for (const source of dbSources) {
    const key = source.drive_file_id || source.id || "";
    if (key) {
      seen.add(key);
    }
    const matchingDriveSource = key ? driveByKey.get(key) : null;
    merged.push({
      ...source,
      web_view_link: source.web_view_link || matchingDriveSource?.web_view_link || null,
    });
  }

  for (const source of driveSources) {
    const key = source.drive_file_id || source.id || "";
    if (key && seen.has(key)) {
      continue;
    }
    if (key) {
      seen.add(key);
    }
    merged.push(source);
  }

  return merged;
}

function getSourceKey(source: KnowledgeSourceItem) {
  const key = source.drive_file_id || source.id;
  return typeof key === "string" && key.trim().length > 0 ? key : null;
}

function isWebSource(source: KnowledgeSourceItem) {
  return source.sheet_name === "WEB_URL" || /^https?:\/\//i.test(String(source.drive_file_id || ""));
}

async function probeRawReadability(
  driveFileId: string,
  memo: Map<string, Promise<RawReadProbeResult>>,
): Promise<RawReadProbeResult> {
  const existing = memo.get(driveFileId);
  if (existing) {
    return existing;
  }

  const probe = (async (): Promise<RawReadProbeResult> => {
    const authCandidates = buildDriveReadonlyAuthCandidates();
    if (authCandidates.length === 0) {
      return {
        checked: false,
        readable: false,
        reason: "missing_drive_readonly_credentials",
      };
    }

    let lastError: unknown = null;
    for (const auth of authCandidates) {
      try {
        const drive = google.drive({ version: "v3", auth });
        const response = await drive.files.get(
          {
            fileId: driveFileId,
            fields: "id,mimeType,size,capabilities/canDownload,exportLinks",
            supportsAllDrives: true,
          },
          {
            timeout: RAW_READ_PROBE_TIMEOUT_MS,
          },
        );
        const file = response.data;
        const mimeType = file.mimeType || "";
        const canDownload = file.capabilities?.canDownload !== false;
        const hasExportLink = Boolean(file.exportLinks && Object.keys(file.exportLinks).length > 0);

        return {
          checked: true,
          readable: mimeType === GOOGLE_SHEET_MIME_TYPE ? hasExportLink || canDownload : canDownload,
        };
      } catch (error) {
        lastError = error;
      }
    }

    console.warn("[knowledge-source-raw-read-probe-failed]", {
      driveFileId,
      error: lastError,
    });
    return {
      checked: true,
      readable: false,
      reason: "drive_metadata_probe_failed",
    };
  })();

  memo.set(driveFileId, probe);
  return probe;
}

async function loadSourceIndexFacts(driveFileIds: string[]) {
  const facts = new Map<string, SourceIndexFact>();
  const ids = Array.from(new Set(driveFileIds.filter((id) => id.trim().length > 0)));

  if (ids.length === 0) {
    return facts;
  }

  for (const id of ids) {
    facts.set(id, {
      hasFileSearchStore: false,
      hasKnowledgeChunks: false,
    });
  }

  try {
    const fileSearchRows = await prisma.file_search_storage.findMany({
      where: {
        drive_file_id: {
          in: ids,
        },
      },
      select: {
        drive_file_id: true,
        file_search_name: true,
      },
    });

    for (const row of fileSearchRows) {
      if (!row.drive_file_id) {
        continue;
      }

      const fileSearchName = row.file_search_name || "";
      const current = facts.get(row.drive_file_id) || {
        hasFileSearchStore: false,
        hasKnowledgeChunks: false,
      };

      facts.set(row.drive_file_id, {
        ...current,
        hasFileSearchStore:
          current.hasFileSearchStore ||
          fileSearchName.startsWith("fileSearchStores/") ||
          fileSearchName.includes("/documents/"),
      });
    }
  } catch (error) {
    console.warn("[knowledge-source-state-file-search-facts-unavailable]", { error });
  }

  try {
    const chunkRows = await prisma.$queryRaw<Array<{ drive_file_id: string | null }>>`
      SELECT
        COALESCE(
          metadata->>'drive_file_id',
          metadata->>'driveFileId',
          metadata->>'file_id',
          metadata->>'fileId'
        ) AS drive_file_id
      FROM public.knowledge_chunks
      WHERE COALESCE(
          metadata->>'drive_file_id',
          metadata->>'driveFileId',
          metadata->>'file_id',
          metadata->>'fileId'
        ) IN (${Prisma.join(ids)})
      GROUP BY 1
    `;

    for (const row of chunkRows) {
      if (!row.drive_file_id) {
        continue;
      }

      const current = facts.get(row.drive_file_id) || {
        hasFileSearchStore: false,
        hasKnowledgeChunks: false,
      };

      facts.set(row.drive_file_id, {
        ...current,
        hasKnowledgeChunks: true,
      });
    }
  } catch (error) {
    console.warn("[knowledge-source-state-chunk-facts-unavailable]", { error });
  }

  return facts;
}

async function addSourceStates(
  sources: KnowledgeSourceItem[],
  driveVisibleIds: Set<string>,
  options: { loadIndexFacts?: boolean } = {},
) {
  const loadIndexFacts = options.loadIndexFacts !== false;
  const driveFileIds = sources
    .map((source) => source.drive_file_id)
    .filter((id): id is string => typeof id === "string" && !/^https?:\/\//i.test(id));
  const indexFacts = loadIndexFacts ? await loadSourceIndexFacts(driveFileIds) : new Map<string, SourceIndexFact>();
  const rawReadProbeMemo = new Map<string, Promise<RawReadProbeResult>>();

  return Promise.all(sources.map(async (source) => {
    const key = getSourceKey(source);
    const driveFileId = typeof source.drive_file_id === "string" ? source.drive_file_id : null;
    const facts = driveFileId ? indexFacts.get(driveFileId) : null;
    const metadataSaved = source.source !== "google_drive_fallback";
    const webSource = isWebSource(source);
    const driveVisible = webSource ? false : Boolean(key && driveVisibleIds.has(key));
    const hasVectorIndex = facts?.hasFileSearchStore === true || facts?.hasKnowledgeChunks === true;
    const spreadsheetCompatible = isSpreadsheetCompatibleSource(source.sheet_name);
    const rawReadProbe =
      metadataSaved && hasVectorIndex && spreadsheetCompatible && driveFileId && !webSource
        ? await probeRawReadability(driveFileId, rawReadProbeMemo)
        : null;

    return {
      ...source,
      sourceState: buildKnowledgeSourceState({
        driveVisible,
        metadataSaved,
        hasFileSearchStore: facts?.hasFileSearchStore,
        hasKnowledgeChunks: facts?.hasKnowledgeChunks,
        rawReadable: rawReadProbe?.readable,
        rawReadChecked: rawReadProbe?.checked,
        webSource,
        spreadsheetCompatible,
      }),
    };
  }));
}

async function listDriveKnowledgeSources(type: string | null) {
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!folderId) {
    return null;
  }

  let lastError: unknown = null;

  for (const auth of buildDriveReadonlyAuthCandidates()) {
    try {
      const drive = google.drive({ version: "v3", auth });
      const files: Array<{
        id?: string | null;
        name?: string | null;
        mimeType?: string | null;
        webViewLink?: string | null;
        modifiedTime?: string | null;
        size?: string | null;
      }> = [];
      const queue: Array<{ folderId: string; depth: number }> = [{ folderId, depth: 0 }];

      while (queue.length > 0 && files.length < 200) {
        const current = queue.shift();
        if (!current) {
          break;
        }

        const response = await drive.files.list({
          q: `'${current.folderId}' in parents and trashed = false`,
          fields: "files(id,name,mimeType,webViewLink,modifiedTime,size)",
          pageSize: 100,
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
        });

        for (const file of response.data.files || []) {
          if (file.mimeType === DRIVE_FOLDER_MIME_TYPE) {
            if (file.id && current.depth < 3) {
              queue.push({ folderId: file.id, depth: current.depth + 1 });
            }
            continue;
          }

          files.push(file);
        }
      }

      const filtered = files.filter((file) => {
        if (!isUserVisibleDriveFile(file.name)) {
          return false;
        }

        const sheetName = inferDriveSheetName(file);
        if (type === "source") {
          return sheetName === "WEB_URL" || sheetName === "GOOGLE_SHEET";
        }
        if (type === "document") {
          return sheetName !== "WEB_URL" && sheetName !== "GOOGLE_SHEET";
        }
        return true;
      });

      return filtered.map((file) => ({
        id: file.id,
        drive_file_id: file.id,
        drive_name: file.name,
        sheet_name: inferDriveSheetName(file),
        hash: file.size || null,
        created_at: file.modifiedTime || new Date().toISOString(),
        web_view_link: file.webViewLink || null,
        source: "google_drive_fallback",
      }));
    } catch (error) {
      lastError = error;
    }
  }

  console.warn("[knowledge-drive-fallback-unavailable]", { error: lastError });
  return null;
}

export async function GET(req: Request) {
  try {
    const currentUser = await getCurrentUserWithRole();

    if (!currentUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!["Admin", "Manager"].includes(currentUser.role)) {
      return NextResponse.json(
        { error: "Forbidden: Only Admin and Manager can view knowledge sources" },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(req.url);
    const type = searchParams.get('type');
    const paginationParams = getPaginationParams(req);

    // Determine the WHERE clause based on type
    let whereCondition = Prisma.empty;
    if (type === 'source') {
      whereCondition = Prisma.sql`WHERE sheet_name IN ('WEB_URL', 'GOOGLE_SHEET')`;
    } else if (type === 'document') {
      whereCondition = Prisma.sql`WHERE (sheet_name NOT IN ('WEB_URL', 'GOOGLE_SHEET') OR sheet_name IS NULL)`;
    }

    try {
      const sourcesResult = await prisma.$queryRaw<KnowledgeSourceRow[]>`
        SELECT 
          *,
          COUNT(*) OVER() as full_count
        FROM public.knowledge_sources
        ${whereCondition}
        ORDER BY created_at DESC
        LIMIT ${paginationParams.limit} OFFSET ${paginationParams.skip}
      `;

      const totalCount = Number(sourcesResult[0]?.full_count || 0);
      const sources = sourcesResult.map((row) => {
        const { full_count, ...rest } = row;
        void full_count;
        return rest;
      });

      const driveSources = await listDriveKnowledgeSources(type);
      if (driveSources && driveSources.length > 0) {
        const driveVisibleIds = new Set(
          driveSources
            .map((source) => getSourceKey(source))
            .filter((id): id is string => Boolean(id)),
        );
        const allSourcesResult = await prisma.$queryRaw<KnowledgeSourceRow[]>`
          SELECT
            *,
            COUNT(*) OVER() as full_count
          FROM public.knowledge_sources
          ${whereCondition}
          ORDER BY created_at DESC
          LIMIT 1000
        `;
        const allSources = allSourcesResult.map((row) => {
          const { full_count, ...rest } = row;
          void full_count;
          return rest;
        });
        const merged = mergeKnowledgeSources(allSources, driveSources);
        const sourcesWithState = await addSourceStates(merged, driveVisibleIds);
        return NextResponse.json(formatPaginatedResponse(
          sourcesWithState.slice(
            paginationParams.skip,
            paginationParams.skip + paginationParams.limit,
          ),
          sourcesWithState.length,
          paginationParams,
        ));
      }

      const sourcesWithState = await addSourceStates(sources, new Set());
      return NextResponse.json(formatPaginatedResponse(sourcesWithState, totalCount, paginationParams));
    } catch (databaseError) {
      console.warn("[knowledge-sources-db-unavailable]", { error: databaseError });
      const driveSources = await listDriveKnowledgeSources(type);

      if (driveSources) {
        const driveVisibleIds = new Set(
          driveSources
            .map((source) => getSourceKey(source))
            .filter((id): id is string => Boolean(id)),
        );
        const sourcesWithState = await addSourceStates(driveSources, driveVisibleIds, {
          loadIndexFacts: false,
        });
        const pageItems = sourcesWithState.slice(
          paginationParams.skip,
          paginationParams.skip + paginationParams.limit,
        );
        return NextResponse.json(formatPaginatedResponse(
          pageItems,
          driveSources.length,
          paginationParams,
        ));
      }

      throw databaseError;
    }
  } catch (error) {
    console.error("Failed to fetch sources:", error);
    return NextResponse.json({ error: "Failed to fetch sources" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const currentUser = await getCurrentUserWithRole();

    if (!currentUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!["Admin", "Manager"].includes(currentUser.role)) {
      return NextResponse.json(
        { error: "Forbidden: Only Admin and Manager can add knowledge sources" },
        { status: 403 }
      );
    }

    const body = await request.json();

    let data: {
      drive_file_id: string;
      drive_name: string;
      sheet_name?: string;
      hash?: string;
    };

    // Nếu là Web URL (từ chức năng "Thêm nguồn")
    if (body.source_url) {
      const url = body.source_url;
      let pageTitle = body.source_name || url; // Mặc định là user input hoặc URL

      try {
        // Fetch URL để lấy metadata (title)
        const res = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; KnowledgeBot/1.0)' }
        });
        if (res.ok) {
          const html = await res.text();
          // Regex đơn giản để lấy nội dung thẻ <title>
          const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
          if (match && match[1]) {
            pageTitle = match[1].trim();
          }
        }
      } catch (err) {
        console.error("Error fetching URL metadata:", err);
        // Nếu lỗi fetch thì vẫn giữ title mặc định và tiếp tục lưu
      }

      data = {
        drive_file_id: url,          // Lưu URL vào drive_file_id
        drive_name: pageTitle,       // Lưu Title lấy được vào drive_name
        sheet_name: "WEB_URL",       // Đánh dấu loại (tận dụng trường sheet_name)
        hash: body.refresh_frequency // Tận dụng trường hash để lưu frequency
      };
    } else {
      // Logic cũ cho Google Drive/Sheet
      data = {
        drive_file_id: body.drive_file_id,
        drive_name: body.drive_name,
        hash: body.hash,
        sheet_name: body.sheet_name,
      };
    }

    const newSource = await prisma.knowledge_sources.create({
      data: data
    });

    return NextResponse.json(newSource, { status: 201 });
  } catch (error) {
    console.error("Failed to add source:", error);
    return NextResponse.json({ error: "Failed to add source" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const currentUser = await getCurrentUserWithRole();

    if (!currentUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!["Admin", "Manager"].includes(currentUser.role)) {
      return NextResponse.json(
        { error: "Forbidden: Only Admin and Manager can delete knowledge sources" },
        { status: 403 },
      );
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "Missing source id" }, { status: 400 });
    }

    if (!UUID_PATTERN.test(id)) {
      return NextResponse.json(
        {
          error:
            "This item is listed directly from Google Drive fallback. Delete it in Drive, or sync it into the database before deleting from the app.",
        },
        { status: 409 },
      );
    }

    const source = await prisma.knowledge_sources.findUnique({
      where: { id },
    });

    if (!source) {
      return NextResponse.json({ error: "Knowledge source not found" }, { status: 404 });
    }

    await prisma.$transaction([
      ...(source.drive_file_id
        ? [
            prisma.file_search_storage.deleteMany({
              where: { drive_file_id: source.drive_file_id },
            }),
          ]
        : []),
      prisma.knowledge_sources.delete({
        where: { id },
      }),
    ]);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete source:", error);
    return NextResponse.json({ error: "Failed to delete source" }, { status: 500 });
  }
}
