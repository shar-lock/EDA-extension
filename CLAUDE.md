# CLAUDE.md

此文件为 Claude Code (claude.ai/code) 提供在此代码库中工作的指导。

## 项目概述
这是一个用于嘉立创EDA & EasyEDA专业版API开发的TypeScript SDK项目，使用esbuild构建，开发时采用ts-node运行。

## 构建与开发命令
- `npm run compile` - 清理dist目录并使用esbuild编译
- `npm run build` - 完整的构建流程（编译+打包）
- `npm run lint` - 运行ESLint代码检查
- `npm run fix` - 运行ESLint并自动修复问题

## 架构设计
- **构建系统**: 使用esbuild实现快速编译，配置在`config/esbuild.prod.ts`
- **开发环境**: 使用ts-node直接运行TypeScript代码
- **代码规范**: ESLint配合@antfu/eslint-config
- **代码结构**: 源代码在`src/`目录，编译输出到`dist/`目录
- **类型定义**: 使用`@jlceda/pro-api-types`包

## 关键配置
- TypeScript 5.7.3，启用严格类型检查
- CommonJS模块系统，目标ESNext
- 同时包含源文件和pro-api-types类型定义

## 开发注意事项
- 预提交钩子通过lint-staged运行ESLint
- 生产构建禁用source map
- 支持TypeScript和JavaScript文件(allowJs: true)
