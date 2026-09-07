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
      'firebase/functions-deploy/**',
      'firebase/web-dist/**',
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
      // react-hooks 7's compiler-derived rules are kept ON (they caught two
      // real render-purity issues on upgrade) with one exception:
      // `set-state-in-effect` flags every synchronous setState inside an
      // effect. This codebase uses that deliberately and consistently in two
      // shapes — subscription hooks/providers resetting state at the top of a
      // re-subscribe effect (loading=true, items=[] before onSnapshot), and
      // screens correcting an initial guess once live data arrives. Both are
      // correct here; the "cascading render" cost is a single extra render at
      // club-scale data. Fifteen scattered inline disables would say less
      // than this one documented choice. Revisit if the app ever adopts the
      // React Compiler, which optimises the endorsed alternatives.
      'react-hooks/set-state-in-effect': 'off',
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
  {
    // `web/tsconfig.app.json` has to list "node" in `types` because a handful
    // of *tests* under `src/` read files off disk (styles.test.ts,
    // csp.test.ts, templates.test.ts, push/checkSw.test.ts). Vitest 2 pulled
    // those types in implicitly; Vitest 4 does not, so they are now declared.
    //
    // The cost is that node builtins become resolvable from *any* web file,
    // including browser source that ships to members. This puts that guard
    // back explicitly, and only where it belongs: tests may use them, the app
    // may not.
    files: ['web/src/**/*.{ts,tsx}'],
    ignores: ['web/src/**/*.test.{ts,tsx}', 'web/src/setupTests.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['node:*'],
              message:
                'Node builtins do not exist in the browser bundle. If this is a test, name it *.test.ts.',
            },
          ],
        },
      ],
    },
  },
);
