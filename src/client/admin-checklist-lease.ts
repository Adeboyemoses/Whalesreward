type Ticket = { generation: number; validation: number };
/** A read authorization belongs to one committed mounted/navigation surface.
 * Frozen requests are deliberately owned elsewhere and survive its cleanup. */
export class ReviewLeaseGate {
  private active: {
    owner: object;
    path: string;
    generation: number;
    validation: number;
    authorized: boolean;
  } | null = null;
  private generation = 0;
  mount(owner: object, path: string) {
    this.active = {
      owner,
      path,
      generation: ++this.generation,
      validation: 0,
      authorized: false,
    };
  }
  release(owner: object) {
    if (this.active?.owner === owner) {
      this.active = null;
      this.generation++;
      return true;
    }
    return false;
  }
  begin(owner: object, path: string): Ticket | undefined {
    const a = this.active;
    if (!a || a.owner !== owner || a.path !== path) return;
    a.authorized = false;
    return { generation: a.generation, validation: ++a.validation };
  }
  current(owner: object, path: string, ticket: Ticket) {
    const a = this.active;
    return (
      !!a &&
      a.owner === owner &&
      a.path === path &&
      a.generation === ticket.generation &&
      a.validation === ticket.validation
    );
  }
  accept(owner: object, path: string, ticket: Ticket) {
    if (!this.current(owner, path, ticket)) return false;
    this.active!.authorized = true;
    return true;
  }
  authorized(owner: object, path: string) {
    return (
      !!this.active &&
      this.active.owner === owner &&
      this.active.path === path &&
      this.active.authorized
    );
  }
}
