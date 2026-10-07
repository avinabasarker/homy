// AuthProvider.tsx — single source of truth for session, lock, and
// recovery-gate state. Screens switch on `status`; no secrets live here.
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState } from 'react-native';
import type { AppStateStatus } from 'react-native';

import {
  clearRecoveryPending,
  getUsername,
  isRecoveryPending,
  loginAccount,
  registerAccount,
  restoreSession,
  signOutAccount,
  startPresenceHeartbeat,
} from '../lib/auth';
import type { RegisterInput } from '../lib/auth';
import { pinExists, setPinSecret, verifyPinSecret } from '../lib/pin';

export type AuthStatus =
  | 'initializing'
  | 'signedOut'
  | 'recoveryGate'
  | 'pinSetup'
  | 'locked'
  | 'ready';

interface AuthContextValue {
  status: AuthStatus;
  userId: string | null;
  username: string | null;
  register: (input: RegisterInput) => Promise<void>;
  login: (input: { username: string; password: string }) => Promise<void>;
  confirmRecoverySaved: () => Promise<void>;
  submitPin: (pin: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('initializing');
  const [userId, setUserId] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  // Where to go once the recovery phrase has been confirmed as saved.
  const [recoveryGateAfter, setRecoveryGateAfter] = useState<AuthStatus>('ready');
  const statusRef = useRef(status);
  statusRef.current = status;

  // Startup: AsyncStorage session (Part H #6) → PIN screen on restart (Part D1).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const restoredUserId = await restoreSession();
      if (cancelled) {
        return;
      }
      if (!restoredUserId) {
        setStatus('signedOut');
        return;
      }
      setUserId(restoredUserId);
      startPresenceHeartbeat(restoredUserId);
      getUsername(restoredUserId)
        .then((name) => {
          if (!cancelled) setUsername(name);
        })
        .catch(() => undefined);
      const pending = await isRecoveryPending(restoredUserId);
      const hasPin = await pinExists(restoredUserId);
      if (cancelled) {
        return;
      }
      if (pending) {
        setRecoveryGateAfter(hasPin ? 'locked' : 'pinSetup');
        setStatus('recoveryGate');
      } else {
        setStatus(hasPin ? 'locked' : 'pinSetup');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Part C security UI: PIN required again after backgrounding.
  useEffect(() => {
    const subscription = AppState.addEventListener(
      'change',
      (nextState: AppStateStatus) => {
        if (nextState !== 'active' && statusRef.current === 'ready') {
          setStatus('locked');
        }
      },
    );
    return () => subscription.remove();
  }, []);

  const register = useCallback(async (input: RegisterInput) => {
    const result = await registerAccount(input);
    setUserId(result.userId);
    setUsername(result.username);
    startPresenceHeartbeat(result.userId);
    setRecoveryGateAfter('ready');
    setStatus('recoveryGate');
  }, []);

  const login = useCallback(async (input: { username: string; password: string }) => {
    const result = await loginAccount(input);
    setUserId(result.userId);
    setUsername(result.username);
    startPresenceHeartbeat(result.userId);
    const pending = await isRecoveryPending(result.userId);
    const hasPin = await pinExists(result.userId);
    if (pending) {
      setRecoveryGateAfter(hasPin ? 'locked' : 'pinSetup');
      setStatus('recoveryGate');
    } else {
      setStatus(hasPin ? 'locked' : 'pinSetup');
    }
  }, []);

  const confirmRecoverySaved = useCallback(async () => {
    if (userId) {
      await clearRecoveryPending(userId);
    }
    setStatus(recoveryGateAfter);
  }, [userId, recoveryGateAfter]);

  const submitPin = useCallback(
    async (pin: string) => {
      if (!userId) {
        throw new Error('No active session.');
      }
      if (statusRef.current === 'pinSetup') {
        if (!/^\d{4,8}$/.test(pin)) {
          throw new Error('PIN must be 4 to 8 digits.');
        }
        await setPinSecret(userId, pin);
        setStatus('ready');
        return;
      }
      const ok = await verifyPinSecret(userId, pin);
      if (!ok) {
        throw new Error('Wrong PIN. Try again.');
      }
      setStatus('ready');
    },
    [userId],
  );

  const logout = useCallback(async () => {
    if (userId) {
      await signOutAccount(userId);
    }
    setUserId(null);
    setUsername(null);
    setStatus('signedOut');
  }, [userId]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      userId,
      username,
      register,
      login,
      confirmRecoverySaved,
      submitPin,
      logout,
    }),
    [status, userId, username, register, login, confirmRecoverySaved, submitPin, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside <AuthProvider>.');
  }
  return context;
}
