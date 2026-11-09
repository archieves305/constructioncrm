"use client"

import * as React from "react"

import { cn } from "@/lib/utils"
import { Label } from "./label"
import { FieldContext } from "./field-context"

/**
 * One form field: label, control, help text and error, wired together.
 *
 *   <Field label="Due date" help="Leave empty for no deadline" error={errors.dueAt?.message}>
 *     <Input type="date" {...register("dueAt")} />
 *   </Field>
 *
 * The label points at the control (clicking it focuses the field; a screen
 * reader announces it), the help and error are read as the field's
 * description, and an error marks the control invalid. Input, Textarea and
 * SelectTrigger pick this up by themselves; any other control can read
 * `FieldContext` (or take `id` from `useFieldId`).
 */
export function Field({
  label,
  help,
  error,
  required,
  id: idProp,
  className,
  labelClassName,
  children,
}: {
  label: React.ReactNode
  help?: React.ReactNode
  error?: React.ReactNode
  required?: boolean
  /** Use when a test or a link needs a stable id; otherwise one is generated. */
  id?: string
  className?: string
  labelClassName?: string
  children: React.ReactNode
}) {
  const generated = React.useId()
  const id = idProp ?? `field-${generated}`
  const helpId = help && !error ? `${id}-help` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [errorId, helpId].filter(Boolean).join(" ") || undefined
  const value = React.useMemo(
    () => ({ id, describedBy, invalid: Boolean(error), required: Boolean(required) }),
    [id, describedBy, error, required],
  )
  return (
    <div data-slot="field" className={cn("grid gap-1.5", className)}>
      <Label htmlFor={id} className={labelClassName}>
        {label}
        {required && (
          <span className="text-tone-danger-fg" aria-hidden>
            *
          </span>
        )}
      </Label>
      <FieldContext.Provider value={value}>{children}</FieldContext.Provider>
      {help && !error && (
        <p id={helpId} className="text-xs text-muted-foreground">
          {help}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs text-tone-danger-fg">
          {error}
        </p>
      )}
    </div>
  )
}

/** The id of the enclosing Field's control, for controls that don't read the context themselves. */
export function useFieldId(): string | undefined {
  return React.useContext(FieldContext)?.id
}
