import { auth } from './firebase';
import type {
  CatalogGame,
  DailyItem,
  GameRequestItem,
  MeResponse,
  UserSettings,
} from '../types';

async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
  forceTokenRefresh = false
): Promise<T> {
  const user = auth?.currentUser;
  if (!user) {
    throw new Error('Not signed in.');
  }
  const idToken = await user.getIdToken(forceTokenRefresh);
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${idToken}`);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(path, { ...init, headers });
  if (!response.ok) {
    let detail = `Request failed (${response.status})`;
    try {
      const payload = (await response.json()) as { detail?: string };
      if (payload?.detail) detail = payload.detail;
    } catch {
      // keep status message
    }
    throw new Error(detail);
  }
  return (await response.json()) as T;
}

export function fetchMe(detectedTz?: string): Promise<MeResponse> {
  const query = detectedTz ? `?tz=${encodeURIComponent(detectedTz)}` : '';
  return apiFetch<MeResponse>(`/api/me${query}`);
}

export function fetchCatalog(): Promise<{ games: CatalogGame[] }> {
  return apiFetch<{ games: CatalogGame[] }>('/api/catalog');
}

export function updateUserSettings(patch: {
  timezone?: string;
  defaultNotifyTime?: string;
  notificationsEnabled?: boolean;
}): Promise<UserSettings> {
  return apiFetch<UserSettings>('/api/settings', {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export function updateAccountEmail(email: string): Promise<{ email: string }> {
  return apiFetch<{ email: string }>(
    '/api/account/email',
    {
      method: 'PATCH',
      body: JSON.stringify({ email }),
    },
    true
  );
}

export function deleteAccount(): Promise<{ status: string }> {
  return apiFetch<{ status: string }>(
    '/api/account',
    {
      method: 'DELETE',
    },
    true
  );
}

export function createDaily(input: {
  catalogId: string;
  customNotifyTime?: string | null;
}): Promise<DailyItem> {
  return apiFetch<DailyItem>('/api/dailies', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function reorderDailies(orderedIds: string[]): Promise<{ status: string }> {
  return apiFetch<{ status: string }>('/api/dailies/reorder', {
    method: 'PUT',
    body: JSON.stringify({ orderedIds }),
  });
}

export function updateDaily(
  id: string,
  patch: {
    title?: string;
    customNotifyTime?: string;
    clearCustomNotifyTime?: boolean;
    playedToday?: boolean;
  }
): Promise<DailyItem> {
  return apiFetch<DailyItem>(`/api/dailies/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export function deleteDaily(id: string): Promise<{ status: string; id: string }> {
  return apiFetch<{ status: string; id: string }>(`/api/dailies/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export function submitGameRequest(input: {
  url: string;
  title?: string;
  category?: string;
}): Promise<{ id: string; title: string; url: string; requestCount: number }> {
  return apiFetch('/api/requests', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function fetchAdminRequests(): Promise<{ requests: GameRequestItem[] }> {
  return apiFetch<{ requests: GameRequestItem[] }>('/api/admin/requests');
}

export function acceptAdminRequest(
  requestId: string,
  override?: { title?: string; category?: string }
): Promise<{ game: CatalogGame }> {
  return apiFetch<{ game: CatalogGame }>(
    `/api/admin/requests/${encodeURIComponent(requestId)}/accept`,
    {
      method: 'POST',
      body: JSON.stringify(override || {}),
    }
  );
}

export function rejectAdminRequest(requestId: string): Promise<{ status: string; id: string }> {
  return apiFetch<{ status: string; id: string }>(
    `/api/admin/requests/${encodeURIComponent(requestId)}`,
    {
      method: 'DELETE',
    }
  );
}

export function addAdminCatalogGame(input: {
  url: string;
  title?: string;
  category?: string;
}): Promise<{ game: CatalogGame }> {
  return apiFetch<{ game: CatalogGame }>('/api/admin/catalog', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function removeAdminCatalogGame(gameId: string): Promise<{ status: string; id: string }> {
  return apiFetch<{ status: string; id: string }>(
    `/api/admin/catalog/${encodeURIComponent(gameId)}`,
    {
      method: 'DELETE',
    }
  );
}

export function registerDeviceToken(
  token: string
): Promise<{ tokenHash: string; deviceCount: number; notificationsEnabled: boolean }> {
  return apiFetch('/api/devices', {
    method: 'POST',
    body: JSON.stringify({
      token,
      userAgent: navigator.userAgent.slice(0, 500),
    }),
  });
}

export function unregisterDeviceToken(tokenHash: string): Promise<{ status: string }> {
  return apiFetch(`/api/devices/${encodeURIComponent(tokenHash)}`, {
    method: 'DELETE',
  });
}
