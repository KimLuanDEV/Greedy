// src/firebase.js
import admin from "firebase-admin";
import dotenv from "dotenv";

dotenv.config();

// Nếu bạn đã cấu hình GOOGLE_APPLICATION_CREDENTIALS trỏ tới file JSON service account,
// thì Admin SDK sẽ tự dùng file đó:
if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  admin.initializeApp();
} else {
  // Ngược lại: dùng 3 biến trong .env
  const projectId   = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  let privateKey    = process.env.FIREBASE_PRIVATE_KEY;

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("Missing Firebase envs: FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY");
  }

  // Convert ký tự "\n" về xuống dòng thật (cần thiết khi để PRIVATE_KEY trong .env một dòng)
  privateKey = privateKey.replace(/\\n/g, "\n");

  admin.initializeApp({
    credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
  });
}

// Xuất ra Firestore và Auth để các file khác dùng
export const db   = admin.firestore();
export const auth = admin.auth();
