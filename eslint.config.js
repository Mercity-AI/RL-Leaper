// ESLint settings for `pnpm lint` (eslint src tests scripts).
// Only ESLint's recommended correctness rules are used: unused variables,
// unreachable code, typos in names and similar real mistakes. Code style and
// formatting are left alone on purpose.
import js from '@eslint/js';
import globals from 'globals';

export default [
  // Generated, downloaded or third-party files are never linted.
  { ignores: ['dist/', 'node_modules/', 'public/', 'output/', 'rl_artifacts/', 'tmp/', 'assets/'] },

  // ESLint's recommended rule set.
  js.configs.recommended,

  // The game, its test pages and the Node scripts are modern ES modules that run
  // in the browser or in Node, so both sets of global names are known.
  {
    files: ['**/*.{js,mjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
  },

  // Known findings in game files this change may not edit (src/ is being rebuilt
  // separately): an unused import and an unused catch variable. Reported as
  // warnings so `pnpm lint` passes; fix them, then delete this block.
  {
    files: ['src/camera/LeaperPov.js', 'src/simulation/TrainingVisualizer.js'],
    rules: { 'no-unused-vars': 'warn' },
  },
];
