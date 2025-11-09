import { NextResponse } from 'next/server';

/**
 * @swagger
 * /api/chat-with-agent:
 *   post:
 *     summary: Gửi tin nhắn đến RAG agent của n8n
 *     description: Endpoint này nhận tin nhắn từ người dùng và một session ID, sau đó chuyển tiếp đến workflow của n8n để xử lý và trả về câu trả lời từ agent.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               chatInput:
 *                 type: string
 *                 description: Tin nhắn của người dùng.
 *                 example: "Công thức 1 là gì?"
 *               sessionId:
 *                 type: string
 *                 description: ID duy nhất cho mỗi phiên trò chuyện để duy trì ngữ cảnh.
 *                 example: "user123-convo456"
 *             required:
 *               - chatInput
 *               - sessionId
 *     responses:
 *       200:
 *         description: Phản hồi thành công từ agent n8n.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               description: Cấu trúc của response sẽ phụ thuộc vào output của workflow n8n.
 *       400:
 *         description: Request không hợp lệ do thiếu `chatInput` hoặc `sessionId`.
 *       500:
 *         description: Lỗi server, ví dụ như không thể kết nối đến n8n.
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

    const n8nWebhookUrl = process.env.N8N_CHAT_WEBHOOK_URL;

    if (!n8nWebhookUrl) {
      throw new Error('N8N_CHAT_WEBHOOK_URL is not defined in environment variables');
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
  
    // n8n chat trigger thường trả về một response stream.
    // Cách xử lý sẽ phụ thuộc vào việc bạn có muốn stream câu trả lời về frontend hay không.
    // Ở đây chúng ta chỉ đơn giản là trả về toàn bộ kết quả khi nó hoàn thành.
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
