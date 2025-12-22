import { NextResponse } from 'next/server';
import { google } from 'googleapis';
import { Readable } from 'stream';
import { db as prisma } from "@/lib/db";


async function uploadToGoogleDrive(file: File) {
  const serviceAccountBase64 = process.env.GOOGLE_SERVICE_ACCOUNT_BASE64;
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  const userToImpersonate = process.env.GOOGLE_DRIVE_IMPERSONATED_USER_EMAIL;

  if (!serviceAccountBase64 || !folderId || !userToImpersonate) {
    throw new Error("Missing Google Drive configuration (Env vars)");
  }

  // 1. Decode a key
  const serviceAccountJson = Buffer.from(
    serviceAccountBase64,
    'base64'
  ).toString('utf-8');

  let credentials;
  try {
    credentials = JSON.parse(serviceAccountJson);
  } catch (e) {
    throw new Error("Invalid Google Service Account JSON");
  }

  // 2. Auth
  const auth = new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ['https://www.googleapis.com/auth/drive.file'],
    subject: userToImpersonate,
  });

  const drive = google.drive({ version: 'v3', auth });

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
    fields: 'id,name',
  });

  return response.data;
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

  } catch (error: any) {
    console.error('An error occurred during file upload:', error);
    // Return the actual error message for debugging
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
