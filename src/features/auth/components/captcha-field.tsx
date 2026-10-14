import { forwardRef, useImperativeHandle, useRef } from "react";
import HCaptcha from "@hcaptcha/react-hcaptcha";

export type CaptchaFieldHandle = { reset: () => void };

/**
 * The hCaptcha check on sign-in and password reset (S-3). The token it
 * produces is checked on the server; the widget alone proves nothing.
 * Local development uses hCaptcha's test site key, which always passes.
 */
export const CaptchaField = forwardRef<
  CaptchaFieldHandle,
  { onToken: (token: string | null) => void }
>(function CaptchaField({ onToken }, ref) {
  const captcha = useRef<HCaptcha>(null);
  useImperativeHandle(ref, () => ({
    reset: () => {
      captcha.current?.resetCaptcha();
      onToken(null);
    },
  }));

  return (
    <div className="min-h-[78px]">
      <HCaptcha
        ref={captcha}
        sitekey={process.env.HCAPTCHA_SITE_KEY ?? ""}
        onVerify={(token) => onToken(token)}
        onExpire={() => onToken(null)}
        onError={() => onToken(null)}
        // Don't send error reports to hCaptcha's own tracker (S-21).
        sentry={false}
      />
    </div>
  );
});
