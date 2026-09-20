# Check which books need catalog entries

Save changes in Excel, then run in PowerShell:

```powershell
cd C:\library_app\library-map
.\tools\check_library_catalog.ps1
```

This reads `LIBRARY LIST VIEW.xlsx` (the **List View** sheet only) and the
catalog sheets in `LIBRARY.xlsx` from the shared MyLibrary folder. It prints
an alphabetical checklist and refreshes `MISSING FROM CATALOG.txt` beside the
workbooks. Share that text file or print it from Notepad. Add `-OpenReport`
to the command to open the saved checklist automatically.

The tool only reads saved workbook contents. It does not assign IDs, change
workbooks, rebuild the app, commit, or push. IDs do not need to be refreshed
first: catalog sheets have no shared Book ID or ISBN, so comparison uses
the app's title parsing and author keys. Possible shortened titles, similar
titles, contributor differences, and duplicate catalog keys appear in a
separate review section with catalog sheet/row references. A match confirms
title/author presence, not cover completeness or edition identity. Spelling
differences can still require manual review. Each run replaces the text
checklist, so keep personal notes elsewhere.

For alternate sources or an output location:

```powershell
.\.venv\Scripts\python.exe .\tools\check_library_catalog.py --list-view 'C:\path\list.xlsx' --catalog 'C:\path\catalog.xlsx' --output 'C:\path\checklist.txt'
```

Matching regression tests:

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tools -p test_check_library_catalog.py
```

# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
