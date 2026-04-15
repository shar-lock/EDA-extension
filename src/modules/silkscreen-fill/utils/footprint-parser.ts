/**
 * 封装源码解析器
 *
 * 解析 EasyEDA Pro 封装文档源码格式（elibu文件）
 * elibu格式：每行包含两个JSON对象，通过||分隔
 * 外层：{"type":"TYPE","ticket":N,"id":"ID"}
 * 内层：{...实际几何数据...}
 */

// 引入JSZip
import JSZip from 'jszip';

// 封装数据缓存
const footprintCache = new Map();

/**
 * 解析封装文件（elibz2 格式，是一个 zip 压缩包）
 * @param file - 封装文件
 * @param footprintUuid - 要获取的封装 UUID
 * @returns 解析后的封装数据
 */
export async function parseFootprintFile(
	file: File | Blob,
	footprintUuid: string,
): Promise<any | null> {
	if (!file) {
		console.warn('[FootprintParser] No file provided');
		return null;
	}

	try {
		// 1. 使用 JSZip 解压 elibz2 文件
		const zip = await JSZip.loadAsync(file);

		// 2. 查找 elibu 文件（实际几何数据在这里）
		let elibuFile = null;
		for (const [fileName, fileEntry] of Object.entries(zip.files)) {
			if (!fileEntry.dir && fileName.endsWith('.elibu')) {
				elibuFile = fileEntry;
				console.log('[FootprintParser] Found elibu:', fileName);
				break;
			}
		}

		if (!elibuFile) {
			console.warn('[FootprintParser] No elibu file found');
			return null;
		}

		// 3. 读取 elibu 文件内容
		const elibuContent = await elibuFile.async('text');

		// 4. 输出elibu文件内容供分析
		const lines = elibuContent.split(/\r?\n/).filter(line => line.trim().length > 0);
		console.log('[FootprintParser] ========== ELIBU Content (first 10 lines) ==========');
		for (let i = 0; i < Math.min(10, lines.length); i++) {
			console.log(`Line ${i} (len=${lines[i].length}):`, lines[i]);
		}
		console.log('[FootprintParser] ========== Total lines:', lines.length, '==========');

		// 5. 解析 elibu 文件
		const footprintData = parseElibuContent(elibuContent);

		if (footprintData) {
			console.log('[FootprintParser] Parsed:', footprintData.pads.length, 'pads,', footprintData.silkScreen.length, 'shapes');
		}

		return footprintData;
	}
	catch (err) {
		console.error('[FootprintParser] Parse failed:', err);
		return null;
	}
}

/**
 * 封装数据
 */
export interface FootprintData {
	canvas: { x: number; y: number; width: number; height: number };
	pads: Array<any>;
	silkScreen: Array<any>;
	fab: Array<any>;
	otherLayers: Map<string, any>;
}

/**
 * 解析 elibu 文件内容
 * @param content - elibu 文件内容
 * @returns 封装数据
 */
export function parseElibuContent(content: string): FootprintData {
	const result: FootprintData = {
		canvas: { x: 0, y: 0, width: 100, height: 100 },
		pads: [],
		silkScreen: [],
		fab: [],
		otherLayers: new Map(),
	};

	let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
	const lines = content.split(/\r?\n/).filter(line => line.trim().length > 0);

	console.log('[FootprintParser] Parsing', lines.length, 'lines');

	const parsedCount = { PAD: 0, LINE: 0, ARC: 0, POLY: 0, FILL: 0, STRING: 0 };
	let failedCount = 0;
	const typeCount = {};

	for (let i = 0; i < lines.length; i++) {
		let line = lines[i].trim();
		if (!line || line.length < 10)
			continue;

		// 去掉行尾的 | 字符
		if (line.endsWith('|')) {
			line = line.substring(0, line.length - 1);
		}

		// 每行格式：{"type":"XXX",...}||{...数据...}
		const separatorIndex = line.indexOf('||');
		if (separatorIndex === -1) {
			if (i < 5)
				console.log('[FootprintParser] Line', i, 'no || separator');
			continue;
		}

		const part1 = line.substring(0, separatorIndex);
		const part2 = line.substring(separatorIndex + 2);

		try {
			const outer = JSON.parse(part1);
			const inner = JSON.parse(part2);
			const type = outer.type;

			if (!type)
				continue;

			// 统计类型
			typeCount[type] = (typeCount[type] || 0) + 1;

			// 解析不同类型的图元
			if (type === 'CANVAS') {
				// 捕获画布原点
				if (inner.originX !== undefined) {
					result.canvas.x = Number(inner.originX) || 0;
				}
				if (inner.originY !== undefined) {
					result.canvas.y = Number(inner.originY) || 0;
				}
			}
			else if (type === 'PAD') {
				const pad = parsePad(inner);
				if (pad) {
					result.pads.push(pad);
					updateBounds(pad.x, pad.y);
					parsedCount.PAD++;
				}
			}
			else if (type === 'LINE') {
				const line = parseLine(inner);
				if (line && line.layer === 'SilkScreen') {
					result.silkScreen.push(line);
					updateBounds(line.x1, line.y1);
					updateBounds(line.x2, line.y2);
					parsedCount.LINE++;
				}
			}
			else if (type === 'ARC') {
				const arc = parseArc(inner);
				if (arc && arc.layer === 'SilkScreen') {
					result.silkScreen.push(arc);
					updateBounds(arc.centerX - arc.radius, arc.centerY - arc.radius);
					updateBounds(arc.centerX + arc.radius, arc.centerY + arc.radius);
					parsedCount.ARC++;
				}
			}
			else if (type === 'POLY') {
				console.log('[FootprintParser] Parsing POLY at line', i, 'layerId:', inner.layerId, 'width:', inner.width);
				const poly = parsePoly(inner);
				if (poly && poly.layer === 'SilkScreen') {
					result.silkScreen.push(poly);
					// 更新边界
					if (poly.segments) {
						poly.segments.forEach((seg) => {
							if (seg.type === 'point') {
								updateBounds(seg.x, seg.y);
							}
							else if (seg.type === 'line') {
								updateBounds(seg.x1, seg.y1);
								updateBounds(seg.x2, seg.y2);
							}
							else if (seg.type === 'arc') {
								updateBounds(seg.x1, seg.y1);
								updateBounds(seg.x2, seg.y2);
							}
						});
					}
					parsedCount.POLY++;
					console.log('[FootprintParser] Added POLY to silkScreen, total:', parsedCount.POLY);
				}
				else {
					console.log('[FootprintParser] POLY not added:', poly ? `layer=${poly.layer}` : 'null');
				}
			}
			else if (type === 'FILL') {
				const fill = parseFill(inner);
				if (fill && fill.layer === 'SilkScreen') {
					result.silkScreen.push(fill);
					fill.points.forEach(pt => updateBounds(pt.x, pt.y));
					parsedCount.FILL++;
				}
			}
			else if (type === 'STRING') {
				const text = parseString(inner);
				if (text && text.layer === 'SilkScreen') {
					result.silkScreen.push(text);
					updateBounds(text.x, text.y);
					parsedCount.STRING++;
				}
			}
		}
		catch (e) {
			failedCount++;
			if (failedCount <= 3) {
				console.log('[FootprintParser] Parse error at line', i, ':', e.message);
				console.log('[FootprintParser] Line content:', line.substring(0, 100));
			}
		}
	}

	console.log('[FootprintParser] Type count:', typeCount);
	console.log('[FootprintParser] Failed to parse:', failedCount, 'lines');
	console.log('[FootprintParser] Parsed types:', parsedCount);
	console.log('[FootprintParser] Result:', result.pads.length, 'pads,', result.silkScreen.length, 'shapes');

	function updateBounds(x, y) {
		if (x < minX)
			minX = x;
		if (x > maxX)
			maxX = x;
		if (y < minY)
			minY = y;
		if (y > maxY)
			maxY = y;
	}

	// 计算画布尺寸
	if (minX !== Infinity) {
		const pad = 10;
		result.canvas = {
			x: minX - pad,
			y: minY - pad,
			width: maxX - minX + pad * 2,
			height: maxY - minY + pad * 2,
		};
	}

	return result;
}

/**
 * 解析焊盘
 */
function parsePad(data: any): any | null {
	if (!data.centerX || !data.defaultPad)
		return null;

	// 解析钻孔信息
	let holeRadius = 0;
	let holeDiameter = 0;
	if (data.hole && data.hole.width) {
		// hole.width 和 hole.height 是钻孔的尺寸
		holeDiameter = Number(data.hole.width) || 0;
		holeRadius = holeDiameter / 2;
	}

	const pad = {
		type: 'pad',
		x: Number(data.centerX) || 0,
		y: Number(data.centerY) || 0,
		width: Number(data.defaultPad.width) || 1,
		height: Number(data.defaultPad.height) || 1,
		number: data.num || '',
		angle: Number(data.padAngle) || 0,
		layer: data.layerId === 1 ? 'top' : data.layerId === 2 ? 'bottom' : 'multi',
		holeRadius,
		holeDiameter,
	};

	// 判断形状
	const padType = data.defaultPad.padType;
	if (padType === 'ROUND' || padType === 'ELLIPSE') {
		pad.shape = pad.width === pad.height ? 'circle' : 'oval';
	}
	else {
		pad.shape = 'rectangle';
	}

	return pad;
}

/**
 * 解析直线
 */
export function parseLine(data: any): any | null {
	if (!data.startX)
		return null;

	return {
		type: 'line',
		layer: data.layerId === 3 ? 'SilkScreen' : 'Other',
		x1: Number(data.startX) || 0,
		y1: Number(data.startY) || 0,
		x2: Number(data.endX) || 0,
		y2: Number(data.endY) || 0,
		strokeWidth: Number(data.width) || 0.1,
	};
}

/**
 * 解析圆弧
 * EasyEDA圆弧格式：startX/startY（起点）、endX/endY（终点）、angle（圆弧角度，逆时针正，顺时针负）
 */
export function parseArc(data: any): any | null {
	if (!data.startX)
		return null;

	const startX = Number(data.startX) || 0;
	const startY = Number(data.startY) || 0;
	const endX = Number(data.endX) || 0;
	const endY = Number(data.endY) || 0;
	const angle = Number(data.angle) || 0;

	// 计算起点到终点的距离和中点
	const dx = endX - startX;
	const dy = endY - startY;
	const chord = Math.sqrt(dx * dx + dy * dy);
	const midX = (startX + endX) / 2;
	const midY = (startY + endY) / 2;

	// 根据圆弧角度计算半径
	const angleRad = (angle * Math.PI) / 180;
	const radius = chord / (2 * Math.sin(angleRad / 2));

	// 计算圆心位置
	const perpAngle = Math.atan2(dy, dx) + Math.PI / 2;
	const distToCenter = Math.sqrt(radius * radius - (chord / 2) * (chord / 2));
	const centerX = midX + distToCenter * Math.cos(perpAngle) * (angle > 0 ? 1 : -1);
	const centerY = midY + distToCenter * Math.sin(perpAngle) * (angle > 0 ? 1 : -1);

	// 计算起始和结束角度
	const startAngle = Math.atan2(startY - centerY, startX - centerX);
	const endAngle = Math.atan2(endY - centerY, endX - centerX);

	return {
		type: 'arc',
		layer: data.layerId === 3 ? 'SilkScreen' : 'Other',
		centerX,
		centerY,
		radius: Math.abs(radius),
		startAngle,
		endAngle,
		counterclockwise: angle > 0,
		strokeWidth: Number(data.width) || 0.1,
	};
}

/**
 * 解析折线（包含直线和圆弧段）
 * path格式：[startX, startY, "L", endX, endY] 或 [startX, startY, "ARC", angle, endX, endY]
 */
export function parsePoly(data) {
	console.log('[ParsePoly] Called with data:', {
		hasPath: !!data.path,
		pathLength: data.path ? data.path.length : 0,
		layerId: data.layerId,
		width: data.width,
		pathPreview: data.path ? data.path.slice(0, 10) : null,
	});

	if (!data.path || !Array.isArray(data.path) || data.path.length < 2) {
		console.log('[ParsePoly] Invalid path, returning null');
		return null;
	}

	const segments = [];
	const path = data.path;

	// 第一个点是起点
	if (typeof path[0] !== 'number' || typeof path[1] !== 'number')
		return null;

	let currentX = path[0];
	let currentY = path[1];
	let i = 2;

	// 解析后续的命令
	while (i < path.length) {
		const command = path[i];

		if (typeof command === 'string') {
			if (command === 'L') {
				// 直线：L endX endY
				if (i + 2 < path.length && typeof path[i + 1] === 'number' && typeof path[i + 2] === 'number') {
					const endX = path[i + 1];
					const endY = path[i + 2];

					segments.push({
						type: 'line',
						x1: currentX,
						y1: currentY,
						x2: endX,
						y2: endY,
					});

					currentX = endX;
					currentY = endY;
					i += 3;
				}
				else {
					i++;
				}
			}
			else if (command === 'ARC' || command === 'CARC') {
				// 圆弧：ARC angle endX endY
				if (i + 3 < path.length && typeof path[i + 1] === 'number' && typeof path[i + 2] === 'number' && typeof path[i + 3] === 'number') {
					const angle = path[i + 1];
					const endX = path[i + 2];
					const endY = path[i + 3];

					console.log('[ParseArc] command:', command, 'from:', currentX, currentY, 'to:', endX, endY, 'angle:', angle);

					segments.push({
						type: 'arc',
						mode: command,
						x1: currentX,
						y1: currentY,
						x2: endX,
						y2: endY,
						angle,
					});

					currentX = endX;
					currentY = endY;
					i += 4;
				}
				else {
					i++;
				}
			}
			else {
				// 未知命令，跳过
				i++;
			}
		}
		else if (typeof command === 'number') {
			// 如果是数字，可能是直接的点坐标（没有命令）
			if (i + 1 < path.length && typeof path[i + 1] === 'number') {
				const endX = command;
				const endY = path[i + 1];

				segments.push({
					type: 'line',
					x1: currentX,
					y1: currentY,
					x2: endX,
					y2: endY,
				});

				currentX = endX;
				currentY = endY;
				i += 2;
			}
			else {
				i++;
			}
		}
		else {
			i++;
		}
	}

	if (segments.length === 0) {
		console.log('[ParsePoly] No segments parsed, returning null');
		return null;
	}

	const result = {
		type: 'poly',
		layer: data.layerId === 3 ? 'SilkScreen' : 'Other',
		segments,
		strokeWidth: Number(data.width) || 0.1,
	};

	console.log('[ParsePoly] Returning poly with', segments.length, 'segments, strokeWidth:', result.strokeWidth, 'layer:', result.layer);

	return result;
}

/**
 * 解析填充
 */
export function parseFill(data) {
	if (!data.path || !Array.isArray(data.path))
		return null;

	const points = [];
	for (const polygon of data.path) {
		if (!Array.isArray(polygon))
			continue;
		for (let i = 0; i < polygon.length; i++) {
			if (typeof polygon[i] === 'string')
				continue;
			if (typeof polygon[i] === 'number' && typeof polygon[i + 1] === 'number') {
				points.push({ x: polygon[i], y: polygon[i + 1] });
				i++;
			}
		}
	}

	if (points.length === 0)
		return null;

	return {
		type: 'fill',
		layer: data.layerId === 3 ? 'SilkScreen' : 'Other',
		points,
		strokeWidth: Number(data.width) || 0.1,
	};
}

/**
 * 解析文本
 */
export function parseString(data) {
	if (!data.text)
		return null;

	return {
		type: 'text',
		layer: data.layerId === 3 ? 'SilkScreen' : 'Other',
		x: Number(data.positionX) || 0,
		y: Number(data.positionY) || 0,
		text: data.text || '',
		fontSize: Number(data.fontSize) || 10,
		angle: Number(data.angle) || 0,
	};
}

// 缓存相关函数
function getCachedFootprint(footprintUuid) {
	return footprintCache.get(footprintUuid) || null;
}

function cacheFootprint(footprintUuid, footprintData) {
	footprintCache.set(footprintUuid, footprintData);
}

function clearFootprintCache(footprintUuid) {
	if (footprintUuid) {
		footprintCache.delete(footprintUuid);
	}
	else {
		footprintCache.clear();
	}
}
