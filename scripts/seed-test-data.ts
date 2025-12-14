/**
 * Script to seed test data for RBAC testing
 * Run: npx tsx scripts/seed-test-data.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding test data...');

  // 1. Create Departments
  console.log('Creating departments...');
  const deptThietKe = await prisma.departments.upsert({
    where: { name: 'Thiết kế' },
    update: {},
    create: { name: 'Thiết kế' },
  });

  const deptThiCong = await prisma.departments.upsert({
    where: { name: 'Thi công' },
    update: {},
    create: { name: 'Thi công' },
  });

  const deptDichVu = await prisma.departments.upsert({
    where: { name: 'Dịch vụ' },
    update: {},
    create: { name: 'Dịch vụ' },
  });

  console.log('✅ Departments created:', {
    thietKe: deptThietKe.id,
    thiCong: deptThiCong.id,
    dichVu: deptDichVu.id,
  });

  // 2. Create Test Customer
  console.log('Creating test customer...');

  // Check if test customer already exists
  let customer = await prisma.customers.findFirst({
    where: { phone: '0901234567' },
  });

  if (!customer) {
    customer = await prisma.customers.create({
      data: {
        company_name: 'Công ty TNHH ABC',
        contact_person: 'Nguyễn Văn A',
        phone: '0901234567',
        address: '123 Đường Test, Quận 1, TP.HCM',
        customer_type: 'Doanh_nghi_p',
      },
    });
  }

  console.log('✅ Customer created:', customer.id);

  // 3. Create Materials and Services
  console.log('Creating materials and services...');
  const material1 = await prisma.materials_and_services.upsert({
    where: { item_code: 'VT001' },
    update: {},
    create: {
      item_code: 'VT001',
      name: 'Ống nước PVC D21',
      type: 'V_t_t_',
      unit: 'Cái',
      price: 50000,
    },
  });

  const material2 = await prisma.materials_and_services.upsert({
    where: { item_code: 'VT002' },
    update: {},
    create: {
      item_code: 'VT002',
      name: 'Van khóa nước',
      type: 'V_t_t_',
      unit: 'Cái',
      price: 120000,
    },
  });

  const service1 = await prisma.materials_and_services.upsert({
    where: { item_code: 'NC001' },
    update: {},
    create: {
      item_code: 'NC001',
      name: 'Lắp đặt hệ thống nước',
      type: 'Nh_n_c_ng',
      unit: 'Giờ',
      price: 150000,
    },
  });

  console.log('✅ Materials/Services created:', {
    material1: material1.id,
    material2: material2.id,
    service1: service1.id,
  });

  // 4. Create Sample Job
  console.log('Creating sample job...');
  const job = await prisma.jobs.create({
    data: {
      job_code: 'JOB-TEST-001',
      customer_id: customer.id,
      job_type: 'L_p___t_m_i',
      status: 'M_i',
      scheduled_start_time: new Date('2025-12-15T08:00:00Z'),
      scheduled_end_time: new Date('2025-12-15T17:00:00Z'),
      notes: 'Job test cho RBAC system',
      job_line_items: {
        create: [
          {
            item_id: material1.id,
            quantity: 10,
            unit_price: 50000,
          },
          {
            item_id: service1.id,
            quantity: 4,
            unit_price: 150000,
          },
        ],
      },
    },
  });

  console.log('✅ Sample job created:', job.id);

  console.log('\n🎉 Seeding completed!');
  console.log('\n📝 Next steps:');
  console.log('1. Create test users in Clerk Dashboard with these emails:');
  console.log('   - admin@test.com (Role: Admin)');
  console.log('   - manager.thietke@test.com (Role: Manager, Dept: Thiết kế)');
  console.log('   - manager.thicong@test.com (Role: Manager, Dept: Thi công)');
  console.log('   - tech.thietke1@test.com (Role: Technician, Dept: Thiết kế)');
  console.log('   - tech.thicong1@test.com (Role: Technician, Dept: Thi công)');
  console.log('   - sales@test.com (Role: Sales)');
  console.log('\n2. Update users table with department_id and role');
  console.log('\n3. Run test scenarios from test_scenarios.md');
}

main()
  .catch((e) => {
    console.error('❌ Error seeding data:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
