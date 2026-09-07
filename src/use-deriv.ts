import { useEffect, useState } from 'react';
import {
  type DerivAuthState,
  type DerivAccount,
  onAuthStateChange,
  onAccountChange,
  onAvailableAccountsChange,
  getAuthState,
  getAccountInfo,
  getAvailableAccounts,
  authorize,
  switchAccount as derivSwitchAccount,
  disconnect,
} from './deriv-client';

export function useDerivConnection() {
  const [authState, setAuthState] = useState<DerivAuthState>(getAuthState());
  const [account, setAccount] = useState<DerivAccount | null>(getAccountInfo());
  const [accounts, setAccounts] = useState<DerivAccount[]>(getAvailableAccounts());

  useEffect(() => onAuthStateChange(setAuthState), []);
  useEffect(() => onAccountChange(setAccount), []);
  useEffect(() => onAvailableAccountsChange(setAccounts), []);

  const connect = async (token: string, appId: string): Promise<{ ok: boolean; account?: DerivAccount; accounts?: DerivAccount[]; error?: string }> => {
    try {
      const account = await authorize(token, appId);
      return { ok: true, account, accounts: getAvailableAccounts() };
    } catch (err) {
      const message = err instanceof Error ? err.message : typeof err === 'string' ? err : 'Authorization failed';
      return { ok: false, error: message };
    }
  };

  const switchAccount = async (loginid: string): Promise<{ ok: boolean; account?: DerivAccount; error?: string }> => {
    try {
      const switched = await derivSwitchAccount(loginid);
      return { ok: true, account: switched };
    } catch (err) {
      const message = err instanceof Error ? err.message : typeof err === 'string' ? err : 'Failed to switch account';
      return { ok: false, error: message };
    }
  };

  const doDisconnect = () => disconnect();

  return { authState, account, accounts, connect, switchAccount, disconnect: doDisconnect };
}
