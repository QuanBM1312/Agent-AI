
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Attempting to connect to the database...');
  try {
    const userCount = await prisma.users.count();
    console.log(`Successfully connected! Found ${userCount} users.`);
    const firstUser = await prisma.users.findFirst();
    console.log('First user:', firstUser);
  } catch (e) {
    console.error('Connection failed:', e);
  } finally {
    await prisma.$disconnect();
  }
}

main();
