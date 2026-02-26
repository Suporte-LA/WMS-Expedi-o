import axios from "axios";
import { getToken } from "./auth";

const apiBaseUrl = import.meta.env.VITE_API_URL?.trim() || "/api";

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
