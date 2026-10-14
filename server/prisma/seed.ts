import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const adminEmail = process.env.ADMIN_EMAIL ?? 'admin@nodepay.local';
  const adminPassword = process.env.ADMIN_PASSWORD ?? '';

  if (adminPassword) {
    const existing = await prisma.user.findUnique({ where: { email: adminEmail } });
    if (!existing) {
      await prisma.user.create({
        data: {
          email: adminEmail,
          passwordHash: await bcrypt.hash(adminPassword, 12),
          role: 'ADMIN',
          name: 'NodePay Admin',
          feeBps: 0,
        },
      });
      console.log(`[seed] admin created: ${adminEmail}`);
    } else {
      console.log('[seed] admin already exists');
    }
  } else {
    console.log('[seed] ADMIN_PASSWORD not set — skipping admin seed');
  }

  const demoEmail = process.env.DEMO_MERCHANT_EMAIL;
  if (demoEmail && process.env.DEMO_MERCHANT_PASSWORD) {
    const existing = await prisma.user.findUnique({ where: { email: demoEmail } });
    if (!existing) {
      await prisma.user.create({
        data: {
          email: demoEmail,
          passwordHash: await bcrypt.hash(process.env.DEMO_MERCHANT_PASSWORD, 12),
          name: 'Demo Merchant',
        },
      });
      console.log(`[seed] demo merchant created: ${demoEmail}`);
    }
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
