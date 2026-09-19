import { useState, useMemo } from 'react';
import { TrendingUp, TrendingDown, BarChart3, Calendar, Clock, Target, Zap, Filter, ChevronDown, ChevronUp } from 'lucide-react';

interface BotPerformanceData {
  botName: string;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  pnl: number;
  wonAmount: number;
  lostAmount: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  maxDrawdown: number;
  sharpeRatio: number;
  tradesByHour: Record<number, { wins: number; losses: number; pnl: number }>;
  tradesByDay: Record<string, { wins: number; losses: number; pnl: number }>;
  recentPerformance: Array<{ date: string; winRate: number; pnl: number }>;
}

interface BotPerformanceDashboardProps {
  bots: any[];
  trades: any[];
  selectedBot?: string;
  onBotSelect?: (botName: string) => void;
}

export function BotPerformanceDashboard({ bots, trades, selectedBot, onBotSelect }: BotPerformanceDashboardProps) {
  const [timeRange, setTimeRange] = useState<'7d' | '30d' | '90d' | 'all'>('30d');
  const [sortBy, setSortBy] = useState<'winRate' | 'pnl' | 'trades'>('winRate');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const [expandedBot, setExpandedBot] = useState<string | null>(null);

  // Process bot performance data
  const botPerformanceData = useMemo(() => {
    const now = new Date();
    const timeRangeMs = {
      '7d': 7 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000,
      '90d': 90 * 24 * 60 * 60 * 1000,
      'all': Infinity,
    }[timeRange];

    return bots.map(bot => {
      const botTrades = trades.filter(
        t => t.bot_name === bot.name && 
             (t.result === 'won' || t.result === 'lost') &&
             new Date(t.created_at).getTime() >= now.getTime() - timeRangeMs
      );

      const wins = botTrades.filter(t => t.result === 'won');
      const losses = botTrades.filter(t => t.result === 'lost');
      const totalTrades = botTrades.length;
      const winRate = totalTrades > 0 ? (wins.length / totalTrades) * 100 : 0;
      const pnl = botTrades.reduce((sum, t) => sum + Number(t.profit || 0), 0);
      const wonAmount = wins.reduce((sum, t) => sum + Number(t.profit || 0), 0);
      const lostAmount = Math.abs(losses.reduce((sum, t) => sum + Number(t.profit || 0), 0));
      const avgWin = wins.length > 0 ? wonAmount / wins.length : 0;
      const avgLoss = losses.length > 0 ? lostAmount / losses.length : 0;
      const profitFactor = lostAmount > 0 ? wonAmount / lostAmount : 0;

      // Calculate max drawdown
      let maxDrawdown = 0;
      let peak = 0;
      let runningPnl = 0;
      botTrades.forEach(trade => {
        runningPnl += Number(trade.profit || 0);
        if (runningPnl > peak) peak = runningPnl;
        const drawdown = peak - runningPnl;
        if (drawdown > maxDrawdown) maxDrawdown = drawdown;
      });

      // Calculate Sharpe ratio (simplified)
      const returns = botTrades.map(t => Number(t.profit || 0));
      const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
      const stdDev = Math.sqrt(returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / (returns.length || 1));
      const sharpeRatio = stdDev > 0 ? avgReturn / stdDev : 0;

      // Trade distribution by hour
      const tradesByHour: Record<number, { wins: number; losses: number; pnl: number }> = {};
      botTrades.forEach(trade => {
        const hour = new Date(trade.created_at).getHours();
        if (!tradesByHour[hour]) {
          tradesByHour[hour] = { wins: 0, losses: 0, pnl: 0 };
        }
        if (trade.result === 'won') {
          tradesByHour[hour].wins++;
          tradesByHour[hour].pnl += Number(trade.profit || 0);
        } else {
          tradesByHour[hour].losses++;
          tradesByHour[hour].pnl += Number(trade.profit || 0);
        }
      });

      // Trade distribution by day
      const tradesByDay: Record<string, { wins: number; losses: number; pnl: number }> = {};
      botTrades.forEach(trade => {
        const day = new Date(trade.created_at).toLocaleDateString();
        if (!tradesByDay[day]) {
          tradesByDay[day] = { wins: 0, losses: 0, pnl: 0 };
        }
        if (trade.result === 'won') {
          tradesByDay[day].wins++;
          tradesByDay[day].pnl += Number(trade.profit || 0);
        } else {
          tradesByDay[day].losses++;
          tradesByDay[day].pnl += Number(trade.profit || 0);
        }
      });

      // Recent performance trend
      const recentPerformance: Array<{ date: string; winRate: number; pnl: number }> = [];
      const days = timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : timeRange === '90d' ? 90 : 30;
      for (let i = days - 1; i >= 0; i--) {
        const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
        const dateStr = date.toLocaleDateString();
        const dayTrades = botTrades.filter(t => 
          new Date(t.created_at).toLocaleDateString() === dateStr
        );
        const dayWins = dayTrades.filter(t => t.result === 'won').length;
        const dayWinRate = dayTrades.length > 0 ? (dayWins / dayTrades.length) * 100 : 0;
        const dayPnl = dayTrades.reduce((sum, t) => sum + Number(t.profit || 0), 0);
        recentPerformance.push({ date: dateStr, winRate: dayWinRate, pnl: dayPnl });
      }

      return {
        botName: bot.name,
        totalTrades,
        wins: wins.length,
        losses: losses.length,
        winRate,
        pnl,
        wonAmount,
        lostAmount,
        avgWin,
        avgLoss,
        profitFactor,
        maxDrawdown,
        sharpeRatio,
        tradesByHour,
        tradesByDay,
        recentPerformance,
      };
    });
  }, [bots, trades, timeRange]);

  // Sort bots
  const sortedBots = useMemo(() => {
    return [...botPerformanceData].sort((a, b) => {
      let comparison = 0;
      switch (sortBy) {
        case 'winRate':
          comparison = a.winRate - b.winRate;
          break;
        case 'pnl':
          comparison = a.pnl - b.pnl;
          break;
        case 'trades':
          comparison = a.totalTrades - b.totalTrades;
          break;
      }
      return sortOrder === 'asc' ? comparison : -comparison;
    });
  }, [botPerformanceData, sortBy, sortOrder]);

  const formatMoney = (value: number) => {
    return `${value < 0 ? '-' : ''}$${Math.abs(value).toFixed(2)}`;
  };

  const getPerformanceColor = (value: number, isPositiveGood: boolean = true) => {
    if (isPositiveGood) {
      return value >= 0 ? '#2dd4bf' : '#f87171';
    } else {
      return value >= 0 ? '#f87171' : '#2dd4bf';
    }
  };

  return (
    <div className="bot-performance-dashboard">
      {/* Header Controls */}
      <div className="dashboard-controls">
        <div className="time-range-selector">
          {(['7d', '30d', '90d', 'all'] as const).map(range => (
            <button
              key={range}
              className={`time-range-btn ${timeRange === range ? 'active' : ''}`}
              onClick={() => setTimeRange(range)}
            >
              {range === 'all' ? 'All Time' : range}
            </button>
          ))}
        </div>
        
        <div className="sort-selector">
          <Filter size={16} />
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
          >
            <option value="winRate">Sort by Win Rate</option>
            <option value="pnl">Sort by P&L</option>
            <option value="trades">Sort by Trades</option>
          </select>
          <button
            className="sort-order-btn"
            onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
          >
            {sortOrder === 'asc' ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>
      </div>

      {/* Bot Performance Cards */}
      <div className="bot-performance-grid">
        {sortedBots.map(bot => (
          <div
            key={bot.botName}
            className={`bot-performance-card ${expandedBot === bot.botName ? 'expanded' : ''}`}
            onClick={() => setExpandedBot(expandedBot === bot.botName ? null : bot.botName)}
          >
            <div className="bot-card-header">
              <div className="bot-card-title">
                <h3>{bot.botName}</h3>
                <span className="trade-count">{bot.totalTrades} trades</span>
              </div>
              <div className="bot-card-summary">
                <div className="summary-item">
                  <span className="summary-label">Win Rate</span>
                  <span 
                    className="summary-value"
                    style={{ color: getPerformanceColor(bot.winRate - 50) }}
                  >
                    {bot.winRate.toFixed(1)}%
                  </span>
                </div>
                <div className="summary-item">
                  <span className="summary-label">P&L</span>
                  <span 
                    className="summary-value"
                    style={{ color: getPerformanceColor(bot.pnl) }}
                  >
                    {formatMoney(bot.pnl)}
                  </span>
                </div>
              </div>
            </div>

            {expandedBot === bot.botName && (
              <div className="bot-card-details">
                {/* Advanced Metrics */}
                <div className="metrics-grid">
                  <div className="metric-item">
                    <span className="metric-label">Profit Factor</span>
                    <span className="metric-value">{bot.profitFactor.toFixed(2)}</span>
                  </div>
                  <div className="metric-item">
                    <span className="metric-label">Avg Win</span>
                    <span className="metric-value positive">{formatMoney(bot.avgWin)}</span>
                  </div>
                  <div className="metric-item">
                    <span className="metric-label">Avg Loss</span>
                    <span className="metric-value negative">{formatMoney(bot.avgLoss)}</span>
                  </div>
                  <div className="metric-item">
                    <span className="metric-label">Max Drawdown</span>
                    <span className="metric-value negative">{formatMoney(bot.maxDrawdown)}</span>
                  </div>
                  <div className="metric-item">
                    <span className="metric-label">Sharpe Ratio</span>
                    <span className="metric-value">{bot.sharpeRatio.toFixed(2)}</span>
                  </div>
                  <div className="metric-item">
                    <span className="metric-label">Win/Loss</span>
                    <span className="metric-value">{bot.wins}/{bot.losses}</span>
                  </div>
                </div>

                {/* Performance Trend Chart */}
                {bot.recentPerformance.length > 0 && (
                  <div className="performance-trend">
                    <h4>Performance Trend</h4>
                    <div className="trend-chart">
                      {bot.recentPerformance.map((day, index) => (
                        <div key={index} className="trend-bar-container">
                          <div className="trend-bar">
                            <div
                              className="trend-fill win-rate"
                              style={{ height: `${day.winRate}%` }}
                            />
                          </div>
                          <div className="trend-bar">
                            <div
                              className={`trend-fill pnl ${day.pnl >= 0 ? 'positive' : 'negative'}`}
                              style={{ 
                                height: `${Math.min(100, Math.abs(day.pnl) / Math.max(1, bot.recentPerformance.reduce((max, d) => Math.max(max, Math.abs(d.pnl)), 0)) * 100)}%` 
                              }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="trend-legend">
                      <span className="legend-item win-rate">Win Rate</span>
                      <span className="legend-item pnl positive">Profit</span>
                      <span className="legend-item pnl negative">Loss</span>
                    </div>
                  </div>
                )}

                {/* Hourly Performance Heatmap */}
                {Object.keys(bot.tradesByHour).length > 0 && (
                  <div className="hourly-performance">
                    <h4>Performance by Hour</h4>
                    <div className="hourly-grid">
                      {Array.from({ length: 24 }, (_, hour) => {
                        const hourData = bot.tradesByHour[hour];
                        if (!hourData) return null;
                        
                        const totalTrades = hourData.wins + hourData.losses;
                        const winRate = totalTrades > 0 ? (hourData.wins / totalTrades) * 100 : 0;
                        const pnl = hourData.pnl;
                        
                        return (
                          <div
                            key={hour}
                            className="hour-cell"
                            style={{
                              background: pnl >= 0 
                                ? `rgba(45, 212, 191, ${Math.min(0.8, Math.abs(pnl) / 100)})`
                                : `rgba(248, 113, 113, ${Math.min(0.8, Math.abs(pnl) / 100)})`,
                            }}
                            title={`${hour}:00 - Win Rate: ${winRate.toFixed(0)}%, P&L: ${formatMoney(pnl)}`}
                          >
                            <span className="hour-label">{hour}</span>
                            <span className="hour-trades">{totalTrades}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Overall Performance Summary */}
      <div className="overall-summary">
        <h3>Overall Performance Summary</h3>
        <div className="summary-stats">
          <div className="summary-stat">
            <div className="stat-icon">
              <BarChart3 size={20} />
            </div>
            <div>
              <span className="stat-label">Total Trades</span>
              <span className="stat-value">
                {botPerformanceData.reduce((sum, bot) => sum + bot.totalTrades, 0)}
              </span>
            </div>
          </div>
          <div className="summary-stat">
            <div className="stat-icon">
              <Target size={20} />
            </div>
            <div>
              <span className="stat-label">Overall Win Rate</span>
              <span className="stat-value">
                {botPerformanceData.length > 0 
                  ? (botPerformanceData.reduce((sum, bot) => sum + bot.wins, 0) / 
                     botPerformanceData.reduce((sum, bot) => sum + bot.totalTrades, 0) * 100).toFixed(1)
                  : '0'}%
              </span>
            </div>
          </div>
          <div className="summary-stat">
            <div className="stat-icon">
              <TrendingUp size={20} />
            </div>
            <div>
              <span className="stat-label">Total P&L</span>
              <span className="stat-value" style={{ 
                color: getPerformanceColor(botPerformanceData.reduce((sum, bot) => sum + bot.pnl, 0))
              }}>
                {formatMoney(botPerformanceData.reduce((sum, bot) => sum + bot.pnl, 0))}
              </span>
            </div>
          </div>
          <div className="summary-stat">
            <div className="stat-icon">
              <Zap size={20} />
            </div>
            <div>
              <span className="stat-label">Best Bot</span>
              <span className="stat-value">
                {sortedBots.length > 0 ? sortedBots[0].botName : 'N/A'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}