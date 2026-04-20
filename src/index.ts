/**
 * 入口文件
 *
 * 本文件为默认扩展入口文件，如果你想要配置其它文件作为入口文件，
 * 请修改 `extension.json` 中的 `entry` 字段；
 *
 * 请在此处使用 `export`  导出所有你希望在 `headerMenus` 中引用的方法，
 * 方法通过方法名与 `headerMenus` 关联。
 *
 * 如需了解更多开发细节，请阅读：
 * https://prodocs.lceda.cn/cn/api/guide/
 */
import * as extensionConfig from '../extension.json';
import { executeSilkscreenFill } from './modules/silkscreen-fill';

// eslint-disable-next-line unused-imports/no-unused-vars
export function activate(status?: 'onStartupFinished', arg?: string): void {
	// eslint-disable-next-line no-console
	console.log('丝印层填充插件已激活');
}

export function about(): void {
	eda.sys_Dialog.showInformationMessage(
		eda.sys_I18n.text('EasyEDA extension SDK v', undefined, undefined, extensionConfig.version),
		eda.sys_I18n.text('About'),
	);
}

/**
 * 丝印层填充功能
 * 在PCB编辑器中通过菜单调用此方法
 */
export async function silkscreenFill(): Promise<void> {
	try {
		// eslint-disable-next-line no-console
		console.log('开始执行丝印层填充...');

		// 显示开始提示
		eda.sys_Dialog.showInformationMessage(
			'开始丝印层填充。下一步请先在PCB中选择填充区域。',
			'丝印层填充',
		);

		// 执行填充
		const result = await executeSilkscreenFill({
			silkscreenLayerId: EPCB_LayerId.TOP_SILKSCREEN, // 顶层丝印层
			fillLayerId: EPCB_LayerId.TOP_SILKSCREEN, // 填充到顶层丝印层
			fillMode: 'solid', // 实心填充
		});

		// eslint-disable-next-line no-console
		console.log('丝印层填充完成，创建了', result.length, '个填充区域');
	}
	catch (error) {
		console.error('丝印层填充失败:', error);

		eda.sys_Dialog.showInformationMessage(
			`丝印层填充失败: ${error instanceof Error ? error.message : '未知错误'}`,
			'错误',
		);
	}
}
