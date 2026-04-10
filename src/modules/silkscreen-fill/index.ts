/**
 * 丝印层填充模块入口
 *
 * 导出所有公共 API
 */

export {
	PRESETS,
	SILKSCREEN_FILL_CONFIG,
} from './config';

export {
	executeSilkscreenFill,
	quickFill,
	type SilkscreenFillConfig,
} from './controller';

export {
	clearFilledRegions,
	createFilledRegions,
	type FillRegionConfig,
} from './fill-generator';

export {
	getLayerPolygons,
	getLayerPrimitives,
	primitiveToPolygons,
	type SilkscreenPrimitive,
} from './layer-extractor';

export {
	getCurrentSelection,
	type SelectionRect,
	type SelectionResult,
	selectionToPolygon,
	waitForUserSelection,
} from './selection-handler';

export {
	cleanPolygons,
	difference,
	intersection,
	type Point,
	type Polygon,
	type Polygons,
	rectToPolygon,
	union,
} from './utils/clipper';
