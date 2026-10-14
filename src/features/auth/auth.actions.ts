import { createServerFn } from "@tanstack/react-start";

import {
  signInHandler,
  signOutHandler,
  startTwoStepSetupHandler,
  verifyTwoStepHandler,
  type SignInInput,
  type VerifyInput,
} from "./auth.handlers.server";
import {
  requestPasswordResetHandler,
  setPasswordFromLinkHandler,
  type LinkInput,
  type ResetInput,
} from "./link.handlers.server";

/**
 * Server functions for signing in. The logic lives in auth.handlers.server.ts,
 * which never reaches the browser; these are the endpoints the pages call.
 */
export const signInFn = createServerFn({ method: "POST" })
  .validator((d: SignInInput) => d)
  .handler(({ data }) => signInHandler(data));

export const startTwoStepSetupFn = createServerFn({ method: "POST" }).handler(() =>
  startTwoStepSetupHandler(),
);

export const verifyTwoStepFn = createServerFn({ method: "POST" })
  .validator((d: VerifyInput) => d)
  .handler(({ data }) => verifyTwoStepHandler(data));

export const signOutFn = createServerFn({ method: "POST" }).handler(() => signOutHandler());

export const requestPasswordResetFn = createServerFn({ method: "POST" })
  .validator((d: ResetInput) => d)
  .handler(({ data }) => requestPasswordResetHandler(data));

export const setPasswordFromLinkFn = createServerFn({ method: "POST" })
  .validator((d: LinkInput) => d)
  .handler(({ data }) => setPasswordFromLinkHandler(data));
