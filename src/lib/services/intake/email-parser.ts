export interface ParsedLead {
  firstName: string;
  lastName: string;
  primaryPhone: string;
  email?: string;
  propertyAddress1?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  serviceRequested?: string;
  notes?: string;
  campaignSource?: string;
}

/**
 * Parse Google Ads lead notification emails.
 * Supports common landing-page form notification formats.
 */
export function parseGoogleAdsLeadEmail(bodyText: string, subject: string): ParsedLead | null {
  // Strip HTML tags if present
  const text = bodyText.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

  // Try field-value patterns common in form notification emails
  const fields: Record<string, string> = {};

  // Pattern: "Label: Value" or "Label - Value"
  const fieldPatterns = [
    /(?:^|\n)\s*([A-Za-z\s]+?):\s*(.+?)(?=\n|$)/g,
    /(?:^|\n)\s*([A-Za-z\s]+?)\s*[-–—]\s*(.+?)(?=\n|$)/g,
  ];

  for (const pattern of fieldPatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const key = match[1].trim().toLowerCase();
      const value = match[2].trim();
      if (value && value.length > 0 && value.length < 500) {
        fields[key] = value;
      }
    }
  }

  // Extract name
  const rawName =
    fields["name"] || fields["full name"] || fields["customer name"] ||
    fields["contact name"] || fields["first name"] ||
    extractBetween(text, "Name", "\n") || "";

  if (!rawName) return null;

  const nameParts = rawName.trim().split(/\s+/);
  const firstName = nameParts[0] || "Unknown";
  const lastName = nameParts.slice(1).join(" ") || "Lead";

  // Extract phone
  const phoneRaw =
    fields["phone"] || fields["phone number"] || fields["telephone"] ||
    fields["mobile"] || fields["cell"] || fields["contact number"] || "";
  const phone = phoneRaw.replace(/[^\d+]/g, "");

  if (!phone || phone.length < 7) return null;

  // Extract email
  const emailRaw = fields["email"] || fields["email address"] || fields["e-mail"] || "";
  const emailMatch = emailRaw.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);

  // Extract address
  const address = fields["address"] || fields["property address"] || fields["street address"] || "";
  const city = fields["city"] || fields["town"] || "";
  const state = fields["state"] || "FL";
  const zip = fields["zip"] || fields["zip code"] || fields["postal code"] || "";

  // Extract service
  const service =
    fields["service"] || fields["service needed"] || fields["service type"] ||
    fields["project type"] || fields["interested in"] || fields["service requested"] || "";

  // Extract notes/message
  const notes =
    fields["message"] || fields["comments"] || fields["notes"] ||
    fields["additional info"] || fields["details"] || "";

  // Campaign source from subject or fields
  const campaign =
    fields["campaign"] || fields["source"] || fields["utm_campaign"] ||
    extractCampaignFromSubject(subject) || "";

  return {
    firstName,
    lastName,
    primaryPhone: phone,
    email: emailMatch?.[0] || undefined,
    propertyAddress1: address || undefined,
    city: city || undefined,
    state: state || undefined,
    zipCode: zip || undefined,
    serviceRequested: service || undefined,
    notes: notes || undefined,
    campaignSource: campaign || undefined,
  };
}

function extractBetween(text: string, start: string, end: string): string | null {
  const idx = text.toLowerCase().indexOf(start.toLowerCase());
  if (idx === -1) return null;
  const afterStart = text.substring(idx + start.length);
  const endIdx = afterStart.indexOf(end);
  return endIdx > 0 ? afterStart.substring(0, endIdx).replace(/^[\s:]+/, "").trim() : null;
}

function extractCampaignFromSubject(subject: string): string | null {
  // Common patterns: "New Lead from [Campaign Name]", "[Campaign] - New Form Submission"
  const match = subject.match(/(?:from|campaign|via)\s*[:\-–]?\s*(.+)/i);
  return match ? match[1].trim() : null;
}
