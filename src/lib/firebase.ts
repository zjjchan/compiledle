import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  EmailAuthProvider,
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  updatePassword,
  signOut,
  type Auth,
  type User,
} from 'firebase/auth';
import {
  getMessaging,
  getToken,
  isSupported as isMessagingSupported,
  onMessage,
  type MessagePayload,
} from 'firebase/messaging';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '',
};

export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId
);

let app: FirebaseApp | null = null;
let authInstance: Auth | null = null;

if (isFirebaseConfigured) {
  app = initializeApp(firebaseConfig);
  authInstance = getAuth(app);
}

export const auth = authInstance;

export async function signInWithGoogle() {
  if (!auth) throw new Error('Firebase is not configured.');
  const provider = new GoogleAuthProvider();
  return signInWithPopup(auth, provider);
}

export async function signInWithEmail(email: string, password: string) {
  if (!auth) throw new Error('Firebase is not configured.');
  return signInWithEmailAndPassword(auth, email, password);
}

export async function signUpWithEmail(email: string, password: string) {
  if (!auth) throw new Error('Firebase is not configured.');
  return createUserWithEmailAndPassword(auth, email, password);
}

export async function logOut() {
  if (!auth) return;
  await signOut(auth);
}

export function getUserProviders(user: User): { hasPassword: boolean; hasGoogle: boolean } {
  const ids = new Set(user.providerData.map((p) => p.providerId));
  return {
    hasPassword: ids.has('password'),
    hasGoogle: ids.has('google.com'),
  };
}

export async function reauthenticateUserWithPassword(currentPassword: string): Promise<void> {
  const user = auth?.currentUser;
  if (!user || !user.email) {
    throw new Error('No signed-in email user found.');
  }
  const credential = EmailAuthProvider.credential(user.email, currentPassword);
  await reauthenticateWithCredential(user, credential);
}

export async function reauthenticateUserWithGoogle(): Promise<void> {
  const user = auth?.currentUser;
  if (!user) {
    throw new Error('Not signed in.');
  }
  const provider = new GoogleAuthProvider();
  await reauthenticateWithPopup(user, provider);
}

export async function changeUserPassword(
  currentPassword: string,
  newPassword: string
): Promise<void> {
  const user = auth?.currentUser;
  if (!user) {
    throw new Error('Not signed in.');
  }
  await reauthenticateUserWithPassword(currentPassword);
  await updatePassword(user, newPassword);
}

export async function reloadCurrentUser(): Promise<void> {
  const user = auth?.currentUser;
  if (!user) return;
  await user.reload();
  await user.getIdToken(true);
}

export function buildServiceWorkerUrl(): string {
  const params = new URLSearchParams({
    apiKey: firebaseConfig.apiKey,
    authDomain: firebaseConfig.authDomain,
    projectId: firebaseConfig.projectId,
    storageBucket: firebaseConfig.storageBucket,
    messagingSenderId: firebaseConfig.messagingSenderId,
    appId: firebaseConfig.appId,
  });
  return `/firebase-messaging-sw.js?${params.toString()}`;
}

export async function ensureAppServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register(buildServiceWorkerUrl(), { scope: '/' });
  } catch (err) {
    console.warn('Service worker registration skipped:', err);
    return null;
  }
}

export async function requestFcmDeviceToken(): Promise<string> {
  if (!app) {
    throw new Error('Firebase is not configured.');
  }
  const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY || '';
  if (!vapidKey) {
    throw new Error('VITE_FIREBASE_VAPID_KEY is missing in environment configuration.');
  }
  if (!('Notification' in window)) {
    throw new Error('This browser does not support Web Push notifications.');
  }

  const supported = await isMessagingSupported();
  if (!supported) {
    throw new Error(
      'Web Push is not available in this browser context. On iPhone/iPad, install this app via Share → Add to Home Screen first.'
    );
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error(
      'Notification permission was denied. Please enable notifications in browser settings.'
    );
  }

  const swReg = await ensureAppServiceWorker();
  if (!swReg) {
    throw new Error('Failed to register the Service Worker required for push notifications.');
  }

  const messaging = getMessaging(app);
  const token = await getToken(messaging, {
    vapidKey,
    serviceWorkerRegistration: swReg,
  });

  if (!token) {
    throw new Error('Could not retrieve a push registration token from Firebase Cloud Messaging.');
  }
  return token;
}

export async function subscribeForegroundMessages(
  callback: (payload: MessagePayload) => void
): Promise<(() => void) | null> {
  if (!app) return null;
  const supported = await isMessagingSupported().catch(() => false);
  if (!supported) return null;
  const messaging = getMessaging(app);
  return onMessage(messaging, callback);
}

export function formatFirebaseAuthError(err: unknown): string {
  const code = (err as { code?: string })?.code || '';
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Incorrect email or password.';
    case 'auth/email-already-in-use':
      return 'An account with this email already exists. Try signing in instead.';
    case 'auth/weak-password':
      return 'Password must be at least 6 characters long.';
    case 'auth/invalid-email':
      return 'Please enter a valid email address.';
    case 'auth/popup-closed-by-user':
      return 'Sign-in popup was closed before completing.';
    case 'auth/unauthorized-domain':
      return 'This domain is not yet authorized in Firebase Auth settings.';
    case 'auth/requires-recent-login':
      return 'Please verify your current sign-in and try again.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a moment and try again.';
    default:
      return err instanceof Error ? err.message : 'Authentication failed. Please try again.';
  }
}
