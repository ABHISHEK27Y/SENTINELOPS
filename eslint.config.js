import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import';

export default tseslint.config(
  {
    ignores: [
      'node_modules',
      'dist',
      '**/*.d.ts',
      'apps/web/**',
      'eslint.config.js',
      'eslint.config.mjs',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  importPlugin.flatConfigs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.mjs'],
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
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    rules: {
      // TypeScript strictness (no type info needed)
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      // Import hygiene (simplified for monorepo)
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
      // Disable no-unresolved for monorepo - TypeScript handles this
      'import/no-unresolved': 'off',
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
  },
  // Allow vitest in test files
  {
    files: ['**/*.test.ts', '**/*.spec.ts'],
    rules: {
      'import/no-extraneous-dependencies': 'off',
    },
  },
  // Allow console in specific files that need it for CLI output
  {
    files: [
      'packages/service-kit/src/telemetry.ts',
      'services/loadgen/src/index.ts',
      'packages/db/src/cli.ts',
    ],
    rules: {
      'no-console': 'off',
    },
  }
);
