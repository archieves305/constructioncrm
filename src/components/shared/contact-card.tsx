"use client";

import Link from "next/link";
import { Building2, ExternalLink, Mail, MapPin, Phone } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatAddressFull, type AddressInput } from "@/lib/labels/address";

/** `tel:` wants digits (and a leading +); the display keeps whatever was typed. */
export function telHref(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, "");
  return `tel:${digits.startsWith("+") ? digits : digits.replace(/\+/g, "")}`;
}

/** "TBD" or "n/a" is not a number to dial. */
export function isDialable(phone: string | null | undefined): phone is string {
  return !!phone && phone.replace(/\D/g, "").length >= 7;
}

function PhoneLine({ phone }: { phone: string }) {
  return isDialable(phone) ? (
    <a href={telHref(phone)} className="flex items-center gap-2 text-brand-fg hover:underline">
      <Phone className="size-4 text-muted-foreground" />
      {phone}
    </a>
  ) : (
    <div className="flex items-center gap-2 text-muted-foreground">
      <Phone className="size-4" />
      {phone}
    </div>
  );
}

export function mapsHref(a: AddressInput): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(formatAddressFull(a))}`;
}

/**
 * The customer and the property in one card: name, tappable phone and
 * email, the address with a map link. Lives on the job and the lead page
 * so nobody has to open the lead to find a phone number.
 */
export function ContactCard({
  title = "Customer",
  name,
  nameHref,
  companyName,
  phone,
  secondaryPhone,
  email,
  address,
  county,
  propertyType,
  children,
}: {
  title?: string;
  name: string;
  nameHref?: string;
  companyName?: string | null;
  phone?: string | null;
  secondaryPhone?: string | null;
  email?: string | null;
  address: AddressInput;
  county?: string | null;
  propertyType?: string | null;
  children?: React.ReactNode;
}) {
  const line2 = [address.city, [address.state, address.zipCode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div>
          {nameHref ? (
            <Link href={nameHref} className="inline-flex items-center gap-1 font-medium text-brand-fg hover:underline">
              {name}
              <ExternalLink className="size-3" />
            </Link>
          ) : (
            <div className="font-medium">{name}</div>
          )}
          {companyName && companyName.trim() !== name.trim() && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Building2 className="size-4" />
              {companyName}
            </div>
          )}
        </div>
        {phone && <PhoneLine phone={phone} />}
        {secondaryPhone && <PhoneLine phone={secondaryPhone} />}
        {email && (
          <a href={`mailto:${email}`} className="flex min-w-0 items-center gap-2 text-brand-fg hover:underline">
            <Mail className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{email}</span>
          </a>
        )}
        <div className="flex items-start gap-2">
          <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <div>{address.propertyAddress1}</div>
            {address.propertyAddress2 && <div>{address.propertyAddress2}</div>}
            <div>{line2}</div>
            {county && <div className="text-muted-foreground">{county} County</div>}
            {propertyType && <div className="capitalize text-muted-foreground">{propertyType.toLowerCase()}</div>}
            <a href={mapsHref(address)} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-brand-fg hover:underline">
              Open in Maps <ExternalLink className="size-3" />
            </a>
          </div>
        </div>
        {children}
      </CardContent>
    </Card>
  );
}
