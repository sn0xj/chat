import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function upsertAuthUser(params: {
  username: string;
  firstname: string;
  lastname: string;
  passwordHash: string;
}) {
  const now = new Date();
  return prisma.auth.upsert({
    where: { username: params.username },
    update: {
      firstname: params.firstname,
      lastname: params.lastname,
      password: params.passwordHash,
      wrong_attempts: 0,
      updated_at: now,
      last_seen: now,
      last_activity: now,
    },
    create: {
      username: params.username,
      password: params.passwordHash,
      firstname: params.firstname,
      lastname: params.lastname,
      wrong_attempts: 0,
      created_at: now,
      updated_at: now,
      last_seen: now,
      last_activity: now,
      last_password_change_date: now,
    },
  });
}

async function main() {
  const passwordHash = await bcrypt.hash('123456', 10);

  await upsertAuthUser({
    username: 'mikhail',
    firstname: 'Михаил',
    lastname: 'Тестовый',
    passwordHash,
  });

  await upsertAuthUser({
    username: 'elisey',
    firstname: 'Елисей',
    lastname: 'Тестовый',
    passwordHash,
  });

  await upsertAuthUser({
    username: 'maksap',
    firstname: 'OneBomb@',
    lastname: '',
    passwordHash,
  });

  console.log(
    'Seed complete: Auth users Михаил, Елисей и maksap (OneBomb@) created/updated.',
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
