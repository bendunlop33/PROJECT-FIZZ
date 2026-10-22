// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**', 'apps/mobile/ios/**', 'apps/mobile/android/**', 'apps/mobile/.expo/**', '.claude/**', 'docs/design/prototypes/**'] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      'no-restricted-globals': [
        'error',
        { name: 'Date', message: 'Domain code takes time as an explicit argument; use the injected clock.' },
      ],
    },
  },
  {
    files: ['**/test/**', 'vitest.config.ts', 'vitest.perf.config.ts', 'eslint.config.js'],
    rules: { 'no-restricted-globals': 'off' },
  },
  {
    files: ['eslint.config.js'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    // Metro loads this as CommonJS; Expo's tsconfig excludes it from the TS project.
    files: ['apps/mobile/metro.config.js'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      ...tseslint.configs.disableTypeChecked.languageOptions,
      sourceType: 'commonjs',
      globals: { require: 'readonly', module: 'writable', __dirname: 'readonly' },
    },
    rules: {
      ...tseslint.configs.disableTypeChecked.rules,
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
);
