import { NextResponse } from 'next/server';

/**
 * @swagger
 * /api/hello:
 *   get:
 *     description: Returns a hello message
 *     tags:
 *       - Hello
 *     responses:
 *       200:
 *         description: Successful response
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Hello, World!"
 */
export async function GET(request: Request) {
  return NextResponse.json({ message: 'Hello, World!' });
}
