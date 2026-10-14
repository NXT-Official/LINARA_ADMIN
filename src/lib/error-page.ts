/**
 * The page sent when the server itself fails. No script at all, so the
 * Content-Security-Policy never blocks it (S-14): "Try again" is a link to the
 * same address. Colours are the LINARA brand's.
 */
export function renderErrorPage(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>This page didn't load</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, nofollow" />
    <style>
      body { font: 15px/1.5 system-ui, -apple-system, sans-serif; background: #faf3e6; color: #1b2a28; display: grid; place-items: center; min-height: 100vh; margin: 0; padding: 1.5rem; }
      .card { max-width: 28rem; width: 100%; text-align: center; padding: 2rem; background: #fefbf6; border-radius: 24px; }
      h1 { font-size: 1.25rem; margin: 0 0 0.5rem; }
      p { color: #576764; margin: 0 0 1.5rem; }
      .actions { display: flex; gap: 0.5rem; justify-content: center; flex-wrap: wrap; }
      a { padding: 0.5rem 1rem; border-radius: 12px; font: inherit; font-weight: 600; text-decoration: none; border: 1px solid transparent; }
      .primary { background: #26574e; color: #fefbf6; }
      .secondary { background: #fefbf6; color: #26574e; border-color: rgba(38, 87, 78, 0.3); }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>This page didn't load</h1>
      <p>Something went wrong on our side. Try again, or go back to the console.</p>
      <div class="actions">
        <a class="primary" href="">Try again</a>
        <a class="secondary" href="/">Go to the console</a>
      </div>
    </div>
  </body>
</html>`;
}
