import axios from "axios";
import { getToken } from "./auth";

export const apiBaseUrl = (import.meta.env.VITE_API_URL?.trim() || "/api").replace(/\/$/, "");

export const api = axios.create({
  baseURL: apiBaseUrl
});

api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export function buildApiUrl(path: string) {
  if (!path) return apiBaseUrl;
  if (/^https?:\/\//i.test(path)) return path;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${apiBaseUrl}${normalized}`;
}
