import "./lib/error-capture";

import { randomBytes } from "node:crypto";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { withSecurityHeaders } from "./lib/security-headers";
import { SERVER_FN_PREFIX, badRequest, isMalformedServerFnBody } from "./lib/server-fn-body";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"}; try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

async function respond(request: Request, env: unknown, ctx: unknown): Promise<Response> {
  try {
    const handler = await getServerEntry();
    const response = await handler.fetch(request, env, ctx);
    return await normalizeCatastrophicSsrResponse(response);
  } catch (error) {
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
}

/** Files that may be cached: built assets, icons and robots.txt. Everything else is no-store (S-16). */
function isStaticAsset(pathname: string): boolean {
  return (
    pathname.startsWith("/assets/") || /\.(?:png|ico|svg|txt|webmanifest|woff2?)$/.test(pathname)
  );
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    // A fresh nonce per request for the router's own scripts (S-14). It reaches
    // the router through a request header the browser can't set for us.
    const nonce = randomBytes(16).toString("base64");
    const headers = new Headers(request.headers);
    headers.set("x-csp-nonce", nonce);
    // Built from parts: Nitro's incoming request isn't a native Request, so
    // `new Request(request, ...)` can't copy it.
    const hasBody = request.method !== "GET" && request.method !== "HEAD";
    const securityOptions = {
      nonce,
      // Vite's dev server needs inline scripts: report violations there, enforce in builds.
      reportOnly: import.meta.env.DEV,
      noStore: !isStaticAsset(new URL(request.url).pathname),
    };

    // A hand-made server-function call the framework can't parse gets a plain
    // 400 here, instead of a 500 carrying the framework's own error text.
    let body: BodyInit | null | undefined = hasBody ? request.body : undefined;
    const contentType = request.headers.get("content-type");
    if (
      hasBody &&
      new URL(request.url).pathname.startsWith(SERVER_FN_PREFIX) &&
      contentType?.toLowerCase().includes("application/json")
    ) {
      const text = await request.text();
      if (isMalformedServerFnBody(contentType, text)) {
        return withSecurityHeaders(badRequest(), securityOptions);
      }
      body = text;
    }

    const withNonce = new Request(request.url, {
      method: request.method,
      headers,
      body,
      signal: request.signal,
      // Required by Node when the body is a stream.
      ...(hasBody ? { duplex: "half" } : {}),
    } as RequestInit);

    // Every response, error pages and redirects too.
    return withSecurityHeaders(await respond(withNonce, env, ctx), securityOptions);
  },
};
