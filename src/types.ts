export interface DailyItem {
  id: string;
  title: string;
  url: string;
  iconUrl: string;
  customNotifyTime: string | null;
  playedToday: boolean;
  lastPlayedDate: string | null;
  order?: number;
  createdAt: string;
}

export interface UserSettings {
  email: string;
  timezone: string;
  defaultNotifyTime: string;
  notificationsEnabled: boolean;
  deviceCount: number;
  localToday: string;
}

export interface MeResponse {
  settings: UserSettings;
  dailies: DailyItem[];
}

export interface InspectedSite {
  url: string;
  title: string;
  iconUrl: string;
}

export interface TimeOption {
  value: string;
  label: string;
}

export function formatTime12h(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(':');
  const h = Number(hStr);
  const m = Number(mStr);
  if (Number.isNaN(h) || Number.isNaN(m)) return hhmm;
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  const minPadded = String(m).padStart(2, '0');
  if (hhmm === '00:00') return '12:00 AM (Midnight)';
  if (hhmm === '12:00') return '12:00 PM (Noon)';
  return `${hour12}:${minPadded} ${period}`;
}

export const TIME_SLOTS_15M: TimeOption[] = Array.from({ length: 96 }, (_, idx) => {
  const totalMins = idx * 15;
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  const value = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
  return {
    value,
    label: formatTime12h(value),
  };
});

export function getSupportedTimezones(): string[] {
  try {
    if (typeof Intl !== 'undefined' && 'supportedValuesOf' in Intl) {
      return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf(
        'timeZone'
      );
    }
  } catch {
    // Fallback list
  }
  return [
    'UTC',
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Los_Angeles',
    'Europe/London',
    'Europe/Paris',
    'Asia/Singapore',
    'Asia/Tokyo',
    'Australia/Sydney',
  ];
}

export function detectBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
