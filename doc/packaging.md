# 打包与发布

> 应用本体：`editor-app/`（Tauri 2 壳）。Tauri 打的是**当前系统**的包，无法交叉编译。
> 本开发环境是 Linux；正式产物在 Windows/macOS 机器或 CI 上构建。

## 1. Tauri 命令

```bash
cd editor-app
npm run tauri dev          # 开发调试（需 Rust 工具链）
npm run tauri build        # 打当前平台包（默认 target 见 tauri.conf.json）
npm run tauri build -- --bundles nsis        # 显式指定打包类型
```

- Rust 壳用 `cargo check` 验证（Linux 环境）。
- `tauri.conf.json` 的 `bundle.targets` 为 `["nsis", "app", "dmg"]`（跨平台列表，非当前平台目标静默跳过）。

## 2. 平台产物

### Windows

```bash
npm run tauri build -- --bundles nsis
# 安装包: src-tauri/target/release/bundle/nsis/*-setup.exe
# 便携版: 直接压缩 src-tauri/target/release/milkdown-note.exe（单文件，免安装）
```

### macOS

```bash
npm run tauri build -- --bundles app,dmg
# 产物: src-tauri/target/release/bundle/macos/*.app、bundle/dmg/*.dmg
# CI 只上传 DMG（.app 完整包含在 DMG 内；不再另发 .app.zip，避免产物体积翻倍）
```

### Linux（开发验证用）

```bash
npm run tauri build -- --bundles deb     # bundle/deb/*.deb
npm run tauri build -- --bundles appimage
```

## 3. Rust 命令清单（`src-tauri/src/lib.rs`）

| 命令 | 作用 | 备注 |
|---|---|---|
| `set_root` | 设置根目录 | 校验是目录 |
| `read_tree` | 读整棵文件树 | 目录在前，名字排序；隐藏文件（`.` 开头）仅 `showAll=false` 时跳过；`showAll=true` 保留全部（`.template` 模板域依赖） |
| `read_file` / `write_file` | 读写文件 | 自动建父目录；`resolve()` 校验不越界（`starts_with(root)`） |
| `create_file` / `create_dir` | 新建 | 已存在报错 |
| `rename` | 重命名/移动 | 目标已存在报错；自动建父目录 |
| `remove` | 删除 | 目录递归删除 |
| `save_binary` | 导出写盘（M10） | 绝对路径 + base64 → 解码写文件；导出功能专用 |
| `git_user_name` | 批注用户名 | 目录含 `.git` 时执行 `git config user.name` |

- 前端调用：`src/fs/tauri.ts`（`invoke` 封装），窗口/对话框权限在 `src-tauri/capabilities/`。
- 目录选择走 `@tauri-apps/plugin-dialog`。

## 4. CI 自动构建（GitHub Actions）

`.github/workflows/build.yml` 自动构建三平台：

| 平台 | Runner | 产物 |
|---|---|---|
| Windows | `windows-latest` | NSIS 安装包 + 便携 zip |
| macOS Intel | `macos-15-intel` | DMG |
| macOS Apple Silicon | `macos-14` | DMG |

- 产物上传 Artifacts；
- 推送 `v*` 标签时自动发布 GitHub Release（含全部平台产物）。

## 5. 已知限制

- 全局模板目录（工作区外）v1 仅 Tauri 生效（mock 用内置示例，web 不支持）。
- 外部文件变更无 fs.watch 监听（打开的文件树不会自动感知磁盘改动，刷新用 ⟳ 按钮）。
- 二进制文件预览（图片等）未实现。
