/** A refusal from the partners service, carrying the HTTP status it answers with. */
export class PartnerError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly detail?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "PartnerError";
  }
}
