/**
 * Clipper 布尔运算工具模块
 *
 * 使用 @doodle3d/clipper-js 库进行多边形的布尔运算
 */

import Shape from '@doodle3d/clipper-js';

export interface Point {
	x: number;
	y: number;
}

export type Polygon = Point[];
export type Polygons = Polygon[];

/**
 * 将 Polygons 转换为 Clipper Shape
 */
function toShape(polygons: Polygons): Shape {
	// Shape 构造函数支持 PointLower 格式 {x, y}
	return new Shape(polygons, true, true, true);
}

/**
 * 将 Clipper Shape 转换为 Polygons
 */
function fromShape(shape: Shape): Polygons {
	// mapToLower 返回 {x, y} 格式
	return shape.mapToLower() as Polygons;
}

/**
 * 执行多边形差集运算
 * @param subject 被减数多边形数组
 * @param clip 减数多边形数组
 * @returns 差集运算结果
 */
export function difference(subject: Polygons, clip: Polygons): Polygons {
	if (subject.length === 0)
		return [];
	if (clip.length === 0)
		return subject;

	const subjectShape = toShape(subject);
	const clipShape = toShape(clip);

	const resultShape = subjectShape.difference(clipShape);
	return fromShape(resultShape);
}

/**
 * 执行多边形并集运算
 * @param subject 多边形数组1
 * @param clip 多边形数组2
 * @returns 并集运算结果
 */
export function union(subject: Polygons, clip: Polygons): Polygons {
	if (subject.length === 0)
		return clip;
	if (clip.length === 0)
		return subject;

	const subjectShape = toShape(subject);
	const clipShape = toShape(clip);

	const resultShape = subjectShape.union(clipShape);
	return fromShape(resultShape);
}

/**
 * 执行多边形交集运算
 * @param subject 多边形数组1
 * @param clip 多边形数组2
 * @returns 交集运算结果
 */
export function intersection(subject: Polygons, clip: Polygons): Polygons {
	if (subject.length === 0 || clip.length === 0)
		return [];

	const subjectShape = toShape(subject);
	const clipShape = toShape(clip);

	const resultShape = subjectShape.intersect(clipShape);
	return fromShape(resultShape);
}

/**
 * 将矩形区域转换为多边形
 * @param x 左上角X坐标
 * @param y 左上角Y坐标
 * @param width 宽度
 * @param height 高度
 * @returns 矩形多边形
 */
export function rectToPolygon(x: number, y: number, width: number, height: number): Polygon {
	return [
		{ x, y },
		{ x: x + width, y },
		{ x: x + width, y: y + height },
		{ x, y: y + height },
	];
}

/**
 * 清理空多边形
 */
export function cleanPolygons(polygons: Polygons): Polygons {
	return polygons.filter(polygon => polygon.length >= 3);
}
