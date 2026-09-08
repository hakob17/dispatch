import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const FIRST = ["Ani", "Aram", "Lilit", "Narek", "Mariam", "Tigran", "Sona", "Vahe", "Anna", "Davit"];
const LAST = ["Petrosyan", "Hakobyan", "Sargsyan", "Karapetyan", "Grigoryan"];
const PLANS = ["free", "pro", "enterprise"];
const CITIES = ["Yerevan", "Gyumri", "Berlin", "London", "NYC"];

async function main() {
  // Default admin account (change the password after first login!)
  if ((await db.user.count()) === 0) {
    const { hashPassword } = await import("../src/lib/password");
    await db.user.create({
      data: {
        email: "admin@dispatch.local",
        name: "Admin",
        role: "ADMIN",
        passwordHash: hashPassword("admin123!"),
      },
    });
    console.log("Created admin account: admin@dispatch.local / admin123!  — change this password.");
  }

  const count = await db.contact.count();
  if (count > 0) {
    console.log(`DB already has ${count} contacts — skipping seed.`);
    return;
  }

  for (let i = 0; i < 50; i++) {
    const firstName = FIRST[i % FIRST.length];
    const lastName = LAST[i % LAST.length];
    await db.contact.create({
      data: {
        email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}${i}@example.com`,
        firstName,
        lastName,
        attributes: {
          plan: PLANS[i % PLANS.length],
          city: CITIES[i % CITIES.length],
          signupSource: i % 2 ? "organic" : "ads",
        },
      },
    });
  }

  await db.segment.create({
    data: {
      name: "Pro plan users",
      filters: [{ field: "attributes.plan", op: "eq", value: "pro" }],
    },
  });

  await db.messageTemplate.create({
    data: {
      name: "Welcome email",
      channel: "EMAIL",
      subject: "Welcome aboard, {{firstName}}!",
      htmlBody: `<html><body style="font-family: Georgia, serif; max-width: 560px; margin: 0 auto; padding: 24px;">
  <h1 style="color: #17130e;">Hello {{firstName}} 👋</h1>
  <p>Thanks for joining. You're on the <strong>{{attributes.plan}}</strong> plan.</p>
  <p><a href="https://example.com/get-started" style="color: #e8482b;">Get started here</a></p>
</body></html>`,
    },
  });

  await db.messageTemplate.create({
    data: {
      name: "Welcome push",
      channel: "WEB_PUSH",
      pushTitle: "Hey {{firstName}} 👋",
      pushBody: "Your account is ready — jump back in.",
      pushUrl: "http://localhost:3000/demo/push",
    },
  });

  console.log("Seeded 50 contacts, 1 segment, 2 templates.");
}

main().finally(() => db.$disconnect());
