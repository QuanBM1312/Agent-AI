import { NextResponse } from 'next/server';
import { google } from 'googleapis';
import { Readable } from 'stream';

async function uploadToGoogleDrive(file: File) {
  // 1. Decode a chave da conta de serviço
  const serviceAccountJson = Buffer.from(
    process.env.GOOGLE_SERVICE_ACCOUNT_BASE64!,
    'base64'
  ).toString('utf-8');
  const credentials = JSON.parse(serviceAccountJson);
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID!;
  const userToImpersonate = process.env.GOOGLE_DRIVE_IMPERSONATED_USER_EMAIL!;

  // 2. Autenticar com delegação de domínio
  const auth = new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ['https://www.googleapis.com/auth/drive.file'],
    subject: userToImpersonate,
  });

  const drive = google.drive({ version: 'v3', auth });

  // 3. Preparar o conteúdo do arquivo
  const fileBuffer = Buffer.from(await file.arrayBuffer());
  const media = {
    mimeType: file.type,
    body: Readable.from(fileBuffer),
  };

  // 4. Enviar o arquivo
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
 * /api/knowledge/upload-file:
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

    // Step 1: Upload the file to Google Drive (already implemented)
    const uploadedFile = await uploadToGoogleDrive(file);

    // Step 2: Trigger the n8n vectorization workflow
    const n8nWebhookUrl = process.env.N8N_INGESTION_WEBHOOK_URL;
    if (!n8nWebhookUrl) {
      // Log an error for the developer, but don't block the user.
      // The file is uploaded, and the polling trigger in n8n can still pick it up later.
      console.warn('N8N_INGESTION_WEBHOOK_URL is not defined. Skipping direct n8n trigger.');
    } else {
      try {
        // We trigger the workflow but don't wait for it to finish (fire and forget)
        fetch(n8nWebhookUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            // The n8n workflow needs to be adapted to read these properties.
            // This structure mimics the output of the Google Drive trigger.
            id: uploadedFile.id,
            name: uploadedFile.name,
            mimeType: file.type,
          }),
        });
      } catch (n8nError) {
        // If the webhook call fails, just log it. Don't fail the whole request.
        console.error('Failed to trigger n8n ingestion webhook:', n8nError);
      }
    }

    // Respond to the client immediately
    return NextResponse.json({
      message: 'File uploaded successfully. Processing has been initiated.',
      fileId: uploadedFile.id,
      fileName: uploadedFile.name,
    });

  } catch (error) {
    console.error('An error occurred during file upload:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

