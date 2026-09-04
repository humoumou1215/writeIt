# E2E 测试套件（Milkdown Note）

M1-M16 回归套件。基于 **ego-lite（ego-browser）** 驱动真实 Chromium，需先启动 dev server。**本项目禁止 playwright**。

## 运行

```bash
# 1. 启动 dev server（若未运行）
npm run dev            # http://localhost:5173

# 2. 跑全部套件
npm run test:e2e

# 或单个套件
node tests/e2e/_run-one.js m6c-e2e

# 定向运行多个正式套件（不传时仍运行全部套件）
E2E_SUITES=ref-e2e,embed-save-race-e2e npm run test:e2e
```

## 驱动与辅助

- 每个套件是**纯 ego-lite 脚本**，由 `run-all.js` / `_run-one.js` 拼接 `_egolite-lib.js`（共享辅助库）后 pipe 给 `ego-browser nodejs` 执行。
- 共享辅助库 `_egolite-lib.js`：`js / click / wait / q / txt / clickText / treeClick / 组合键 press / 截图 / 下载 / 错误收集 / freshApp 重置 mock` 等。
- 全量运行器只在回归开始和结束时做全局 task-space 清理；正常套件由共享库回收自己的空间，异常套件才触发即时兜底清理，避免固定清理开销重复乘以套件数。
- 默认使用 2 个 worker 并发执行互不共享资源的套件；嵌入同步、保存竞态、导出、Git、诊断和综合套件固定串行。需要对照或排查环境问题时可用 `E2E_WORKERS=1` 强制串行。
- 运行器逐套件输出耗时，每 15 秒输出一次长套件心跳，并在汇总中列出最慢的 5 个套件；清理耗时和超时也会单独显示。
- **组合键**用 `L.press('Control+e')`（内部 CDP 发真实修饰符）；裸 `pressKey('Control+e')` 不当。
- 无额外浏览器依赖（不装 playwright）——依赖已装好的 ego lite。

## 目录结构

```
tests/
├── e2e/            # 正式回归套件（本目录）
│   ├── run-all.js        # 汇总运行器（npm run test:e2e）
│   ├── _run-one.js       # 单个套件运行器
│   └── _egolite-lib.js   # ego-lite 共享辅助库（拼接注入）
└── package.json    # {"type":"commonjs"}
```

> 历史一次性调试脚本（`tests/scratch/`）已随 playwright 禁令删除（git 历史可查）。
