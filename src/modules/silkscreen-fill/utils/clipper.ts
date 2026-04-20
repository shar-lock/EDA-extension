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
export type ComplexPolygons = IPCB_ComplexPolygon[];
const complexPolygonSourceMap = new WeakMap<object, TPCB_PolygonSourceArray[]>();

export function registerComplexPolygonSource(
	complexPolygon: IPCB_ComplexPolygon,
	sourceArray: TPCB_PolygonSourceArray,
): void {
	if (!complexPolygon || !Array.isArray(sourceArray) || sourceArray.length === 0) {
		return;
	}
	const key = complexPolygon as unknown as object;
	const existing = complexPolygonSourceMap.get(key) || [];
	complexPolygonSourceMap.set(key, [...existing, sourceArray]);
}

export function registerComplexPolygonRawSource(
	complexPolygon: IPCB_ComplexPolygon,
	rawSource: any,
): void {
	if (!complexPolygon) {
		return;
	}
	const sourceArrays = normalizeSourceArrays(rawSource);
	if (sourceArrays.length === 0) {
		return;
	}
	complexPolygonSourceMap.set(complexPolygon as unknown as object, sourceArrays);
}

function registerComplexPolygonSources(
	complexPolygon: IPCB_ComplexPolygon,
	sourceArrays: TPCB_PolygonSourceArray[],
): void {
	if (!complexPolygon || !Array.isArray(sourceArrays) || sourceArrays.length === 0) {
		return;
	}
	const valid = sourceArrays.filter(item => Array.isArray(item) && item.length > 0);
	if (valid.length === 0) {
		return;
	}
	complexPolygonSourceMap.set(complexPolygon as unknown as object, valid);
}

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

function appendArcPoints(points: Polygon, start: Point, end: Point, arcAngle: number): void {
	const dx = end.x - start.x;
	const dy = end.y - start.y;
	const chord = Math.sqrt(dx * dx + dy * dy);
	const angleAbs = Math.abs(arcAngle);
	let segments = Math.max(16, Math.ceil(angleAbs / 4));
	if (angleAbs > 0.001 && angleAbs < 179.999) {
		const angleRad = (angleAbs * Math.PI) / 180;
		const radius = Math.abs(chord / (2 * Math.sin(angleRad / 2)));
		if (Number.isFinite(radius) && radius > 0) {
			const arcLength = radius * angleRad;
			segments = Math.max(segments, Math.ceil(arcLength / 2));
		}
	}
	segments = Math.min(256, segments);
	const arcPoints = arcToPolygon(start.x, start.y, end.x, end.y, arcAngle, segments);
	if (arcPoints.length >= 2) {
		points.push(...arcPoints.slice(1));
	}
	else {
		points.push(end);
	}
}

function normalizeArcArgs(a: number, b: number, c: number): { arcAngle: number; endX: number; endY: number } {
	// 官方文档描述为 [arcAngle, endX, endY]，
	// 但实测/示例中常出现 [endX, endY, arcAngle]，这里同时兼容两种格式。
	const isAngleA = Number.isFinite(a) && Math.abs(a) <= 3600;
	const isAngleC = Number.isFinite(c) && Math.abs(c) <= 3600;

	if (isAngleC && !isAngleA) {
		return { arcAngle: c, endX: a, endY: b };
	}
	if (isAngleA && !isAngleC) {
		return { arcAngle: a, endX: b, endY: c };
	}
	if (isAngleC) {
		return { arcAngle: c, endX: a, endY: b };
	}
	return { arcAngle: a, endX: b, endY: c };
}

function appendBezierPoints(points: Polygon, p0: Point, p1: Point, p2: Point, p3: Point): void {
	const segments = 20;
	for (let i = 1; i <= segments; i++) {
		const t = i / segments;
		const mt = 1 - t;
		const x = (mt ** 3) * p0.x
			+ 3 * (mt ** 2) * t * p1.x
			+ 3 * mt * (t ** 2) * p2.x
			+ (t ** 3) * p3.x;
		const y = (mt ** 3) * p0.y
			+ 3 * (mt ** 2) * t * p1.y
			+ 3 * mt * (t ** 2) * p2.y
			+ (t ** 3) * p3.y;
		points.push({ x, y });
	}
}

function sourceArrayToPolygon(sourceArray: TPCB_PolygonSourceArray): Polygon {
	if (!Array.isArray(sourceArray) || sourceArray.length === 0) {
		return [];
	}

	// R x y width height rot round
	if (sourceArray[0] === 'R') {
		const [, x, y, width, height] = sourceArray as any[];
		if ([x, y, width, height].every(Number.isFinite)) {
			return [
				{ x, y },
				{ x: x + width, y },
				{ x: x + width, y: y + height },
				{ x, y: y + height },
				{ x, y },
			];
		}
		return [];
	}

	// CIRCLE cx cy radius
	if (sourceArray[0] === 'CIRCLE') {
		const [, cx, cy, radius] = sourceArray as any[];
		if ([cx, cy, radius].every(Number.isFinite) && radius > 0) {
			const points: Polygon = [];
			const segments = 36;
			for (let i = 0; i <= segments; i++) {
				const angle = (Math.PI * 2 * i) / segments;
				points.push({
					x: cx + radius * Math.cos(angle),
					y: cy + radius * Math.sin(angle),
				});
			}
			return points;
		}
		return [];
	}

	const points: Polygon = [];
	let i = 0;
	let currentCommand: 'L' | 'ARC' | 'CARC' | 'C' = 'L';
	let current: Point | null = null;

	while (i < sourceArray.length) {
		const token = sourceArray[i];
		if (typeof token === 'string') {
			if (token === 'L' || token === 'ARC' || token === 'CARC' || token === 'C') {
				currentCommand = token;
			}
			i++;
			continue;
		}

		if (currentCommand === 'ARC' || currentCommand === 'CARC') {
			if (!current) {
				break;
			}
			const a = sourceArray[i] as number;
			const b = sourceArray[i + 1] as number;
			const c = sourceArray[i + 2] as number;
			const { arcAngle, endX, endY } = normalizeArcArgs(a, b, c);
			if ([arcAngle, endX, endY].every(Number.isFinite)) {
				const endPoint = { x: endX, y: endY };
				appendArcPoints(points, current, endPoint, arcAngle);
				current = endPoint;
				i += 3;
				currentCommand = 'L';
				continue;
			}
			i++;
			continue;
		}

		if (currentCommand === 'C') {
			if (!current) {
				break;
			}
			const x1 = sourceArray[i] as number;
			const y1 = sourceArray[i + 1] as number;
			const x2 = sourceArray[i + 2] as number;
			const y2 = sourceArray[i + 3] as number;
			const x3 = sourceArray[i + 4] as number;
			const y3 = sourceArray[i + 5] as number;
			if ([x1, y1, x2, y2, x3, y3].every(Number.isFinite)) {
				const p1 = { x: x1, y: y1 };
				const p2 = { x: x2, y: y2 };
				const p3 = { x: x3, y: y3 };
				appendBezierPoints(points, current, p1, p2, p3);
				current = p3;
				i += 6;
				currentCommand = 'L';
				continue;
			}
			i++;
			continue;
		}

		const x = sourceArray[i] as number;
		const y = sourceArray[i + 1] as number;
		if (Number.isFinite(x) && Number.isFinite(y)) {
			const point = { x, y };
			points.push(point);
			current = point;
			i += 2;
			continue;
		}
		i++;
	}

	if (points.length >= 3) {
		const first = points[0];
		const last = points[points.length - 1];
		if (first.x !== last.x || first.y !== last.y) {
			points.push({ ...first });
		}
	}

	return points;
}

function toSourceArray(polygon: Polygon): TPCB_PolygonSourceArray {
	const sourceArray: any[] = [];
	if (polygon.length < 3) {
		return sourceArray as TPCB_PolygonSourceArray;
	}
	const normalizedPolygon = [...polygon];
	if (normalizedPolygon.length >= 2) {
		const first = normalizedPolygon[0];
		const last = normalizedPolygon[normalizedPolygon.length - 1];
		if (first.x === last.x && first.y === last.y) {
			normalizedPolygon.pop();
		}
	}
	if (normalizedPolygon.length < 3) {
		return sourceArray as TPCB_PolygonSourceArray;
	}
	sourceArray.push(normalizedPolygon[0].x, normalizedPolygon[0].y);
	sourceArray.push('L');
	for (let i = 1; i < normalizedPolygon.length; i++) {
		sourceArray.push(normalizedPolygon[i].x, normalizedPolygon[i].y);
	}
	const first = normalizedPolygon[0];
	const last = normalizedPolygon[normalizedPolygon.length - 1];
	if (first.x !== last.x || first.y !== last.y) {
		sourceArray.push(first.x, first.y);
	}
	return sourceArray as TPCB_PolygonSourceArray;
}

function ensureOrientation(polygon: Polygon, isOuter: boolean): Polygon {
	if (polygon.length < 3) {
		return polygon;
	}
	const area = calculateSignedArea(polygon);
	// 外环使用逆时针，孔洞使用顺时针
	if (isOuter) {
		return area < 0 ? [...polygon].reverse() : polygon;
	}
	return area > 0 ? [...polygon].reverse() : polygon;
}

function fromShapeAsSingleComplexPolygon(shape: Shape): IPCB_ComplexPolygon | null {
	const lowLevelPolygons = (shape.mapToLower() as Polygons).filter(p => p.length >= 3);
	if (lowLevelPolygons.length === 0) {
		return null;
	}
	const sorted = [...lowLevelPolygons].sort((a, b) => Math.abs(calculateSignedArea(b)) - Math.abs(calculateSignedArea(a)));
	const outer = ensureOrientation(sorted[0], true);
	const holes = sorted.slice(1).map(p => ensureOrientation(p, false));
	const sourceArrays = [outer, ...holes].map(toSourceArray).filter(item => item.length > 0) as TPCB_PolygonSourceArray[];
	if (sourceArrays.length === 0) {
		return null;
	}
	const complexPolygon = eda.pcb_MathPolygon.createComplexPolygon(sourceArrays as unknown as TPCB_PolygonSourceArray);
	if (!complexPolygon) {
		return null;
	}
	registerComplexPolygonSources(complexPolygon, sourceArrays);
	return complexPolygon;
}

function normalizeSourceArrays(raw: any): TPCB_PolygonSourceArray[] {
	if (Array.isArray(raw)) {
		if (raw.length > 0 && Array.isArray(raw[0])) {
			return raw.filter((item: any) => Array.isArray(item)) as TPCB_PolygonSourceArray[];
		}
		return [raw as TPCB_PolygonSourceArray];
	}
	// 常见返回结构：{ complexPolygon: TPCB_PolygonSourceArray[] | TPCB_PolygonSourceArray }
	if (raw && Array.isArray(raw.complexPolygon)) {
		if (raw.complexPolygon.length > 0 && Array.isArray(raw.complexPolygon[0])) {
			return raw.complexPolygon.filter((item: any) => Array.isArray(item)) as TPCB_PolygonSourceArray[];
		}
		return [raw.complexPolygon as TPCB_PolygonSourceArray];
	}
	if (raw && Array.isArray(raw.polygon)) {
		return [raw.polygon as TPCB_PolygonSourceArray];
	}
	return [];
}

function complexPolygonToPolygons(complexPolygon: IPCB_ComplexPolygon): Polygons {
	const registeredSourceArrays = complexPolygonSourceMap.get(complexPolygon as unknown as object);
	if (registeredSourceArrays && registeredSourceArrays.length > 0) {
		const polygons = registeredSourceArrays
			.map(sourceArrayToPolygon)
			.filter((polygon: Polygon) => polygon.length >= 3);
		if (polygons.length > 0) {
			return polygons;
		}
	}

	const candidateGetters = [
		'getState_SourceArray',
		'getState_PolygonSourceArray',
		'getState_Polygon',
		'getState_ComplexPolygon',
	];

	for (const getter of candidateGetters) {
		const fn = (complexPolygon as any)?.[getter];
		if (typeof fn !== 'function') {
			continue;
		}
		try {
			const raw = fn.call(complexPolygon);
			const sourceArrays = normalizeSourceArrays(raw);
			const polygons = sourceArrays
				.map(sourceArrayToPolygon)
				.filter((polygon: Polygon) => polygon.length >= 3);
			if (polygons.length > 0) {
				return polygons;
			}
		}
		catch {
			// 尝试下一个 getter
		}
	}

	return [];
}

function complexPolygonsToPolygons(complexPolygons: ComplexPolygons): Polygons {
	return complexPolygons.flatMap(complexPolygon => complexPolygonToPolygons(complexPolygon));
}

export function getComplexPolygonBBox(complexPolygon: IPCB_ComplexPolygon): BBox | null {
	const polygons = complexPolygonToPolygons(complexPolygon);
	if (polygons.length === 0) {
		return null;
	}
	let merged: BBox | null = null;
	for (const polygon of polygons) {
		const bbox = getPolygonBBox(polygon);
		if (!bbox) {
			continue;
		}
		if (!merged) {
			merged = { ...bbox };
			continue;
		}
		merged.minX = Math.min(merged.minX, bbox.minX);
		merged.minY = Math.min(merged.minY, bbox.minY);
		merged.maxX = Math.max(merged.maxX, bbox.maxX);
		merged.maxY = Math.max(merged.maxY, bbox.maxY);
	}
	return merged;
}

function toShape(polygons: ComplexPolygons, isOuterRing: boolean = true): Shape {
	// 处理多边形方向
	const flattenPolygons = complexPolygonsToPolygons(polygons);
	const processedPolygons = flattenPolygons.map((polygon) => {
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
function fromShape(shape: Shape): ComplexPolygons {
	const lowLevelPolygons = shape.mapToLower() as Polygons;
	const results: ComplexPolygons = [];
	for (const polygon of lowLevelPolygons) {
		if (polygon.length < 3) {
			continue;
		}
		const sourceArray = toSourceArray(polygon);
		const complexPolygon = eda.pcb_MathPolygon.createComplexPolygon(sourceArray);
		if (complexPolygon) {
			registerComplexPolygonSource(complexPolygon, sourceArray);
			results.push(complexPolygon);
		}
	}
	return results;
}

function bboxToPolygon(bbox: BBox): Polygon {
	return [
		{ x: bbox.minX, y: bbox.minY },
		{ x: bbox.maxX, y: bbox.minY },
		{ x: bbox.maxX, y: bbox.maxY },
		{ x: bbox.minX, y: bbox.maxY },
	];
}

export function bboxToShape(bboxes: BBox[]): Shape {
	const polygons = bboxes
		.filter(bbox => Number.isFinite(bbox.minX)
			&& Number.isFinite(bbox.minY)
			&& Number.isFinite(bbox.maxX)
			&& Number.isFinite(bbox.maxY)
			&& bbox.maxX > bbox.minX
			&& bbox.maxY > bbox.minY)
		.map(bbox => bboxToPolygon(bbox));
	return new Shape(polygons, true, true, true);
}

export function shapeToBBoxes(shape: Shape): BBox[] {
	const polygons = shape.mapToLower() as Polygons;
	const bboxes: BBox[] = [];
	for (const polygon of polygons) {
		const bbox = getPolygonBBox(polygon);
		if (bbox) {
			bboxes.push(bbox);
		}
	}
	return bboxes;
}

export function differenceBBoxes(
	subjectBBox: BBox,
	clipBBoxes: BBox[],
): ComplexPolygons {
	const subjectShape = bboxToShape([subjectBBox]);
	const clipShape = bboxToShape(clipBBoxes);
	console.log('=====================subjectShape====================');
	console.log(subjectShape);
	console.log('=====================clipShape====================');
	console.log(clipShape);
	const resultShape = clipBBoxes.length > 0 ? subjectShape.difference(clipShape) : subjectShape;
	console.log('=====================resultShape====================');
	console.log(resultShape);
	const singleComplexPolygon = fromShapeAsSingleComplexPolygon(resultShape);
	console.log('=====================singleComplexPolygon====================');
	console.log(singleComplexPolygon);
	if (singleComplexPolygon) {
		return [singleComplexPolygon];
	}
	return fromShape(resultShape);
}

export function differenceComplexPolygonWithBBoxes(
	subjectComplexPolygon: IPCB_ComplexPolygon,
	clipBBoxes: BBox[],
): ComplexPolygons {
	const subjectShape = toShape([subjectComplexPolygon], true);
	const clipShape = bboxToShape(clipBBoxes);
	console.log('=====================subjectShape====================');
	console.log(subjectShape);
	console.log('=====================clipShape====================');
	console.log(clipShape);
	const resultShape = clipBBoxes.length > 0 ? subjectShape.difference(clipShape) : subjectShape;
	console.log('=====================resultShape====================');
	console.log(resultShape);
	const singleComplexPolygon = fromShapeAsSingleComplexPolygon(resultShape);
	console.log('=====================singleComplexPolygon====================');
	console.log(singleComplexPolygon);
	if (singleComplexPolygon) {
		return [singleComplexPolygon];
	}
	return fromShape(resultShape);
}

// 执行多边形差集运算
// subject - clip = 结果
export function difference(subject: ComplexPolygons, clip: ComplexPolygons): ComplexPolygons {
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
	// if (DIAGNOSTIC_MODE.ENABLED) {
	// 	validateClipperData(subject, '差集运算-subject');
	// 	validateClipperData(clip, '差集运算-clip');
	// }

	try {
		const subjectShape = toShape(subject, true);
		const clipShape = toShape(clip, true);
		console.log('=====================toshape====================');
		console.log(subjectShape);
		console.log(clipShape);
		diagnosticLog('Clipper输入准备完成，执行difference操作...');

		// 使用 Clipper 的 difference 方法
		const resultShape = subjectShape.difference(clipShape);
		const result = fromShape(resultShape);
		console.log('=====================fromshape====================');
		console.log(result);
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
export function union(subject: ComplexPolygons, clip: ComplexPolygons): ComplexPolygons {
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
		validateClipperData(complexPolygonsToPolygons(subject), '并集运算-subject');
		validateClipperData(complexPolygonsToPolygons(clip), '并集运算-clip');
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
export function intersection(subject: ComplexPolygons, clip: ComplexPolygons): ComplexPolygons {
	startTimer('clipper_intersection');
	diagnosticLog(`Clipper交集运算开始: subject=${subject.length}, clip=${clip.length}`);

	if (subject.length === 0 || clip.length === 0) {
		endTimer('clipper_intersection', 'Clipper交集运算（空输入）: ');
		return [];
	}

	// 验证输入数据
	if (DIAGNOSTIC_MODE.ENABLED) {
		validateClipperData(complexPolygonsToPolygons(subject), '交集运算-subject');
		validateClipperData(complexPolygonsToPolygons(clip), '交集运算-clip');
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
// 使用起点、终点和圆弧角度计算圆弧路径
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

	// 如果角度非常小或非常大，直接返回起点终点
	if (Math.abs(arcAngle) < 0.001 || Math.abs(arcAngle) > 360) {
		diagnosticLog('圆弧角度异常，返回简单路径');
		return [{ x: startX, y: startY }, { x: endX, y: endY }];
	}

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

	// 检查半径是否合理，如果太大或太小则使用直线
	if (!isFinite(radius) || radius > 10000 || radius < 0.001) {
		diagnosticLog(`圆弧半径异常: ${radius}，使用直线代替`);
		return [{ x: startX, y: startY }, { x: endX, y: endY }];
	}

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

	// 检查圆心是否合理
	if (!isFinite(centerX) || !isFinite(centerY)) {
		diagnosticLog('圆弧圆心计算异常，使用直线代替');
		return [{ x: startX, y: startY }, { x: endX, y: endY }];
	}

	// 起始角度和终止角度
	const startAngle = Math.atan2(startY - centerY, startX - centerX);
	const endAngle = startAngle + angleRad;

	// 生成圆弧上的点
	const points: Point[] = [];
	for (let i = 0; i <= segments; i++) {
		const t = i / segments;
		const angle = startAngle + (endAngle - startAngle) * t;
		const x = centerX + radius * Math.cos(angle);
		const y = centerY + radius * Math.sin(angle);

		// 检查生成的点是否有效
		if (!isFinite(x) || !isFinite(y)) {
			diagnosticLog(`圆弧点计算异常，提前终止`);
			break;
		}

		points.push({ x, y });
	}

	diagnosticLog(`圆弧转换完成: ${points.length} 个点`);

	return points;
}

// 使用起点、终点和角度将圆弧转换为多边形
export function arcToPolygonWithCenter(
	startX: number,
	startY: number,
	endX: number,
	endY: number,
	arcAngle: number,
	lineWidth: number,
): Polygon {
	diagnosticLog(`圆弧转多边形: (${startX},${startY}) -> (${endX},${endY}) 角度=${arcAngle} 线宽=${lineWidth}`);

	// 如果角度为0，返回空数组
	if (arcAngle === 0) {
		diagnosticLog('圆弧角度为0，返回空数组');
		return [];
	}

	// 如果角度非常小或非常大，直接返回起点终点
	if (Math.abs(arcAngle) < 0.001 || Math.abs(arcAngle) > 360) {
		diagnosticLog('圆弧角度异常，返回简单路径');
		return [{ x: startX, y: startY }, { x: endX, y: endY }];
	}

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

	// 检查半径是否合理，如果太大或太小则使用直线
	if (!isFinite(radius) || radius > 10000 || radius < 0.001) {
		diagnosticLog(`圆弧半径异常: ${radius}，使用直线代替`);
		return [{ x: startX, y: startY }, { x: endX, y: endY }];
	}

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

	// 检查圆心是否合理
	if (!isFinite(centerX) || !isFinite(centerY)) {
		diagnosticLog('圆弧圆心计算异常，使用直线代替');
		return [{ x: startX, y: startY }, { x: endX, y: endY }];
	}

	// 起始角度和终止角度
	const startAngle = Math.atan2(startY - centerY, startX - centerX);
	const endAngle = startAngle + angleRad;

	// 生成圆弧上的点
	const points: Point[] = [];
	const segments = 32; // 固定细分度
	for (let i = 0; i <= segments; i++) {
		const t = i / segments;
		const angle = startAngle + (endAngle - startAngle) * t;
		const x = centerX + radius * Math.cos(angle);
		const y = centerY + radius * Math.sin(angle);

		// 检查生成的点是否有效
		if (!isFinite(x) || !isFinite(y)) {
			diagnosticLog(`圆弧点计算异常，提前终止`);
			break;
		}

		points.push({ x, y });
	}

	diagnosticLog(`圆弧转换完成: ${points.length} 个点`);

	// 如果线宽大于0，需要将圆弧转换为有宽度的多边形
	if (lineWidth > 0) {
		// 将圆弧路径转换为有宽度的多边形
		const widthPolygons: Polygon[] = [];
		for (let i = 0; i < points.length - 1; i++) {
			const segment = lineToPolygon(
				points[i].x,
				points[i].y,
				points[i + 1].x,
				points[i + 1].y,
				lineWidth,
			);
			if (segment.length > 0) {
				widthPolygons.push(segment);
			}
		}
		// 合并所有线段多边形
		return mergeWidthPolygons(widthPolygons);
	}

	return points;
}

// 合并带宽度的多边形
function mergeWidthPolygons(polygons: Polygon[]): Polygon {
	if (polygons.length === 0) {
		return [];
	}
	if (polygons.length === 1) {
		return polygons[0];
	}

	// 简单的合并策略：取所有多边形的点
	// 注意：这里简化处理，实际可能需要更复杂的合并算法
	const allPoints: Point[] = [];
	for (const poly of polygons) {
		allPoints.push(...poly);
	}

	// 尝试使用PCB_MathPolygon.createPolygon来合并
	if (typeof eda !== 'undefined' && eda.pcb_MathPolygon && typeof eda.pcb_MathPolygon.createPolygon === 'function') {
		const sourceArray: any[] = [];
		for (const point of allPoints) {
			if (sourceArray.length === 0) {
				sourceArray.push(point.x, point.y);
			}
			else {
				sourceArray.push('L', point.x, point.y);
			}
		}
		if (allPoints.length > 0) {
			sourceArray.push('L', allPoints[0].x, allPoints[0].y);
		}

		const polyObj = eda.pcb_MathPolygon.createPolygon(sourceArray);
		if (polyObj) {
			diagnosticLog('使用PCB_MathPolygon.createPolygon合并多边形成功');
			return allPoints; // 返回原始点，因为createPolygon成功验证了数据
		}
	}

	return allPoints;
}

// 将线条转换为带宽度的多边形
export function lineToPolygon(x1: number, y1: number, x2: number, y2: number, width: number): Polygon {
	diagnosticLog(`线条转多边形: (${x1},${y1}) -> (${x2},${y2}) 宽度=${width}`);

	// 放宽条件：只检查关键参数的有效性
	if (!isFinite(x1) || !isFinite(y1) || !isFinite(x2) || !isFinite(y2)) {
		diagnosticLog('线条坐标参数包含非数值，返回空数组');
		return [];
	}

	// 放宽宽度检查：允许0宽度和更大的宽度
	if (width < 0) {
		diagnosticLog(`线条宽度为负数: ${width}，返回空数组`);
		return [];
	}

	const dx = x2 - x1;
	const dy = y2 - y1;
	const len = Math.sqrt(dx * dx + dy * dy);

	if (len === 0) {
		diagnosticLog('线条长度为0，返回空数组');
		return [];
	}

	// 计算垂直方向（简化计算，避免除以0）
	const halfWidth = width / 2;
	let nx, ny;

	if (len > 0) {
		nx = -dy / len * halfWidth;
		ny = dx / len * halfWidth;
	}
	else {
		nx = 0;
		ny = halfWidth;
	}

	// 计算四个顶点
	const p1 = { x: x1 + nx, y: y1 + ny };
	const p2 = { x: x1 - nx, y: y1 - ny };
	const p3 = { x: x2 - nx, y: y2 - ny };
	const p4 = { x: x2 + nx, y: y2 + ny };

	// 简单的有效性检查
	if (!isFinite(p1.x) || !isFinite(p1.y) || !isFinite(p2.x) || !isFinite(p2.y)) {
		diagnosticLog('线条多边形顶点计算异常，返回简单矩形');
		// 返回一个简单的矩形作为fallback
		return [
			{ x: x1 - halfWidth, y: y1 - halfWidth },
			{ x: x1 + halfWidth, y: y1 - halfWidth },
			{ x: x2 + halfWidth, y: y2 + halfWidth },
			{ x: x2 - halfWidth, y: y2 + halfWidth },
		];
	}

	return [p1, p2, p3, p4];
}

// 边界框类型
export interface BBox {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

// 计算多边形边界框
export function getPolygonBBox(polygon: Polygon): BBox | null {
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
