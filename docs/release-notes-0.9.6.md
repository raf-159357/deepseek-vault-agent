# 0.9.6 — 过了 ESLint 全量检查（0 error）

## 修复（为了让自动审核通过）

- `innerHTML` 全部去掉，图标改成 DOM 构建（`createEl("img")`）。
- 行内样式（`style.display/borderRadius/objectFit`）移除，改由 CSS 类控制。
- `document` → `activeDocument`，兼容弹出窗口。
- `setTimeout` → `window.setTimeout`。
- 去掉两处多余的类型断言、一个未使用的 import、一处 `createEl("div")` 改成 `createDiv`。
- `eslint-plugin-obsidianmd` 官方规则集：**0 error**（原 2 个 error、14 个 warning，现 0 error、7 个 warning）。

## 说明

自动审核按 error 卡；这次把 error 清空，重新发布后会重新扫描。
