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
```

## 驱动与辅助

- 每个套件是**纯 ego-lite 脚本**，由 `run-all.js` / `_run-one.js` 拼接 `_egolite-lib.js`（共享辅助库）后 pipe 给 `ego-browser nodejs` 执行。
- 共享辅助库 `_egolite-lib.js`：`js / click / wait / q / txt / clickText / treeClick / 组合键 press / 截图 / 下载 / 错误收集 / freshApp 重置 mock` 等。
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
