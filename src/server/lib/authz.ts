// Every protected attendant operation loads current database authority. Call this
// within the operation transaction so disable/revoke cannot race its commit.
export { liveSession as requireSession } from "../modules/auth/repo";

// Every admin transaction takes this lock before loading live authority. Access
// changes and privileged writes therefore cannot commit using revoked grants.
export {
  liveAdmin as requireAdminSession,
  permission as requirePermission,
  securityLock,
} from "../modules/admin-access/repo";
