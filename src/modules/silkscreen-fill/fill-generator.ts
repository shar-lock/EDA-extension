/**
 * 填充区域生成模块
 *
 * 将布尔运算结果转换为 PCB FilledRegion 并添加到文档中
 */

// EPCB_LayerId 和 EPCB_PrimitiveFillMode 在 @jlceda/pro-api-types 中通过 declare global 声明，无需导入
import { diagnosticLog, logAPICall, logAPIReturn } from './utils/diagnostic';

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
	polygons: IPCB_ComplexPolygon[],
	config: FillRegionConfig,
): Promise<string[]> {
	// 参数验证
	if (!Array.isArray(polygons)) {
		throw new TypeError('polygons 必须是一个数组');
	}

	if (!config || typeof config.layerId !== 'number' || config.layerId < 0) {
		throw new Error('无效的配置或图层ID');
	}

	const createdIds: string[] = [];
	const startTime = performance.now();

	diagnosticLog(`开始创建填充区域: ${polygons.length} 个多边形`);

	// 批量处理，限制并发数
	const BATCH_SIZE = 10;
	for (let i = 0; i < polygons.length; i += BATCH_SIZE) {
		const batch = polygons.slice(i, i + BATCH_SIZE);
		const batchPromises: Promise<string | null>[] = [];

		for (let j = 0; j < batch.length; j++) {
			const polygon = batch[j];
			const globalIndex = i + j;
			if (!polygon) {
				diagnosticLog(`跳过无效复杂多边形 ${globalIndex}`);
				continue;
			}

			batchPromises.push(
				createSingleFill(polygon, config, globalIndex).catch((error) => {
					diagnosticLog(`创建填充区域 ${globalIndex} 失败:`, error);
					return null;
				}),
			);
		}

		// 等待当前批次完成
		const batchResults = await Promise.all(batchPromises);
		for (const result of batchResults) {
			if (result) {
				createdIds.push(result);
			}
		}

		// 每批之间稍微延迟，避免界面卡顿
		if (i + BATCH_SIZE < polygons.length) {
			await new Promise(resolve => setTimeout(resolve, 10));
		}
	}

	const duration = performance.now() - startTime;
	diagnosticLog(`填充区域创建完成: ${createdIds.length} 个，耗时 ${duration.toFixed(2)}ms`);

	return createdIds;
}

/**
 * 创建单个填充区域
 * @internal
 */
async function createSingleFill(
	polygon: IPCB_ComplexPolygon,
	config: FillRegionConfig,
	index: number,
): Promise<string | null> {
	logAPICall('createSingleFill', [{ index, complexPolygon: true }]);

	// 3. 获取填充模式
	const fillModeValue = config.fillMode === 'hatched'
		? EPCB_PrimitiveFillMode.MESH
		: EPCB_PrimitiveFillMode.SOLID;

	// 4. 创建填充图元
	// 参数: layer, complexPolygon, net?, fillMode?, lineWidth?, primitiveLock?
	const fill = await eda.pcb_PrimitiveFill.create(
		config.layerId,
		polygon as unknown as IPCB_Polygon,
		config.netName || undefined,
		fillModeValue,
		0, // lineWidth
		false, // primitiveLock
	);

	if (fill) {
		const primitiveId = fill.getState_PrimitiveId();
		logAPIReturn('createSingleFill', primitiveId);
		return primitiveId;
	}

	return null;
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
