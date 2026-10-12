import { firebaseAuth } from "./firebase";

export interface VerifiedPhoneIdentity {
  firebaseUid: string;
  phoneNumber: string;
}

export async function verifyPhoneIdToken(idToken: string): Promise<VerifiedPhoneIdentity> {
  const decoded = await firebaseAuth().verifyIdToken(idToken, true);
  if (!decoded.phone_number) {
    throw new Error("Token has no phone_number claim");
  }
  return {
    firebaseUid: decoded.uid,
    phoneNumber: decoded.phone_number,
  };
}

export function normalizePhone(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, "");
  return digits.startsWith("+") ? digits : `+${digits}`;
}
