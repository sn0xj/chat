import axios from 'axios';
import { useChatStore } from '@/store/chat-store';

const resolveApiBaseUrl = () => {
  const enforceTls = import.meta.env.VITE_REQUIRE_TLS !== 'false';
  const protocol = window.location.protocol === 'https:' ? 'https' : 'http';
  const runtimeBaseUrl = `${protocol}://${window.location.hostname}:3025`;
  const envBaseUrl = import.meta.env.VITE_API_URL;
  if (!envBaseUrl) {
    return runtimeBaseUrl;
  }

  try {
    const envUrl = new URL(envBaseUrl);
    const isEnvLocalhost = envUrl.hostname === 'localhost' || envUrl.hostname === '127.0.0.1';
    const isRuntimeLocalhost =
      window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

    // If app opened from LAN host, never call localhost API on client machine.
    if (isEnvLocalhost && !isRuntimeLocalhost) {
      return runtimeBaseUrl;
    }
  } catch {
    return runtimeBaseUrl;
  }

  if (enforceTls) {
    try {
      const resolved = new URL(envBaseUrl);
      if (window.location.protocol === 'https:' && resolved.protocol !== 'https:') {
        throw new Error('Insecure API URL is not allowed when app is served via HTTPS');
      }
    } catch {
      throw new Error('VITE_API_URL must be a valid absolute URL when TLS enforcement is enabled');
    }
  }

  return envBaseUrl;
};

const API_BASE_URL = resolveApiBaseUrl();

export const api = axios.create({
  baseURL: API_BASE_URL,
});

const refreshClient = axios.create({
  baseURL: API_BASE_URL,
});

const bootToken = localStorage.getItem('accessToken');
if (bootToken) {
  api.defaults.headers.common.Authorization = `Bearer ${bootToken}`;
}

export const setAuthToken = (token: string | null) => {
  if (!token) {
    delete api.defaults.headers.common.Authorization;
    return;
  }
  api.defaults.headers.common.Authorization = `Bearer ${token}`;
};

let refreshPromise: Promise<string | null> | null = null;

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const status = error?.response?.status;
    const originalRequest = error?.config as { _retry?: boolean; headers?: Record<string, string> };
    if (status !== 401 || !originalRequest || originalRequest._retry) {
      return Promise.reject(error);
    }

    const { refreshToken, setToken, setRefreshToken, setUser } = useChatStore.getState();
    if (!refreshToken) {
      setToken(null);
      setRefreshToken(null);
      setUser(null);
      return Promise.reject(error);
    }

    originalRequest._retry = true;

    if (!refreshPromise) {
      refreshPromise = refreshClient
        .post('/auth/refresh', { refreshToken })
        .then((response) => {
          const nextAccess = response.data?.accessToken as string;
          const nextRefresh = response.data?.refreshToken as string;
          if (!nextAccess || !nextRefresh) {
            throw new Error('Invalid refresh response');
          }
          setToken(nextAccess);
          setRefreshToken(nextRefresh);
          setAuthToken(nextAccess);
          return nextAccess;
        })
        .catch((refreshError) => {
          setToken(null);
          setRefreshToken(null);
          setUser(null);
          setAuthToken(null);
          throw refreshError;
        })
        .finally(() => {
          refreshPromise = null;
        });
    }

    const nextAccess = await refreshPromise;
    if (!nextAccess) {
      return Promise.reject(error);
    }
    originalRequest.headers = originalRequest.headers || {};
    originalRequest.headers.Authorization = `Bearer ${nextAccess}`;
    return api(originalRequest);
  },
);
