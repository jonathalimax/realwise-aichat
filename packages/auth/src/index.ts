export { firebaseAuth, getFirebaseApp } from "./firebase";
export { verifyPhoneIdToken, normalizePhone, type VerifiedPhoneIdentity } from "./verify";
export {
  signBusinessSession,
  signVisitorSession,
  verifySession,
  type BusinessSessionClaims,
  type VisitorSessionClaims,
} from "./session";
