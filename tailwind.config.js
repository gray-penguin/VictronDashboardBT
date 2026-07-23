/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        orange: { 400: '#fb923c', 500: '#f97316', 600: '#ea580c' },
        // Theme tokens, backed by CSS variables in index.css so a single
        // [data-theme] attribute on <html> flips every one of these at once.
        // Named by role/weight (not by literal shade) so component code
        // never hardcodes a light- or dark-specific color again.
        canvas: withOpacity('--color-canvas'), // page background
        surface: withOpacity('--color-surface'), // card background
        'surface-2': withOpacity('--color-surface-2'), // elevated/hover surface
        'surface-3': withOpacity('--color-surface-3'), // selected/active pill
        line: withOpacity('--color-line'), // default border
        'line-2': withOpacity('--color-line-2'), // stronger border (popovers)
        'line-3': withOpacity('--color-line-3'), // hover/focus border
        ink: withOpacity('--color-ink'), // primary text
        'ink-2': withOpacity('--color-ink-2'), // headings
        'ink-3': withOpacity('--color-ink-3'), // body text
        'ink-4': withOpacity('--color-ink-4'), // secondary/label text
        'ink-5': withOpacity('--color-ink-5'), // tertiary text
        'ink-6': withOpacity('--color-ink-6'), // muted text
        'ink-7': withOpacity('--color-ink-7'), // faint/near-hidden text
        'ink-accent': withOpacity('--color-ink-accent'), // text on orange accent, fixed both themes
      },
    },
  },
  plugins: [],
};

function withOpacity(cssVar) {
  return `rgb(var(${cssVar}) / <alpha-value>)`;
}
