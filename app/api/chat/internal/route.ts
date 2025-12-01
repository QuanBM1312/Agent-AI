import { NextResponse } from 'next/server';

/**
 * @swagger
 * /api/chat/internal:
 *   post:
 *     summary: Send a message to the n8n RAG agent
 *     description: This endpoint forwards a user's message and session ID to the main n8n workflow for processing and returns the agent's response.
 *     tags: [Chat]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               chatInput:
 *                 type: string
 *                 description: The user's message.
 *                 example: "What is the F1 regulation for 2025?"
 *               sessionId:
 *                 type: string
 *                 description: A unique ID for each chat session to maintain context.
 *                 example: "user123-convo456"
 *             required:
 *               - chatInput
 *               - sessionId
 *     responses:
 *       200:
 *         description: Successful response from the n8n agent.
 *       400:
 *         description: Invalid request due to missing `chatInput` or `sessionId`.
 *       500:
 *         description: Server error, e.g., unable to connect to n8n.
 */
export async function POST(request: Request) {
  try {
    const { chatInput, sessionId } = await request.json();

    if (!chatInput || !sessionId) {
      return NextResponse.json(
        { message: 'Missing chatInput or sessionId' },
        { status: 400 }
      );
    }

    const n8nWebhookUrl = process.env.N8N_MAIN_RAG_WEBHOOK_URL;

    if (!n8nWebhookUrl) {
      throw new Error('N8N_MAIN_RAG_WEBHOOK_URL is not defined in environment variables');
    }

    const response = await fetch(n8nWebhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chatInput,
        sessionId,
      }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error('Failed to call n8n agent:', errorText);
        return NextResponse.json(
          { message: 'Failed to call n8n agent' },
          { status: response.status }
        );
      }

    const result = await response.json();

    return NextResponse.json(result);

  } catch (error) {
    console.error(error);
    if (error instanceof Error) {
        return NextResponse.json({ message: error.message }, { status: 500 });
    }
    return NextResponse.json({ message: 'An unknown error occurred' }, { status: 500 });
  }
}