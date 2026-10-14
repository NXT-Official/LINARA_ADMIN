import { createCsrfMiddleware, createMiddleware, createStart } from "@tanstack/react-start";

import { isServerFnRequest } from "./lib/csrf";
import { renderErrorPage } from "./lib/error-page";

// Server functions only answer requests from this site: the browser's
// Sec-Fetch-Site and Origin headers must say so. Backs up the SameSite=Strict
// session cookies (D26).
const csrfMiddleware = createCsrfMiddleware({
  filter: ({ request }) => isServerFnRequest(request.url),
});

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

export const startInstance = createStart(() => ({
  requestMiddleware: [errorMiddleware, csrfMiddleware],
}));
