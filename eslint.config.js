import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  importPlugin.flatConfigs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.mjs'],
    ignores: ['node_modules', 'dist', '**/*.d.ts'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        module: 'readonly',
        require: 'readonly',
        exports: 'readonly',
        global: 'readonly',
      },
      parserOptions: {
        project: ['./tsconfig.json', './apps/*/tsconfig.json', './packages/*/tsconfig.json', './services/*/tsconfig.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    settings: {
      'import/resolver': {
        typescript: {
          project: ['./tsconfig.json', './apps/*/tsconfig.json', './packages/*/tsconfig.json', './services/*/tsconfig.json'],
        },
      },
    },
    rules: {
      // TypeScript strictness
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/require-await': 'warn',
      '@typescript-eslint/no-misused-promises': ['warn', { checksVoidReturn: false }],

      // Import hygiene
      'import/order': [
        'warn',
        {
          alphabetize: { order: 'asc', caseInsensitive: true },
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
          'newlines-between': 'always',
          pathGroups: [
            { pattern: '@sentinelops/**', group: 'internal', position: 'after' },
            { pattern: './**', group: 'sibling', position: 'before' },
          ],
          pathGroupsExcludedImportTypes: ['builtin'],
        },
      ],
      'import/no-unresolved': ['error', { ignore: ['^node:'] }],
      'import/no-extraneous-dependencies': [
        'error',
        {
          devDependencies: [
            '**/*.test.ts',
            '**/*.spec.ts',
            '**/vitest.config.*',
            '**/eslint.config.*',
            '**/prettier.config.*',
          ],
        },
      ],
      'import/no-cycle': 'error',
      'import/no-useless-path-segments': 'warn',

      // General hygiene
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
      'no-debugger': 'warn',
      'prefer-const': 'warn',
      'no-var': 'error',
    },
  }
);