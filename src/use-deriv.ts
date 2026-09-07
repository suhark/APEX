import { useEffect, useState } from 'react';
import {
  type DerivAuthState,
  type DerivAccount,
  onAuthStateChange,
  onAccountChange,
  getAuthState,
  getAccountInfo,
  authorize,
  disconnect,
} from './deriv-client';

export function useDerivConnection() {
  const [authState, setAuthState] = useState<DerivAuthState>(getAuthState());
  const [account, setAccount] = useState<DerivAccount | null>(getAccountInfo());

  useEffect(() => onAuthStateChange(setAuthState), []);
  useEffect(() => onAccountChange(setAccount), []);

  const connect = async (token: string): Promise<{ ok: boolean; account?: DerivAccount; error?: string }> => {
    try {
      const account = await authorize(token);
      return { ok: true, account };
    } catch (err) {
      return { ok: false, error: typeof err === 'string' ? err : 'Authorization failed' };
    }
  };

  const doDisconnect = () => disconnect();

  return { authState, account, connect, disconnect: doDisconnect };
}
