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
	/** 错误信息 */
	error?: string;
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
	return new Promise((resolve) => {
		try {
			// 显示提示信息
			const result = getCurrentSelection();
			resolve(result);
		}
		catch (error) {
			resolve({
				success: false,
				error: error instanceof Error ? error.message : '初始化框选失败',
			});
		}
	});
}

/**
 * 获取当前选中的对象边界框
 *
 * @returns 选区结果
 */
export async function getCurrentSelection(): Promise<SelectionResult> {
	try {
		const selectedPrimitives = await eda.pcb_SelectControl.getAllSelectedPrimitives();

		if (!selectedPrimitives || selectedPrimitives.length === 0) {
			return {
				success: false,
				error: '未选中任何对象',
			};
		}

		// 获取选中图元的边界框
		const bbox = await eda.pcb_Primitive.getPrimitivesBBox(selectedPrimitives);
		console.warn('选中对象的边界框:', bbox);

		if (!bbox) {
			return {
				success: false,
				error: '无法获取选中对象的边界框',
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
