# 文件系统抽象

> 核心代码：`editor-app/src/fs/`（types.ts / index.ts / mock.ts / web.ts / tauri.ts）。
> 设计目标：**同一套接口，三种宿主实现**，应用代码不感知底层。

## 1. 接口定义（`types.ts`）

```ts
export interface FileSystem {
  readonly kind: 'mock' | 'web' | 'tauri'
  readonly rootName: string
  openDirectory(): Promise<boolean>   // 返回 false = 用户取消
  readTree(showAll: boolean): Promise<FsEntry[]>
  readFile(path: string): Promise<string>
  writeFile(path: string, content: string): Promise<void>
  createFile(path: string): Promise<void>
  createDir(path: string): Promise<void>
  rename(oldPath: string, newPath: string): Promise<void>
  remove(path: string): Promise<void>
}
```

- `FsEntry = { name, path（相对根，`/` 分隔）, kind: 'file'|'dir', children? }`
- 路径工具：`joinPath / dirName / baseName / isEditableFile`（.md/.markdown/.txt）。
- `shouldShowInTree(path, name, showAll)`：树过滤——非 showAll 时只显示可编辑文件 + `.template` 模板域（模板 TS 配套文件属"可信区"，必须可见）。

## 2. 三种实现

| 实现 | 场景 | 存储 | 特点 |
|---|---|---|---|
| `mock` | 浏览器 Demo（默认） | localStorage | 内置示例工作区 + 全局模板，**开箱即用**；`SEED_VERSION` 版本化迁移 |
| `web` | Chrome/Edge 调试 | File System Access API | 可打开真实目录；权限由浏览器管理 |
| `tauri` | 打包桌面应用 | Rust 命令 | 完整 Node/Rust 文件能力；git 用户名支持 |

### mock（`mock.ts`）

- 数据结构：`{ files: { [path]: content }, dirs: string[] }`，存 localStorage key `milkdown-note-mock-fs-v2`。
- **演示数据版本化**：`SEED_VERSION` + `FORCE_UPDATE_PATHS`——bump 版本时，演示核心文件（模板 suggest 样例/周报数据/引用演示页）跨版本强制覆盖，普通文件只补缺不覆盖（保留用户改动）。
- `mockGlobalTemplates()` / `mockGlobalReadFile()`：全局模板域内置示例（真实文件系统外部目录 v1.5 缺口）。
- 演示数据源：`mock-samples.generated.ts`（由 `scripts/sync-demo.mjs` 从 `../demo/` 同步生成）+ 少量手写样例（会议记录/待办/原始数据/周报模板等）。
- 调试钩子：`__mockFsDebug()` 输出 seededVersion / 模板文件清单。

### web（`web.ts`）

- 用 `showDirectoryPicker()` 拿到目录句柄，`readTree` 递归句柄树。
- 文件读写基于 FileSystemFileHandle + `createWritable`。
- 注意：File System Access API 仅 Chromium 系支持，且每个文件读写需重新请求权限句柄（代码内缓存句柄映射）。

### tauri（`tauri.ts`）

- 经 `@tauri-apps/api/core.invoke` 调用 Rust 命令（见 [打包与发布](packaging.md)）。
- 命令清单：`set_root / read_tree / read_file / write_file / create_file / create_dir / rename / remove / git_user_name`。
- 路径安全：Rust 侧 `resolve()` 把相对路径 join 到根目录并校验 `starts_with(root)`，防越界。
- `git_user_name`：目录含 `.git` 时执行 `git config user.name`（批注评论作者，见 [批注与评论](annotation.md)）。

## 3. 切换逻辑（`index.ts`）

```ts
let backend = isTauri() ? tauriFs : mockFs
export const fs = new Proxy({} as FileSystem, {
  get: (_, prop) => { const v = backend[prop]; return typeof v === 'function' ? v.bind(backend) : v }
})
```

- **自动探测**：Tauri 环境（`__TAURI_INTERNALS__` 存在）→ tauri；浏览器 → mock。
- **延迟切换**：浏览器点「打开目录」（`Ctrl+O`）→ `useRealDirFs()` 切到 web 实现（若支持该 API）。
- 应用代码一律 `import { fs } from '../fs'`，状态栏显示当前 `fs.kind`。

## 4. 使用要点

- 路径一律相对根目录、`/` 分隔（Rust 侧 `replace('\\', '/')` 归一化）。
- 隐藏文件/目录（`.` 开头）仅在 `showAll=false` 时跳过；`showAll=true` 时保留（`.template` 模板域等必须可见，模板扫描依赖）。
- `readTree(showAll)`：前端树展示 / ref 菜单过滤「可编辑文件」之外的隐藏目录（`filterHiddenDirs`）；模板扫描用 `true` 拿到含 `.template` 的全量树。
