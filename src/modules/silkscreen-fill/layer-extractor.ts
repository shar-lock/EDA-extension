/**
 * 丝印层对象提取模块
 *
 * 从 PCB 文档中提取指定图层的所有图元对象
 * 并将它们转换为多边形格式供 Clipper 使用
 */

import { fetchComponentFootprints, fetchPcbData, getComponentFootprint } from './utils/api';
import { bboxesIntersect, getPolygonBBox, registerComplexPolygonSource } from './utils/clipper';
import { captureError, DIAGNOSTIC_MODE, diagnosticLog, endTimer, logAPICall, logAPIReturn, startTimer } from './utils/diagnostic';

/**
 * 丝印图元对象
 */
export interface SilkscreenPrimitive {
	/** 图元ID */
	id: string;
	/** 图元类型 */
	type: 'track' | 'arc' | 'circle' | 'text' | 'polygon' | 'rect';
	/** 图元数据 */
	data: any;
	/** 图层ID */
	layerId: number;
	/** 转换后的多边形（缓存） */
	cachedPolygons?: IPCB_ComplexPolygon[];
	/** 边界框缓存 */
	cachedBBox?: { minX: number; minY: number; maxX: number; maxY: number };
}

/**
 * 从 footprint-parser 解析的直线数据中提取图元
 * 支持两种格式：
 * 1. 已解析格式：x1, y1, x2, y2
 * 2. 原始格式：startX, startY, endX, endY
 */
async function extractLinePrimitive(data: any, layerId: number): Promise<SilkscreenPrimitive | null> {
	if (!data) {
		return null;
	}

	// 支持多种坐标格式
	const startX = data.startX;
	const startY = data.startY;
	const endX = data.endX;
	const endY = data.endY;
	const lineWidth = data.lineWidth || data.width || 0.1;

	if (startX === undefined || startY === undefined || endX === undefined || endY === undefined) {
		diagnosticLog(`直线数据缺少必要的坐标信息`, data);
		return null;
	}

	return {
		id: `line_${startX}_${startY}_${endX}_${endY}`,
		type: 'track',
		data: {
			startX,
			startY,
			endX,
			endY,
			lineWidth,
		},
		layerId,
	};
}

/**
 * 从 footprint-parser 解析的圆弧数据中提取图元
 * 支持两种格式：
 * 1. 已解析格式：centerX, centerY, radius, startAngle, endAngle
 * 2. Segment格式：x1, y1, x2, y2, angle（起点、终点、角度）
 */
async function extractArcPrimitive(data: any, layerId: number): Promise<SilkscreenPrimitive | null> {
	if (!data) {
		return null;
	}

	return {
		id: `arc_${data.centerX}_${data.centerY}_${data.radius}`,
		type: 'arc',
		data: {
			startX: data.startX,
			startY: data.startY,
			endX: data.endX,
			endY: data.endY,
			mode: data.mode,
			angle: data.angle,
			lineWidth: data.lineWidth || 0.1,
		},
		layerId,
	};
}

/**
 * 从 footprint 数据中提取丝印层图元
 * 数据结构示例:
 * {
 *   "silkScreen": [
 *     {
 *       "type": "poly",
 *       "layer": "SilkScreen",
 *       "segments": [
 *         {"type": "line", "x1": 77.949, "y1": -59.05, "x2": -77.949, "y2": -59.05},
 *         {"type": "arc", "mode": "ARC", "x1": 78, "y1": -59.1, "x2": -78, "y2": -59.1, "angle": 254.20101}
 *       ],
 *       "strokeWidth": 10
 *     }
 *   ]
 * }
 */
async function extractSilkScreenPrimitivesFromFootprint(
	footprintData: any,
	layerId: number,
	componentId: string,
	componentX: number = 0,
	componentY: number = 0,
): Promise<SilkscreenPrimitive[]> {
	startTimer('extractSilkScreenPrimitivesFromFootprint');
	logAPICall('extractSilkScreenPrimitivesFromFootprint', [layerId, componentId]);
	diagnosticLog(`[${componentId}] 开始从封装数据中提取丝印层图元`, `图层ID: ${layerId}, 元件位置: (${componentX}, ${componentY})`);

	const primitives: SilkscreenPrimitive[] = [];

	if (!footprintData || !footprintData.silkScreen) {
		diagnosticLog(`[${componentId}] 封装数据无效或缺少 silkScreen 属性`);
		endTimer('extractSilkScreenPrimitivesFromFootprint', `[${componentId}] 提取丝印层图元耗时: `);
		logAPIReturn('extractSilkScreenPrimitivesFromFootprint', 0);
		return primitives;
	}

	diagnosticLog(`[${componentId}] 找到 ${footprintData.silkScreen.length} 个丝印层图元`);

	for (let i = 0; i < footprintData.silkScreen.length; i++) {
		const silkShape = footprintData.silkScreen[i];

		if (!silkShape || !silkShape.layer || silkShape.layer !== 'SilkScreen') {
			diagnosticLog(`[${componentId}] 跳过第 ${i} 个图元: 无效或图层不匹配`, silkShape?.layer);
			continue;
		}

		diagnosticLog(`[${componentId}] 处理第 ${i} 个图元: 类型=${silkShape.type}, strokeWidth=${silkShape.strokeWidth}`);

		// 提取通用的strokeWidth
		const strokeWidth = silkShape.strokeWidth || 0.1;

		switch (silkShape.type) {
			case 'line': {
				// 处理直接的line类型（如果存在）
				diagnosticLog(`[${componentId}] 提取直接直线图元`);
				const primitive = await extractLinePrimitive({
					startX: (silkShape.x1 || 0) + componentX,
					startY: (silkShape.y1 || 0) + componentY,
					endX: (silkShape.x2 || 0) + componentX,
					endY: (silkShape.y2 || 0) + componentY,
					lineWidth: strokeWidth,
				}, layerId);
				if (primitive) {
					primitive.id = `${componentId}_line_${i}_${primitive.id}`;
					primitives.push(primitive);
					diagnosticLog(`[${componentId}] 成功提取直线图元: ${primitive.id}`);
				}
				else {
					diagnosticLog(`[${componentId}] 提取直线图元失败`);
				}
				break;
			}

			case 'arc': {
				// 处理直接的arc类型（如果存在）
				diagnosticLog(`[${componentId}] 提取直接圆弧图元`);
				const primitive = await extractArcPrimitive({
					startX: (silkShape.x1 || 0) + componentX,
					startY: (silkShape.y1 || 0) + componentY,
					endX: (silkShape.x2 || 0) + componentX,
					endY: (silkShape.y2 || 0) + componentY,
					mode: 'ARC',
					angle: silkShape.angle,
					lineWidth: strokeWidth,
				}, layerId);
				if (primitive) {
					primitive.id = `${componentId}_arc_${i}_${primitive.id}`;
					primitives.push(primitive);
					diagnosticLog(`[${componentId}] 成功提取圆弧图元: ${primitive.id}`);
				}
				else {
					diagnosticLog(`[${componentId}] 提取圆弧图元失败`);
				}
				break;
			}

			case 'poly': {
				// poly类型包含segments数组，需要分别处理每个segment
				diagnosticLog(`[${componentId}] 提取复合多边形图元，包含 ${silkShape.segments?.length || 0} 个segments`);
				if (silkShape.segments && Array.isArray(silkShape.segments)) {
					for (let j = 0; j < silkShape.segments.length; j++) {
						const segment = silkShape.segments[j];
						diagnosticLog(`[${componentId}] 处理 segment ${j}: 类型=${segment.type}`);

						switch (segment.type) {
							case 'line': {
								// 处理直线段，添加元件位置偏移
								const primitive = await extractLinePrimitive({
									startX: (segment.x1 || 0) + componentX,
									startY: (segment.y1 || 0) + componentY,
									endX: (segment.x2 || 0) + componentX,
									endY: (segment.y2 || 0) + componentY,
									lineWidth: strokeWidth,
								}, layerId);
								if (primitive) {
									primitive.id = `${componentId}_poly_${i}_line_${j}_${primitive.id}`;
									primitives.push(primitive);
									diagnosticLog(`[${componentId}] 成功提取 poly 中的直线段: ${primitive.id}`);
								}
								else {
									diagnosticLog(`[${componentId}] 提取 poly 中的直线段失败`);
								}
								break;
							}

							case 'arc': {
								// 处理圆弧段，添加元件位置偏移
								const primitive = await extractArcPrimitive({
									startX: (segment.x1 || 0) + componentX,
									startY: (segment.y1 || 0) + componentY,
									endX: (segment.x2 || 0) + componentX,
									endY: (segment.y2 || 0) + componentY,
									mode: 'ARC',
									angle: segment.angle,
									lineWidth: strokeWidth,
								}, layerId);
								if (primitive) {
									primitive.id = `${componentId}_poly_${i}_arc_${j}_${primitive.id}`;
									primitives.push(primitive);
									diagnosticLog(`[${componentId}] 成功提取 poly 中的圆弧段: ${primitive.id}`);
								}
								else {
									diagnosticLog(`[${componentId}] 提取 poly 中的圆弧段失败`);
								}
								break;
							}

							default: {
								diagnosticLog(`[${componentId}] 未知的 segment 类型: ${segment.type}`);
								break;
							}
						}
					}
				}
				else {
					diagnosticLog(`[${componentId}] poly 类型缺少 segments 数据`);
				}
				break;
			}

			default: {
				diagnosticLog(`[${componentId}] 未知图元类型: ${(silkShape as any).type}`);
				break;
			}
		}
	}

	endTimer('extractSilkScreenPrimitivesFromFootprint', `[${componentId}] 提取丝印层图元总耗时: `);
	diagnosticLog(`[${componentId}] 提取完成: ${primitives.length} 个图元`);
	logAPIReturn('extractSilkScreenPrimitivesFromFootprint', primitives.length);

	return primitives;
}

/**
 * 获取指定图层的所有图元
 * @param layerId 图层ID（3 = 顶层丝印层）
 * @returns 图元数组
 */
export async function getLayerPrimitives(layerId: number): Promise<SilkscreenPrimitive[]> {
	logAPICall('getLayerPrimitives', [layerId]);
	startTimer('getLayerPrimitives');
	diagnosticLog(`开始获取图层 ${layerId} 的图元`);
	const primitives: SilkscreenPrimitive[] = [];

	if (!Number.isInteger(layerId) || layerId < 0) {
		diagnosticLog(`无效的图层ID: ${layerId}`);
		return primitives;
	}

	try {
		// 使用 api.ts 中的函数获取PCB数据和元件
		logAPICall('fetchPcbData', []);
		const pcbData = await fetchPcbData();
		logAPIReturn('fetchPcbData', pcbData);
		console.log('=======================获取pcbdata=========================');
		console.log(pcbData);
		if (!pcbData.components || pcbData.components.length === 0) {
			diagnosticLog('没有获取到元件数据');
			return primitives;
		}

		diagnosticLog(`获取到 ${pcbData.components.length} 个元件`);

		// 使用 api.ts 中的函数获取所有元件的封装数据
		logAPICall('fetchComponentFootprints', [pcbData.components]);
		const footprintMap = await fetchComponentFootprints(pcbData.components);
		logAPIReturn('fetchComponentFootprints', footprintMap.size);

		if (footprintMap.size === 0) {
			diagnosticLog('没有获取到封装数据');
			return primitives;
		}
		console.log('=======================footprintMap===================');
		console.log(footprintMap);
		diagnosticLog(`获取到 ${footprintMap.size} 个封装数据`);

		// 遍历所有元件，从封装数据中提取丝印层图元
		for (const component of pcbData.components) {
			const componentId = component.ref || component.designator || 'unknown';
			diagnosticLog(`处理元件: ${componentId}`);
			eda.pcb_Primitive.getPrimitivesBBox([component.primitiveId]);
			// 获取元件的位置信息
			let componentX = 0;
			let componentY = 0;
			if (component.getState_X && typeof component.getState_X === 'function') {
				componentX = await component.getState_X();
			}
			if (component.getState_Y && typeof component.getState_Y === 'function') {
				componentY = await component.getState_Y();
			}
			diagnosticLog(`元件 ${componentId} 位置: (${componentX}, ${componentY})`);

			// 使用 api.ts 中的函数获取元件的封装数据
			const footprintData = getComponentFootprint(component, footprintMap);
			if (!footprintData) {
				diagnosticLog(`元件 ${componentId} 没有找到封装数据`);
				continue;
			}
			// 从封装数据中提取丝印层图元，传入元件位置作为坐标偏移
			const silkPrimitives = await extractSilkScreenPrimitivesFromFootprint(
				footprintData,
				layerId,
				componentId,
				componentX,
				componentY,
			);

			if (silkPrimitives.length > 0) {
				primitives.push(...silkPrimitives);
				diagnosticLog(`元件 ${componentId} 提取到 ${silkPrimitives.length} 个丝印层图元`);
			}
		}

		endTimer('getLayerPrimitives', '获取图层图元总耗时: ');
		diagnosticLog(`图层 ${layerId} 图元获取完成: ${primitives.length} 个图元`);
		logAPIReturn('getLayerPrimitives', primitives.length);

		return primitives;
	}
	catch (error) {
		captureError(error, 'getLayerPrimitives');
		endTimer('getLayerPrimitives', '获取图层图元耗时（含错误）: ');
		diagnosticLog(`图层 ${layerId} 图元获取失败:`, error);
		return primitives; // 出错时返回已获取的图元
	}
}

/**
 * 获取图元的边界框
 */
function getPrimitiveBBox(primitive: SilkscreenPrimitive): { minX: number; minY: number; maxX: number; maxY: number } | null {
	if (primitive.cachedBBox)
		return primitive.cachedBBox;

	switch (primitive.type) {
		case 'track': {
			const { startX, startY, endX, endY, lineWidth = 0.1 } = primitive.data;
			const halfWidth = lineWidth / 2;
			return {
				minX: Math.min(startX, endX) - halfWidth,
				minY: Math.min(startY, endY) - halfWidth,
				maxX: Math.max(startX, endX) + halfWidth,
				maxY: Math.max(startY, endY) + halfWidth,
			};
		}
		case 'arc': {
			// 简化处理：使用起点和终点的边界框
			const { startX, startY, endX, endY, lineWidth = 0.1 } = primitive.data;
			const halfWidth = lineWidth / 2;
			return {
				minX: Math.min(startX, endX) - halfWidth,
				minY: Math.min(startY, endY) - halfWidth,
				maxX: Math.max(startX, endX) + halfWidth,
				maxY: Math.max(startY, endY) + halfWidth,
			};
		}
		case 'text': {
			if (primitive.data.boundingBox) {
				return {
					minX: primitive.data.boundingBox.x,
					minY: primitive.data.boundingBox.y,
					maxX: primitive.data.boundingBox.x + primitive.data.boundingBox.width,
					maxY: primitive.data.boundingBox.maxY,
				};
			}
			return null;
		}
		case 'polygon': {
			if (primitive.data.points && primitive.data.points.length > 0) {
				return getPolygonBBox(primitive.data.points);
			}
			return null;
		}
		default:
			return null;
	}
}

/**
 * 将丝印图元转换为多边形
 * 使用内置的 PCB_MathPolygon.createPolygon() API 方法
 */
function pointsToLineSourceArray(points: Array<{ x: number; y: number }>): TPCB_PolygonSourceArray {
	if (points.length < 3) {
		return [] as TPCB_PolygonSourceArray;
	}
	const sourceArray: any[] = [points[0].x, points[0].y, 'L'];
	for (let i = 1; i < points.length; i++) {
		sourceArray.push(points[i].x, points[i].y);
	}
	const first = points[0];
	const last = points[points.length - 1];
	if (first.x !== last.x || first.y !== last.y) {
		sourceArray.push(first.x, first.y);
	}
	return sourceArray as TPCB_PolygonSourceArray;
}

function primitiveToSourceArray(primitive: SilkscreenPrimitive): TPCB_PolygonSourceArray | null {
	switch (primitive.type) {
		case 'track': {
			const { startX, startY, endX, endY } = primitive.data;
			if ([startX, startY, endX, endY].every(Number.isFinite)) {
				return [startX, startY, 'L', endX, endY] as TPCB_PolygonSourceArray;
			}
			return null;
		}
		case 'arc': {
			const { startX, startY, endX, endY, angle } = primitive.data;
			if ([startX, startY, endX, endY, angle].every(Number.isFinite)) {
				return [startX, startY, 'ARC', angle, endX, endY] as TPCB_PolygonSourceArray;
			}
			return null;
		}
		case 'polygon': {
			if (Array.isArray(primitive.data.points)) {
				const points = primitive.data.points
					.map((p: { x: number; y: number }) => ({ x: Number(p.x), y: Number(p.y) }))
					.filter((p: { x: number; y: number }) => Number.isFinite(p.x) && Number.isFinite(p.y));
				return pointsToLineSourceArray(points);
			}
			return null;
		}
		case 'text': {
			if (primitive.data.boundingBox) {
				const { x, y, width, maxY } = primitive.data.boundingBox;
				const height = Math.abs(maxY - y);
				if ([x, y, width, height].every(Number.isFinite) && width > 0 && height > 0) {
					return ['R', x, y, width, height, 0, 0] as TPCB_PolygonSourceArray;
				}
			}
			return null;
		}
		default:
			return null;
	}
}

function primitiveToComplexPolygon(primitive: SilkscreenPrimitive): IPCB_ComplexPolygon | null {
	const sourceArray = primitiveToSourceArray(primitive);
	if (!sourceArray || sourceArray.length === 0) {
		return null;
	}
	const complexPolygon = eda.pcb_MathPolygon.createComplexPolygon(sourceArray) || null;
	if (complexPolygon) {
		registerComplexPolygonSource(complexPolygon, sourceArray);
	}
	return complexPolygon;
}

export function primitiveToPolygons(primitive: SilkscreenPrimitive): IPCB_ComplexPolygon[] {
	// 检查缓存
	if (primitive.cachedPolygons) {
		return primitive.cachedPolygons;
	}

	const startTime = performance.now();
	const polygons: IPCB_ComplexPolygon[] = [];

	switch (primitive.type) {
		case 'track': {
			const complexPolygon = primitiveToComplexPolygon(primitive);
			if (complexPolygon) {
				polygons.push(complexPolygon);
			}
			break;
		}
		case 'arc': {
			const complexPolygon = primitiveToComplexPolygon(primitive);
			if (complexPolygon) {
				polygons.push(complexPolygon);
			}
			break;
		}
		case 'polygon': {
			const complexPolygon = primitiveToComplexPolygon(primitive);
			if (complexPolygon) {
				polygons.push(complexPolygon);
			}
			break;
		}
		case 'text': {
			const complexPolygon = primitiveToComplexPolygon(primitive);
			if (complexPolygon) {
				polygons.push(complexPolygon);
			}
			break;
		}
		default:
			diagnosticLog(`不支持的图元类型: ${primitive.type}`);
	}

	// 缓存结果
	primitive.cachedPolygons = polygons;

	const endTime = performance.now();
	if (endTime - startTime > 10) {
		diagnosticLog(`[PERF] primitiveToPolygons ${primitive.type} (${primitive.id}): ${(endTime - startTime).toFixed(2)}ms -> ${polygons.length} polygons`);
	}

	return polygons;
}

/**
 * 获取指定图层的所有图元并转换为多边形
 * 只返回与目标边界框相交的图元
 */
export async function getLayerPolygons(
	layerId: number,
	targetBBox?: { minX: number; minY: number; maxX: number; maxY: number },
): Promise<IPCB_ComplexPolygon[]> {
	startTimer('getLayerPolygons');
	logAPICall('getLayerPolygons', [layerId, targetBBox]);
	diagnosticLog(`开始获取图层 ${layerId} 的多边形`, targetBBox ? `目标边界框: ${JSON.stringify(targetBBox)}` : '');

	const primitives = await getLayerPrimitives(layerId);
	diagnosticLog(`获取到 ${primitives.length} 个图元`);

	// 批量转换多边形
	const allPolygons: IPCB_ComplexPolygon[] = [];
	let totalPolygons = 0;

	for (const primitive of primitives) {
		// 如果提供了目标边界框，先检查是否相交
		if (targetBBox) {
			const primitiveBBox = getPrimitiveBBox(primitive);
			if (!primitiveBBox || !bboxesIntersect(primitiveBBox, targetBBox)) {
				continue; // 不相交则跳过
			}
		}
		console.log('----------------------------------------------------------------------------------');
		console.log(primitive);
		const polygons = primitiveToPolygons(primitive);
		console.log('---------------------获取polygons----------------------------------------');
		console.log(polygons);
		allPolygons.push(...polygons);
		totalPolygons += polygons.length;

		if (DIAGNOSTIC_MODE.VERBOSE && polygons.length > 0) {
			diagnosticLog(`图元 ${primitive.id} (${primitive.type}) 转换为 ${polygons.length} 个多边形`);
		}
	}

	endTimer('getLayerPolygons', '获取图层多边形总耗时: ');
	diagnosticLog(`图层 ${layerId} 多边形转换完成: ${allPolygons.length} 个多边形 (${totalPolygons} 个转换结果)`);
	logAPIReturn('getLayerPolygons', allPolygons.length);

	return allPolygons;
}

/**
 * 清除所有缓存
 */
export function clearCache(primitives: SilkscreenPrimitive[]): void {
	diagnosticLog(`清除 ${primitives.length} 个图元的缓存`);
	for (const primitive of primitives) {
		primitive.cachedPolygons = undefined;
		primitive.cachedBBox = undefined;
	}
}
