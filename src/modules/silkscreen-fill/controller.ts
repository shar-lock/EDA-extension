/**
 * 丝印层填充主控制器
 *
 * 协调整个丝印层填充流程：
 * 1. 获取用户框选区域
 * 2. 提取丝印层图元
 * 3. 执行布尔差集运算
 * 4. 生成填充区域
 */

import type { FillRegionConfig } from './fill-generator';
import { createFilledRegions } from './fill-generator';
import { getLayerPolygons } from './layer-extractor';
import { selectionToPolygon, waitForUserSelection } from './selection-handler';
import { cleanPolygons, difference } from './utils/clipper';

/**
 * 丝印层填充配置
 */
export interface SilkscreenFillConfig {
	/** 丝印层ID（默认3 = 顶层丝印层） */
	silkscreenLayerId: number;
	/** 填充层ID（默认与丝印层相同） */
	fillLayerId: number;
	/** 丝印线宽（用于将线条转换为面） */
	strokeWidth: number;
	/** 网络名称（可选） */
	netName?: string;
	/** 填充模式 */
	fillMode: 'solid' | 'hatched';
	/** 颜色（可选） */
	color?: string;
}

/**
 * 默认配置
 */
const DEFAULT_CONFIG: SilkscreenFillConfig = {
	silkscreenLayerId: 3, // 顶层丝印层
	fillLayerId: 3,
	strokeWidth: 0.1,
	fillMode: 'solid',
};

/**
 * 执行丝印层填充
 *
 * 主流程：
 * 1. 等待用户框选区域
 * 2. 提取丝印层所有图元并转换为多边形
 * 3. 执行差集运算：选区 - 丝印图元
 * 4. 在指定图层生成填充区域
 *
 * @param config 配置（可选，使用默认配置）
 * @returns 创建的填充区域ID数组
 */
export async function executeSilkscreenFill(
	config: Partial<SilkscreenFillConfig> = {},
): Promise<string[]> {
	const finalConfig: SilkscreenFillConfig = { ...DEFAULT_CONFIG, ...config };

	// eslint-disable-next-line no-console
	console.log('开始丝印层填充流程...');
	// eslint-disable-next-line no-console
	console.log('配置:', finalConfig);

	try {
		// 步骤1: 获取用户框选区域
		// eslint-disable-next-line no-console
		console.log('步骤1: 等待用户框选区域...');
		const selectionResult = await waitForUserSelection();

		if (!selectionResult.success || !selectionResult.rect) {
			throw new Error(`获取选区失败: ${selectionResult.error || '未知错误'}`);
		}

		// eslint-disable-next-line no-console
		console.log('选区:', selectionResult.rect);

		// 步骤2: 提取丝印层图元并转换为多边形
		// eslint-disable-next-line no-console
		console.log('步骤2: 提取丝印层图元...');
		const silkscreenPolygons = await getLayerPolygons(
			finalConfig.silkscreenLayerId,
			finalConfig.strokeWidth,
		);

		// eslint-disable-next-line no-console
		console.log(`提取到 ${silkscreenPolygons.length} 个丝印多边形`);

		// 步骤3: 执行差集运算
		// eslint-disable-next-line no-console
		console.log('步骤3: 执行布尔差集运算...');
		const selectionPolygon = selectionToPolygon(selectionResult.rect);

		// 差集运算：选区矩形 - 丝印图元
		const resultPolygons = difference([selectionPolygon], silkscreenPolygons);

		// 清理空多边形
		const cleanedPolygons = cleanPolygons(resultPolygons);

		// eslint-disable-next-line no-console
		console.log(`差集运算结果: ${cleanedPolygons.length} 个填充多边形`);

		if (cleanedPolygons.length === 0) {
			console.warn('没有生成任何填充区域，可能选区完全被丝印覆盖');
			return [];
		}

		// 步骤4: 生成填充区域
		// eslint-disable-next-line no-console
		console.log('步骤4: 生成填充区域...');
		const fillConfig: FillRegionConfig = {
			layerId: finalConfig.fillLayerId,
			netName: finalConfig.netName,
			fillMode: finalConfig.fillMode,
			color: finalConfig.color,
		};

		const createdIds = await createFilledRegions(cleanedPolygons, fillConfig);

		// eslint-disable-next-line no-console
		console.log(`成功创建 ${createdIds.length} 个填充区域`);
		// eslint-disable-next-line no-console
		console.log('丝印层填充完成!');

		return createdIds;
	}
	catch (error) {
		console.error('丝印层填充失败:', error);

		// 显示错误提示
		eda.sys_Dialog.showInformationMessage(
			`丝印层填充失败: ${error instanceof Error ? error.message : '未知错误'}`,
			'错误',
		);

		throw error;
	}
}

/**
 * 快速执行（使用默认配置）
 */
export async function quickFill(): Promise<string[]> {
	return executeSilkscreenFill();
}
