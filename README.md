[简体中文](#) | [English](./README.en.md) | [繁體中文](./README.zh-Hant.md) | [日本語](./README.ja.md) | [Русский](./README.ru.md)

# 丝印层填充 (Silkscreen Fill)

嘉立创EDA专业版插件：在PCB编辑器中使用 clipper.js 完成丝印层的布尔运算并生成填充区域。

## 功能介绍

本插件旨在解决在 PCB 丝印层上进行复杂布尔运算的问题。通过使用高性能的多边形运算库 **clipper.js**，用户可以轻松地在丝印层生成避开现有丝印图元的填充区域。

### 主要特性

- **高精度布尔运算**：使用 `clipper.js` 进行稳定的差集（Difference）、并集（Union）和交集（Intersection）运算。
- **智能交互**：支持通过框选选定区域，自动计算该区域内所有丝印图元的包围盒并进行扣除。
- **专业版 API 适配**：完全适配嘉立创EDA专业版（JLCEDA Pro）扩展 API。

## 使用说明

1. **选择区域**：在画布上点击填充区域并拖动以进行框选，选定你希望处理的丝印区域。
2. **启动插件**：在 PCB 编辑器顶部菜单栏找到 **丝印工具 -> 丝印层填充**。
3. **自动生成**：插件将自动提取该区域内的丝印图元，计算选区与丝印图元bbox的差集，并在顶层丝印层生成填充区域。
4. **iframe**: 支持自定义避让区域和区域重新框选功能
## 开发与编译

如果你希望基于本项目进行二次开发：

1. **安装依赖**

    ```shell
    npm install
    ```

2. **编译项目**

    ```shell
    npm run build
    ```

3. **安装扩展**：在嘉立创EDA专业版中，进入“扩展设置” -> “导入”，选择编译生成的 `./build/dist/` 目录。

## 技术栈

- [Clipper.js](https://github.com/Doodle3D/clipper-js) - 多边形布尔运算引擎
- [@jlceda/pro-api-types](https://www.npmjs.com/package/@jlceda/pro-api-types) - 嘉立创EDA专业版 API 类型定义
- TypeScript & esbuild

## 开源许可

本项目使用 [Apache License 2.0](https://choosealicense.com/licenses/apache-2.0/) 开源许可协议。
