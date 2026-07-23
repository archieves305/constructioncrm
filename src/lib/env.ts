import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  DATABASE_URL: z.string().url(),

  NEXTAUTH_URL: z.string().url(),
  NEXTAUTH_SECRET: z.string().min(32),

  // Public origin the app is reached at, used to build absolute URLs that
  // leave the app: password-reset links, the /co change-order portal, /action
  // tracked links, unsubscribe links, cron digest emails, and the Zapier
  // roofr-callback URL. Kept separate from NEXTAUTH_URL — that one is
  // NextAuth's own callback origin — so the public hostname can be changed
  // (e.g. a domain cutover) without touching auth config. Optional: falls
  // back to NEXTAUTH_URL, which is what every deploy did before the split.
  APP_BASE_URL: z.string().url().optional(),

  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM_NUMBER: z.string().optional(),

  OUTLOOK_TENANT_ID: z.string().optional(),
  OUTLOOK_CLIENT_ID: z.string().optional(),
  OUTLOOK_CLIENT_SECRET: z.string().optional(),
  OUTLOOK_MAILBOX_ADDRESS: z.string().email().optional(),

  MAILERSEND_API_KEY: z.string().optional(),
  // Accepts either a bare "addr@example.com" or "Display Name <addr@example.com>";
  // runtime parser in src/lib/email/send.ts handles both shapes.
  EMAIL_FROM: z.string().min(3).optional(),

  CRON_SECRET: z.string().optional(),

  // Bearer token cc-allocator's worker presents on integration calls.
  // Optional at server-start so the app boots without it; the integration
  // routes 503 when unset.
  CC_ALLOCATOR_API_KEY: z.string().optional(),

  // Bearer token the KNU phone-routing app presents when auto-creating leads
  // from inbound calls. Optional at boot; the integration route 503s when unset.
  // PHONE_ROUTING_SYSTEM_USER_ID optionally pins the User that phone-created
  // leads are attributed to; falls back to the first active ADMIN.
  PHONE_ROUTING_API_KEY: z.string().optional(),
  PHONE_ROUTING_SYSTEM_USER_ID: z.string().optional(),

  // Zapier integration for Roofr report ordering. URL is the Zapier
  // "Catch Hook" we POST lead+order data to when the user clicks "Order
  // Roofr Report". Secret is the shared header value we require on the
  // inbound callback Zap that returns the completed report. Both optional
  // so the app boots without them; routes 503 when unset.
  ZAPIER_ROOFR_ORDER_URL: z.string().url().optional(),
  ZAPIER_WEBHOOK_SECRET: z.string().optional(),

  // Keyring for field-level encryption of sensitive personnel data (SSNs).
  // Comma-separated "v<version>:<base64 32-byte key>" entries, e.g.
  // "v1:8mF3...==". The highest version encrypts new writes; older versions
  // stay listed until a rotation sweep re-encrypts their rows. Generate a key
  // with: openssl rand -base64 32. Optional at boot; the SSN set/reveal
  // endpoints 503 when unset (src/lib/crypto/field-encryption.ts).
  FIELD_ENCRYPTION_KEYS: z.string().optional(),

  // Zylow read-only property API (door-knock enrichment). Key is delivered
  // over a secure channel and lives only in /etc/knuco/env — never the client.
  // Optional at boot so the app runs without it; the /api/zylow routes 503
  // when the key is unset. Base defaults to the public v1 path.
  ZYLOW_API_KEY: z.string().optional(),
  ZYLOW_API_BASE: z.string().url().default("https://zylow.net/api/public"),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
    .join("\n");
  throw new Error(`Invalid environment variables:\n${issues}`);
}

// APP_BASE_URL is always present downstream and never carries a trailing
// slash, so callers can interpolate `${env.APP_BASE_URL}/path` directly.
export const env = {
  ...parsed.data,
  APP_BASE_URL: (parsed.data.APP_BASE_URL ?? parsed.data.NEXTAUTH_URL).replace(
    /\/$/,
    "",
  ),
};

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
    name: "MailerSend (email)",
    keys: ["MAILERSEND_API_KEY", "EMAIL_FROM"],
  },
];

export function assertProviderEnv(name: "Twilio (SMS)" | "Outlook (intake)" | "MailerSend (email)") {
  const group = requiredInProd.find((g) => g.name === name);
  if (!group) return;
  const missing = group.keys.filter((k) => !env[k]);
  if (missing.length) {
    throw new Error(
      `${name} is not configured. Missing: ${missing.join(", ")}`,
    );
  }
}
