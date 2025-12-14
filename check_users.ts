import { prisma } from "./lib/prisma";

async function main() {
  const count = await prisma.users.count();
  console.log(`User count: ${count}`);
  if (count > 0) {
    const firstUser = await prisma.users.findFirst();
    console.log(`First user ID: ${firstUser?.id}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
