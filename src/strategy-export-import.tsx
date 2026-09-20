import { useState, useCallback } from 'react';
import { Download, Upload, FileText, Copy, Check, X, Settings, Save, FolderOpen, Share2, Lock, Unlock, ShieldCheck, Zap } from 'lucide-react';

interface BotConfig {
  name: string;
  stake: number;
  [key: string]: any;
}

interface StrategyExport {
  version: string;
  exportedAt: string;
  exportedBy: string;
  strategy: {
    name: string;
    description: string;
    botConfigs: Array<{
      botName: string;
      config: BotConfig;
    }>;
    workspaceSettings?: {
      lossLimit: number;
      allowBotLiveTrading: boolean;
      maxBalancePercent: number;
    };
  };
}

interface StrategyExportImportProps {
  botConfigs: Record<string, BotConfig>;
  workspaceSettings?: {
    lossLimit: number;
    allowBotLiveTrading: boolean;
    maxBalancePercent: number;
  };
  onImport: (strategy: StrategyExport) => void;
  userId?: string;
}

export function StrategyExportImport({ 
  botConfigs = {}, 
  workspaceSettings, 
  onImport, 
  userId 
}: StrategyExportImportProps) {
  const [showExportModal, setShowExportModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [exportName, setExportName] = useState('');
  const [exportDescription, setExportDescription] = useState('');
  const [selectedBots, setSelectedBots] = useState<string[]>([]);
  const [includeWorkspace, setIncludeWorkspace] = useState(false);
  const [exportSuccess, setExportSuccess] = useState(false);
  const [importError, setImportError] = useState('');
  const [copiedToClipboard, setCopiedToClipboard] = useState(false);

  const availableBots = Object.keys(botConfigs);

  const handleExport = useCallback(() => {
    if (!exportName.trim()) {
      setImportError('Please enter a strategy name');
      return;
    }

    const selectedConfigs = selectedBots.map(botName => ({
      botName,
      config: botConfigs[botName],
    }));

    const strategy: StrategyExport = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      exportedBy: userId || 'anonymous',
      strategy: {
        name: exportName,
        description: exportDescription,
        botConfigs: selectedConfigs,
        workspaceSettings: includeWorkspace ? workspaceSettings : undefined,
      },
    };

    const jsonStr = JSON.stringify(strategy, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `apex-strategy-${exportName.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    setExportSuccess(true);
    setTimeout(() => setExportSuccess(false), 3000);
    setShowExportModal(false);
    setExportName('');
    setExportDescription('');
    setSelectedBots([]);
    setIncludeWorkspace(false);
  }, [exportName, exportDescription, selectedBots, botConfigs, includeWorkspace, workspaceSettings, userId]);

  const handleImport = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const json = JSON.parse(e.target?.result as string);
        
        // Validate structure
        if (!json.version || !json.strategy || !json.strategy.botConfigs) {
          throw new Error('Invalid strategy file format');
        }

        // Validate version compatibility
        const versionParts = json.version.split('.');
        if (parseInt(versionParts[0]) > 1) {
          throw new Error('Strategy version not supported');
        }

        onImport(json);
        setShowImportModal(false);
        setImportError('');
      } catch (err) {
        setImportError(err instanceof Error ? err.message : 'Failed to import strategy');
      }
    };
    reader.readAsText(file);
  }, [onImport]);

  const copyToClipboard = useCallback((strategy: StrategyExport) => {
    const jsonStr = JSON.stringify(strategy, null, 2);
    navigator.clipboard.writeText(jsonStr).then(() => {
      setCopiedToClipboard(true);
      setTimeout(() => setCopiedToClipboard(false), 2000);
    });
  }, []);

  const toggleBotSelection = (botName: string) => {
    setSelectedBots(prev => 
      prev.includes(botName) 
        ? prev.filter(b => b !== botName)
        : [...prev, botName]
    );
  };

  const selectAllBots = () => setSelectedBots(availableBots);
  const clearBotSelection = () => setSelectedBots([]);

  return (
    <div className="strategy-export-import">
      <div className="export-import-actions">
        <button 
          className="secondary" 
          onClick={() => setShowExportModal(true)}
        >
          <Download size={16} /> Export Strategy
        </button>
        <button 
          className="secondary" 
          onClick={() => setShowImportModal(true)}
        >
          <Upload size={16} /> Import Strategy
        </button>
      </div>

      {/* Export Modal */}
      {showExportModal && (
        <div className="modal-overlay" onClick={() => setShowExportModal(false)}>
          <div className="modal-content strategy-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2><Download size={20} /> Export Strategy</h2>
              <button className="icon-button" onClick={() => setShowExportModal(false)}>
                <X size={16} />
              </button>
            </div>

            <div className="modal-body">
              <div className="form-group">
                <label>Strategy Name *</label>
                <input
                  type="text"
                  value={exportName}
                  onChange={(e) => setExportName(e.target.value)}
                  placeholder="My Winning Strategy"
                />
              </div>

              <div className="form-group">
                <label>Description</label>
                <textarea
                  value={exportDescription}
                  onChange={(e) => setExportDescription(e.target.value)}
                  placeholder="Describe your strategy..."
                  rows={3}
                />
              </div>

              <div className="form-group">
                <label>Select Bots to Include</label>
                <div className="bot-selection-header">
                  <button className="text-button" onClick={selectAllBots}>
                    Select All
                  </button>
                  <button className="text-button" onClick={clearBotSelection}>
                    Clear All
                  </button>
                </div>
                <div className="bot-selection-grid">
                  {availableBots.map(botName => (
                    <button
                      key={botName}
                      className={`bot-selection-item ${selectedBots.includes(botName) ? 'selected' : ''}`}
                      onClick={() => toggleBotSelection(botName)}
                    >
                      <span className="bot-checkbox">
                        {selectedBots.includes(botName) && <Check size={14} />}
                      </span>
                      <span>{botName}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="form-group">
                <label className="toggle-label">
                  <input
                    type="checkbox"
                    checked={includeWorkspace}
                    onChange={(e) => setIncludeWorkspace(e.target.checked)}
                  />
                  <span>Include workspace settings (loss limits, risk caps)</span>
                </label>
              </div>

              {importError && (
                <div className="error-message">
                  <X size={14} />
                  {importError}
                </div>
              )}

              <div className="modal-footer">
                <button className="secondary" onClick={() => setShowExportModal(false)}>
                  Cancel
                </button>
                <button 
                  className="primary" 
                  onClick={handleExport}
                  disabled={!exportName.trim() || selectedBots.length === 0}
                >
                  {exportSuccess ? <><Check size={16} /> Exported!</> : <><Download size={16} /> Export Strategy</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Import Modal */}
      {showImportModal && (
        <div className="modal-overlay" onClick={() => setShowImportModal(false)}>
          <div className="modal-content strategy-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2><Upload size={20} /> Import Strategy</h2>
              <button className="icon-button" onClick={() => setShowImportModal(false)}>
                <X size={16} />
              </button>
            </div>

            <div className="modal-body">
              <div className="import-zone">
                <input
                  type="file"
                  accept=".json"
                  onChange={handleImport}
                  id="strategy-file-input"
                  style={{ display: 'none' }}
                />
                <label htmlFor="strategy-file-input" className="import-drop-zone">
                  <Upload size={32} />
                  <p>Drop your strategy file here or click to browse</p>
                  <small>Supports .json format</small>
                </label>
              </div>

              {importError && (
                <div className="error-message">
                  <X size={14} />
                  {importError}
                </div>
              )}

              <div className="import-info">
                <h4>What gets imported?</h4>
                <ul>
                  <li>Bot configurations and parameters</li>
                  <li>Stake settings and risk management</li>
                  <li>Strategy metadata (name, description)</li>
                  {includeWorkspace && <li>Workspace settings (if included in export)</li>}
                </ul>
              </div>

              <div className="modal-footer">
                <button className="secondary" onClick={() => setShowImportModal(false)}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Template library component
export function StrategyTemplateLibrary({
  onApplyTemplate,
}: {
  onApplyTemplate: (template: any) => void;
}) {
  const templates = [
    {
      id: 'conservative',
      name: 'Conservative Growth',
      description: 'Low-risk strategy with 1% position sizing and strict loss limits',
      icon: <ShieldCheck size={20} />,
      configs: {
        'Phantom Scalper': { baseStake: 5, rsiOverbought: 0.75, rsiOversold: 0.25, lossFadeAt: 3, winStepAt: 5, sessionFilter: true },
        'Trend Pullback V3': { stakeMode: 'percent', stakeValue: 1, stakeMin: 2, stakeMax: 20, scoreThreshold: 80, adxMin: 25, cooldownMinutes: 20 },
      },
      workspaceSettings: { lossLimit: 25, allowBotLiveTrading: false, maxBalancePercent: 1 },
    },
    {
      id: 'aggressive',
      name: 'Aggressive Growth',
      description: 'Higher risk strategy with 3% position sizing and relaxed limits',
      icon: <Zap size={20} />,
      configs: {
        'Phantom Scalper': { baseStake: 15, rsiOverbought: 0.70, rsiOversold: 0.30, lossFadeAt: 2, winStepAt: 2, sessionFilter: false },
        'Trend Pullback V3': { stakeMode: 'percent', stakeValue: 3, stakeMin: 5, stakeMax: 50, scoreThreshold: 65, adxMin: 20, cooldownMinutes: 10 },
      },
      workspaceSettings: { lossLimit: 100, allowBotLiveTrading: false, maxBalancePercent: 3 },
    },
    {
      id: 'balanced',
      name: 'Balanced Approach',
      description: 'Moderate risk strategy with 2% position sizing and balanced limits',
      icon: <Settings size={20} />,
      configs: {
        'Phantom Scalper': { baseStake: 10, rsiOverbought: 0.72, rsiOversold: 0.28, lossFadeAt: 2, winStepAt: 3, sessionFilter: true },
        'Trend Pullback V3': { stakeMode: 'percent', stakeValue: 2, stakeMin: 3, stakeMax: 30, scoreThreshold: 75, adxMin: 22, cooldownMinutes: 15 },
      },
      workspaceSettings: { lossLimit: 50, allowBotLiveTrading: false, maxBalancePercent: 2 },
    },
  ];

  const [appliedTemplate, setAppliedTemplate] = useState<string | null>(null);

  const applyTemplate = (templateId: string) => {
    const template = templates.find(t => t.id === templateId);
    if (!template) return;

    // Call the parent function to actually apply the template
    onApplyTemplate(template);
    setAppliedTemplate(templateId);
    // Keep the badge visible - don't clear it automatically
  };

  return (
    <div className="strategy-template-library">
      <h3>Quick Start Templates</h3>
      <div className="template-grid">
        {templates.map(template => (
          <div
            key={template.id}
            className={`template-card ${appliedTemplate === template.id ? 'selected' : ''}`}
            onClick={() => applyTemplate(template.id)}
          >
            <div className="template-icon">{template.icon}</div>
            <h4>{template.name}</h4>
            <p>{template.description}</p>
            <div className="template-meta">
              <span><FileText size={12} /> {Object.keys(template.configs).length} bots</span>
              <span><Settings size={12} /> Risk: {template.id}</span>
            </div>
            {appliedTemplate === template.id && (
              <div className="template-applied">
                <Check size={14} /> Applied!
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}