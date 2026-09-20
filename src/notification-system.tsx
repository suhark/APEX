import { useEffect, useState, useCallback, useRef } from 'react';
import { Bell, X, Settings, Check, AlertTriangle, TrendingUp, TrendingDown, Wallet, Bot, ShieldCheck } from 'lucide-react';

type NotificationType = 'trade' | 'bot' | 'system' | 'alert' | 'price';
type NotificationPriority = 'low' | 'medium' | 'high';

interface Notification {
  id: string;
  type: NotificationType;
  priority: NotificationPriority;
  title: string;
  message: string;
  timestamp: number;
  read: boolean;
  actionUrl?: string;
  data?: Record<string, any>;
}

interface NotificationPreferences {
  enableBrowserNotifications: boolean;
  enableTradeAlerts: boolean;
  enableBotAlerts: boolean;
  enableSystemAlerts: boolean;
  enablePriceAlerts: boolean;
  soundEnabled: boolean;
  quietHours: { enabled: boolean; start: string; end: string };
}

const DEFAULT_PREFERENCES: NotificationPreferences = {
  enableBrowserNotifications: true,
  enableTradeAlerts: true,
  enableBotAlerts: true,
  enableSystemAlerts: true,
  enablePriceAlerts: false,
  soundEnabled: false,
  quietHours: { enabled: false, start: '22:00', end: '08:00' },
};

export function useNotificationSystem(userId: string) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [preferences, setPreferences] = useState<NotificationPreferences>(DEFAULT_PREFERENCES);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showPanel, setShowPanel] = useState(false);
  const permissionRef = useRef<NotificationPermission>('default');

  // Load preferences from localStorage
  useEffect(() => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const savedPrefs = localStorage.getItem(`apex_notification_prefs_${userId}`);
        if (savedPrefs) {
          setPreferences({ ...DEFAULT_PREFERENCES, ...JSON.parse(savedPrefs) });
        }
      }
    } catch (e) {
      console.warn('Failed to load notification preferences:', e);
    }
  }, [userId]);

  // Save preferences to localStorage
  const savePreferences = useCallback((newPrefs: NotificationPreferences) => {
    setPreferences(newPrefs);
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        localStorage.setItem(`apex_notification_prefs_${userId}`, JSON.stringify(newPrefs));
      }
    } catch (e) {
      console.warn('Failed to save notification preferences:', e);
    }
  }, [userId]);

  // Request browser notification permission
  const requestBrowserPermission = useCallback(async () => {
    if ('Notification' in window) {
      const permission = await Notification.requestPermission();
      permissionRef.current = permission;
      return permission === 'granted';
    }
    return false;
  }, []);

  // Check if we're in quiet hours
  const isInQuietHours = useCallback(() => {
    if (!preferences.quietHours.enabled) return false;
    
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentTime = currentHour * 60 + currentMinute;
    
    const [startHour, startMinute] = preferences.quietHours.start.split(':').map(Number);
    const [endHour, endMinute] = preferences.quietHours.end.split(':').map(Number);
    const startTime = startHour * 60 + startMinute;
    const endTime = endHour * 60 + endMinute;
    
    if (startTime < endTime) {
      return currentTime >= startTime && currentTime < endTime;
    } else {
      // Overnight quiet hours (e.g., 22:00 to 08:00)
      return currentTime >= startTime || currentTime < endTime;
    }
  }, [preferences.quietHours]);

  // Show browser notification
  const showBrowserNotification = useCallback((notification: Notification) => {
    if (typeof window === 'undefined') return;
    if (!preferences.enableBrowserNotifications) return;
    if (isInQuietHours()) return;
    if (permissionRef.current !== 'granted') return;
    if (!('Notification' in window)) return;

    // Check category-specific preferences
    switch (notification.type) {
      case 'trade':
        if (!preferences.enableTradeAlerts) return;
        break;
      case 'bot':
        if (!preferences.enableBotAlerts) return;
        break;
      case 'system':
        if (!preferences.enableSystemAlerts) return;
        break;
      case 'price':
        if (!preferences.enablePriceAlerts) return;
        break;
    }

    try {
      const browserNotif = new Notification(notification.title, {
        body: notification.message,
        icon: '/apex-logo.png',
        tag: notification.id,
        requireInteraction: notification.priority === 'high',
      });

      browserNotif.onclick = () => {
        window.focus();
        if (notification.actionUrl) {
          window.location.href = notification.actionUrl;
        }
        browserNotif.close();
      };

      if (preferences.soundEnabled) {
        // Play notification sound
        const audio = new Audio('/notification-sound.mp3');
        audio.volume = 0.3;
        audio.play().catch(() => {});
      }
    } catch (e) {
      console.warn('Failed to show browser notification:', e);
    }
  }, [preferences, isInQuietHours]);

  // Add notification
  const addNotification = useCallback((notification: Omit<Notification, 'id' | 'timestamp' | 'read'>) => {
    const newNotification: Notification = {
      ...notification,
      id: `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
      read: false,
    };

    setNotifications(prev => [newNotification, ...prev].slice(0, 50)); // Keep last 50
    setUnreadCount(prev => prev + 1);
    
    showBrowserNotification(newNotification);
    
    return newNotification.id;
  }, [showBrowserNotification]);

  // Mark notification as read
  const markAsRead = useCallback((id: string) => {
    setNotifications(prev => 
      prev.map(n => n.id === id ? { ...n, read: true } : n)
    );
    setUnreadCount(prev => Math.max(0, prev - 1));
  }, []);

  // Mark all as read
  const markAllAsRead = useCallback(() => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    setUnreadCount(0);
  }, []);

  // Delete notification
  const deleteNotification = useCallback((id: string) => {
    setNotifications(prev => {
      const notif = prev.find(n => n.id === id);
      if (notif && !notif.read) {
        setUnreadCount(c => Math.max(0, c - 1));
      }
      return prev.filter(n => n.id !== id);
    });
  }, []);

  // Clear all notifications
  const clearAll = useCallback(() => {
    setNotifications([]);
    setUnreadCount(0);
  }, []);

  return {
    notifications,
    preferences,
    unreadCount,
    showPanel,
    setShowPanel,
    addNotification,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    clearAll,
    savePreferences,
    requestBrowserPermission,
  };
}

// Notification Panel Component
export function NotificationPanel({
  notifications,
  unreadCount,
  onClose,
  onMarkAsRead,
  onMarkAllAsRead,
  onDelete,
  onClearAll,
}: {
  notifications: Notification[];
  unreadCount: number;
  onClose: () => void;
  onMarkAsRead: (id: string) => void;
  onMarkAllAsRead: () => void;
  onDelete: (id: string) => void;
  onClearAll: () => void;
}) {
  const getNotificationIcon = (type: NotificationType) => {
    switch (type) {
      case 'trade': return <Wallet size={16} />;
      case 'bot': return <Bot size={16} />;
      case 'system': return <ShieldCheck size={16} />;
      case 'alert': return <AlertTriangle size={16} />;
      case 'price': return <TrendingUp size={16} />;
    }
  };

  const getNotificationColor = (type: NotificationType) => {
    switch (type) {
      case 'trade': return '#2dd4bf';
      case 'bot': return '#8b5cf6';
      case 'system': return '#3b82f6';
      case 'alert': return '#f97316';
      case 'price': return '#fbbf24';
    }
  };

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
    return date.toLocaleDateString();
  };

  return (
    <div className="notification-panel-overlay" onClick={onClose}>
      <div className="notification-panel" onClick={(e) => e.stopPropagation()}>
        <div className="notification-panel-header">
          <div className="notification-panel-title">
            <Bell size={18} />
            <span>Notifications</span>
            {unreadCount > 0 && (
              <span className="notification-badge">{unreadCount}</span>
            )}
          </div>
          <div className="notification-panel-actions">
            {unreadCount > 0 && (
              <button 
                className="text-button" 
                onClick={onMarkAllAsRead}
                title="Mark all as read"
              >
                Mark all read
              </button>
            )}
            {notifications.length > 0 && (
              <button 
                className="text-button" 
                onClick={onClearAll}
                title="Clear all notifications"
              >
                Clear all
              </button>
            )}
            <button className="icon-button" onClick={onClose} title="Close">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="notification-panel-content">
          {notifications.length === 0 ? (
            <div className="notification-empty">
              <Bell size={32} className="notification-empty-icon" />
              <p>No notifications yet</p>
              <small>You're all caught up</small>
            </div>
          ) : (
            <div className="notification-list">
              {notifications.map((notification) => (
                <div
                  key={notification.id}
                  className={`notification-item ${notification.read ? 'read' : 'unread'}`}
                  onClick={() => onMarkAsRead(notification.id)}
                >
                  <div 
                    className="notification-icon"
                    style={{ color: getNotificationColor(notification.type) }}
                  >
                    {getNotificationIcon(notification.type)}
                  </div>
                  <div className="notification-content">
                    <div className="notification-header">
                      <span className="notification-title">{notification.title}</span>
                      <span className="notification-time">{formatTime(notification.timestamp)}</span>
                    </div>
                    <p className="notification-message">{notification.message}</p>
                    {notification.priority === 'high' && (
                      <span className="notification-priority">High Priority</span>
                    )}
                  </div>
                  <button
                    className="notification-delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(notification.id);
                    }}
                    title="Delete notification"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Notification Settings Component
export function NotificationSettings({
  preferences,
  onSave,
  onRequestPermission,
}: {
  preferences: NotificationPreferences;
  onSave: (prefs: NotificationPreferences) => void;
  onRequestPermission: () => Promise<boolean>;
}) {
  const [localPrefs, setLocalPrefs] = useState(preferences);
  const [permissionStatus, setPermissionStatus] = useState<string>('unknown');

  useEffect(() => {
    if ('Notification' in window) {
      setPermissionStatus(Notification.permission);
    }
  }, []);

  const handleRequestPermission = async () => {
    const granted = await onRequestPermission();
    if (granted) {
      setPermissionStatus('granted');
    }
  };

  const handleSave = () => {
    onSave(localPrefs);
  };

  return (
    <div className="notification-settings">
      <div className="settings-section">
        <h3>Browser Notifications</h3>
        <div className="settings-row">
          <label className="toggle-label">
            <input
              type="checkbox"
              checked={localPrefs.enableBrowserNotifications}
              onChange={(e) => setLocalPrefs({ ...localPrefs, enableBrowserNotifications: e.target.checked })}
            />
            <span>Enable browser notifications</span>
          </label>
          {permissionStatus === 'default' && (
            <button className="secondary" onClick={handleRequestPermission}>
              Request Permission
            </button>
          )}
          {permissionStatus === 'granted' && (
            <span className="permission-status granted">✓ Permission granted</span>
          )}
          {permissionStatus === 'denied' && (
            <span className="permission-status denied">✗ Permission denied</span>
          )}
        </div>
        <label className="toggle-label">
          <input
            type="checkbox"
            checked={localPrefs.soundEnabled}
            onChange={(e) => setLocalPrefs({ ...localPrefs, soundEnabled: e.target.checked })}
          />
          <span>Enable notification sounds</span>
        </label>
      </div>

      <div className="settings-section">
        <h3>Notification Types</h3>
        <label className="toggle-label">
          <input
            type="checkbox"
            checked={localPrefs.enableTradeAlerts}
            onChange={(e) => setLocalPrefs({ ...localPrefs, enableTradeAlerts: e.target.checked })}
          />
          <span>Trade alerts (wins/losses)</span>
        </label>
        <label className="toggle-label">
          <input
            type="checkbox"
            checked={localPrefs.enableBotAlerts}
            onChange={(e) => setLocalPrefs({ ...localPrefs, enableBotAlerts: e.target.checked })}
          />
          <span>Bot activity alerts</span>
        </label>
        <label className="toggle-label">
          <input
            type="checkbox"
            checked={localPrefs.enableSystemAlerts}
            onChange={(e) => setLocalPrefs({ ...localPrefs, enableSystemAlerts: e.target.checked })}
          />
          <span>System notifications</span>
        </label>
        <label className="toggle-label">
          <input
            type="checkbox"
            checked={localPrefs.enablePriceAlerts}
            onChange={(e) => setLocalPrefs({ ...localPrefs, enablePriceAlerts: e.target.checked })}
          />
          <span>Price alerts</span>
        </label>
      </div>

      <div className="settings-section">
        <h3>Quiet Hours</h3>
        <label className="toggle-label">
          <input
            type="checkbox"
            checked={localPrefs.quietHours.enabled}
            onChange={(e) => setLocalPrefs({ 
              ...localPrefs, 
              quietHours: { ...localPrefs.quietHours, enabled: e.target.checked }
            })}
          />
          <span>Enable quiet hours</span>
        </label>
        {localPrefs.quietHours.enabled && (
          <div className="time-range">
            <label>
              From
              <input
                type="time"
                value={localPrefs.quietHours.start}
                onChange={(e) => setLocalPrefs({ 
                  ...localPrefs, 
                  quietHours: { ...localPrefs.quietHours, start: e.target.value }
                })}
              />
            </label>
            <label>
              To
              <input
                type="time"
                value={localPrefs.quietHours.end}
                onChange={(e) => setLocalPrefs({ 
                  ...localPrefs, 
                  quietHours: { ...localPrefs.quietHours, end: e.target.value }
                })}
              />
            </label>
          </div>
        )}
      </div>

      <button className="primary save-settings-btn" onClick={handleSave}>
        Save Settings
      </button>
    </div>
  );
}