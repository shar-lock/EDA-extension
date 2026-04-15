#!/usr/bin/env node

/**
 * Skill: 获取封装丝印层信息
 * 用于解析EasyEDA Pro封装的丝印层数据
 *
 * 使用示例:
 *   const skill = require('./.claude/skills/get-silk-screen-info');
 *   const result = await skill.getFootprintSilkScreen(footprintFile, footprintUuid);
 */

const JSZip = require('jszip');

// 解析器核心类
class FootprintSilkScreenParser {
  constructor() {
    this.cache = new Map();
  }

  /**
   * 获取封装的丝印层信息
   * @param {File|Blob} file - elibz2封装文件
   * @param {string} footprintUuid - 封装UUID
   * @returns {Promise<Object>} 丝印层数据
   */
  async getFootprintSilkScreen(file, footprintUuid) {
    if (!file || !footprintUuid) {
      throw new Error('Missing required parameters: file and footprintUuid');
    }

    // 检查缓存
    const cacheKey = `${footprintUuid}_${file.name}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    try {
      // 1. 解压elibz2文件
      const zip = await JSZip.loadAsync(file);

      // 2. 查找elibu文件
      let elibuFile = null;
      for (const [fileName, fileEntry] of Object.entries(zip.files)) {
        if (!fileEntry.dir && fileName.endsWith('.elibu')) {
          elibuFile = fileEntry;
          break;
        }
      }

      if (!elibuFile) {
        throw new Error('No elibu file found in the footprint package');
      }

      // 3. 读取并解析elibu内容
      const elibuContent = await elibuFile.async('text');
      const silkScreenData = this.parseElibuContent(elibuContent);

      // 4. 缓存结果
      this.cache.set(cacheKey, silkScreenData);

      return silkScreenData;
    } catch (error) {
      console.error(`[SilkScreenParser] Failed to parse footprint ${footprintUuid}:`, error);
      throw error;
    }
  }

  /**
   * 解析elibu文件内容，提取丝印层信息
   * @param {string} content - elibu文件内容
   * @returns {Object} 结构化丝印层数据
   */
  parseElibuContent(content) {
    const result = {
      canvas: { x: 0, y: 0, width: 100, height: 100 },
      silkScreen: {
        lines: [],
        arcs: [],
        polylines: [],
        fills: [],
        texts: []
      },
      statistics: {
        totalShapes: 0,
        lines: 0,
        arcs: 0,
        polylines: 0,
        fills: 0,
        texts: 0
      }
    };

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    // 按行解析
    const lines = content.split(/\r?\n/).filter(line => line.trim().length > 0);

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i].trim();
      if (!line || line.length < 10) continue;

      // 去掉行尾的分隔符
      if (line.endsWith('|')) {
        line = line.substring(0, line.length - 1);
      }

      // 分割外层和内层JSON
      const separatorIndex = line.indexOf('||');
      if (separatorIndex === -1) continue;

      const part1 = line.substring(0, separatorIndex);
      const part2 = line.substring(separatorIndex + 2);

      try {
        const outer = JSON.parse(part1);
        const inner = JSON.parse(part2);
        const type = outer.type;

        if (!type) continue;

        // 只处理丝印层(layerId=3)
        if (inner.layerId !== 3) continue;

        // 解析不同类型的图元
        switch (type) {
          case 'LINE':
            this.parseLine(inner, result);
            break;
          case 'ARC':
            this.parseArc(inner, result);
            break;
          case 'POLY':
            this.parsePoly(inner, result);
            break;
          case 'FILL':
            this.parseFill(inner, result);
            break;
          case 'STRING':
            this.parseString(inner, result);
            break;
        }
      } catch (e) {
        console.warn(`[SilkScreenParser] Parse error at line ${i}:`, e.message);
      }
    }

    // 计算画布边界
    this.calculateCanvasBounds(result, minX, minY, maxX, maxY);

    // 统计总数
    result.statistics.totalShapes = result.statistics.lines +
                                    result.statistics.arcs +
                                    result.statistics.polylines +
                                    result.statistics.fills +
                                    result.statistics.texts;

    return result;
  }

  // 解析直线
  parseLine(data, result) {
    const line = {
      type: 'line',
      x1: Number(data.startX) || 0,
      y1: Number(data.startY) || 0,
      x2: Number(data.endX) || 0,
      y2: Number(data.endY) || 0,
      strokeWidth: Number(data.width) || 0.1
    };

    result.silkScreen.lines.push(line);
    result.statistics.lines++;
  }

  // 解析圆弧
  parseArc(data, result) {
    const startX = Number(data.startX) || 0;
    const startY = Number(data.startY) || 0;
    const endX = Number(data.endX) || 0;
    const endY = Number(data.endY) || 0;
    const angle = Number(data.angle) || 0;

    const arc = {
      type: 'arc',
      startX,
      startY,
      endX,
      endY,
      angle,
      strokeWidth: Number(data.width) || 0.1
    };

    result.silkScreen.arcs.push(arc);
    result.statistics.arcs++;
  }

  // 解析折线
  parsePoly(data, result) {
    if (!data.path || !Array.isArray(data.path) || data.path.length < 2) {
      return;
    }

    const polyline = {
      type: 'polyline',
      segments: this.parsePolySegments(data.path),
      strokeWidth: Number(data.width) || 0.1
    };

    if (polyline.segments.length > 0) {
      result.silkScreen.polylines.push(polyline);
      result.statistics.polylines++;
    }
  }

  // 解析折线段
  parsePolySegments(path) {
    const segments = [];
    let currentX = path[0];
    let currentY = path[1];
    let i = 2;

    while (i < path.length) {
      const command = path[i];

      if (typeof command === 'string') {
        if (command === 'L') {
          const endX = path[i + 1];
          const endY = path[i + 2];
          segments.push({
            type: 'line',
            x1: currentX,
            y1: currentY,
            x2: endX,
            y2: endY
          });
          currentX = endX;
          currentY = endY;
          i += 3;
        } else if (command === 'ARC' || command === 'CARC') {
          const angle = path[i + 1];
          const endX = path[i + 2];
          const endY = path[i + 3];
          segments.push({
            type: 'arc',
            mode: command,
            x1: currentX,
            y1: currentY,
            x2: endX,
            y2: endY,
            angle: angle
          });
          currentX = endX;
          currentY = endY;
          i += 4;
        } else {
          i++;
        }
      } else {
        i++;
      }
    }

    return segments;
  }

  // 解析填充
  parseFill(data, result) {
    if (!data.path || !Array.isArray(data.path)) return;

    const fill = {
      type: 'fill',
      points: this.parseFillPoints(data.path),
      strokeWidth: Number(data.width) || 0.1
    };

    if (fill.points.length > 0) {
      result.silkScreen.fills.push(fill);
      result.statistics.fills++;
    }
  }

  // 解析填充点
  parseFillPoints(path) {
    const points = [];
    for (const polygon of path) {
      if (!Array.isArray(polygon)) continue;
      for (let i = 0; i < polygon.length; i++) {
        if (typeof polygon[i] === 'number' && typeof polygon[i + 1] === 'number') {
          points.push({ x: polygon[i], y: polygon[i + 1] });
          i++;
        }
      }
    }
    return points;
  }

  // 解析文本
  parseString(data, result) {
    const text = {
      type: 'text',
      x: Number(data.positionX) || 0,
      y: Number(data.positionY) || 0,
      text: data.text || '',
      fontSize: Number(data.fontSize) || 10,
      angle: Number(data.angle) || 0
    };

    result.silkScreen.texts.push(text);
    result.statistics.texts++;
  }

  // 计算画布边界
  calculateCanvasBounds(result, minX, minY, maxX, maxY) {
    if (minX !== Infinity) {
      const pad = 10;
      result.canvas = {
        x: minX - pad,
        y: minY - pad,
        width: maxX - minX + pad * 2,
        height: maxY - minY + pad * 2,
      };
    }
  }

  // 清除缓存
  clearCache(footprintUuid = null) {
    if (footprintUuid) {
      // 清除特定封装的缓存
      for (const key of this.cache.keys()) {
        if (key.startsWith(`${footprintUuid}_`)) {
          this.cache.delete(key);
        }
      }
    } else {
      // 清除所有缓存
      this.cache.clear();
    }
  }

  // 获取统计信息
  getStatistics(result) {
    return result.statistics;
  }
}

// 导出模块
module.exports = {
  FootprintSilkScreenParser,
  getFootprintSilkScreen: async (file, footprintUuid) => {
    const parser = new FootprintSilkScreenParser();
    return await parser.getFootprintSilkScreen(file, footprintUuid);
  }
};

// CLI使用示例
if (require.main === module) {
  console.log('Footprint SilkScreen Parser Skill');
  console.log('Usage: const skill = require("./.claude/skills/get-silk-screen-info");');
  console.log('       skill.getFootprintSilkScreen(file, footprintUuid).then(console.log);');
}