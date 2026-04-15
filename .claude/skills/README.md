# Footprint SilkScreen Parser Skill

该skill用于解析EasyEDA Pro封装文件的丝印层信息，提取所有丝印层图形元素。

## 功能特性

- ✅ 解析elibz2封装文件格式
- ✅ 提取丝印层直线、圆弧、折线、填充、文本等图形元素
- ✅ 支持缓存机制提高性能
- ✅ 提供详细的统计信息
- ✅ 支持批量处理和单独查询

## 安装依赖

```bash
npm install jszip
```

## API参考

### `getFootprintSilkScreen(file, footprintUuid)`
获取封装的丝印层信息

**参数:**
- `file` - elibz2封装文件（File或Blob对象）
- `footprintUuid` - 封装UUID字符串

**返回:**
```javascript
{
  canvas: { x, y, width, height },  // 画布信息
  silkScreen: {
    lines: [],    // 直线数组
    arcs: [],     // 圆弧数组
    polylines: [], // 折线数组
    fills: [],    // 填充数组
    texts: []     // 文本数组
  },
  statistics: {
    totalShapes,  // 总图元数
    lines,        // 直线数
    arcs,         // 圆弧数
    polylines,    // 折线数
    fills,        // 填充数
    texts         // 文本数
  }
}
```

### `FootprintSilkScreenParser`类

主要解析器类，支持更复杂的操作：

```javascript
const { FootprintSilkScreenParser } = require('./.claude/skills/get-silk-screen-info');

const parser = new FootprintSilkScreenParser();
const result = await parser.getFootprintSilkScreen(file, footprintUuid);
parser.clearCache(); // 清除缓存
```

## 使用示例

### 基本用法
```javascript
const skill = require('./.claude/skills/get-silk-screen-info');

// 解析封装丝印层
const silkScreenData = await skill.getFootprintSilkScreen(
  footprintFile,  // 从eda.sys_FileManager获取的File对象
  'footprint-uuid-12345'
);

console.log('丝印层统计:', silkScreenData.statistics);
console.log('直线数量:', silkScreenData.silkScreen.lines.length);
console.log('文本内容:', silkScreenData.silkScreen.texts.map(t => t.text));
```

### 在EasyEDA Pro扩展中使用
```javascript
// 获取元件封装丝印层信息
async function getComponentSilkScreen(component) {
  const info = await getComponentFootprintInfo(component);
  if (!info) return null;

  const file = await eda.sys_FileManager.getFootprintFileByFootprintUuid(
    info.footprintUuid,
    info.libraryUuid,
    'elibz2'
  );

  if (!file) return null;

  return await skill.getFootprintSilkScreen(file, info.footprintUuid);
}
```

### 批量处理所有元件
```javascript
const { FootprintSilkScreenParser } = require('./.claude/skills/get-silk-screen-info');

async function processAllComponents() {
  const parser = new FootprintSilkScreenParser();
  const components = await eda.pcb_PrimitiveComponent.getAll();
  const results = [];

  for (const component of components) {
    try {
      const info = await getComponentFootprintInfo(component);
      if (!info) continue;

      const file = await eda.sys_FileManager.getFootprintFileByFootprintUuid(
        info.footprintUuid,
        info.libraryUuid,
        'elibz2'
      );

      if (file) {
        const silkScreen = await parser.getFootprintSilkScreen(file, info.footprintUuid);
        results.push({
          ref: component.ref,
          footprint: info.name,
          silkScreen
        });
      }
    } catch (error) {
      console.error(`Failed to process component ${component.ref}:`, error);
    }
  }

  console.log(`成功处理 ${results.length} 个元件的丝印层`);
  return results;
}
```

## 数据结构说明

### 直线(Line)
```javascript
{
  type: 'line',
  x1: 10, y1: 20,  // 起点
  x2: 30, y2: 40,  // 终点
  strokeWidth: 0.15 // 线宽
}
```

### 圆弧(Arc)
```javascript
{
  type: 'arc',
  startX: 10, startY: 20,  // 起点
  endX: 30, endY: 40,      // 终点
  angle: 90,               // 角度（度）
  strokeWidth: 0.15        // 线宽
}
```

### 折线(Polyline)
```javascript
{
  type: 'polyline',
  segments: [             // 线段数组
    { type: 'line', x1, y1, x2, y2 },
    { type: 'arc', mode, x1, y1, x2, y2, angle }
  ],
  strokeWidth: 0.15
}
```

### 填充(Fill)
```javascript
{
  type: 'fill',
  points: [               // 多边形顶点
    { x: 10, y: 20 },
    { x: 30, y: 40 }
  ],
  strokeWidth: 0.15
}
```

### 文本(Text)
```javascript
{
  type: 'text',
  x: 10, y: 20,           // 位置
  text: "R1",             // 文本内容
  fontSize: 10,           // 字体大小
  angle: 0                // 旋转角度
}
```

## 错误处理

skill会抛出以下错误：
- `Missing required parameters: file and footprintUuid` - 参数缺失
- `No elibu file found in the footprint package` - 封装包格式错误
- 解析错误会记录到控制台但不会中断程序

## 性能优化

- 使用缓存避免重复解析相同封装
- 支持批量处理提高效率
- 提供`clearCache()`方法管理内存

## 调试技巧

启用详细日志：
```javascript
// 在代码中添加调试日志
console.log('[SilkScreenParser] Processing footprint:', footprintUuid);
const result = await skill.getFootprintSilkScreen(file, footprintUuid);
console.log('[SilkScreenParser] Statistics:', result.statistics);
```

## 许可证

Apache-2.0