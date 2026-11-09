"use client"

import * as React from "react"

/**
 * What a <Field> hands its control: the id its label points at, the ids of the
 * help / error text, and whether it is invalid. Input, Textarea and
 * SelectTrigger read it, so a form only writes <Field label="…"><Input /></Field>.
 */
export type FieldControl = { id: string; describedBy?: string; invalid: boolean; required: boolean }

export const FieldContext = React.createContext<FieldControl | null>(null)

/** Props a control should carry inside a Field; anything the caller set wins. */
export function useFieldControlProps<P extends { id?: string; "aria-describedby"?: string; "aria-invalid"?: unknown; required?: boolean }>(props: P) {
  const field = React.useContext(FieldContext)
  if (!field) return {}
  return {
    id: props.id ?? field.id,
    "aria-describedby": props["aria-describedby"] ?? field.describedBy,
    "aria-invalid": props["aria-invalid"] ?? (field.invalid || undefined),
    ...(field.required && props.required === undefined ? { "aria-required": true as const } : {}),
  }
}
