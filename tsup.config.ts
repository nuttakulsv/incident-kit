import { defineConfig } from 'tsup'

export default defineConfig([
  {
    entry: { index: 'src/index.ts', cli: 'src/cli.ts' },
    format: 'esm',
    target: 'node20',
    dts: { entry: { index: 'src/index.ts' }, compilerOptions: { ignoreDeprecations: '6.0' } },
    clean: true,
  },
  {
    // The Action runs straight from the repository without npm install, so everything goes into one file.
    entry: { index: 'src/action-main.ts' },
    outDir: 'action',
    outExtension: () => ({ js: '.cjs' }),
    format: 'cjs',
    target: 'node24',
    noExternal: [/.*/],
    splitting: false,
    banner: { js: '// Built from src/ by `npm run build`. Do not edit.' },
  },
])
