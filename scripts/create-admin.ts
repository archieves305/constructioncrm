import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";

const VALID_ROLES = [
  "ADMIN",
  "MANAGER",
  "SALES_REP",
  "OFFICE_STAFF",
  "MARKETING",
  "READ_ONLY",
] as const;
type RoleString = (typeof VALID_ROLES)[number];

interface Args {
  email?: string;
  name?: string;
  role?: string;
  password?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (!flag.startsWith("--")) continue;
    const key = flag.slice(2);
    if (value && !value.startsWith("--")) {
      (args as Record<string, string>)[key] = value;
      i++;
    }
  }
  return args;
}

function usage(): never {
  console.error(
    "Usage: npx tsx scripts/create-admin.ts --email <email> --name \"<First Last>\" [--role <RoleName>] [--password <pw>]\n" +
      `  --role one of: ${VALID_ROLES.join(", ")} (default: ADMIN)\n` +
      "  --password optional; if omitted, a 32-char random password is generated and printed once.",
  );
  process.exit(1);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.email || !args.name) usage();

  const role = (args.role ?? "ADMIN") as RoleString;
  if (!VALID_ROLES.includes(role)) {
    console.error(`ERROR: --role must be one of ${VALID_ROLES.join(", ")}`);
    process.exit(1);
  }

  const nameParts = args.name!.trim().split(/\s+/);
  const firstName = nameParts[0];
  const lastName = nameParts.slice(1).join(" ") || "";

  const password = args.password ?? randomBytes(24).toString("base64");
  const generated = !args.password;

  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  try {
    const existing = await prisma.user.findUnique({ where: { email: args.email! } });
    if (existing) {
      console.log(`USER EXISTS, skipping: ${args.email}`);
      return;
    }

    const roleRecord = await prisma.role.findUnique({ where: { name: role as never } });
    if (!roleRecord) {
      console.error(
        `ERROR: role ${role} not found in roles table. Run scripts/seed-prod.ts first.`,
      );
      process.exit(1);
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: {
        firstName,
        lastName,
        email: args.email!,
        passwordHash,
        roleId: roleRecord.id,
        isActive: true,
      },
    });

    console.log(`CREATED user ${user.email} | password: ${password}`);
    if (generated) {
      console.log(
        "NOTE: password was generated cryptographically (24 random bytes, base64). " +
          "Save to your password manager NOW — this is the only time it is displayed.",
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
