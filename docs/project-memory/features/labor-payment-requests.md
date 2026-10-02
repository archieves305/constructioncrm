# Crew payment requests + assignable labor-contract lines (2026-10-02)

Job → Field → Labor. Plan: `~/.claude/plans/when-i-create-a-vast-lamport.md`.

## Why

A labor contract had no way to ask for a crew payment and its task schedule
had no owner; staff raised loose CRM tasks ("Release $5750 to Jesus") that
were tied to nothing, so the payment was never recorded on the contract.

## Shape

- `LaborPaymentRequest` (migration `20261011120000_labor_payment_requests`):
  the ask. Carried by an ordinary CRM task (`taskId`,
  `sourceKey labor-payment-request:<id>`), HIGH priority, due on the
  needed-by day (today when blank) so the mail is immediate under digests
  too. Assigned to whoever was picked, else
  `userForJobRole(jobId, "ACCOUNTING")` (`lib/workflows/roles.ts`: the job's
  team slot, then the company default; null → the dialog asks for a person).
- `lib/labor/payment-requests.ts`: `createPaymentRequest`,
  `settleRequestOnPayment` (recording a `LaborPayment` with `requestId` →
  PAID, task completed), `cancelPaymentRequest`, `onRequestTaskClosed` (task
  completed by hand → `CLOSED_UNPAID`; cancelled → `CANCELLED`).
- `LaborContractTask` gained `assignedUserId`, `dueDate`, `taskId`,
  `paymentRequestId`. `lib/labor/schedule-task-link.ts`: pure `planLineSync`
  + `syncScheduleTask` — a line with an owner has a CRM task
  (`labor-contract-task:<id>`); owner and date drive it; completing either
  completes the other; deleting the line cancels it.
- `lib/labor/payment-math.ts` (client-safe): `isApprovedForPayment`,
  `netDueForLines`, `requestableLines`.
- The task-side hooks live in `updateTask` (beside the field-issue sync), not
  in `onTaskTransition` — that one only runs for workflow tasks.
- Routes: `GET|POST /api/labor-contracts/[id]/payment-requests` (`guardJob`;
  anyone who may change the job may request), `DELETE
  /api/labor-payment-requests/[id]` (requester or a money role), `requestId`
  on `POST …/payments` (recording stays `canManageJobMoney`),
  `assignedUserId` / `dueDate` on the schedule-line routes.
- UI: `components/jobs/labor-payment-requests.tsx` on each contract card
  (list, Request payment dialog, Record payment against a request, withdraw);
  schedule dialog rows (Assigned to, Due, status marker) and "Request this
  payment" on the weekly calculation for approved, not-yet-requested lines;
  task sheet quick link to Field → Labor; Overview attention row + timeline.

## Rules

- A `LaborPayment` means paid. A request never counts as cost.
- A line is requested once: `paymentRequestId` is cleared only when its
  request is cancelled.
- No new email: the task assignment mail is the notice.
