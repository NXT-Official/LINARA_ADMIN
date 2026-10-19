import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { useT } from "@/lib/i18n/i18n";
import { LocaleProvider } from "@/lib/i18n/locale-provider";
import { readLocale } from "@/lib/i18n/locale-cookie";

import appCss from "../styles.css?url";

function NotFoundComponent() {
  const t = useT();
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl text-foreground">{t("root.notFoundTitle")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("root.notFoundBody")}</p>
        <Button asChild className="mt-6">
          <Link to="/">{t("common.goToConsole")}</Link>
        </Button>
      </div>
    </main>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();
  const t = useT();

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl text-foreground">{t("root.errorTitle")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("root.errorBody")}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button
            onClick={() => {
              router.invalidate();
              reset();
            }}
          >
            {t("common.tryAgain")}
          </Button>
          <Button asChild variant="outline">
            <Link to="/">{t("common.goToConsole")}</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Linara Business Console" },
      // Kept out of search engines (spec §7.4); the server also sends X-Robots-Tag.
      { name: "robots", content: "noindex, nofollow" },
      { name: "theme-color", content: "#1F5A54" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&family=Literata:opsz,wght@7..72,400;7..72,500;7..72,600;7..72,700&family=Nunito+Sans:wght@300;400;500;600;700;800&display=swap",
      },
    ],
  }),
  // The admin's language, from its cookie, so pages arrive already in it (D42).
  beforeLoad: () => ({ locale: readLocale() }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  const locale = Route.useRouteContext({ select: (c) => c.locale });
  return (
    <html lang={locale}>
      <head>
        <HeadContent />
      </head>
      <body>
        <LocaleProvider initial={locale}>
          {children}
          <Scripts />
        </LocaleProvider>
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
      <Toaster position="top-center" richColors closeButton />
    </QueryClientProvider>
  );
}
