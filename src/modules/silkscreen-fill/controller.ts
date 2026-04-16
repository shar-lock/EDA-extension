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
import { cleanPolygons, difference, getPolygonBBox } from './utils/clipper';
import {
	captureError,
	DIAGNOSTIC_MODE,
	diagnosticLog,
	endTimer,
	logPolygonInfo,
	logPolygonsInfo,
	startTimer,
	validateClipperData,
} from './utils/diagnostic';

/**
 * 丝印层填充配置
 */
export interface SilkscreenFillConfig {
	/** 丝印层ID（默认3 = 顶层丝印层） */
	silkscreenLayerId: number;
	/** 填充层ID（默认与丝印层相同） */
	fillLayerId: number;
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
	silkscreenLayerId: EPCB_LayerId.TOP_SILKSCREEN, // 顶层丝印层
	fillLayerId: EPCB_LayerId.TOP_SILKSCREEN,
	fillMode: 'solid',
};

/**
 * 执行丝印层填充 - 补集算法
 *
 * 核心概念：计算用户选区与丝印图元的补集
 * 数学表达：FillRegion = SelectionArea - SilkscreenPrimitives
 *
 * 优化流程：
 * 1. 获取精确选区边界
 * 2. 提取并筛选与选区相交的丝印图元
 * 3. 高效转换为多边形（批量处理+缓存）
 * 4. 执行差集运算（选区 - 丝印图元）
 * 5. 清理和优化结果多边形
 * 6. 批量生成填充区域
 *
 * @param config 配置（可选，使用默认配置）
 * @returns 创建的填充区域ID数组
 */
export async function executeSilkscreenFill(
	config: Partial<SilkscreenFillConfig> = {},
): Promise<string[]> {
	// 参数验证
	if (config.silkscreenLayerId !== undefined
		&& (!Number.isInteger(config.silkscreenLayerId) || config.silkscreenLayerId < 0)) {
		throw new Error(`无效的丝印层ID: ${config.silkscreenLayerId}`);
	}

	if (config.fillLayerId !== undefined
		&& (!Number.isInteger(config.fillLayerId) || config.fillLayerId < 0)) {
		throw new Error(`无效的填充层ID: ${config.fillLayerId}`);
	}

	if (config.fillMode !== undefined
		&& !['solid', 'hatched'].includes(config.fillMode)) {
		throw new Error(`无效的填充模式: ${config.fillMode}`);
	}
	// 启用诊断模式
	if (DIAGNOSTIC_MODE.ENABLED) {
		diagnosticLog('============ 丝印层填充-诊断模式启动 ============');
		diagnosticLog('输入配置:', config);
	}

	const finalConfig: SilkscreenFillConfig = { ...DEFAULT_CONFIG, ...config };
	startTimer('total_execution');

	// eslint-disable-next-line no-console
	console.log('【丝印层填充-补集算法】开始执行');
	// eslint-disable-next-line no-console
	console.log('配置:', finalConfig);

	let createdIds: string[] = [];

	try {
		// 步骤1: 获取精确选区
		// eslint-disable-next-line no-console
		console.log('步骤1: 获取用户选区边界...');
		startTimer('step_selection');
		const selectionResult = await waitForUserSelection();
		endTimer('step_selection', '选区获取耗时: ');
		diagnosticLog('选区结果:', selectionResult);

		if (!selectionResult.success) {
			const errorMsg = selectionResult.error || '获取选区失败';
			diagnosticLog(errorMsg);
			return [];
		}

		if (!selectionResult.success || !selectionResult.rect) {
			const errorMsg = selectionResult.error || '获取选区失败';
			diagnosticLog(errorMsg);
			return [];
		}

		// 验证选区有效性
		if (selectionResult.rect.width <= 0 || selectionResult.rect.height <= 0) {
			const errorMsg = '无效的选区尺寸';
			captureError(new Error(errorMsg), '选区验证');
			throw new Error(errorMsg);
		}

		// eslint-disable-next-line no-console
		console.log('选区边界:', selectionResult.rect);
		const selectionPolygon = selectionToPolygon(selectionResult.rect);
		logPolygonInfo(selectionPolygon, '选区多边形');

		// 步骤2: 智能提取丝印图元
		// 只提取与选区相交的丝印图元，优化性能
		// eslint-disable-next-line no-console
		console.log('步骤2: 智能提取丝印图元...');
		startTimer('step_extraction');

		// 计算选区边界框
		const selectionBBox = {
			minX: selectionResult.rect.x,
			minY: selectionResult.rect.y,
			maxX: selectionResult.rect.x + selectionResult.rect.width,
			maxY: selectionResult.rect.y + selectionResult.rect.height,
		};
		diagnosticLog('选区边界框:', selectionBBox);

		// 获取与选区相交的丝印多边形
		const silkscreenPolygons = await getLayerPolygons(finalConfig.silkscreenLayerId, selectionBBox);
		endTimer('step_extraction', '丝印提取耗时: ');

		// eslint-disable-next-line no-console
		console.log(`丝印提取完成: ${silkscreenPolygons.length} 个多边形`);
		logPolygonsInfo(silkscreenPolygons, '丝印多边形');

		// 验证丝印多边形数据
		if (DIAGNOSTIC_MODE.ENABLED) {
			validateClipperData(silkscreenPolygons, '丝印多边形验证');
		}

		// 步骤3: 执行补集运算（差集）
		// eslint-disable-next-line no-console
		console.log('步骤3: 执行补集运算...');
		startTimer('step_difference');

		// 执行差集运算：选区 - 丝印图元
		// 如果没有任何丝印图元，直接填充整个选区
		const polygonsToSubtract = silkscreenPolygons.length > 0 ? silkscreenPolygons : [];
		diagnosticLog('差集运算输入:', {
			subjectCount: 1,
			clipCount: polygonsToSubtract.length,
		});
		logPolygonsInfo([selectionPolygon], '差集运算-subject');
		logPolygonsInfo(polygonsToSubtract, '差集运算-clip');
		console.log('---------------------selectionPolygon  polygonsToSubtract----------------------------------------');
		console.log(selectionPolygon);
		console.log(polygonsToSubtract);
		const resultPolygons = difference([selectionPolygon], polygonsToSubtract);
		console.log('---------------------获取resultPolygons----------------------------------------');
		console.log(resultPolygons);
		endTimer('step_difference', '差集运算耗时: ');
		// eslint-disable-next-line no-console
		console.log(`补集运算完成: ${resultPolygons.length} 个结果多边形`);
		logPolygonsInfo(resultPolygons, '差集运算结果');

		// 步骤4: 清理和优化结果
		// eslint-disable-next-line no-console
		console.log('步骤4: 清理结果多边形...');
		startTimer('step_cleaning');

		// 清理无效多边形
		const cleanedPolygons = cleanPolygons(resultPolygons);

		// 移除过小的区域（面积小于选区面积的0.1%）
		const minArea = (selectionResult.rect.width * selectionResult.rect.height) * 0.001;
		const filteredPolygons = cleanedPolygons.filter((polygon) => {
			const bbox = getPolygonBBox(polygon);
			if (!bbox)
				return false;
			// 计算近似面积
			const area = (bbox.maxX - bbox.minX) * (bbox.maxY - bbox.minY);
			return area > minArea;
		});

		endTimer('step_cleaning', '清理耗时: ');
		// eslint-disable-next-line no-console
		console.log(`清理完成: ${filteredPolygons.length} 个有效填充多边形`);
		logPolygonsInfo(filteredPolygons, '最终填充多边形');

		if (filteredPolygons.length === 0) {
			const warningMsg = '警告: 没有生成任何填充区域，可能选区完全被丝印覆盖或区域过小';
			diagnosticLog(warningMsg);
			console.warn(warningMsg);
			return [];
		}

		// 步骤5: 生成填充区域
		// eslint-disable-next-line no-console
		console.log('步骤5: 批量生成填充区域...');
		startTimer('step_generation');

		const fillConfig: FillRegionConfig = {
			layerId: finalConfig.fillLayerId,
			netName: finalConfig.netName,
			fillMode: finalConfig.fillMode,
			color: finalConfig.color,
		};
		diagnosticLog('填充配置:', fillConfig);

		createdIds = await createFilledRegions(filteredPolygons, fillConfig);

		endTimer('step_generation', '填充生成耗时: ');
		// eslint-disable-next-line no-console
		console.log(`填充生成完成: ${createdIds.length} 个填充区域`);

		// 总耗时统计
		endTimer('total_execution', '【补集算法】总耗时: ');
		// eslint-disable-next-line no-console
		console.log('丝印层填充完成!');

		if (DIAGNOSTIC_MODE.ENABLED) {
			diagnosticLog('============ 丝印层填充-诊断模式结束 ============');
		}

		// 显示成功提示
		eda.sys_Dialog.showInformationMessage(
			`丝印层填充完成！\n成功创建 ${createdIds.length} 个填充区域`,
			'完成',
		);

		return createdIds;
	}
	catch (error) {
		captureError(error, '丝印层填充主流程');
		endTimer('total_execution', '【补集算法】总耗时（含错误）: ');
		console.error('丝印层填充失败:', error);

		if (DIAGNOSTIC_MODE.ENABLED) {
			diagnosticLog('============ 丝印层填充-诊断模式结束（错误） ============');
		}

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
