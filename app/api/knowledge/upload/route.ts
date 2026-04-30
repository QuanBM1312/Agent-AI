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

function buildGoogleDriveAuth() {
  const serviceAccount = parseServiceAccountCredentials();
  const impersonatedUser = process.env.GOOGLE_DRIVE_IMPERSONATED_USER_EMAIL;

  if (serviceAccount?.client_email && serviceAccount?.private_key) {
    return new google.auth.JWT({
      email: serviceAccount.client_email,
      key: serviceAccount.private_key,
      scopes: DRIVE_SCOPES,
      subject: impersonatedUser,
    });
  }

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "Missing Google Drive credentials. Provide GOOGLE_SERVICE_ACCOUNT_BASE64 / GOOGLE_SERVICE_ACCOUNT_JSON / GDRIVE_JSON, or the OAuth fallback env vars."
    );
  }

  const auth = new google.auth.OAuth2(
    clientId,
    clientSecret,
    "https://developers.google.com/oauthplayground" // redirect URI
  );

  auth.setCredentials({ refresh_token: refreshToken });
  return auth;
}

async function uploadToGoogleDrive(
  file: File
): Promise<drive_v3.Schema$File> {
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

  if (!folderId) {
    throw new Error("Missing GOOGLE_DRIVE_FOLDER_ID");
  }

  const auth = buildGoogleDriveAuth();
  const drive = google.drive({ version: 'v3', auth });

  console.log(`Starting upload to Google Drive for file: ${file.name}`);

  // 3. Prepare content
  const fileBuffer = Buffer.from(await file.arrayBuffer());
  const media = {
    mimeType: file.type,
    body: Readable.from(fileBuffer),
  };

  // 4. Send file
  const response = await drive.files.create({
    media: media,
    requestBody: {
      name: file.name,
      parents: [folderId],
    },
    fields: 'id, name, webViewLink, webContentLink',
  });

  const fileData = response.data;
  console.log(`Successfully uploaded. File ID: ${fileData.id}`);

  return fileData;
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

    // Step 1: Upload the file to Google Drive
    const uploadedFile = await uploadToGoogleDrive(file);

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

    // Step 3: Trigger the n8n vectorization workflow
    const n8nWebhookUrl = process.env.N8N_INGESTION_WEBHOOK_URL;
    if (!n8nWebhookUrl) {
      console.warn('N8N_INGESTION_WEBHOOK_URL is not defined. Skipping direct n8n trigger.');
    } else {
      try {
        // Fire and forget
        fetch(n8nWebhookUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            id: uploadedFile.id,
            name: uploadedFile.name,
            mimeType: file.type,
          }),
        });
      } catch (n8nError) {
        console.error('Failed to trigger n8n ingestion webhook:', n8nError);
      }
    }

    // Respond to the client immediately
    return NextResponse.json({
      message: 'File uploaded successfully. Processing has been initiated.',
      fileId: uploadedFile.id,
      fileName: uploadedFile.name,
    });

  } catch (error: unknown) {
    console.error('An error occurred during file upload:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    // Return the actual error message for debugging
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
