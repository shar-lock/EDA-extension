# CLAUDE.md

此文件为 Claude Code (claude.ai/code) 提供在此代码库中工作的指导。

## 项目概述
这是一个嘉立创EDA专业版插件项目，用于在PCB编辑器中使用clipper.js完成丝印层的布尔运算并生成填充区域。项目使用TypeScript开发，esbuild构建，最终打包为.eext扩展格式。

## 构建与开发命令
- `npm run compile` - 清理dist目录并使用esbuild编译TypeScript为浏览器可运行的IIFE格式
- `npm run build` - 完整的构建流程（编译+生成.eext扩展包）
- `npm run lint` - 运行ESLint代码检查
- `npm run fix` - 运行ESLint并自动修复可修复的问题

## 架构设计
- **构建系统**: 使用esbuild实现快速编译，配置分为`config/esbuild.common.ts`（通用配置）和`config/esbuild.prod.ts`（生产配置）
- **开发环境**: 使用ts-node直接运行TypeScript代码
- **代码规范**: ESLint配合@antfu/eslint-config
- **代码结构**: 
  - 源代码在`src/`目录
  - 编译输出到`dist/`目录
  - 最终扩展包生成在`build/dist/`目录
- **类型定义**: 使用`@jlceda/pro-api-types`包提供嘉立创EDA API类型
- **核心算法**: 使用`@doodle3d/clipper-js`进行多边形布尔运算

## 模块结构
- `src/modules/silkscreen-fill/` - 丝印层填充核心模块
  - `controller.ts` - 主控制器，协调整个填充流程
  - `fill-generator.ts` - 填充区域生成，将多边形转换为PCB图元
  - `layer-extractor.ts` - 图层图元提取，将丝印图元转换为多边形
  - `selection-handler.ts` - 用户选区处理
  - `utils/clipper.ts` - Clipper.js工具函数
  - `config.ts` - 模块配置

## 关键配置
- TypeScript 5.7.3，启用严格类型检查
- ESNext目标，浏览器平台，IIFE格式
- 包含源文件和pro-api-types类型定义
- 生产构建禁用source map以减小体积

## 构建流程
1. `compile`阶段：esbuild将TypeScript编译为JavaScript
2. `build`阶段：执行`build/packaged.ts`脚本，将编译后的文件打包为.eext格式
3. 打包过程会：
   - 检查并修复extension.json中的UUID
   - 根据.edaignore过滤文件
   - 使用JSZip压缩为.eext扩展包

## 开发注意事项
- 预提交钩子通过lint-staged运行ESLint自动修复
- 支持TypeScript和JavaScript文件(allowJs: true)
- 扩展安装：编译后，在嘉立创EDA专业版的"扩展设置" -> "导入"中选择`./build/dist/`目录
- 插件入口：PCB编辑器顶部菜单栏"丝印工具 -> 丝印层填充"
