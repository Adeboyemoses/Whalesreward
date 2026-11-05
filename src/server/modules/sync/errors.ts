export class SyncError extends Error {
  constructor(
    public code: string,
    public status: number,
    public reason?: string,
  ) {
    super(code);
  }
}
