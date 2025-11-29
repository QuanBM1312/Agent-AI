// CẤU HÌNH
const BASE_URL = "http://localhost:3000"; // Đảm bảo server Next.js đang chạy
const API_KEY = "password123"; // Khớp với .env của bạn

// --- CẤU HÌNH N8N ---
// Điền URL Webhook n8n của bạn vào đây để test kết nối trực tiếp
// Ví dụ: https://your-n8n-app.railway.app/webhook/process-new-report
const N8N_WEBHOOK_URL = "https://primary-production-79be44.up.railway.app/webhook/97ab234b-6d5d-4e9d-ba12-e12f634bb008"; 

// Helper function
async function callApi(path, method = "GET", body = null, useKey = true, fullUrl = false) {
  const headers = {
    "Content-Type": "application/json",
  };
  if (useKey && !fullUrl) { // Chỉ gửi API Key cho Backend của mình
    headers["x-api-key"] = API_KEY;
  }

  const options = {
    method,
    headers,
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const url = fullUrl ? path : `${BASE_URL}${path}`;
  
  try {
    const res = await fetch(url, options);
    // n8n thường trả về text hoặc json tùy cấu hình, ta handle cả 2
    const text = await res.text();
    let data;
    try {
        data = JSON.parse(text);
    } catch {
        data = text;
    }
    return { status: res.status, data };
  } catch (error) {
    return { status: 0, data: error.message };
  }
}

async function runTests() {
  console.log("🚀 STARTING SYSTEM HEALTH CHECK...\n");

  // --- 0. CHECK N8N CONNECTION ---
  console.log("🔹 0. Checking Direct Connection to n8n...");
  if (N8N_WEBHOOK_URL && N8N_WEBHOOK_URL.startsWith("http")) {
      const n8nCheck = await callApi(N8N_WEBHOOK_URL, "POST", { test: "ping_from_script" }, false, true);
      if (n8nCheck.status >= 200 && n8nCheck.status < 300) {
          console.log("✅ n8n Connection Passed: Webhook is reachable.");
      } else {
          console.warn("⚠️  n8n Connection Warning: Could not reach n8n Webhook.");
          console.warn(`   Status: ${n8nCheck.status}. Error: ${JSON.stringify(n8nCheck.data)}`);
          console.warn("   -> Please check N8N_WEBHOOK_URL in this script or n8n server status.");
      }
  } else {
      console.log("ℹ️  Skipping n8n check: No valid N8N_WEBHOOK_URL provided in script.");
  }

  // --- 1. TEST AUTHENTICATION ---
  console.log("\n🔹 1. Testing Security Middleware...");
  const authTest = await callApi("/api/jobs", "POST", { dummy: "data" }, false); // Không gửi Key
  if (authTest.status === 401) {
    console.log("✅ Auth Check Passed: Protected API rejected request without key.");
  } else {
    console.error("❌ Auth Check Failed: API accepted request without key!", authTest.status);
  }

  // --- 2. CREATE USER (Mock) ---
  // Vì API Users chưa có POST public, ta giả định dùng một ID có sẵn hoặc tạo tạm nếu cần.
  // Để đơn giản cho test này, ta sẽ dùng một UUID giả định là ID của Admin/Tech đang login
  const TECH_ID = "d290f1ee-6c54-4b01-90e6-d701748f0851"; // ID từ file .env cũ hoặc DB của bạn
  
  // --- 3. CREATE CUSTOMER ---
  console.log("\n🔹 2. Testing Customer Creation...");
  const customerPayload = {
    company_name: `Test Company ${Date.now()}`,
    contact_person: "Test User",
    phone: "0909000111",
    customer_type: "Doanh nghiệp"
  };
  const customerRes = await callApi("/api/customers", "POST", customerPayload);
  
  if (customerRes.status === 201) {
    console.log(`✅ Customer Created: ${customerRes.data.company_name} (ID: ${customerRes.data.id})`);
  } else {
    console.error("❌ Create Customer Failed:", customerRes.data);
    return; // Dừng nếu fail
  }
  const CUSTOMER_ID = customerRes.data.id;

  // --- 4. CREATE JOB ---
  console.log("\n🔹 3. Testing Job Creation...");
  const jobPayload = {
    job_code: `JOB-${Date.now()}`,
    customer_id: CUSTOMER_ID,
    status: "M_i",
    notes: "Test job via script",
    scheduled_start_time: new Date().toISOString()
  };
  // Lưu ý: API Job cần Auth
  const jobRes = await callApi("/api/jobs", "POST", jobPayload, true);

  if (jobRes.status === 201) {
    console.log(`✅ Job Created: ${jobRes.data.job_code} (ID: ${jobRes.data.id})`);
  } else {
    console.error("❌ Create Job Failed:", jobRes.data);
    return;
  }
  const JOB_ID = jobRes.data.id;

  // --- 5. SUBMIT JOB REPORT (Trigger n8n) ---
  console.log("\n🔹 4. Testing Job Report Submission (Triggers n8n)...");
  const reportPayload = {
    job_id: JOB_ID,
    created_by_user_id: TECH_ID, // Cần đảm bảo ID này tồn tại trong bảng Users
    problem_summary: "Máy chạy kêu to, đã kiểm tra",
    actions_taken: "Đã tra dầu, vệ sinh lọc gió",
    voice_message_url: "https://example.com/voice.mp3"
  };
  
  // API này cũng cần Auth
  const reportRes = await callApi("/api/job-reports", "POST", reportPayload, true);

  if (reportRes.status === 201) {
    console.log("✅ Job Report Submitted Successfully.");
    console.log("   -> Check n8n logs to see if workflow was triggered!");
  } else if (reportRes.status === 500 && reportRes.data.error?.includes("Foreign key constraint")) {
     console.error("⚠️  User ID Check Failed: The TECH_ID used in script does not exist in your DB.");
     console.error("   -> Please update TECH_ID in the script with a valid User ID from your 'users' table.");
  } else {
    console.error("❌ Submit Report Failed:", reportRes.data);
  }

  console.log("\n🎉 TEST COMPLETE.");
}

runTests();
