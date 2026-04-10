[简体中文](./README.md) | [English](./README.en.md) | [繁體中文](#) | [日本語](./README.ja.md) | [Русский](./README.ru.md)

# 絲印層填充 (Silkscreen Fill)

嘉立創EDA專業版插件：在PCB編輯器中使用 clipper.js 完成絲印層的布爾運算并生成填充區域。

## 功能介紹

本插件旨在解決在 PCB 絲印層上进行复杂布爾運算的問题。通过使用高性能的多邊形運算庫 **clipper.js**，用户可以輕鬆地在絲印層生成避開现有絲印圖元的填充區域。

### 主要特性

- **高精度布爾運算**：使用 `clipper.js` 进行稳定的差集（Difference）、并集（Union）和交集（Intersection）運算。
- **多圖元支持**：支持處理絲印層上的直线（Line）、圆弧（Arc）、折線（Polyline）、填充（Fill）以及文本（String）等多種圖元。
- **智能交互**：支持通过框選選定區域，自动计算該區域内所有絲印圖元的包围盒并进行扣除。
- **專業版 API 适配**：完全适配嘉立創EDA專業版（JLCEDA Pro）擴展 API。

## 使用說明

1. **啟動插件**：在 PCB 編輯器頂部菜單欄找到 **絲印工具 -> 絲印層填充**。
2. **選擇區域**：在畫布上点击并拖动以进行矩形框選，選定你希望處理的絲印區域。
3. **自动生成**：插件將自动提取該區域内的絲印圖元，计算選區与絲印圖元的差集，并在頂層絲印層生成填充區域。

## 開發与編譯

如果你希望基于本项目进行二次開發：

1. **安装依賴**

    ```shell
    npm install
    ```

2. **編譯项目**

    ```shell
    npm run build
    ```

3. **安装擴展**：在嘉立創EDA專業版中，进入“擴展设置” -> “导入”，选择編譯生成的 `./build/dist/` 目錄。

## 技術棧

- [Clipper.js](https://github.com/Doodle3D/clipper-js) - 多邊形布爾運算引擎
- [@jlceda/pro-api-types](https://www.npmjs.com/package/@jlceda/pro-api-types) - 嘉立創EDA專業版 API 类型定义
- TypeScript & esbuild

## 開源許可

本项目使用 [Apache License 2.0](https://choosealicense.com/licenses/apache-2.0/) 開源許可协议。
