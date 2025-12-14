
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const emailToDelete = 'manager.thietke@test.com'; // Email causing conflict

  console.log(`🔍 Checking for user with email: ${emailToDelete}`);

  const user = await prisma.users.findUnique({
    where: { email: emailToDelete },
  });

  if (!user) {
    console.log('✅ No user found with that email. You are good to go!');
    return;
  }

  console.log(`⚠️ Found conflicting user:`);
  console.log(`   ID: ${user.id}`);
  console.log(`   Email: ${user.email}`);
  console.log(`   Name: ${user.full_name}`);
  console.log(`   Role: ${user.role}`);

  console.log(`\n🗑️ Deleting user...`);
  await prisma.users.delete({
    where: { id: user.id },
  });

  console.log(`✅ User deleted successfully! Now you can run the API request again.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
