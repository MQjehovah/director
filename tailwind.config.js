/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,ts}'],
  theme: {
    extend: {
      colors: {
        panel: 'var(--panel)',
        raised: 'var(--raised)',
        edge: 'var(--edge)',
        ink: 'var(--ink)',
        'ink-muted': 'var(--ink-muted)',
        accent: 'var(--accent)',
      },
    },
  },
  plugins: [],
}
