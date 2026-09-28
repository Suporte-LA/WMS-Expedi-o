import { isAxiosError } from "axios";

export function errorMessage(error: unknown, fallback: string): string {
  if (isAxiosError<{ message?: string }>(error) && typeof error.response?.data?.message === "string") {
    return error.response.data.message;
  }
  return fallback;
}
