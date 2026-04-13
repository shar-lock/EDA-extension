/**
 * Clipper 布尔运算工具模块
 *
 * 使用 @doodle3d/clipper-js 库进行多边形的布尔运算
 */

import Shape from '@doodle3d/clipper-js';
import { DIAGNOSTIC_MODE, diagnosticLog, endTimer, startTimer, validateClipperData } from './diagnostic';

export interface Point {
	x: number;
	y: number;
}

export type Polygon = Point[];
export type Polygons = Polygon[];

// 计算多边形面积（用于判断方向）
// 正值表示逆时针，负值表示顺时针
function calculateSignedArea(polygon: Polygon): number {
	if (polygon.length < 3)
		return 0;

	let area = 0;
	for (let i = 0; i < polygon.length; i++) {
		const j = (i + 1) % polygon.length;
		area += polygon[i].x * polygon[j].y - polygon[j].x * polygon[i].y;
	}

	return area / 2;
}

// 将 Polygons 转换为 Clipper Shape
// 使用正确的方向：外环逆时针，内环顺时针
function toShape(polygons: Polygons, isOuterRing: boolean = true): Shape {
	// 处理多边形方向
	const processedPolygons = polygons.map((polygon) => {
		if (polygon.length < 3)
			return polygon;

		// 对于外环需要逆时针，内环（孔洞）需要顺时针
		// isOuterRing=true时，确保逆时针；isOuterRing=false时，确保顺时针
		const area = calculateSignedArea(polygon);
		if (isOuterRing) {
			return area < 0 ? [...polygon].reverse() : polygon;
		}
		else {
			return area > 0 ? [...polygon].reverse() : polygon;
		}
	});

	return new Shape(processedPolygons, true, true, true);
}

// 将 Clipper Shape 转换为 Polygons
function fromShape(shape: Shape): Polygons {
	return shape.mapToLower() as Polygons;
}

// 执行多边形差集运算
// subject - clip = 结果
export function difference(subject: Polygons, clip: Polygons): Polygons {
	startTimer('clipper_difference');
	diagnosticLog(`Clipper差集运算开始: subject=${subject.length}, clip=${clip.length}`);

	if (subject.length === 0) {
		endTimer('clipper_difference', 'Clipper差集运算（空subject）: ');
		diagnosticLog('差集运算: subject为空，返回空数组');
		return [];
	}
	if (clip.length === 0) {
		endTimer('clipper_difference', 'Clipper差集运算（空clip）: ');
		diagnosticLog('差集运算: clip为空，返回原始subject');
		return subject;
	}

	// 验证输入数据
	if (DIAGNOSTIC_MODE.ENABLED) {
		validateClipperData(subject, '差集运算-subject');
		validateClipperData(clip, '差集运算-clip');
	}

	try {
		const subjectShape = toShape(subject, true);
		const clipShape = toShape(clip, true);

		diagnosticLog('Clipper输入准备完成，执行difference操作...');

		// 使用 Clipper 的 difference 方法
		const resultShape = subjectShape.difference(clipShape);
		const result = fromShape(resultShape);

		endTimer('clipper_difference', 'Clipper差集运算成功: ');
		diagnosticLog(`差集运算成功: ${result.length} 个结果多边形`);

		return result;
	}
	catch (error) {
		endTimer('clipper_difference', 'Clipper差集运算失败: ');
		diagnosticLog('差集运算失败:', error);
		diagnosticLog('返回原始subject以避免完全失败');
		return subject; // 出错时返回原始subject
	}
}

// 执行多边形并集运算
export function union(subject: Polygons, clip: Polygons): Polygons {
	startTimer('clipper_union');
	diagnosticLog(`Clipper并集运算开始: subject=${subject.length}, clip=${clip.length}`);

	if (subject.length === 0) {
		endTimer('clipper_union', 'Clipper并集运算（空subject）: ');
		return clip;
	}
	if (clip.length === 0) {
		endTimer('clipper_union', 'Clipper并集运算（空clip）: ');
		return subject;
	}

	// 验证输入数据
	if (DIAGNOSTIC_MODE.ENABLED) {
		validateClipperData(subject, '并集运算-subject');
		validateClipperData(clip, '并集运算-clip');
	}

	try {
		const subjectShape = toShape(subject, true);
		const clipShape = toShape(clip, true);

		const resultShape = subjectShape.union(clipShape);
		const result = fromShape(resultShape);

		endTimer('clipper_union', 'Clipper并集运算成功: ');
		diagnosticLog(`并集运算成功: ${result.length} 个结果多边形`);

		return result;
	}
	catch (error) {
		endTimer('clipper_union', 'Clipper并集运算失败: ');
		diagnosticLog('并集运算失败:', error);
		return subject;
	}
}

// 执行多边形交集运算
export function intersection(subject: Polygons, clip: Polygons): Polygons {
	startTimer('clipper_intersection');
	diagnosticLog(`Clipper交集运算开始: subject=${subject.length}, clip=${clip.length}`);

	if (subject.length === 0 || clip.length === 0) {
		endTimer('clipper_intersection', 'Clipper交集运算（空输入）: ');
		return [];
	}

	// 验证输入数据
	if (DIAGNOSTIC_MODE.ENABLED) {
		validateClipperData(subject, '交集运算-subject');
		validateClipperData(clip, '交集运算-clip');
	}

	try {
		const subjectShape = toShape(subject, true);
		const clipShape = toShape(clip, true);

		const resultShape = subjectShape.intersect(clipShape);
		const result = fromShape(resultShape);

		endTimer('clipper_intersection', 'Clipper交集运算成功: ');
		diagnosticLog(`交集运算成功: ${result.length} 个结果多边形`);

		return result;
	}
	catch (error) {
		endTimer('clipper_intersection', 'Clipper交集运算失败: ');
		diagnosticLog('交集运算失败:', error);
		return [];
	}
}

// 将矩形区域转换为多边形
export function rectToPolygon(x: number, y: number, width: number, height: number): Polygon {
	diagnosticLog(`矩形转多边形: (${x}, ${y}) ${width}x${height}`);
	return [
		{ x, y },
		{ x: x + width, y },
		{ x: x + width, y: y + height },
		{ x, y: y + height },
	];
}

// 清理无效多边形
export function cleanPolygons(polygons: Polygons): Polygons {
	diagnosticLog(`清理多边形: ${polygons.length} 个输入`);
	const result = polygons.filter(polygon => polygon.length >= 3);
	diagnosticLog(`清理后: ${result.length} 个有效多边形`);
	return result;
}

// 将圆弧转换为多边形（高细分度以提高精度）
export function arcToPolygon(
	startX: number,
	startY: number,
	endX: number,
	endY: number,
	arcAngle: number,
	segments: number = 32,
): Polygon {
	if (arcAngle === 0) {
		diagnosticLog('圆弧角度为0，返回空数组');
		return [];
	}

	diagnosticLog(`圆弧转多边形: (${startX},${startY}) -> (${endX},${endY}) 角度=${arcAngle} 段数=${segments}`);

	// 计算圆心和半径
	const dx = endX - startX;
	const dy = endY - startY;
	const d = Math.sqrt(dx * dx + dy * dy);
	if (d === 0) {
		diagnosticLog('圆弧起点终点重合，返回空数组');
		return [];
	}

	const angleRad = (arcAngle * Math.PI) / 180;
	const radius = Math.abs(d / (2 * Math.sin(angleRad / 2)));

	// 中点
	const midX = (startX + endX) / 2;
	const midY = (startY + endY) / 2;

	// 垂直向量
	const h = d / (2 * Math.tan(angleRad / 2));
	const nx = -(endY - startY) / d;
	const ny = (endX - startX) / d;

	// 圆心
	const centerX = midX - h * nx;
	const centerY = midY - h * ny;

	// 起始角度和终止角度
	const startAngle = Math.atan2(startY - centerY, startX - centerX);
	const endAngle = startAngle + angleRad;

	// 生成圆弧上的点
	const points: Point[] = [];
	for (let i = 0; i <= segments; i++) {
		const t = i / segments;
		const angle = startAngle + (endAngle - startAngle) * t;
		points.push({
			x: centerX + radius * Math.cos(angle),
			y: centerY + radius * Math.sin(angle),
		});
	}

	diagnosticLog(`圆弧转换完成: ${points.length} 个点`);

	return points;
}

// 将线条转换为带宽度的多边形
export function lineToPolygon(x1: number, y1: number, x2: number, y2: number, width: number): Polygon {
	diagnosticLog(`线条转多边形: (${x1},${y1}) -> (${x2},${y2}) 宽度=${width}`);
	const dx = x2 - x1;
	const dy = y2 - y1;
	const len = Math.sqrt(dx * dx + dy * dy);

	if (len === 0) {
		diagnosticLog('线条长度为0，返回空数组');
		return [];
	}

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

// 计算多边形边界框
export function getPolygonBBox(polygon: Polygon): { minX: number; minY: number; maxX: number; maxY: number } | null {
	if (polygon.length === 0)
		return null;

	let minX = polygon[0].x;
	let minY = polygon[0].y;
	let maxX = polygon[0].x;
	let maxY = polygon[0].y;

	for (const point of polygon) {
		minX = Math.min(minX, point.x);
		minY = Math.min(minY, point.y);
		maxX = Math.max(maxX, point.x);
		maxY = Math.max(maxY, point.y);
	}

	return { minX, minY, maxX, maxY };
}

// 检查两个边界框是否相交
export function bboxesIntersect(
	bbox1: { minX: number; minY: number; maxX: number; maxY: number },
	bbox2: { minX: number; minY: number; maxX: number; maxY: number },
): boolean {
	return !(bbox1.maxX < bbox2.minX
		|| bbox1.minX > bbox2.maxX
		|| bbox1.maxY < bbox2.minY
		|| bbox1.minY > bbox2.maxY);
}
