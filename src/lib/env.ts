import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  DATABASE_URL: z.string().url(),

  NEXTAUTH_URL: z.string().url(),
  NEXTAUTH_SECRET: z.string().min(32),

  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM_NUMBER: z.string().optional(),

  OUTLOOK_TENANT_ID: z.string().optional(),
  OUTLOOK_CLIENT_ID: z.string().optional(),
  OUTLOOK_CLIENT_SECRET: z.string().optional(),
  OUTLOOK_MAILBOX_ADDRESS: z.string().email().optional(),

  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().email().optional(),

  CRON_SECRET: z.string().optional(),

  BUILDIUM_BASE_URL: z.string().url().default("https://api.buildium.com/v1"),
  BUILDIUM_CLIENT_ID: z.string().optional(),
  BUILDIUM_CLIENT_SECRET: z.string().optional(),
  BUILDIUM_VENDOR_NAME: z.string().default("Knu Construction"),
  BUILDIUM_DEFAULT_GL_ACCOUNT_ID: z.string().optional(),
  BUILDIUM_DEFAULT_BANK_ACCOUNT_ID: z.string().optional(),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
    .join("\n");
  throw new Error(`Invalid environment variables:\n${issues}`);
}

export const env = parsed.data;

type RequiredGroup = { name: string; keys: (keyof typeof env)[] };

const requiredInProd: RequiredGroup[] = [
  {
    name: "Twilio (SMS)",
    keys: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER"],
  },
  {
    name: "Outlook (intake)",
    keys: [
      "OUTLOOK_TENANT_ID",
      "OUTLOOK_CLIENT_ID",
      "OUTLOOK_CLIENT_SECRET",
      "OUTLOOK_MAILBOX_ADDRESS",
    ],
  },
  {
    name: "Resend (email)",
    keys: ["RESEND_API_KEY", "EMAIL_FROM"],
  },
];

export function assertProviderEnv(name: "Twilio (SMS)" | "Outlook (intake)" | "Resend (email)") {
  const group = requiredInProd.find((g) => g.name === name);
  if (!group) return;
  const missing = group.keys.filter((k) => !env[k]);
  if (missing.length) {
    throw new Error(
      `${name} is not configured. Missing: ${missing.join(", ")}`,
    );
  }
}
