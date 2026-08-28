import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      // Compiled output only — anchored so it doesn't also match the *source*
      // directory `firebase/functions/src/lib/**`, which a bare `**/lib/**`
      // would (and silently did, pre-Phase-1a).
      '**/dist/**',
      'firebase/functions/lib/**',
      '**/node_modules/**',
      '**/*.config.js',
      '**/*.config.ts',
      'web/**',
    ],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
);
