/**
 * Flat, light-only subset of howlil-app design tokens.
 * Source: howlil/howlil-app/src/styles/global.css (2026-10-19).
 * Snapshot is local by design: sandbox previews have no network access.
 * User-authored style rules follow this preset and may customize a preview.
 */
export const HOWLIL_FLAT_PREVIEW_CSS = String.raw`
:root {
  color-scheme: light;
  --color-page: #FEFEFE;
  --color-surface: #F7F7F7;
  --color-surface-muted: #F5F5F5;
  --color-surface-hover: #F5F5F5;
  --color-border: #BFBFBF;
  --color-border-strong: #949494;
  --color-text-heading: #121212;
  --color-text-body: #202020;
  --color-text-secondary: #626262;
  --color-text-muted: #949494;
  --color-accent: #9BB1FF;
  --color-accent-soft: #EAF8FC;
  --color-success: #ACE1AF;
  --color-focus: #9BB1FF;
  --font-body: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --font-heading: var(--font-body);
  --radius-sm: .375rem;
  --radius-md: .625rem;
  --radius-lg: .9rem;
  --radius-pill: 9999px;
  --space-1: .25rem;
  --space-2: .5rem;
  --space-3: .75rem;
  --space-4: 1rem;
  --space-5: 1.25rem;
  --space-6: 1.5rem;
}
*, *::before, *::after { box-sizing: border-box; }
html, body {
  margin: 0;
  padding: 0;
  min-height: 0;
  height: auto;
  color-scheme: light;
  background: var(--color-page);
  color: var(--color-text-body);
  font: 14px/1.5 var(--font-body);
}
body { overflow-x: hidden; }
#nox-preview-content {
  display: flow-root;
  width: 100%;
  min-width: 0;
  min-height: 0;
  padding: 16px;
  background: var(--color-page);
}
h1, h2, h3, h4, h5, h6 { color: var(--color-text-heading); font-family: var(--font-heading); line-height: 1.3; }
h1 { font-size: 1.75rem; }
h2 { font-size: 1.25rem; }
h3 { font-size: 1.125rem; }
p, ul, ol { overflow-wrap: anywhere; }
img, svg, video, canvas { max-width: 100%; height: auto; }
button, input, select, textarea { font: inherit; }
button {
  min-height: 36px;
  padding: 7px 14px;
  border: 1px solid var(--color-text-heading);
  border-radius: var(--radius-pill);
  background: var(--color-text-heading);
  color: var(--color-page);
  box-shadow: none;
  cursor: pointer;
}
button:hover { background: var(--color-text-body); }
button:disabled { opacity: .45; cursor: not-allowed; }
input, textarea, select {
  min-width: 0;
  max-width: 100%;
  padding: 9px 12px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-page);
  color: var(--color-text-heading);
  box-shadow: none;
}
button:focus-visible, input:focus-visible, textarea:focus-visible, select:focus-visible, a:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}
[data-surface], .preview-card {
  padding: var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
  box-shadow: none;
}
[hidden] { display: none !important; }
@media (max-width: 420px) {
  #nox-preview-content { padding: 12px; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; }
}
`;
