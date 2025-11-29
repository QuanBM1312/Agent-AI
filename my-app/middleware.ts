import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Các đường dẫn API cần bảo vệ bằng API Key (dành cho n8n hoặc server-to-server)
// Lưu ý: Các API này sẽ KHÔNG check session của user, chỉ check API Key trong Header
const PROTECTED_API_ROUTES = [
  "/api/job-reports",
  "/api/calendar-events",
  "/api/knowledge/sources",
  "/api/jobs",
  // "/api/chat/internal" // Nếu muốn bảo vệ cả chat nội bộ
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 1. Bỏ qua các request đến trang tài liệu, static files, hoặc các route public khác
  if (
    pathname.startsWith("/docs") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon.ico") ||
    pathname === "/"
  ) {
    return NextResponse.next();
  }

  // 2. Kiểm tra API Key cho các route được bảo vệ (Server-to-Server / n8n)
  // Logic: Nếu request gửi đến các path trong PROTECTED_API_ROUTES và method là POST/PUT/DELETE (thay đổi dữ liệu)
  // thì bắt buộc phải có API Key. GET có thể mở (hoặc chặn tùy nhu cầu).
  if (PROTECTED_API_ROUTES.some((route) => pathname.startsWith(route))) {
    
    // Chỉ bảo vệ các method thay đổi dữ liệu (POST, PUT, DELETE, PATCH)
    // GET method thường dùng cho UI hiển thị, có thể cần xử lý Auth User riêng (Session)
    // Ở đây ta tập trung chặn n8n/bot lạ spam dữ liệu rác.
    if (["POST", "PUT", "DELETE", "PATCH"].includes(request.method)) {
      const apiKey = request.headers.get("x-api-key");
      const validApiKey = process.env.API_SECRET_KEY;

      // Nếu chưa set biến môi trường thì cảnh báo (nhưng vẫn cho qua ở dev mode hoặc chặn luôn tùy bạn)
      if (!validApiKey) {
        console.warn("WARNING: API_SECRET_KEY is not set in environment variables. API is unprotected.");
        return NextResponse.next();
      }

      if (apiKey !== validApiKey) {
        return NextResponse.json(
          { error: "Unauthorized: Invalid API Key" },
          { status: 401 }
        );
      }
    }
  }

  // 3. Các logic auth khác (ví dụ check session user cho Frontend) có thể thêm vào đây sau này.

  return NextResponse.next();
}

// Cấu hình matcher để middleware chỉ chạy trên các path cần thiết (Tối ưu hiệu năng)
export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
