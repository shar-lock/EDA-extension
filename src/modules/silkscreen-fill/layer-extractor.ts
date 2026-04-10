/**
 * 丝印层对象提取模块
 *
 * 从 PCB 文档中提取指定图层的所有图元对象
 * 并将它们转换为多边形格式供 Clipper 使用
 */

import type { Polygon } from './utils/clipper';

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
}

/**
 * 获取指定图层的所有图元
 * @param layerId 图层ID（3 = 顶层丝印层）
 * @returns 图元数组
 */
export async function getLayerPrimitives(layerId: number): Promise<SilkscreenPrimitive[]> {
	const primitives: SilkscreenPrimitive[] = [];

	try {
		// 1. 获取所有直线 (Line)
		const lines = await eda.pcb_PrimitiveLine.getAll(undefined, layerId);
		for (const line of lines) {
			primitives.push({
				id: line.getState_PrimitiveId(),
				type: 'track',
				data: {
					points: [
						{ x: line.getState_StartX(), y: line.getState_StartY() },
						{ x: line.getState_EndX(), y: line.getState_EndY() },
					],
				},
				layerId,
			});
		}

		// 2. 获取所有圆弧 (Arc)
		const arcs = await eda.pcb_PrimitiveArc.getAll(undefined, layerId);
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
		const polylines = await eda.pcb_PrimitivePolyline.getAll(undefined, layerId);
		for (const polyline of polylines) {
			const polyObj = polyline.getState_Polygon();
			const points = polyObj.getSource();
			// 转换 TPCB_PolygonSourceArray 为点数组，跳过命令字符 ('L', 'ARC' 等)
			const parsedPoints: { x: number; y: number }[] = [];
			for (let i = 0; i < points.length; i++) {
				if (typeof points[i] === 'number' && typeof points[i + 1] === 'number') {
					parsedPoints.push({ x: points[i] as number, y: points[i + 1] as number });
					i++;
				}
				// 如果是命令字符，跳过即可，下一轮循环会检查数字
			}

			primitives.push({
				id: polyline.getState_PrimitiveId(),
				type: 'track',
				data: { points: parsedPoints },
				layerId,
			});
		}

		// 4. 获取所有填充 (Fill)
		const fills = await eda.pcb_PrimitiveFill.getAll(layerId);
		for (const fill of fills) {
			const polyObj = fill.getState_ComplexPolygon();
			const points = polyObj.getSource();
			// 转换 TPCB_PolygonSourceArray 为点数组，跳过命令字符
			const parsedPoints: { x: number; y: number }[] = [];
			for (let i = 0; i < points.length; i++) {
				if (typeof points[i] === 'number' && typeof points[i + 1] === 'number') {
					parsedPoints.push({ x: points[i] as number, y: points[i + 1] as number });
					i++;
				}
			}

			primitives.push({
				id: fill.getState_PrimitiveId(),
				type: 'polygon',
				data: { points: parsedPoints },
				layerId,
			});
		}

		// 5. 获取所有文本 (String)
		const strings = await eda.pcb_PrimitiveString.getAll(layerId);
		for (const str of strings) {
			const bbox = await eda.pcb_Primitive.getPrimitivesBBox([str]);
			if (bbox) {
				primitives.push({
					id: str.getState_PrimitiveId(),
					type: 'text',
					data: {
						boundingBox: {
							x: bbox.minX,
							y: bbox.minY,
							width: bbox.maxX - bbox.minX,
							height: bbox.maxY - bbox.minY,
						},
					},
					layerId,
				});
			}
		}

		return primitives;
	}
	catch (error) {
		console.error('获取图层图元失败:', error);
		throw error;
	}
}

/**
 * 将丝印图元转换为多边形
 * @param primitive 丝印图元
 * @param strokeWidth 线宽（用于将线条转换为面）
 * @returns 多边形数组
 */
export function primitiveToPolygons(primitive: SilkscreenPrimitive, strokeWidth: number = 0.1): Polygon[] {
	const polygons: Polygon[] = [];

	try {
		switch (primitive.type) {
			case 'track':
				polygons.push(...trackToPolygons(primitive.data, strokeWidth));
				break;
			case 'arc':
				polygons.push(...arcToPolygons(primitive.data, strokeWidth));
				break;
			case 'circle':
				polygons.push(...circleToPolygons(primitive.data, strokeWidth));
				break;
			case 'rect':
				polygons.push(...rectToPolygons(primitive.data, strokeWidth));
				break;
			case 'polygon':
				polygons.push(...polygonToPolygons(primitive.data));
				break;
			case 'text':
				// 文本需要特殊处理，暂时简化为包围盒
				polygons.push(...textToPolygon(primitive.data, strokeWidth));
				break;
			default:
				console.warn(`不支持的图元类型: ${primitive.type}`);
		}
	}
	catch (error) {
		console.error(`转换图元 ${primitive.id} 失败:`, error);
	}

	return polygons;
}

/**
 * 线条转多边形（通过偏移生成矩形）
 */
function trackToPolygons(track: any, strokeWidth: number): Polygon[] {
	const polygons: Polygon[] = [];

	if (!track.points || track.points.length < 2) {
		return polygons;
	}

	// 对于多段线，逐段转换为矩形
	for (let i = 0; i < track.points.length - 1; i++) {
		const p1 = track.points[i];
		const p2 = track.points[i + 1];

		const rect = lineToRect(p1.x, p1.y, p2.x, p2.y, strokeWidth);
		if (rect) {
			polygons.push(rect);
		}
	}

	return polygons;
}

/**
 * 将线段转换为矩形（带宽度）
 */
function lineToRect(x1: number, y1: number, x2: number, y2: number, width: number): Polygon | null {
	const dx = x2 - x1;
	const dy = y2 - y1;
	const len = Math.sqrt(dx * dx + dy * dy);

	if (len === 0)
		return null;

	// 计算垂直方向
	const nx = -dy / len * width / 2;
	const ny = dx / len * width / 2;

	return [
		{ x: x1 + nx, y: y1 + ny },
		{ x: x1 - nx, y: y1 - ny },
		{ x: x2 - nx, y: y2 - ny },
		{ x: x2 + nx, y: y2 + ny },
	];
}

/**
 * 圆弧转多边形（近似为多边形）
 */
function arcToPolygons(arc: any, strokeWidth: number): Polygon[] {
	const polygons: Polygon[] = [];
	const { startX, startY, endX, endY, arcAngle } = arc;

	if (arcAngle === 0)
		return polygons;

	// 计算圆心和半径
	const dx = endX - startX;
	const dy = endY - startY;
	const d = Math.sqrt(dx * dx + dy * dy);
	if (d === 0)
		return polygons;

	const angleRad = arcAngle * Math.PI / 180;
	const radius = Math.abs(d / (2 * Math.sin(angleRad / 2)));

	// 中点
	const midX = (startX + endX) / 2;
	const midY = (startY + endY) / 2;

	// 垂直向量
	const h = d / (2 * Math.tan(angleRad / 2));
	const nx = -(endY - startY) / d;
	const ny = (endX - startX) / d;

	// 圆心 (有两个可能，根据角度正负判断)
	const centerX = midX - h * nx;
	const centerY = midY - h * ny;

	// 起始角度和终止角度
	const startAngle = Math.atan2(startY - centerY, startX - centerX);
	const endAngle = startAngle + angleRad;

	// 简化处理：将圆弧近似为多边形线段
	const segments = Math.max(8, Math.floor(Math.abs(arcAngle) / 5));
	const points: { x: number; y: number }[] = [];

	for (let i = 0; i <= segments; i++) {
		const angle = startAngle + (endAngle - startAngle) * i / segments;
		points.push({
			x: centerX + radius * Math.cos(angle),
			y: centerY + radius * Math.sin(angle),
		});
	}

	// 将圆弧路径转换为有宽度的多边形
	for (let i = 0; i < points.length - 1; i++) {
		const rect = lineToRect(points[i].x, points[i].y, points[i + 1].x, points[i + 1].y, strokeWidth);
		if (rect) {
			polygons.push(rect);
		}
	}

	return polygons;
}

/**
 * 圆形转多边形
 */
function circleToPolygons(circle: any, strokeWidth: number): Polygon[] {
	const polygons: Polygon[] = [];

	if (circle.radius <= 0)
		return polygons;

	// 圆形边框 - 近似为多边形环
	const segments = 64;
	const outerPoints: Polygon = [];
	const innerPoints: Polygon = [];

	const outerRadius = circle.radius + strokeWidth / 2;
	const innerRadius = Math.max(0, circle.radius - strokeWidth / 2);

	for (let i = 0; i <= segments; i++) {
		const angle = (2 * Math.PI * i) / segments;
		outerPoints.push({
			x: circle.centerX + outerRadius * Math.cos(angle),
			y: circle.centerY + outerRadius * Math.sin(angle),
		});
		innerPoints.push({
			x: circle.centerX + innerRadius * Math.cos(angle),
			y: circle.centerY + innerRadius * Math.sin(angle),
		});
	}

	// 外环
	polygons.push(outerPoints);
	// 内环（孔洞）
	if (innerRadius > 0) {
		polygons.push(innerPoints.reverse()); // 反向表示孔洞
	}

	return polygons;
}

/**
 * 矩形转多边形
 */
function rectToPolygons(rect: any, strokeWidth: number): Polygon[] {
	const polygons: Polygon[] = [];

	// 如果是实心矩形
	if (rect.isFilled) {
		polygons.push([
			{ x: rect.x, y: rect.y },
			{ x: rect.x + rect.width, y: rect.y },
			{ x: rect.x + rect.width, y: rect.y + rect.height },
			{ x: rect.x, y: rect.y + rect.height },
		]);
	}
	else {
		// 边框矩形，转换为四条线段
		const halfWidth = strokeWidth / 2;

		// 上边
		polygons.push([
			{ x: rect.x - halfWidth, y: rect.y - halfWidth },
			{ x: rect.x + rect.width + halfWidth, y: rect.y - halfWidth },
			{ x: rect.x + rect.width + halfWidth, y: rect.y + halfWidth },
			{ x: rect.x - halfWidth, y: rect.y + halfWidth },
		]);

		// 下边
		polygons.push([
			{ x: rect.x - halfWidth, y: rect.y + rect.height - halfWidth },
			{ x: rect.x + rect.width + halfWidth, y: rect.y + rect.height - halfWidth },
			{ x: rect.x + rect.width + halfWidth, y: rect.y + rect.height + halfWidth },
			{ x: rect.x - halfWidth, y: rect.y + rect.height + halfWidth },
		]);

		// 左边
		polygons.push([
			{ x: rect.x - halfWidth, y: rect.y - halfWidth },
			{ x: rect.x + halfWidth, y: rect.y - halfWidth },
			{ x: rect.x + halfWidth, y: rect.y + rect.height + halfWidth },
			{ x: rect.x - halfWidth, y: rect.y + rect.height + halfWidth },
		]);

		// 右边
		polygons.push([
			{ x: rect.x + rect.width - halfWidth, y: rect.y - halfWidth },
			{ x: rect.x + rect.width + halfWidth, y: rect.y - halfWidth },
			{ x: rect.x + rect.width + halfWidth, y: rect.y + rect.height + halfWidth },
			{ x: rect.x + rect.width - halfWidth, y: rect.y + rect.height + halfWidth },
		]);
	}

	return polygons;
}

/**
 * 多边形图元转多边形
 */
function polygonToPolygons(polygon: any): Polygon[] {
	if (polygon.points && polygon.points.length >= 3) {
		return [polygon.points.map((p: any) => ({ x: p.x, y: p.y }))];
	}
	return [];
}

/**
 * 文本转多边形（简化为包围盒）
 */
function textToPolygon(text: any, _strokeWidth: number): Polygon[] {
	// 简化处理：使用文本的包围盒
	if (text.boundingBox) {
		return [[
			{ x: text.boundingBox.x, y: text.boundingBox.y },
			{ x: text.boundingBox.x + text.boundingBox.width, y: text.boundingBox.y },
			{ x: text.boundingBox.x + text.boundingBox.width, y: text.boundingBox.y + text.boundingBox.height },
			{ x: text.boundingBox.x, y: text.boundingBox.y + text.boundingBox.height },
		]];
	}
	return [];
}

/**
 * 获取指定图层的所有图元并转换为多边形
 * @param layerId 图层ID
 * @param strokeWidth 线宽
 * @returns 多边形数组
 */
export async function getLayerPolygons(layerId: number, strokeWidth: number = 0.1): Promise<Polygon[]> {
	const primitives = await getLayerPrimitives(layerId);
	const allPolygons: Polygon[] = [];

	for (const prim of primitives) {
		const polygons = primitiveToPolygons(prim, strokeWidth);
		allPolygons.push(...polygons);
	}

	return allPolygons;
}
