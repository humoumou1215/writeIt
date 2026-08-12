// 模板域 TypeScript 文件的运行时加载（设计文档 §10.1）
// 路径：fs 读文本 → esbuild-wasm 转译 → new Function 隔离执行（无 require / 无网络）
// 原则：旁路异步模块 —— 任何失败只 console 降级，绝不中断编辑器主流程。
// 模板域 = 可信区（应用所有者维护的配置代码，等价 ESLint 配置信任级别）。
let esbuildPromise: Promise<typeof import('esbuild-wasm')> | null = null

function ensureEsbuild(): Promise<typeof import('esbuild-wasm')> {
  if (esbuildPromise) return esbuildPromise
  esbuildPromise = (async () => {
    const mod = await import('esbuild-wasm')
    // ?url 让 Vite 把 wasm 作为静态资源输出（dev 直接 serve，build 打进 assets）
    const { default: wasmUrl } = (await import('esbuild-wasm/esbuild.wasm?url')) as {
      default: string
    }
    await mod.initialize({ wasmURL: wasmUrl, worker: false })
    return mod
  })()
  // 初始化失败允许下次重试
  esbuildPromise.catch(() => {
    esbuildPromise = null
  })
  return esbuildPromise
}

/**
 * 读取并执行一个模板 TS 文件（rules.ts / suggest.ts）。
 * 返回模块导出对象；任何失败返回 null（调用方降级）。
 */
export async function loadTsModule<T>(
  path: string,
  readFile: (p: string) => Promise<string>
): Promise<T | null> {
  try {
    const source = await readFile(path)
    const esbuild = await ensureEsbuild()
    const out = await esbuild.transform(source, {
      loader: 'ts',
      format: 'cjs',
      target: 'es2020',
      // import type 擦除后一般无运行时依赖；显式禁止动态 require 兜底
      banner: '/* template domain (trusted) */',
    })
    const exportsObj: Record<string, unknown> = {}
    const moduleObj = { exports: exportsObj }
    const fn = new Function(
      'exports',
      'module',
      'require',
      out.code + '\n//# sourceURL=' + path
    )
    fn(exportsObj, moduleObj, () => {
      throw new Error('模板域不支持 require()')
    })
    return (moduleObj.exports ?? exportsObj) as T
  } catch (e) {
    console.error('[template] 加载失败:', path, e)
    return null
  }
}
