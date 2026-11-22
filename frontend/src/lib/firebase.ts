import { initializeApp, getApps, getApp } from 'firebase/app'
import { getAuth, RecaptchaVerifier, signInWithPhoneNumber, ConfirmationResult } from 'firebase/auth'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'AIzaSyCPUrqyLb9ATFj92OYL3c03Ug6si6L4eMU',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'mandate-f2fea.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'mandate-f2fea',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'mandate-f2fea.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '112810762410',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:112810762410:web:a8471fec07988b73c430d3',
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || 'G-ES9X0YE0YS'
}

export const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp()
export const auth = getAuth(app)
export { RecaptchaVerifier, signInWithPhoneNumber }
export type { ConfirmationResult }
