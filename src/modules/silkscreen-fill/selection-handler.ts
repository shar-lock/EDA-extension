/**
 * 用户框选交互模块
 *
 * 处理用户在 PCB 编辑器中的矩形框选操作
 * 获取用户框选的矩形区域坐标
 */

import type { Polygon } from './utils/clipper';
import { rectToPolygon } from './utils/clipper';

/**
 * 矩形选区
 */
export interface SelectionRect {
	/** 左上角X坐标 */
	x: number;
	/** 左上角Y坐标 */
	y: number;
	/** 宽度 */
	width: number;
	/** 高度 */
	height: number;
}

/**
 * 框选回调结果
 */
export interface SelectionResult {
	/** 是否成功 */
	success: boolean;
	/** 选区矩形 */
	rect?: SelectionRect;
	/** 选中的填充图元ID */
	selectedFillIds?: string[];
	/** 选中填充的源路径（IPCB_ComplexPolygon.getSource()，TPCB_PolygonSourceArray） */
	selectionComplexPolygonSource?: TPCB_PolygonSourceArray;
	/** 错误信息 */
	error?: string;
}

const SELECTION_POLL_INTERVAL_MS = 300;
const SELECTION_TIMEOUT_MS = 60_000;

function sleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 等待用户进行矩形框选
 *
 * 该方法会：
 * 1. 提示用户进行框选
 * 2. 监听用户的框选操作
 * 3. 返回框选的矩形区域
 *
 * @returns 选区结果
 */
export async function waitForUserSelection(): Promise<SelectionResult> {
	try {
		eda.sys_Dialog.showInformationMessage(
			'请先在PCB中框选/选择一个填充区域，然后插件会自动继续计算。',
			'请选择填充区域',
		);

		const start = Date.now();
		while (Date.now() - start < SELECTION_TIMEOUT_MS) {
			const result = await getCurrentSelection();
			if (result.success && result.rect) {
				return result;
			}
			await sleep(SELECTION_POLL_INTERVAL_MS);
		}

		return {
			success: false,
			error: '等待用户选择超时（60秒）',
		};
	}
	catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : '初始化框选失败',
		};
	}
}

/**
 * 获取当前选中的对象边界框
 *
 * @returns 选区结果
 */
export async function getCurrentSelection(): Promise<SelectionResult> {
	try {
		const selectedPrimitivesId = await eda.pcb_SelectControl.getAllSelectedPrimitives_PrimitiveId();

		if (!selectedPrimitivesId || selectedPrimitivesId.length === 0) {
			return {
				success: false,
				error: '未选中任何对象',
			};
		}
		const selectedFills = await eda.pcb_PrimitiveFill.get(selectedPrimitivesId);
		if (!selectedFills || selectedFills.length === 0) {
			return {
				success: false,
				error: '请选择一个填充图元作为填充区域',
			};
		}

		const targetFill = selectedFills[0];
		const selectedFillId = targetFill?.getState_PrimitiveId?.() || selectedPrimitivesId[0];
		const selectionPoly = await targetFill?.getState_ComplexPolygon?.();
		const bbox = await eda.pcb_Primitive.getPrimitivesBBox([selectedFillId]);

		if (!selectionPoly || !bbox) {
			return {
				success: false,
				error: '无法获取选中填充的复杂多边形或边界框',
			};
		}

		const polyWithSource = selectionPoly as unknown as {
			getSource?: () => TPCB_PolygonSourceArray | Promise<TPCB_PolygonSourceArray>;
		};
		const getSource = polyWithSource.getSource;
		const polygonSource = typeof getSource === 'function'
			? await Promise.resolve(getSource.call(polyWithSource))
			: null;

		if (!polygonSource || !Array.isArray(polygonSource) || polygonSource.length === 0) {
			return {
				success: false,
				error: '无法从复杂多边形获取源路径（getSource）',
			};
		}

		return {
			success: true,
			rect: {
				x: bbox.minX,
				y: bbox.minY,
				width: bbox.maxX - bbox.minX,
				height: bbox.maxY - bbox.minY,
			},
			selectedFillIds: [selectedFillId],
			selectionComplexPolygonSource: polygonSource as TPCB_PolygonSourceArray,
		};
	}
	catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : '获取选区失败',
		};
	}
}

/**
 * 将选区矩形转换为多边形
 * @param rect 选区矩形
 * @returns 多边形
 */
export function selectionToPolygon(rect: SelectionRect): Polygon {
	return rectToPolygon(rect.x, rect.y, rect.width, rect.height);
}
