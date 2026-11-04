// Every protected attendant operation loads current database authority. Call this
// within the operation transaction so disable/revoke cannot race its commit.
export { liveSession as requireSession } from "../modules/auth/repo";
