# 0.9.7 — 修掉自动审核的唯一 error

## 修复

- `manifest.json` 的描述里去掉 "Obsidian" 这个词。自动审核规则：插件描述不得包含「Obsidian」，因为在插件目录里属于冗余。
- 新描述：`Mobile-first (iPhone + Android) DeepSeek agent for your vault: speak or type, it searches, reads links, and writes notes. Bring your own key. Desktop works too.`

## 顺带

- 发布工作流加了 **artifact attestations**（构建来源证明），对应审核里的那条 Recommendation；以后每个资产都能验证是由本仓库的 GitHub Actions 构建的。

## 说明

这条 error 是插件从搜索里消失的直接原因。改完发布后扫描器会重扫，通过后 24 小时内恢复搜索。
