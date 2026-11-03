import globals from 'globals';

// Minimal lint focused on the class of bug that a module split can introduce: a name used but
// never imported/declared (no-undef) and dead bindings (no-unused-vars). Not a style gate.
export default [
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        google: 'readonly',        // Google Maps JS, loaded at runtime via <script>
        markerClusterer: 'readonly', // @googlemaps/markerclusterer UMD global
      },
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['warn', { args: 'none' }],
    },
  },
  {
    files: ['api/**/*.js', 'vite.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: { 'no-undef': 'error' },
  },
];
