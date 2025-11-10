import Image from "next/image";

export default async function Page() {
  // Logic kết nối database đã được chuyển sang các API routes.
  // Trang này có thể là một trang tĩnh đơn giản hoặc một client component
  // để gọi và lấy dữ liệu từ các API endpoint (ví dụ: /api/users).
  return (
    <div>
      <h1>Welcome</h1>
      <p>
        Các API route đã được cấu hình để kết nối đến cơ sở dữ liệu bằng
        Prisma.
      </p>
    </div>
  );
}
