/** Thrown by the case services; routes map it to a status. Mirrors WorkflowApplyError. */
export class ViolationError extends Error {
  constructor(
    public readonly status: 400 | 403 | 404 | 409,
    message: string,
    public readonly detail?: unknown,
  ) {
    super(message);
    this.name = "ViolationError";
  }
}
