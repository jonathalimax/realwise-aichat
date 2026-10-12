import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

let app: App;

export function getFirebaseApp(): App {
  if (!app) {
    const existing = getApps()[0];
    if (existing) {
      app = existing;
    } else {
      app = initializeApp({
        credential: cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
        }),
      });
    }
  }
  return app;
}

export function firebaseAuth() {
  return getAuth(getFirebaseApp());
}
