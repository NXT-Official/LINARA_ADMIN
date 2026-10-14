import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { routeTree } from "./routeTree.gen";

/** The request's CSP nonce on the server (set by server.ts); none in the browser. */
const getNonce = createIsomorphicFn()
  .server(() => {
    // Outside a request (tests, build-time tools) there is no nonce to read.
    try {
      return getRequestHeader("x-csp-nonce");
    } catch {
      return undefined;
    }
  })
  .client(() => undefined);

export const getRouter = () => {
  // Screens re-read data at most every 30 seconds and never just because the
  // window regained focus; only outside-service failures retry, once (D31).
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: (count, error) =>
          count < 1 && (error as { code?: string } | null)?.code === "outside_service",
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    // Stamps the router's own inline scripts so the strict CSP allows them (S-14).
    ssr: { nonce: getNonce() },
  });

  return router;
};
