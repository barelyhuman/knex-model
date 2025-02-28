#!/usr/bin/env node
import { CONSTANTS, createContext } from 'esbuild-multicontext'
import fs from 'node:fs'
import path, { basename, dirname, join } from 'node:path'
import { rollup } from 'rollup'
import { dts } from 'rollup-plugin-dts'
import ts from 'typescript'

await defineBuild({
  input: ['src/index.ts'],
  tsconfig: './tsconfig.json',
  outdir: 'dist',
  tmpDir: '.tmp-build',
  dtsInDev: true,
  isDev: process.argv.includes('--dev'),
  esbuild: {
    platform: 'node',
  },
}).build()

if (process.argv.slice(2).includes('playground')) {
  await defineBuild({
    input: ['playground/src/index.ts'],
    tsconfig: './tsconfig.json',
    outdir: 'playground/dist',
    tmpDir: 'playground/.tmp-build',
    dtsInDev: true,
    isDev: process.argv.includes('--dev'),
    esbuild: {
      platform: 'node',
    },
  }).build()
}

/**
 * @param {object} options
 * @param {string} options.input
 * @param {string} options.tsconfig
 * @param {string} options.outdir
 * @param {string} options.tmpDir
 * @param {boolean} options.dtsInDev
 * @param {boolean} options.isDev
 * @param {import("esbuild").BuildOptions} options.esbuild
 * @returns
 */
function defineBuild(options) {
  return {
    ...options,
    build: async () => {
      process.on('SIGINT', function () {
        console.log('Cleaning Up')
        if (fs.existsSync(options.tmpDir)) {
          fs.rmSync(options.tmpDir, { recursive: true, force: true })
        }
        process.exit()
      })

      const ctx = await bundleCode({
        watch: true,
        buildConfig: options,
      })

      const genTypes = throttle(async ({ cleanup = false } = {}) => {
        console.log('Generating Type Bundle')
        generateTypes({ buildConfig: options })
        await bundleTypes({ buildConfig: options })
        cleanup && fs.rmSync(options.tmpDir, { recursive: true, force: true })
      })

      if (options.isDev) {
        await ctx.watch()
      }

      if (options.dtsInDev) {
        ctx.hook('esm:complete', () => {
          genTypes()
        })
        ctx.hook('cjs:complete', () => {
          genTypes()
        })
      }

      await ctx.build()
      await genTypes({ cleanup: true })

      if (!options.isDev) {
        await ctx.dispose()
      }
    },
  }
}

async function bundleCode({ buildConfig } = {}) {
  const buildCtx = createContext()
  buildCtx.add('cjs', {
    ...buildConfig.esbuild,
    entryPoints: [].concat(buildConfig.input),
    format: 'cjs',
    bundle: true,
    outExtension: {
      '.js': '.cjs',
    },
    outdir: join(buildConfig.outdir, 'cjs'),
  })
  buildCtx.add('esm', {
    ...buildConfig.esbuild,
    entryPoints: [].concat(buildConfig.input),
    format: 'esm',
    bundle: true,
    outExtension: {
      '.js': '.mjs',
    },
    outdir: join(buildConfig.outdir, 'esm'),
  })

  buildCtx.hook('esm:complete', () => {
    process.stdout.write('[custom-builder] ESM Built\n')
  })

  buildCtx.hook('cjs:complete', () => {
    process.stdout.write('[custom-builder] CJS Built\n')
  })

  buildCtx.hook('esm:error', async errors => {
    process.stdout.write('[custom-builder] ESM Error:\n')
    errors.map(x => console.error(x))
  })

  buildCtx.hook('cjs:error', async errors => {
    process.stdout.write('[custom-builder] CJS Error:\n')
    errors.map(x => console.error(x))
  })

  buildCtx.hook(CONSTANTS.BUILD_COMPLETE, () => {
    console.log('Bundled')
  })

  buildCtx.hook(CONSTANTS.ERROR, errors => {
    console.error(errors)
  })

  return buildCtx
}

function generateTypes({ buildConfig } = {}) {
  const createdFiles = {}
  const baseConfig = {
    allowJs: true,
    declaration: true,
    emitDeclarationOnly: true,
  }

  const tsconfigExists = buildConfig.tsconfig
    ? fs.existsSync(buildConfig.tsconfig)
    : false

  const includeDirs = buildConfig.input
    .map(d => d.split(path.sep)[0])
    .map(d => `${d}/**/*`)

  let tsconfigRaw = {
    compilerOptions: {
      target: 'esnext',
      module: 'esnext',
    },
    include: includeDirs,
    exclude: ['node_modules/*'],
  }

  if (tsconfigExists) {
    tsconfigRaw = JSON.parse(fs.readFileSync(buildConfig.tsconfig, 'utf-8'))
  }

  const host = ts.createCompilerHost(ts.getDefaultCompilerOptions())
  const tsOptions = ts.parseJsonConfigFileContent(
    {
      ...tsconfigRaw,
      compilerOptions: {
        ...tsconfigRaw.compilerOptions,
        ...baseConfig,
        noEmit: false,
      },
    },
    host,
    '.',
    ts.getDefaultCompilerOptions()
  )

  if (tsOptions.errors.length) {
    console.error(tsOptions.errors)
    return
  }

  const fileNames = Array.from(
    tsOptions.fileNames.concat(buildConfig.input).reduce((acc, item) => {
      if (acc.has(item)) return acc
      acc.add(item)
      return acc
    }, new Set())
  )

  host.writeFile = (fileName, contents) => (createdFiles[fileName] = contents)
  const program = ts.createProgram(fileNames, tsOptions.options, host)
  program.emit()

  fs.mkdirSync(buildConfig.tmpDir, { recursive: true })
  fileNames.forEach(file => {
    const dts = getDTSName(file)

    const fileKeyPath = Object.keys(createdFiles)
      .map(k => {
        return {
          rel: path.relative(process.cwd(), k),
          original: k,
        }
      })
      .find(obj => {
        return obj.rel === dts
      })

    const contents = createdFiles[fileKeyPath.original]
    if (!contents) {
      console.warn(`nothing to emit for file ${file}`)
      return
    }

    const destDir = join(buildConfig.tmpDir, dirname(fileKeyPath.rel))
    const destFile = join(buildConfig.tmpDir, fileKeyPath.rel)

    fs.mkdirSync(destDir, { recursive: true })
    fs.writeFileSync(destFile, createdFiles[fileKeyPath.original], 'utf8')
  })
}

async function bundleTypes({ buildConfig }) {
  await Promise.all(
    buildConfig.input.map(async entryPoint => {
      const entryName = getDTSName(entryPoint)
      const bareName = basename(entryPoint).replace(
        path.extname(entryPoint),
        ''
      )
      const entryPath = join(buildConfig.tmpDir, entryName)
      const rollupBundle = await rollup({
        input: entryPath,
        plugins: [dts()],
      })
      await rollupBundle.write({
        file: join(buildConfig.outdir, `esm/${bareName}.d.mts`),
        format: 'es',
      })
      await rollupBundle.write({
        file: join(buildConfig.outdir, `cjs/${bareName}.d.cts`),
        format: 'cjs',
      })
      await rollupBundle.close()
    })
  )
}

function getDTSName(filename) {
  return filename.replace(/(\.(js|ts))$/, '.d.ts')
}

/**
 * @template T
 * @param {T} fn
 * @returns {T}
 */
function throttle(fn) {
  let lastInvoked
  return (...args) => {
    if (lastInvoked) {
      if (Date.now() - lastInvoked < 2000) {
        lastInvoked = Date.now()
        return
      }
    }
    lastInvoked = Date.now()
    fn(...args)
  }
}
