import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

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
      'web/public/**',
    ],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    // web/ (plan §14.1: React 18 PWA). No `dangerouslySetInnerHTML` anywhere
    // (plan §8.1 XSS control) — enforced repo-wide via no-restricted-syntax
    // rather than pulling in `eslint-plugin-react` just for one rule.
    files: ['web/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'JSXAttribute[name.name="dangerouslySetInnerHTML"]',
          message: 'dangerouslySetInnerHTML is banned (plan §8.1 XSS controls).',
        },
        {
          selector: "CallExpression[callee.property.name='dangerouslySetInnerHTML']",
          message: 'dangerouslySetInnerHTML is banned (plan §8.1 XSS controls).',
        },
      ],
    },
  },
);
