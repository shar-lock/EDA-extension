import { parseFootprintFile } from './footprint-parser';
/**
 * 等待 eda API 可用
 */
export function waitForEda(timeout = 5000): Promise<void> {
	return new Promise((resolve, reject) => {
		if (typeof eda !== 'undefined') {
			resolve();
			return;
		}

		const startTime = Date.now();
		const checkInterval = setInterval(() => {
			if (typeof eda !== 'undefined') {
				clearInterval(checkInterval);
				resolve();
			}
			else if (Date.now() - startTime > timeout) {
				clearInterval(checkInterval);
				reject(new Error('Timeout waiting for eda API'));
			}
		}, 100);
	});
}

/**
 * 解析 TPCB_PolygonSourceArray 格式的路径
 * TPCB_PolygonSourceArray = Array<'L' | 'ARC' | 'CARC' | 'C' | 'R' | 'CIRCLE' | number>
 *
 * 命令说明：
 * - 数字表示坐标：[x, y, ...]
 * - 字符串表示命令，跟在坐标后面：[x, y, 'L', ...]
 * - 'L' (Line): 直线
 * - 'C' (Cubic Bezier): 三次贝塞尔曲线
 * - 'ARC': 圆弧
 * - 'CARC': 反向圆弧
 * - 'R': 矩形
 * - 'CIRCLE': 圆
 *
 * @param sourceArray - TPCB_PolygonSourceArray 格式的源数组
 * @returns 解析后的点和路径命令
 */

export function parsePolygonSourceArray(sourceArray: any[]): {
	points: Array<{ x: number; y: number }>;
	pathCommands: Array<any>;
} {
	if (!Array.isArray(sourceArray) || sourceArray.length === 0) {
		return { points: [], pathCommands: [] };
	}

	const points: Array<{ x: number; y: number }> = [];
	const pathCommands: Array<any> = [];
	let i = 0;
	let currentX = 0;
	let currentY = 0;
	let startX = 0;
	let startY = 0;
	let lastCommand = 'L'; // 默认命令是直线

	while (i < sourceArray.length) {
		const item = sourceArray[i];

		if (typeof item === 'number') {
			// 数字表示坐标点
			const x = item;
			const y = sourceArray[i + 1];

			if (typeof y !== 'number') {
				i++;
				continue;
			}

			currentX = x;
			currentY = y;

			// 如果是第一个点，记录起点
			if (points.length === 0) {
				startX = x;
				startY = y;
				pathCommands.push({ type: 'M', x, y });
			}

			// 根据上一个命令添加路径
			switch (lastCommand) {
				case 'L':
					pathCommands.push({ type: 'L', x, y });
					break;

				case 'C': {
					// 三次贝塞尔曲线：需要控制点（这里简化处理）
					pathCommands.push({ type: 'L', x, y });
					break;
				}
				case 'ARC':
				case 'CARC':
					pathCommands.push({ type: 'L', x, y });
					break;
			}

			points.push({ x, y });
			i += 2; // 跳过 x, y
		}
		else if (typeof item === 'string') {
			// 字符串表示命令，更新当前命令
			lastCommand = item;
			i++;
		}
		else {
			i++;
		}
	}

	// 闭合路径：如果终点不是起点，添加闭合线段
	if (points.length > 0) {
		const lastPoint = points[points.length - 1];
		if (lastPoint.x !== startX || lastPoint.y !== startY) {
			pathCommands.push({ type: 'Z', x: startX, y: startY });
			points.push({ x: startX, y: startY });
		}
	}

	return { points, pathCommands };
}

/**
 * 从 footprint-parser.ts 引入解析函数
 */

// 获取 PCB 数据（包括元件和板框）
export async function fetchPcbData() {
	if (typeof eda === 'undefined') {
		throw new TypeError('eda API not available');
	}

	try {
		// 获取所有元件
		let components = [];
		if (eda.pcb_PrimitiveComponent && typeof eda.pcb_PrimitiveComponent.getAll === 'function') {
			components = await eda.pcb_PrimitiveComponent.getAll() || [];
		}

		// 获取板框 - 使用 getAll(undefined, 11) 直接获取板框层（layerId=11）的数据
		let boardOutline = null;

		if (eda.pcb_PrimitivePolyline && typeof eda.pcb_PrimitivePolyline.getAll === 'function') {
			try {
				// 使用 layerId 参数直接获取板框层的数据
				const polylines = await eda.pcb_PrimitivePolyline.getAll(undefined, 11) || [];

				if (polylines.length > 0) {
					// 收集所有 polyline 的几何信息
					const polylineSegments = [];
					const EPSILON = 0.001; // 用于判断点是否重合
					let outlineWidth = 2; // 默认线宽

					for (let idx = 0; idx < polylines.length; idx++) {
						const pl = polylines[idx];

						// 获取线宽 - 尝试多个可能的属性名
						if (outlineWidth === 2) {
							const width = pl.width || pl.strokeWidth || pl.lineWidth;
							if (width !== undefined) {
								outlineWidth = Number(width) || 2;
							}
						}

						let sourceArray = null;

						// 优先使用 getState_ComplexPolygon() 获取 TPCB_PolygonSourceArray 格式的数据
						if (pl.getState_ComplexPolygon && typeof pl.getState_ComplexPolygon === 'function') {
							try {
								const complexPolygon = pl.getState_ComplexPolygon();
								let sa = complexPolygon;

								if (Array.isArray(complexPolygon) && complexPolygon.length > 0 && Array.isArray(complexPolygon[0])) {
									sa = complexPolygon[0];
								}

								if (Array.isArray(sa) && sa.length > 0) {
									sourceArray = sa;
								}
							}
							catch (e) {
								console.warn('[iBom] getState_ComplexPolygon failed:', e);
							}
						}

						// 降级：使用 getState_Polygon() 获取扁平数组
						if (!sourceArray && pl.getState_Polygon && typeof pl.getState_Polygon === 'function') {
							try {
								const polygonState = pl.getState_Polygon();
								let flatArray = null;

								if (polygonState && polygonState.polygon && Array.isArray(polygonState.polygon)) {
									flatArray = polygonState.polygon;
								}
								else if (Array.isArray(polygonState)) {
									flatArray = polygonState;
								}

								if (flatArray && flatArray.length > 0) {
									sourceArray = flatArray;
								}
							}
							catch (e) {
								console.warn('[iBom] getState_Polygon failed:', e);
							}
						}

						// 解析这个 polyline
						if (sourceArray && Array.isArray(sourceArray) && sourceArray.length > 0) {
							const parsed = parsePolygonSourceArray(sourceArray);

							// 保存这个 polyline 的线段（起点、终点、路径命令）
							if (parsed.points.length >= 2) {
								const points = parsed.points.slice(0, -1); // 移除闭合点
								const commands = parsed.pathCommands.filter(cmd => cmd.type !== 'Z');
								polylineSegments.push({
									startPoint: points[0],
									endPoint: points[points.length - 1],
									points,
									commands,
								});
							}
						}
					}

					// 按连接关系排序线段，形成完整的多边形
					const sortedSegments = [];
					const used = Array.from({ length: polylineSegments.length }).fill(false);

					// 判断两点是否重合
					function isSamePoint(p1, p2) {
						return Math.abs(p1.x - p2.x) < EPSILON && Math.abs(p1.y - p2.y) < EPSILON;
					}

					// 从第一个线段开始
					if (polylineSegments.length > 0) {
						sortedSegments.push(polylineSegments[0]);
						used[0] = true;
						let currentEnd = polylineSegments[0].endPoint;

						// 找下一个连接的线段
						while (sortedSegments.length < polylineSegments.length) {
							let foundIndex = -1;

							for (let i = 0; i < polylineSegments.length; i++) {
								if (!used[i]) {
									const seg = polylineSegments[i];
									// 检查起点是否匹配当前终点
									if (isSamePoint(seg.startPoint, currentEnd)) {
										foundIndex = i;
										currentEnd = seg.endPoint;
										break;
									}
									// 检查终点是否匹配当前终点（需要翻转线段）
									if (isSamePoint(seg.endPoint, currentEnd)) {
										foundIndex = i;
										// 翻转线段
										polylineSegments[i] = {
											startPoint: seg.endPoint,
											endPoint: seg.startPoint,
											points: [...seg.points].reverse(),
											commands: seg.commands, // 命令不需要翻转
										};
										currentEnd = polylineSegments[i].endPoint;
										break;
									}
								}
							}

							if (foundIndex !== -1) {
								sortedSegments.push(polylineSegments[foundIndex]);
								used[foundIndex] = true;
							}
							else {
								console.warn('[iBom] Could not find connected segment');
								break;
							}
						}
					}

					// 合并所有排序后的线段
					if (sortedSegments.length > 0) {
						const allPoints = [];
						const allCommands = [];

						for (const seg of sortedSegments) {
							// 添加点（移除第一个点，因为它是上一个线段的终点）
							if (allPoints.length > 0) {
								allPoints.push(...seg.points.slice(1));
							}
							else {
								allPoints.push(...seg.points);
							}

							// 添加命令
							allCommands.push(...seg.commands);
						}

						// 添加闭合命令
						if (allPoints.length > 0) {
							allCommands.push({ type: 'Z', x: allPoints[0].x, y: allPoints[0].y });
						}

						boardOutline = {
							pointArr: allPoints,
							pathCommands: allCommands,
							layerid: 11,
							width: outlineWidth,
						};
					}
				}
			}
			catch (e) {
				console.warn('[iBom] Failed to get board outline with getAll(undefined, 11):', e);
			}
		}

		return {
			components,
			boardOutline,
		};
	}
	catch (err) {
		console.error('[iBom] fetchPcbData error:', err);
		throw err;
	}
}

/**
 * 获取元件的封装 UUID 和 Library UUID
 * @param {object} component - 元件对象
 * @returns {Promise<{footprintUuid: string, libraryUuid: string}|null>} 封装信息
 */
async function getComponentFootprintInfo(component) {
	if (!component) {
		return null;
	}

	const ref = component.ref || component.designator || 'unknown';
	console.log('[iBom] Getting footprint info for component:', ref);

	try {
		// 使用 getState_Footprint() 获取封装信息
		if (component.getState_Footprint && typeof component.getState_Footprint === 'function') {
			console.log('[iBom] Calling getState_Footprint for', ref);
			const footprint = await component.getState_Footprint();
			if (footprint && footprint.uuid && footprint.libraryUuid) {
				const info = {
					footprintUuid: footprint.uuid,
					libraryUuid: footprint.libraryUuid,
					name: footprint.name,
				};
				return info;
			}
			else {
				console.warn('[iBom] ✗ Component', ref, 'footprint has no uuid or libraryUuid');
			}
		}
		else {
			console.warn('[iBom] Component', ref, 'has no getState_Footprint method');
		}
	}
	catch (err) {
		console.error('[iBom] getComponentFootprintInfo error for', ref, ':', err);
	}

	return null;
}

/**
 * 获取封装文件并解析
 * @param {string} footprintUuid - 封装 UUID
 * @param {string} libraryUuid - 库 UUID
 * @returns {Promise<object | null>} 封装数据
 */
async function fetchFootprintFile(footprintUuid, libraryUuid) {
	if (!footprintUuid || !libraryUuid) {
		return null;
	}

	console.log('[iBom] Fetching footprint file:', { footprintUuid, libraryUuid });

	try {
		// 使用 SYS_FileManager.getFootprintFileByFootprintUuid() 获取封装文件
		if (eda.sys_FileManager && typeof eda.sys_FileManager.getFootprintFileByFootprintUuid === 'function') {
			console.log('[iBom] Calling getFootprintFileByFootprintUuid...');
			console.log('[iBom] Parameters:', { footprintUuid, libraryUuid, fileType: 'elibz2' });

			const file = await eda.sys_FileManager.getFootprintFileByFootprintUuid(
				footprintUuid,
				libraryUuid,
				'elibz2',
			);

			console.log('[iBom] Got footprint file:', file);
			console.log('[iBom] File details:', file
				? {
						name: file.name,
						size: file.size,
						type: file.type,
					}
				: 'null');

			if (file) {
				// 解析封装文件（zip 格式）
				console.log('[iBom] Parsing footprint file...');
				const footprintData = await parseFootprintFile(file, footprintUuid);

				if (footprintData) {
					console.log('[iBom] ✓ Parsed footprint:', footprintUuid);
					console.log('[iBom] footprintData keys:', Object.keys(footprintData));
					console.log('[iBom] footprintData.canvas:', footprintData.canvas);
					console.log('[iBom] footprintData.pads count:', footprintData.pads?.length);
					console.log('[iBom] footprintData.silkScreen count:', footprintData.silkScreen?.length);
					console.log('[iBom] footprintData.fab count:', footprintData.fab?.length);

					// 打印前 3 个焊盘信息
					if (footprintData.pads && footprintData.pads.length > 0) {
						console.log('[iBom] Sample pads:', footprintData.pads.slice(0, 3).map(p => ({
							shape: p.shape,
							x: p.x,
							y: p.y,
							width: p.width,
							height: p.height,
							number: p.number,
						})));
					}

					// 打印前 3 个丝印层图形信息
					if (footprintData.silkScreen && footprintData.silkScreen.length > 0) {
						console.log('[iBom] Sample silkScreen:', footprintData.silkScreen.slice(0, 3).map(s => ({
							type: s.type,
							layer: s.layer,
						})));
					}

					return footprintData;
				}
				else {
					console.warn('[iBom] ✗ Failed to parse footprint file:', footprintUuid);
				}
			}
			else {
				console.warn('[iBom] ✗ Got null file for footprint:', footprintUuid);
			}
		}
		else {
			console.warn('[iBom] sys_FileManager.getFootprintFileByFootprintUuid not available');
		}
	}
	catch (err) {
		console.error('[iBom] fetchFootprintFile error:', err);
	}

	return null;
}

/**
 * 为所有元件获取封装数据
 * @param {Array} components - 元件数组
 * @returns {Promise<Map<string, object>>} footprintUuid -> footprintData 的映射
 */
export async function fetchComponentFootprints(components) {
	console.log('[iBom] ===== fetchComponentFootprints START =====');
	console.log('[iBom] Total components:', components.length);

	const footprintMap = new Map();
	const footprintInfoMap = new Map(); // footprintUuid -> {libraryUuid, ref}

	// 第一步：获取所有元件的封装信息
	console.log('[iBom] Step 1: Getting footprint info for all components...');
	for (const comp of components) {
		const ref = comp.ref || comp.designator || 'unknown';

		if (!comp.footprintUuid) {
			const info = await getComponentFootprintInfo(comp);
			if (info) {
				comp.footprintUuid = info.footprintUuid;
				comp.footprintLibraryUuid = info.libraryUuid;

				// 收集封装信息（去重）
				if (!footprintInfoMap.has(info.footprintUuid)) {
					footprintInfoMap.set(info.footprintUuid, {
						libraryUuid: info.libraryUuid,
						refs: [ref],
					});
				}
				else {
					footprintInfoMap.get(info.footprintUuid).refs.push(ref);
				}
			}
		}
	}

	// 第二步：获取所有封装文件并解析
	console.log('[iBom] Step 2: Fetching footprint files...');
	let successCount = 0;
	let failedCount = 0;

	for (const [footprintUuid, info] of footprintInfoMap.entries()) {
		const footprintData = await fetchFootprintFile(footprintUuid, info.libraryUuid);

		if (footprintData) {
			footprintMap.set(footprintUuid, footprintData);
			successCount++;
		}
		else {
			failedCount++;
			console.warn('[iBom] Failed to fetch footprint:', footprintUuid);
		}
	}

	console.log('[iBom] ===== fetchComponentFootprints END =====');

	return footprintMap;
}

/**
 * 获取元件的封装数据
 * @param {object} component - 元件对象
 * @param {Map} footprintMap - 封装数据映射
 * @returns {object | null} 封装数据
 */
export function getComponentFootprint(component, footprintMap) {
	if (!component || !footprintMap) {
		return null;
	}

	// 尝试从 component 获取 footprintUuid
	const footprintUuid = component.footprintUuid || component.footprintId || component.packageUuid;

	if (!footprintUuid) {
		return null;
	}

	const footprintData = footprintMap.get(footprintUuid);

	// 调试日志（只打印前几个元件）
	const ref = component.ref || component.designator || 'unknown';
	console.log('[iBom] getComponentFootprint for', ref, ':', {
		footprintUuid,
		hasData: !!footprintData,
		canvas: footprintData?.canvas,
		mapSize: footprintMap.size,
	});
	return footprintData || null;
}

/**
 * 获取所有导线
 * @returns {Promise<Array>} 导线数组
 */
async function getAllTracks() {
	console.log('[iBom] Fetching all tracks...');
	try {
		const tracks = await eda.pcb_PrimitiveLine.getAll();
		console.log('[iBom] Got', tracks?.length || 0, 'tracks');
		if (tracks && tracks.length > 0) {
			console.log('[iBom] Sample track:', tracks[0]);
			console.log('[iBom] Track properties:', {
				startX: tracks[0].startX,
				startY: tracks[0].startY,
				endX: tracks[0].endX,
				endY: tracks[0].endY,
				strokeWidth: tracks[0].strokeWidth,
				width: tracks[0].width,
				lineWidth: tracks[0].lineWidth,
				layer: tracks[0].layer,
				layerId: tracks[0].layerId,
			});
		}
		return tracks || [];
	}
	catch (error) {
		console.error('[iBom] Failed to get tracks:', error);
		return [];
	}
}

/**
 * 获取所有过孔
 * @returns {Promise<Array>} 过孔数组
 */
async function getAllVias() {
	console.log('[iBom] Fetching all vias...');
	try {
		const vias = await eda.pcb_PrimitiveVia.getAll();
		console.log('[iBom] Got', vias?.length || 0, 'vias');
		return vias || [];
	}
	catch (error) {
		console.error('[iBom] Failed to get vias:', error);
		return [];
	}
}
