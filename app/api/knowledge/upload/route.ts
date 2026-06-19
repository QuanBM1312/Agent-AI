import { NextResponse } from 'next/server';
import { drive_v3, google } from 'googleapis';
import { Readable } from 'stream';
import { db as prisma } from "@/lib/db";
import { getCurrentUserWithRole } from "@/lib/auth-utils";

const DRIVE_SCOPES = ['https://www.googleapis.com/auth/drive'];

function parseServiceAccountCredentials() {
  const rawJson =
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
    process.env.GDRIVE_JSON;
  const base64Json = process.env.GOOGLE_SERVICE_ACCOUNT_BASE64;

  if (rawJson) {
    return JSON.parse(rawJson);
  }

  if (base64Json) {
    return JSON.parse(Buffer.from(base64Json, "base64").toString("utf8"));
  }

  return null;
}

function buildGoogleDriveUploadAuthCandidates() {
  const authCandidates = [];
  const serviceAccount = parseServiceAccountCredentials();
  const useDomainWideDelegation =
    process.env.GOOGLE_SERVICE_ACCOUNT_USE_DOMAIN_WIDE_DELEGATION === "1";
  const impersonatedUser = useDomainWideDelegation
    ? process.env.GOOGLE_DRIVE_IMPERSONATED_USER_EMAIL
    : undefined;

  if (serviceAccount?.client_email && serviceAccount?.private_key) {
    authCandidates.push(new google.auth.JWT({
      email: serviceAccount.client_email,
      key: serviceAccount.private_key,
      scopes: DRIVE_SCOPES,
      subject: impersonatedUser,
    }));
  }

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;

  if (clientId && clientSecret && refreshToken) {
    const auth = new google.auth.OAuth2(
      clientId,
      clientSecret,
      "https://developers.google.com/oauthplayground" // redirect URI
    );

    auth.setCredentials({ refresh_token: refreshToken });
    authCandidates.push(auth);
  }

  return authCandidates;
}

async function uploadToGoogleDrive(
  file: File
): Promise<{ fileData: drive_v3.Schema$File; fileBuffer: Buffer }> {
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

  if (!folderId) {
    throw new Error("Missing GOOGLE_DRIVE_FOLDER_ID");
  }

  console.log(`Starting upload to Google Drive for file: ${file.name}`);

  // 3. Prepare content
  const fileBuffer = Buffer.from(await file.arrayBuffer());
  let lastError: unknown = null;

  for (const auth of buildGoogleDriveUploadAuthCandidates()) {
    try {
      const drive = google.drive({ version: 'v3', auth });
      const media = {
        mimeType: file.type,
        body: Readable.from(fileBuffer),
      };
      const response = await drive.files.create({
        media,
        requestBody: {
          name: file.name,
          parents: [folderId],
        },
        fields: 'id, name, webViewLink, webContentLink',
        supportsAllDrives: true,
      });

      const fileData = response.data;
      console.log(`Successfully uploaded. File ID: ${fileData.id}`);

      return { fileData, fileBuffer };
    } catch (error) {
      lastError = error;
      console.warn("Google Drive upload auth candidate failed", error);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}


/**
 * @swagger
 * /api/knowledge/upload:
 *   post:
 *     summary: Upload a file to Google Drive for n8n processing
 *     description: Receives a file and uploads it to a pre-configured Google Drive folder, triggering the n8n knowledge ingestion workflow.
 *     tags: [Knowledge]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: The file to be processed.
 *     responses:
 *       200:
 *         description: File uploaded successfully to Google Drive.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "File uploaded successfully to Google Drive"
 *                 fileId:
 *                   type: string
 *       400:
 *         description: Bad request, file is required.
 *       500:
 *         description: Internal server error, e.g., failed to upload.
 */
export async function POST(request: Request) {
  try {
    const currentUser = await getCurrentUserWithRole();

    if (!currentUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!["Admin", "Manager"].includes(currentUser.role)) {
      return NextResponse.json(
        { error: "Forbidden: Only Admin and Manager can upload knowledge" },
        { status: 403 }
      );
    }

    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ error: 'File is required' }, { status: 400 });
    }

    // Bound the size — the file is read into memory and base64-encoded into the
    // n8n webhook body (~33% blowup), so a huge upload OOMs the function.
    const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: `File quá lớn (tối đa ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB)` },
        { status: 413 }
      );
    }

    // Step 1: Upload the file to Google Drive
    const { fileData: uploadedFile, fileBuffer } = await uploadToGoogleDrive(file);

    if (!uploadedFile.id) {
      throw new Error("Failed to get file ID from Google Drive");
    }

    // Step 2: Save metadata to Database
    // Storing size in 'hash' as a workaround per plan
    const sizeString = (file.size).toString();
    // Determine sheet_name based on extension for filtering later
    const ext = file.name.split('.').pop()?.toUpperCase() || "FILE";

    await prisma.knowledge_sources.create({
      data: {
        drive_file_id: uploadedFile.id,
        drive_name: uploadedFile.name,
        sheet_name: ext,
        hash: sizeString,
      }
    });

    const existingSearchStorage = await prisma.file_search_storage.findFirst({
      where: {
        drive_file_id: uploadedFile.id,
      },
      select: {
        id: true,
      },
    });

    if (!existingSearchStorage) {
      await prisma.file_search_storage.create({
        data: {
          drive_file_id: uploadedFile.id,
          drive_name: uploadedFile.name,
          hash: sizeString,
        },
      });
    }

    // Step 3: Trigger the n8n vectorization workflow
    const n8nWebhookUrl = process.env.N8N_INGESTION_WEBHOOK_URL;
    let ingestionStatus: {
      triggered: boolean;
      status?: number;
      ok?: boolean;
      error?: string;
    } = { triggered: false };

    if (!n8nWebhookUrl) {
      console.warn('N8N_INGESTION_WEBHOOK_URL is not defined. Skipping direct n8n trigger.');
    } else {
      try {
        const ingestionResponse = await fetch(n8nWebhookUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          signal: AbortSignal.timeout(10_000),
          body: JSON.stringify({
            id: uploadedFile.id,
            name: uploadedFile.name,
            mimeType: file.type,
            size: file.size,
            dataBase64: fileBuffer.toString("base64"),
          }),
        });
        ingestionStatus = {
          triggered: true,
          status: ingestionResponse.status,
          ok: ingestionResponse.ok,
        };
      } catch (n8nError) {
        console.error('Failed to trigger n8n ingestion webhook:', n8nError);
        ingestionStatus = {
          triggered: true,
          error: n8nError instanceof Error ? n8nError.message : String(n8nError),
        };
      }
    }

    // Respond to the client immediately
    return NextResponse.json({
      message: 'File uploaded successfully. Processing has been initiated.',
      fileId: uploadedFile.id,
      fileName: uploadedFile.name,
      ingestion: ingestionStatus,
    });

  } catch (error: unknown) {
    console.error('An error occurred during file upload:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    // Return the actual error message for debugging
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
