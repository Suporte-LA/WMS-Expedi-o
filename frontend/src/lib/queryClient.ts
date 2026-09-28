import { QueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: (count, error) => {
        const status = isAxiosError(error) ? error.response?.status : undefined;
        return count < 1 && (!status || status >= 500);
      },
    },
    mutations: { retry: false },
  },
});
