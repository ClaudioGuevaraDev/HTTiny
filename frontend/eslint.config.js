import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'vite.config.js', 'vite.config.d.ts', '*.tsbuildinfo'] },
  {
    files: ['src/**/*.{ts,tsx}', 'vite.config.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommendedTypeChecked, reactHooks.configs.flat.recommended, reactRefresh.configs.vite],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // Best-effort JSON formatting in RequestEditor deliberately swallows parse errors.
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  // This config file is not covered by any tsconfig, so type-aware rules cannot run on it.
  { files: ['eslint.config.js'], extends: [js.configs.recommended, tseslint.configs.disableTypeChecked] },
  prettier,
)
