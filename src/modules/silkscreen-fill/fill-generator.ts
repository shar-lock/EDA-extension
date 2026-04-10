/**
 * 填充区域生成模块
 *
 * 将布尔运算结果转换为 PCB FilledRegion 并添加到文档中
 */

import type { Polygon } from './utils/clipper';

/**
 * 填充区域配置
 */
export interface FillRegionConfig {
	/** 图层ID */
	layerId: number;
	/** 网络名称（可选） */
	netName?: string;
	/** 填充模式 */
	fillMode?: 'solid' | 'hatched';
	/** 颜色（可选） */
	color?: string;
}

/**
 * 创建填充区域
 *
 * @param polygons 多边形数组
 * @param config 配置
 * @returns 创建的填充区域ID数组
 */
export async function createFilledRegions(
	polygons: Polygon[],
	config: FillRegionConfig,
): Promise<string[]> {
	const createdIds: string[] = [];

	try {
		// 为每个多边形创建填充区域
		for (let i = 0; i < polygons.length; i++) {
			const polygon = polygons[i];

			if (polygon.length < 3) {
				continue; // 跳过无效多边形
			}

			try {
				// 1. 将 Point[] 转换为 TPCB_PolygonSourceArray
				// 格式: [x1, y1, 'L', x2, y2, x3, y3, ...]
				const sourceArray: any[] = [];
				if (polygon.length >= 1) {
					// 起始点
					sourceArray.push(polygon[0].x, polygon[0].y);
					// 如果有点，添加 'L' 命令及后续点
					if (polygon.length > 1) {
						sourceArray.push('L');
						for (let j = 1; j < polygon.length; j++) {
							sourceArray.push(polygon[j].x, polygon[j].y);
						}
					}
				}

				// 2. 创建 IPCB_Polygon
				const polyObj = eda.pcb_MathPolygon.createPolygon(sourceArray);
				if (!polyObj) {
					console.error(`多边形数据无效:`, sourceArray);
					continue;
				}

				// 3. 创建填充图元
				// JLCEDA Pro 中 FilledRegion 对应 eda.pcb_PrimitiveFill
				const fill = await eda.pcb_PrimitiveFill.create(
					config.layerId,
					polyObj,
					config.netName || '',
					config.fillMode === 'hatched' ? EPCB_PrimitiveFillMode.MESH : EPCB_PrimitiveFillMode.SOLID,
				);

				if (fill) {
					createdIds.push(fill.getState_PrimitiveId());
				}
			}
			catch (error) {
				console.error(`创建填充区域 ${i} 失败:`, error);
			}
		}

		return createdIds;
	}
	catch (error) {
		console.error('创建填充区域失败:', error);
		throw error;
	}
}

/**
 * 清除指定图层上的填充区域
 *
 * @param layerId 图层ID
 * @param regionIds 要清除的区域ID数组（可选，不传则清除图层上所有填充区域）
 */
export async function clearFilledRegions(
	layerId: number,
	regionIds?: string[],
): Promise<void> {
	try {
		if (regionIds && regionIds.length > 0) {
			// 删除指定的填充区域
			await eda.pcb_PrimitiveFill.delete(regionIds);
		}
		else {
			// 删除图层上所有填充区域
			const fillIds = await eda.pcb_PrimitiveFill.getAllPrimitiveId(layerId);
			if (fillIds.length > 0) {
				await eda.pcb_PrimitiveFill.delete(fillIds);
			}
		}
	}
	catch (error) {
		console.error('清除填充区域失败:', error);
		throw error;
	}
}
