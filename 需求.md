**PartNest**：面向个人电子 DIY 的元器件库存与 BOM 整理工具。

> 原始需求：面向个人的电子DIY，存放工具为离心管盒，有多种规格的盒子，例如100个管子的盒子就用 `A0~A9`, ..., `J0~J9` 编号位置。同时这个工具要能够接入EasyEDA的交互式BOM。

核心目标：`我有什么 → 有多少 → 放在哪 → 当前 PCB 是否缺料`

技术栈: `Tauri 2 + React + TypeScript + Vite + shadcn/ui + Tailwind CSS + SQLite + TypeScript EasyEDA Pro Extension + pnpm workspace + Vitest`

数据库：
```text
boxes
- id
- name
- rows
- cols
```

```text
parts
- id
- name
- category
- package
- manufacturer
- mpn
- lcsc_code
- quantity
- box_id
- slot
- note
```

EasyEDA 集成: BOM 是临时数据，不存储。

核心数据只有 partnest.db，定期备份