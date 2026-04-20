"use client";

import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import type {
  FieldErrors,
  FieldValues,
  Path,
  PathValue,
  UseFormRegister,
  UseFormSetValue,
} from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type AddressAutofillProps = {
  accessToken: string;
  onRetrieve?: (res: AutofillRetrieveResponse) => void;
  children: ReactNode;
};

type AutofillRetrieveResponse = {
  features?: Array<{
    properties?: {
      address_line1?: string;
      address_line2?: string;
      address_level1?: string;
      address_level2?: string;
      address_level3?: string;
      postcode?: string;
    };
  }>;
};

type AddressFieldName =
  | "propertyAddress1"
  | "propertyAddress2"
  | "city"
  | "county"
  | "state"
  | "zipCode";

type Props<T extends FieldValues> = {
  register: UseFormRegister<T>;
  setValue: UseFormSetValue<T>;
  errors?: FieldErrors<T>;
};

export function AddressAutofillFields<T extends FieldValues>({
  register,
  setValue,
  errors,
}: Props<T>) {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  const [AddressAutofill, setComponent] =
    useState<ComponentType<AddressAutofillProps> | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    import("@mapbox/search-js-react").then((m) => {
      if (!cancelled) {
        setComponent(
          () => m.AddressAutofill as unknown as ComponentType<AddressAutofillProps>
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const set = (name: AddressFieldName, value: string) => {
    setValue(
      name as Path<T>,
      value as PathValue<T, Path<T>>,
      { shouldDirty: true, shouldTouch: true }
    );
  };

  const handleRetrieve = (res: AutofillRetrieveResponse) => {
    const f = res?.features?.[0]?.properties;
    if (!f) return;
    if (f.address_line1) set("propertyAddress1", f.address_line1);
    set("propertyAddress2", f.address_line2 || "");
    if (f.address_level2) set("city", f.address_level2);
    if (f.address_level1) set("state", f.address_level1);
    if (f.postcode) set("zipCode", f.postcode);
  };

  const address1Input = (
    <Input
      id="propertyAddress1"
      autoComplete="address-line1"
      placeholder={token ? "Start typing an address..." : undefined}
      {...register("propertyAddress1" as Path<T>)}
    />
  );

  const fieldError = (name: AddressFieldName) => {
    const err = (errors as Record<string, { message?: string } | undefined>)?.[
      name
    ];
    return err?.message ? (
      <p className="mt-1 text-xs text-red-600">{String(err.message)}</p>
    ) : null;
  };

  return (
    <>
      <div className="md:col-span-2">
        <Label htmlFor="propertyAddress1">Address Line 1 *</Label>
        {AddressAutofill && token ? (
          <AddressAutofill accessToken={token} onRetrieve={handleRetrieve}>
            {address1Input}
          </AddressAutofill>
        ) : (
          address1Input
        )}
        {fieldError("propertyAddress1")}
        {!token && (
          <p className="mt-1 text-xs text-amber-600">
            Address autocomplete disabled — set NEXT_PUBLIC_MAPBOX_TOKEN in
            .env to enable.
          </p>
        )}
      </div>
      <div className="md:col-span-2">
        <Label htmlFor="propertyAddress2">Address Line 2</Label>
        <Input
          id="propertyAddress2"
          autoComplete="address-line2"
          {...register("propertyAddress2" as Path<T>)}
        />
      </div>
      <div>
        <Label htmlFor="city">City *</Label>
        <Input
          id="city"
          autoComplete="address-level2"
          {...register("city" as Path<T>)}
        />
        {fieldError("city")}
      </div>
      <div>
        <Label htmlFor="county">County</Label>
        <Input id="county" {...register("county" as Path<T>)} />
      </div>
      <div>
        <Label htmlFor="state">State</Label>
        <Input
          id="state"
          autoComplete="address-level1"
          {...register("state" as Path<T>)}
        />
      </div>
      <div>
        <Label htmlFor="zipCode">ZIP Code *</Label>
        <Input
          id="zipCode"
          autoComplete="postal-code"
          {...register("zipCode" as Path<T>)}
        />
        {fieldError("zipCode")}
      </div>
    </>
  );
}
