/**
 * 丝印层对象提取模块
 *
 * 从 PCB 文档中提取指定图层的所有图元对象
 * 并将它们转换为多边形格式供 Clipper 使用
 */

import type { Point, Polygon } from './utils/clipper';
import {
	arcToPolygon,
	bboxesIntersect,
	getPolygonBBox,
	lineToPolygon,
} from './utils/clipper';
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
	cachedPolygons?: Polygon[];
	/** 边界框缓存 */
	cachedBBox?: { minX: number; minY: number; maxX: number; maxY: number };
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

	try {
		// 1. 获取所有直线 (Line)
		logAPICall('eda.pcb_PrimitiveLine.getAll', [undefined, layerId, false]);
		const lines = await eda.pcb_PrimitiveLine.getAll(undefined, layerId, false);
		logAPIReturn('eda.pcb_PrimitiveLine.getAll', lines);
		diagnosticLog(`获取直线数量: ${lines.length}`);
		diagnosticLog(`直线详情:`, lines.map(l => ({
			id: l.getState_PrimitiveId(),
			start: { x: l.getState_StartX(), y: l.getState_StartY() },
			end: { x: l.getState_EndX(), y: l.getState_EndY() },
		})));

		for (const line of lines) {
			primitives.push({
				id: line.getState_PrimitiveId(),
				type: 'track',
				data: {
					startX: line.getState_StartX(),
					startY: line.getState_StartY(),
					endX: line.getState_EndX(),
					endY: line.getState_EndY(),
				},
				layerId,
			});
		}

		// 2. 获取所有圆弧 (Arc)
		logAPICall('eda.pcb_PrimitiveArc.getAll', [undefined, layerId, false]);
		const arcs = await eda.pcb_PrimitiveArc.getAll(undefined, layerId, false);
		logAPIReturn('eda.pcb_PrimitiveArc.getAll', arcs);
		diagnosticLog(`获取圆弧数量: ${arcs.length}`);
		diagnosticLog(`圆弧详情:`, arcs.map(a => ({
			id: a.getState_PrimitiveId(),
			start: { x: a.getState_StartX(), y: a.getState_StartY() },
			end: { x: a.getState_EndX(), y: a.getState_EndY() },
			angle: a.getState_ArcAngle(),
		})));

		for (const arc of arcs) {
			primitives.push({
				id: arc.getState_PrimitiveId(),
				type: 'arc',
				data: {
					startX: arc.getState_StartX(),
					startY: arc.getState_StartY(),
					endX: arc.getState_EndX(),
					endY: arc.getState_EndY(),
					arcAngle: arc.getState_ArcAngle(),
				},
				layerId,
			});
		}

		// 3. 获取所有折线 (Polyline)
		logAPICall('eda.pcb_PrimitivePolyline.getAll', [undefined, layerId, false]);
		const polylines = await eda.pcb_PrimitivePolyline.getAll(undefined, layerId, false);
		logAPIReturn('eda.pcb_PrimitivePolyline.getAll', polylines);
		diagnosticLog(`获取折线数量: ${polylines.length}`);

		for (const polyline of polylines) {
			const polyObj = polyline.getState_Polygon();
			const points = polyObj.getSource();
			// 转换 TPCB_PolygonSourceArray 为点数组
			const parsedPoints: Point[] = [];
			for (let i = 0; i < points.length; i++) {
				if (typeof points[i] === 'number' && typeof points[i + 1] === 'number') {
					parsedPoints.push({ x: points[i] as number, y: points[i + 1] as number });
					i++;
				}
			}

			diagnosticLog(`折线 ${polyline.getState_PrimitiveId()} 点数: ${parsedPoints.length}`);

			primitives.push({
				id: polyline.getState_PrimitiveId(),
				type: 'polygon',
				data: { points: parsedPoints },
				layerId,
			});
		}

		// 4. 获取所有填充 (Fill)
		logAPICall('eda.pcb_PrimitiveFill.getAll', [layerId, undefined, false]);
		const fills = await eda.pcb_PrimitiveFill.getAll(layerId, undefined, false);
		logAPIReturn('eda.pcb_PrimitiveFill.getAll', fills);
		diagnosticLog(`获取填充数量: ${fills.length}`);

		for (const fill of fills) {
			const polyObj = fill.getState_ComplexPolygon();
			const points = polyObj.getSource();
			const parsedPoints: Point[] = [];
			for (let i = 0; i < points.length; i++) {
				if (typeof points[i] === 'number' && typeof points[i + 1] === 'number') {
					parsedPoints.push({ x: points[i] as number, y: points[i + 1] as number });
					i++;
				}
			}

			diagnosticLog(`填充 ${fill.getState_PrimitiveId()} 点数: ${parsedPoints.length}`);

			primitives.push({
				id: fill.getState_PrimitiveId(),
				type: 'polygon',
				data: { points: parsedPoints },
				layerId,
			});
		}

		// 5. 获取所有文本 (String)
		logAPICall('eda.pcb_PrimitiveString.getAll', [layerId, false]);
		const strings = await eda.pcb_PrimitiveString.getAll(layerId, false);
		logAPIReturn('eda.pcb_PrimitiveString.getAll', strings);
		diagnosticLog(`获取文本数量: ${strings.length}`);

		for (const str of strings) {
			logAPICall('eda.pcb_Primitive.getPrimitivesBBox', [[str]]);
			const bbox = await eda.pcb_Primitive.getPrimitivesBBox([str]);
			logAPIReturn('eda.pcb_Primitive.getPrimitivesBBox', bbox);
			if (bbox) {
				diagnosticLog(`文本 ${str.getState_PrimitiveId()} 边界框:`, bbox);
				primitives.push({
					id: str.getState_PrimitiveId(),
					type: 'text',
					data: {
						boundingBox: {
							x: bbox.minX,
							y: bbox.minY,
							width: bbox.maxX - bbox.minX,
							maxY: bbox.maxY,
						},
					},
					layerId,
				});
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
		throw error;
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
			const { startX, startY, endX, endY, lineWidth } = primitive.data;
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
			const { startX, startY, endX, endY, lineWidth } = primitive.data;
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
					maxY: primitive.data.boundingBox.y + primitive.data.boundingBox.height,
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
 */
export function primitiveToPolygons(primitive: SilkscreenPrimitive): Polygon[] {
	// 检查缓存
	if (primitive.cachedPolygons) {
		return primitive.cachedPolygons;
	}

	const startTime = performance.now();
	const polygons: Polygon[] = [];

	switch (primitive.type) {
		case 'track': {
			const { startX, startY, endX, endY, lineWidth } = primitive.data;
			const trackPoly = lineToPolygon(startX, startY, endX, endY, lineWidth);
			if (trackPoly.length > 0) {
				polygons.push(trackPoly);
			}
			break;
		}
		case 'arc': {
			const { startX, startY, endX, endY, arcAngle, lineWidth } = primitive.data;
			// 将圆弧转换为多边形路径，然后给路径添加宽度
			const arcPoints = arcToPolygon(startX, startY, endX, endY, arcAngle, 32);
			if (arcPoints.length >= 2) {
				// 将圆弧路径转换为有宽度的多边形
				for (let i = 0; i < arcPoints.length - 1; i++) {
					const segment = lineToPolygon(
						arcPoints[i].x,
						arcPoints[i].y,
						arcPoints[i + 1].x,
						arcPoints[i + 1].y,
						lineWidth,
					);
					if (segment.length > 0) {
						polygons.push(segment);
					}
				}
			}
			break;
		}
		case 'polygon': {
			if (primitive.data.points && primitive.data.points.length >= 3) {
				polygons.push(primitive.data.points.map((p: any) => ({ x: p.x, y: p.y })));
			}
			break;
		}
		case 'text': {
			// 文本简化为包围盒
			if (primitive.data.boundingBox) {
				const { x, y, width, height } = primitive.data.boundingBox;
				polygons.push([
					{ x, y },
					{ x: x + width, y },
					{ x: x + width, y: y + height },
					{ x, y: y + height },
				]);
			}
			break;
		}
		default:
			console.warn(`不支持的图元类型: ${primitive.type}`);
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
): Promise<Polygon[]> {
	startTimer('getLayerPolygons');
	logAPICall('getLayerPolygons', [layerId, targetBBox]);
	diagnosticLog(`开始获取图层 ${layerId} 的多边形`, targetBBox ? `目标边界框: ${JSON.stringify(targetBBox)}` : '');

	const primitives = await getLayerPrimitives(layerId);
	diagnosticLog(`获取到 ${primitives.length} 个图元`);

	// 批量转换多边形
	const allPolygons: Polygon[] = [];
	let totalPolygons = 0;

	for (const primitive of primitives) {
		// 如果提供了目标边界框，先检查是否相交
		if (targetBBox) {
			const primitiveBBox = getPrimitiveBBox(primitive);
			if (!primitiveBBox || !bboxesIntersect(primitiveBBox, targetBBox)) {
				continue; // 不相交则跳过
			}
		}

		const polygons = primitiveToPolygons(primitive);
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
