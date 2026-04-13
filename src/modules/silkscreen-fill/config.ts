/**
 * 丝印层填充配置
 *
 * 用户可以在这里自定义配置
 */

import type { SilkscreenFillConfig } from './controller';

/**
 * 默认配置
 * 用户可以根据需要修改这些值
 */
export const SILKSCREEN_FILL_CONFIG: SilkscreenFillConfig = {
	/**
	 * 丝印层ID
	 * 3 = 顶层丝印层
	 * 4 = 底层丝印层
	 */
	silkscreenLayerId: 3,

	/**
	 * 填充层ID
	 * 通常与丝印层相同
	 */
	fillLayerId: 3,

	/**
	 * 网络名称（可选）
	 * 如果需要关联特定网络，可以设置
	 */
	netName: undefined,

	/**
	 * 填充模式
	 * 'solid' = 实心填充
	 * 'hatched' = 网格填充
	 */
	fillMode: 'solid' as const,

	/**
	 * 填充颜色（可选）
	 * 使用十六进制颜色值，如 '#FF0000'
	 */
	color: undefined,

};

/**
 * 预设配置
 */
export const PRESETS = {
	/** 顶层丝印填充 */
	TOP_SILKSCREEN: {
		silkscreenLayerId: 3,
		fillLayerId: 3,
		strokeWidth: 0.1,
		fillMode: 'solid' as const,
	},

	/** 底层丝印填充 */
	BOTTOM_SILKSCREEN: {
		silkscreenLayerId: 4,
		fillLayerId: 4,
		strokeWidth: 0.1,
		fillMode: 'solid' as const,
	},

	/** 网格填充 */
	HATCHED_FILL: {
		silkscreenLayerId: 3,
		fillLayerId: 3,
		strokeWidth: 0.1,
		fillMode: 'hatched' as const,
	},
} as const;
