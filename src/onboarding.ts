import type { Page } from './navigation';

export type OnboardingStepId =
  | 'connect_deriv'
  | 'demo_trade'
  | 'loss_limit'
  | 'first_bot';

export type OnboardingStep = {
  id: OnboardingStepId;
  title: string;
  description: string;
  cta: string;
  page: Page;
};

export type OnboardingFlags = {
  dismissed?: boolean;
  lossLimitReviewed?: boolean;
  completedAt?: string;
};

export type OnboardingProgress = {
  steps: OnboardingStep[];
  completed: Record<OnboardingStepId, boolean>;
  doneCount: number;
  total: number;
  isComplete: boolean;
  dismissed: boolean;
};

const STORAGE_PREFIX = 'apex_onboarding_';

export function getOnboardingKey(userId: string): string {
  return `${STORAGE_PREFIX}${userId}`;
}

export function loadOnboardingFlags(userId: string): OnboardingFlags {
  try {
    const raw = localStorage.getItem(getOnboardingKey(userId));
    if (!raw) return {};
    return JSON.parse(raw) as OnboardingFlags;
  } catch {
    return {};
  }
}

export function saveOnboardingFlags(userId: string, flags: OnboardingFlags): void {
  try {
    localStorage.setItem(getOnboardingKey(userId), JSON.stringify(flags));
  } catch {
    /* ignore quota errors */
  }
}

export function dismissOnboarding(userId: string): void {
  const flags = loadOnboardingFlags(userId);
  saveOnboardingFlags(userId, { ...flags, dismissed: true });
}

export function markLossLimitReviewed(userId: string): void {
  const flags = loadOnboardingFlags(userId);
  saveOnboardingFlags(userId, { ...flags, lossLimitReviewed: true });
}

export function markOnboardingComplete(userId: string): void {
  const flags = loadOnboardingFlags(userId);
  if (flags.completedAt) return;
  saveOnboardingFlags(userId, {
    ...flags,
    completedAt: new Date().toISOString(),
  });
}

export const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    id: 'connect_deriv',
    title: 'Connect your Deriv account',
    description: 'Link demo or live so prices and trades use real market data.',
    cta: 'Connect in Settings',
    page: 'settings',
  },
  {
    id: 'demo_trade',
    title: 'Place a practice trade',
    description: 'Open Manual Trader and place one Rise/Fall trade on demo funds.',
    cta: 'Open Manual Trader',
    page: 'manual',
  },
  {
    id: 'loss_limit',
    title: 'Set your session loss limit',
    description: 'Choose how much you are willing to lose before trading pauses automatically.',
    cta: 'Review in Settings',
    page: 'settings',
  },
  {
    id: 'first_bot',
    title: 'Start your first bot',
    description: 'Pick a low-risk bot from the library and run it on demo to see automation in action.',
    cta: 'Browse Free Bots',
    page: 'bots',
  },
];

export function getOnboardingProgress(input: {
  userId: string;
  derivConnected: boolean;
  trades: Array<{ result: string; bot_name?: string }>;
  bots: Array<{ active: boolean; name: string }>;
  lossLimitReviewed?: boolean;
  customLossLimit?: boolean;
}): OnboardingProgress {
  const flags = loadOnboardingFlags(input.userId);
  const lossLimitReviewed =
    Boolean(flags.lossLimitReviewed) ||
    Boolean(input.lossLimitReviewed) ||
    Boolean(input.customLossLimit);

  const completed: Record<OnboardingStepId, boolean> = {
    connect_deriv: input.derivConnected,
    demo_trade: input.trades.some(
      (t) => t.result === 'won' || t.result === 'lost' || t.result === 'pending',
    ),
    loss_limit: lossLimitReviewed,
    first_bot:
      input.bots.some((b) => b.active) ||
      input.trades.some((t) => Boolean(t.bot_name)),
  };

  const doneCount = ONBOARDING_STEPS.filter((step) => completed[step.id]).length;
  const isComplete = doneCount === ONBOARDING_STEPS.length;

  return {
    steps: ONBOARDING_STEPS,
    completed,
    doneCount,
    total: ONBOARDING_STEPS.length,
    isComplete,
    dismissed: Boolean(flags.dismissed),
  };
}

/** Lowest-risk bot for the "recommended first bot" callout. */
export function getRecommendedBot<T extends { name: string; risk: string; description: string }>(
  bots: T[],
): T | null {
  if (!bots.length) return null;
  const riskOrder = ['low', 'medium', 'high'];
  const sorted = [...bots].sort(
    (a, b) => riskOrder.indexOf(a.risk.toLowerCase()) - riskOrder.indexOf(b.risk.toLowerCase()),
  );
  return sorted[0] ?? null;
}

export function greetingForHour(date = new Date()): string {
  const hour = date.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}
