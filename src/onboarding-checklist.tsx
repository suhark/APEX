import { Check, ChevronRight, Rocket, Sparkles, X } from 'lucide-react';
import type { Page } from './navigation';
import type { OnboardingProgress, OnboardingStepId } from './onboarding';

type BotSummary = { name: string; risk: string; description: string; active: boolean };

type Props = {
  progress: OnboardingProgress;
  recommendedBot: BotSummary | null;
  isDerivDemo: boolean;
  onGoTo: (page: Page, stepId?: OnboardingStepId) => void;
  onDismiss: () => void;
  onStartRecommendedBot?: () => void;
};

export function OnboardingChecklist({
  progress,
  recommendedBot,
  isDerivDemo,
  onGoTo,
  onDismiss,
  onStartRecommendedBot,
}: Props) {
  if (progress.dismissed) return null;

  const pct = Math.round((progress.doneCount / progress.total) * 100);

  return (
    <section className="panel onboarding-panel">
      <div className="onboarding-header">
        <div>
          <span className="eyebrow">
            <Sparkles size={12} style={{ display: 'inline', verticalAlign: '-2px', marginRight: 4 }} />
            Getting started
          </span>
          <h2>{progress.isComplete ? 'You are ready to trade' : 'Set up your workspace'}</h2>
          <p className="muted onboarding-sub">
            {progress.isComplete
              ? 'All setup steps are done. Explore bots, manual trading, or review your track record.'
              : 'Complete these steps once — each one unlocks the next part of the platform.'}
          </p>
        </div>
        <div className="onboarding-header-actions">
          <div className="onboarding-progress-ring" aria-label={`${progress.doneCount} of ${progress.total} steps complete`}>
            <strong>{progress.doneCount}/{progress.total}</strong>
            <span>{pct}%</span>
          </div>
          {progress.isComplete && (
            <button type="button" className="icon-button onboarding-dismiss" onClick={onDismiss} aria-label="Dismiss checklist">
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      {isDerivDemo && !progress.completed.connect_deriv && (
        <div className="onboarding-demo-hint">
          Tip: connect with a <strong>Deriv demo account</strong> first — virtual funds, zero risk while you learn.
        </div>
      )}

      <ol className="onboarding-steps">
        {progress.steps.map((step, index) => {
          const done = progress.completed[step.id];
          const isNext = !done && progress.steps.slice(0, index).every((s) => progress.completed[s.id]);
          return (
            <li key={step.id} className={`onboarding-step ${done ? 'done' : ''} ${isNext ? 'next' : ''}`}>
              <div className="onboarding-step-marker" aria-hidden="true">
                {done ? <Check size={14} /> : <span>{index + 1}</span>}
              </div>
              <div className="onboarding-step-body">
                <strong>{step.title}</strong>
                <span>{step.description}</span>
              </div>
              {!done && (
                <button
                  type="button"
                  className={isNext ? 'primary onboarding-step-cta' : 'secondary onboarding-step-cta'}
                  onClick={() => onGoTo(step.page, step.id)}
                >
                  {step.cta} <ChevronRight size={14} />
                </button>
              )}
            </li>
          );
        })}
      </ol>

      {!progress.completed.first_bot && recommendedBot && (
        <div className="onboarding-recommended">
          <div className="onboarding-recommended-icon">
            <Rocket size={18} />
          </div>
          <div>
            <span className="eyebrow">Recommended first bot</span>
            <strong>{recommendedBot.name}</strong>
            <p className="muted">{recommendedBot.description}</p>
          </div>
          <div className="onboarding-recommended-actions">
            <span className={`risk ${recommendedBot.risk.toLowerCase()}`}>{recommendedBot.risk} risk</span>
            <button
              type="button"
              className="primary"
              onClick={() => (onStartRecommendedBot ? onStartRecommendedBot() : onGoTo('bots', 'first_bot'))}
            >
              {recommendedBot.active ? 'View in library' : 'Start on demo'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

export function DemoModeBanner({ onLearnMore }: { onLearnMore?: () => void }) {
  return (
    <div className="demo-mode-banner" role="status">
      <span className="live-dot" />
      <div>
        <strong>Demo mode — virtual funds only</strong>
        <span>Trades use your Deriv demo balance. Switch to live only when you are ready.</span>
      </div>
      {onLearnMore && (
        <button type="button" className="secondary" onClick={onLearnMore}>
          Safety settings
        </button>
      )}
    </div>
  );
}
