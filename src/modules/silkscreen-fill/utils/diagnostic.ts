/**
 * 诊断模式工具模块
 *
 * 提供超级详细日志、可视化调试和性能分析功能
 */

import type { Polygon, Polygons } from './clipper';

// 诊断模式开关
export const DIAGNOSTIC_MODE = {
	ENABLED: true,
	VERBOSE: true, // 超级详细日志
	PERFORMANCE: true, // 性能分析
	VISUALIZE: false, // 可视化调试（需要手动实现）
};

// 性能计时器
const timers: Map<string, number> = new Map();

/**
 * 开始计时
 */
export function startTimer(label: string): void {
	if (!DIAGNOSTIC_MODE.PERFORMANCE)
		return;
	timers.set(label, performance.now());
}

/**
 * 结束计时并输出
 */
export function endTimer(label: string, prefix: string = ''): void {
	if (!DIAGNOSTIC_MODE.PERFORMANCE)
		return;

	const startTime = timers.get(label);
	if (startTime) {
		const duration = performance.now() - startTime;
		timers.delete(label);
		diagnosticLog(`${prefix}${label}: ${duration.toFixed(2)}ms`);
	}
}

/**
 * 诊断日志（带时间戳）
 */
export function diagnosticLog(...args: any[]): void {
	if (!DIAGNOSTIC_MODE.ENABLED)
		return;

	const timestamp = new Date().toISOString();
	const prefix = `[DIAG ${timestamp}] `;

	if (DIAGNOSTIC_MODE.VERBOSE) {
		// 详细模式输出完整信息
		console.log(prefix, ...args);
	}
	else {
		// 简洁模式只输出关键信息
		if (args.length > 0 && typeof args[0] === 'string') {
			const msg = args[0];
			if (msg.includes('完成') || msg.includes('成功') || msg.includes('失败')) {
				console.log(prefix, ...args);
			}
		}
	}
}

/**
 * 调试日志（始终输出）
 */
export function debugLog(...args: any[]): void {
	if (!DIAGNOSTIC_MODE.ENABLED)
		return;

	const timestamp = new Date().toISOString();
	console.warn(`[DEBUG ${timestamp}]`, ...args);
}

/**
 * 日志多边形信息
 */
export function logPolygonInfo(polygon: Polygon, name: string = '多边形'): void {
	if (!DIAGNOSTIC_MODE.VERBOSE)
		return;

	const area = calculatePolygonArea(polygon);
	const perimeter = calculatePolygonPerimeter(polygon);
	const bbox = getPolygonBBox(polygon);

	diagnosticLog(`${name}信息:`, {
		点数: polygon.length,
		面积: area.toFixed(2),
		周长: perimeter.toFixed(2),
		边界框: bbox,
		坐标: polygon.slice(0, 5), // 只显示前5个点避免日志过长
	});
}

/**
 * 日志多边形数组信息
 */
export function logPolygonsInfo(polygons: Polygons, name: string = '多边形数组'): void {
	if (!DIAGNOSTIC_MODE.VERBOSE)
		return;

	diagnosticLog(`${name}: ${polygons.length} 个多边形`);

	if (polygons.length > 0 && polygons.length <= 10) {
		polygons.forEach((poly, index) => {
			logPolygonInfo(poly, `${name}[${index}]`);
		});
	}
	else if (polygons.length > 10) {
		// 超过10个只显示前几个
		polygons.slice(0, 3).forEach((poly, index) => {
			logPolygonInfo(poly, `${name}[${index}]`);
		});
		diagnosticLog(`... 还有 ${polygons.length - 3} 个多边形未显示`);
	}
}

/**
 * 计算多边形面积（带符号）
 */
function calculatePolygonArea(polygon: Polygon): number {
	if (polygon.length < 3)
		return 0;

	let area = 0;
	for (let i = 0; i < polygon.length; i++) {
		const j = (i + 1) % polygon.length;
		area += polygon[i].x * polygon[j].y - polygon[j].x * polygon[i].y;
	}

	return Math.abs(area) / 2;
}

/**
 * 计算多边形周长
 */
function calculatePolygonPerimeter(polygon: Polygon): number {
	if (polygon.length < 2)
		return 0;

	let perimeter = 0;
	for (let i = 0; i < polygon.length; i++) {
		const j = (i + 1) % polygon.length;
		const dx = polygon[j].x - polygon[i].x;
		const dy = polygon[j].y - polygon[i].y;
		perimeter += Math.sqrt(dx * dx + dy * dy);
	}

	return perimeter;
}

/**
 * 计算多边形边界框
 */
function getPolygonBBox(polygon: Polygon): { minX: number; minY: number; maxX: number; maxY: number } | null {
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

/**
 * 导出调试数据到JSON
 */
export function exportDebugData(data: any, filename: string = 'debug-data'): void {
	if (!DIAGNOSTIC_MODE.ENABLED)
		return;

	// 创建可下载的JSON文件
	const jsonString = JSON.stringify(data, null, 2);
	const blob = new Blob([jsonString], { type: 'application/json' });
	const url = URL.createObjectURL(blob);

	// 创建临时下载链接
	const link = document.createElement('a');
	link.href = url;
	link.download = `${filename}-${Date.now()}.json`;
	link.click();

	URL.revokeObjectURL(url);
}

/**
 * 验证Clipper多边形数据
 * 注意：由lineToPolygon生成的线段多边形不需要闭合，这是正常现象
 */
export function validateClipperData(polygons: Polygons, name: string = 'Clipper数据'): boolean {
	if (!DIAGNOSTIC_MODE.ENABLED)
		return true;

	let isValid = true;
	let closedCount = 0;
	let unclosedCount = 0;

	for (let i = 0; i < polygons.length; i++) {
		const polygon = polygons[i];

		// 检查点数
		if (polygon.length < 3) {
			diagnosticLog(`${name}[${i}] 点数不足: ${polygon.length}`);
			isValid = false;
		}

		// 检查坐标有效性
		for (let j = 0; j < polygon.length; j++) {
			const point = polygon[j];
			if (!isFinite(point.x) || !isFinite(point.y)) {
				diagnosticLog(`${name}[${i}][${j}] 无效坐标: (${point.x}, ${point.y})`);
				isValid = false;
			}
		}

		// 统计闭合状态（仅用于信息，不视为错误）
		if (polygon.length > 3) {
			const first = polygon[0];
			const last = polygon[polygon.length - 1];
			const isClosed = Math.abs(first.x - last.x) < 0.001 && Math.abs(first.y - last.y) < 0.001;
			if (isClosed) {
				closedCount++;
			} else {
				unclosedCount++;
			}
		}
	}

	// 记录闭合状态统计（仅信息级别）
	if (closedCount > 0 || unclosedCount > 0) {
		diagnosticLog(`${name} 闭合状态: ${closedCount} 个闭合, ${unclosedCount} 个未闭合`);
		// 只有当大部分多边形都未闭合时才警告
		if (unclosedCount > closedCount * 3 && closedCount > 0) {
			diagnosticLog(`警告: ${name} 中大部分多边形未闭合，可能影响布尔运算结果`);
		}
	}

	return isValid;
}

/**
 * 捕获并记录错误
 */
export function captureError(error: any, context: string = ''): void {
	if (!DIAGNOSTIC_MODE.ENABLED)
		return;

	diagnosticLog(`错误捕获${context ? ` - ${context}` : ''}:`, {
		message: error instanceof Error ? error.message : error,
		stack: error instanceof Error ? error.stack : '',
	});
}

/**
 * 记录API调用
 */
export function logAPICall(apiName: string, params: any[]): void {
	if (!DIAGNOSTIC_MODE.VERBOSE)
		return;

	diagnosticLog(`API调用: ${apiName}`, '参数:', params);
}

/**
 * 记录API返回
 */
export function logAPIReturn(apiName: string, result: any): void {
	if (!DIAGNOSTIC_MODE.VERBOSE)
		return;

	diagnosticLog(`API返回: ${apiName}`, '结果:', result);
}
