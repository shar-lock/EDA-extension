# 丝印层填充插件

基于嘉立创 EDA 专业版 API SDK 开发的 PCB 丝印层布尔运算填充插件。

## 功能说明

该插件可以在 PCB 编辑器中实现以下功能：

1. **提取丝印层对象**：自动提取指定图层（顶层/底层丝印层）的所有丝印图元
2. **用户框选区域**：支持用户通过鼠标拖拽矩形框选需要处理的区域
3. **布尔差集运算**：使用 Clipper.js 库执行 `选区矩形 - 丝印形状` 的差集运算
4. **生成填充区域**：在指定图层创建 FilledRegion 填充区域

## 项目结构

```
src/modules/silkscreen-fill/
├── index.ts                 # 模块入口，导出所有公共 API
├── controller.ts            # 主控制器，协调整个填充流程
├── layer-extractor.ts       # 丝印层对象提取模块
├── selection-handler.ts     # 用户框选交互模块
├── fill-generator.ts        # 填充区域生成模块
├── config.ts                # 配置文件
└── utils/
    └── clipper.ts           # Clipper 布尔运算工具
```

## 使用方法

### 1. 编译插件

```bash
npm install
npm run build
```

编译后会在 `./build/dist/` 目录生成插件包。

### 2. 安装插件

1. 打开嘉立创 EDA 专业版
2. 进入「扩展」→「安装扩展」
3. 选择 `./build/dist/` 目录下的插件包进行安装

### 3. 使用插件

1. 打开 PCB 编辑器
2. 点击菜单栏「API SDK」→「丝印层填充」
3. 按照提示在 PCB 编辑器中进行矩形框选
4. 插件会自动处理并生成填充区域

## 配置说明

可以在 `src/modules/silkscreen-fill/config.ts` 中修改配置：

```typescript
export const SILKSCREEN_FILL_CONFIG: SilkscreenFillConfig = {
  silkscreenLayerId: 3,  // 丝印层ID（3=顶层，4=底层）
  fillLayerId: 3,        // 填充层ID
  strokeWidth: 0.1,      // 丝印线宽（毫米）
  netName: undefined,    // 网络名称（可选）
  fillMode: 'solid',     // 填充模式（'solid' 或 'hatched'）
  color: undefined,      // 填充颜色（可选）
};
```

## 技术实现

### 核心算法

1. **图元转换**：将丝印层的各种图元（线条、圆弧、圆形、矩形、文本等）转换为多边形
2. **坐标缩放**：使用 1000000 倍缩放保持 Clipper 运算精度
3. **布尔差集**：`选区矩形 - 丝印图元 = 填充区域`

### 依赖库

- `@doodle3d/clipper-js`: 用于多边形布尔运算
- `@jlceda/pro-api-types`: 嘉立创 EDA API 类型定义

## API 参考

### 主要函数

```typescript
// 执行丝印层填充（主入口）
executeSilkscreenFill(config?: Partial<SilkscreenFillConfig>): Promise<string[]>

// 快速填充（使用默认配置）
quickFill(): Promise<string[]>

// 获取图层多边形
getLayerPolygons(layerId: number, strokeWidth?: number): Promise<Polygon[]>

// 布尔差集运算
difference(subject: Polygons, clip: Polygons): Polygons
```

### 类型定义

```typescript
interface SilkscreenFillConfig {
  silkscreenLayerId: number;  // 丝印层ID
  fillLayerId: number;        // 填充层ID
  strokeWidth: number;        // 丝印线宽
  netName?: string;           // 网络名称
  fillMode: 'solid' | 'hatched';  // 填充模式
  color?: string;             // 填充颜色
}

interface Polygon {
  x: number;
  y: number;
}

type Polygons = Polygon[];
```

## 注意事项

1. **性能考虑**：大量丝印图元时运算可能较慢，建议分批处理
2. **精度问题**：复杂图形可能需要调整 `strokeWidth` 参数
3. **图层限制**：目前仅支持顶层丝印层（ID=3）和底层丝印层（ID=4）

## 开发计划

- [ ] 支持更多图层类型
- [ ] 优化复杂图形的转换算法
- [ ] 添加预览功能
- [ ] 支持自定义填充图案
- [ ] 批量处理多个选区

## 许可证

Apache-2.0

## 贡献

欢迎提交 Issue 和 Pull Request！
