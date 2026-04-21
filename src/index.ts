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
import { diagnosticLog } from './modules/silkscreen-fill/utils/diagnostic';

const IFRAME_PANEL_ID = 'silkscreen-fill-ui';
const IFRAME_MESSAGE_TOPIC = 'silkscreen-fill:iframe-action';

let fillRunning = false;
let currentClearanceMil = 0;
let lastCreatedFillIds: string[] = [];
let baseZeroClearanceSource: TPCB_PolygonSourceArray | null = null;
let iframeMessageTask: { cancel?: () => void } | null = null;
let messageBusSubscriptionCount = 0;
let lastActionAt = 0;
const ACTION_COOLDOWN_MS = 500;

function resetStoredState(): void {
	diagnosticLog('[index] 重置存储状态', {
		currentClearanceMil,
		lastCreatedFillIdsCount: lastCreatedFillIds.length,
		hasBaseZeroClearanceSource: !!baseZeroClearanceSource,
	});
	currentClearanceMil = 0;
	lastCreatedFillIds = [];
	baseZeroClearanceSource = null;
	lastActionAt = 0;
}

function parseClearanceMil(raw: unknown): number | null {
	const n = Number(String(raw ?? '').trim());
	if (!Number.isFinite(n) || n < 0) {
		return null;
	}
	return n;
}

async function runSilkscreenFillWithClearance(clearanceMil: number): Promise<void> {
	diagnosticLog('[index] 执行填充主流程', { clearanceMil, showSelectionPrompt: true });
	const createdIds = await executeSilkscreenFill({
		silkscreenLayerId: EPCB_LayerId.TOP_SILKSCREEN,
		fillLayerId: EPCB_LayerId.TOP_SILKSCREEN,
		fillMode: 'solid',
		clearanceMil,
		showSelectionPrompt: true,
	});
	currentClearanceMil = clearanceMil;
	lastCreatedFillIds = createdIds;
	diagnosticLog('[index] 填充执行完成', { createdIdsCount: createdIds.length, clearanceMil });
	// 仅在 0 避让时更新“基准复杂多边形 source”，后续改避让应始终基于该基准重算
	if (clearanceMil === 0) {
		const firstFillId = createdIds[0];
		if (firstFillId) {
			const fills = await eda.pcb_PrimitiveFill.get([firstFillId]);
			const firstFill = Array.isArray(fills) ? fills[0] : null;
			const poly = await firstFill?.getState_ComplexPolygon?.();
			const polyWithSource = poly as unknown as {
				getSource?: () => TPCB_PolygonSourceArray | Promise<TPCB_PolygonSourceArray>;
			};
			const source = typeof polyWithSource?.getSource === 'function'
				? await Promise.resolve(polyWithSource.getSource.call(polyWithSource))
				: null;
			baseZeroClearanceSource = source && Array.isArray(source) && source.length > 0 ? source : null;
			diagnosticLog('[index] 更新0避让基准source', {
				baseSourceValid: !!baseZeroClearanceSource,
				firstFillId,
			});
		}
	}
}

async function rerunByLastFill(clearanceMil: number): Promise<void> {
	diagnosticLog('[index] 按避让重填触发', {
		clearanceMil,
		hasBaseZeroClearanceSource: !!baseZeroClearanceSource,
		lastCreatedFillIdsCount: lastCreatedFillIds.length,
	});
	if (!baseZeroClearanceSource || baseZeroClearanceSource.length === 0) {
		throw new Error('没有可用于重填的0避让基准多边形，请先执行一次0避让填充。');
	}
	if (lastCreatedFillIds.length > 0) {
		await eda.pcb_PrimitiveFill.delete(lastCreatedFillIds);
		lastCreatedFillIds = [];
	}
	const baseComplexPolygon = eda.pcb_MathPolygon.createComplexPolygon(baseZeroClearanceSource);
	if (!baseComplexPolygon) {
		throw new Error('0避让基准多边形转换失败');
	}
	const baseFill = await eda.pcb_PrimitiveFill.create(
		EPCB_LayerId.TOP_SILKSCREEN,
		baseComplexPolygon as unknown as IPCB_Polygon,
		undefined,
		EPCB_PrimitiveFillMode.SOLID,
		0,
		false,
	);
	const baseFillId = baseFill?.getState_PrimitiveId?.();
	if (!baseFillId) {
		throw new Error('0避让基准填充创建失败');
	}
	await eda.pcb_SelectControl.clearSelected();
	await eda.pcb_SelectControl.doSelectPrimitives([baseFillId]);
	const createdIds = await executeSilkscreenFill({
		silkscreenLayerId: EPCB_LayerId.TOP_SILKSCREEN,
		fillLayerId: EPCB_LayerId.TOP_SILKSCREEN,
		fillMode: 'solid',
		clearanceMil,
		showSelectionPrompt: false,
	});
	currentClearanceMil = clearanceMil;
	lastCreatedFillIds = createdIds;
	diagnosticLog('[index] 按避让重填完成', { createdIdsCount: createdIds.length, clearanceMil });
}

async function rerunByReselect(clearanceMil: number): Promise<void> {
	diagnosticLog('[index] 重新选区填充触发', {
		clearanceMil,
		previousFillIdsCount: lastCreatedFillIds.length,
	});
	const previousFillIds = [...lastCreatedFillIds];
	if (previousFillIds.length > 0) {
		await eda.pcb_PrimitiveFill.delete(previousFillIds);
	}
	resetStoredState();
	await eda.pcb_SelectControl.clearSelected();
	// 重新选区时先建立 0 避让基准，避免后续“按避让重填”缺少基准数据
	await runSilkscreenFillWithClearance(0);
	if (clearanceMil > 0) {
		diagnosticLog('[index] 基准建立完成，继续执行目标避让重填', { clearanceMil });
		await rerunByLastFill(clearanceMil);
	}
}

function bindIframeMessageBridge(): void {
	if (iframeMessageTask) {
		diagnosticLog('[index] 准备取消旧消息总线订阅', { messageBusSubscriptionCount });
	}
	iframeMessageTask?.cancel?.();
	if (messageBusSubscriptionCount > 0) {
		messageBusSubscriptionCount--;
	}
	diagnosticLog('[index] 消息总线取消订阅完成', { messageBusSubscriptionCount });

	iframeMessageTask = eda.sys_MessageBus.subscribeOncePublic(IFRAME_MESSAGE_TOPIC, (message: any) => {
		// 单次订阅触发后，本订阅任务已消耗
		iframeMessageTask = null;
		if (messageBusSubscriptionCount > 0) {
			messageBusSubscriptionCount--;
		}
		diagnosticLog('[index] 单次订阅消息已触发，开始处理', { messageBusSubscriptionCount });

		const data = message as { action?: string; clearanceMil?: string | number } | undefined;
		diagnosticLog('[index] 收到消息总线消息', data);
		void (async () => {
			try {
				if (!data) {
					return;
				}
				if (data.action !== 'resel' && data.action !== 'clearance' || data.action === 'close') {
					return;
				}
				const now = Date.now();
				if (now - lastActionAt < ACTION_COOLDOWN_MS) {
					diagnosticLog('[index] 消息被节流丢弃', {
						lastActionAt,
						now,
						cooldownMs: ACTION_COOLDOWN_MS,
					});
					return;
				}
				lastActionAt = now;

				if (fillRunning) {
					return;
				}
				fillRunning = true;
				let clearanceMil = currentClearanceMil;
				if (data.action === 'clearance') {
					const parsed = parseClearanceMil(data.clearanceMil);
					if (parsed === null) {
						eda.sys_Dialog.showInformationMessage('请输入大于等于 0 的数字（单位：mil）。', '输入错误');
						return;
					}
					clearanceMil = parsed;
				}
				if (data.action === 'resel') {
					diagnosticLog('[index] 开始处理动作: 重新选区填充', { clearanceMil });
					await rerunByReselect(clearanceMil);
				}
				else {
					diagnosticLog('[index] 开始处理动作: 按避让重填', { clearanceMil });
					await rerunByLastFill(clearanceMil);
				}
			}
			catch (error) {
				console.error('丝印层填充失败:', error);
				eda.sys_Dialog.showInformationMessage(
					`丝印层填充失败: ${error instanceof Error ? error.message : '未知错误'}`,
					'错误',
				);
			}
			finally {
				fillRunning = false;
				if (message.action === 'close') {
					diagnosticLog('[index] 收到关闭消息，本次消息处理结束');
					return;
				}
				diagnosticLog('[index] 本次消息处理结束，重新注册下一次单次订阅');
				bindIframeMessageBridge();
			}
		})();
	});
	if (iframeMessageTask) {
		messageBusSubscriptionCount++;
	}
	diagnosticLog('[index] 消息总线订阅结果', {
		subscribeSuccess: !!iframeMessageTask,
		messageBusSubscriptionCount,
		topic: IFRAME_MESSAGE_TOPIC,
		mode: 'subscribeOncePublic',
	});
}

// eslint-disable-next-line unused-imports/no-unused-vars
export function activate(status?: 'onStartupFinished', arg?: string): void {
	// eslint-disable-next-line no-console
	console.log('丝印层填充插件已激活');
	diagnosticLog('[index] activate', { status, arg });
}

export function about(): void {
	eda.sys_Dialog.showInformationMessage(
		eda.sys_I18n.text('EasyEDA extension SDK v', undefined, undefined, extensionConfig.version),
		eda.sys_I18n.text('About'),
	);
}

/**
 * 丝印层填充功能：打开内联框架 UI（SYS_IFrame），用户在 iframe 内输入避让距离并操作按钮。
 * @see https://prodocs.lceda.cn/cn/api/reference/pro-api.sys_iframe.html
 */
export async function silkscreenFill(): Promise<void> {
	diagnosticLog('[index] 菜单触发丝印层填充');
	bindIframeMessageBridge();
	if (fillRunning) {
		diagnosticLog('[index] fillRunning=true，本次请求忽略');
		return;
	}
	fillRunning = true;
	try {
		await runSilkscreenFillWithClearance(currentClearanceMil);
		await eda.sys_IFrame.openIFrame('/iframe/index.html', 300, 150, IFRAME_PANEL_ID, {
			title: '丝印层填充',
			buttonCallbackFn: (button) => {
				diagnosticLog('[index] iframe标题栏按钮触发', { button });
				if (button === 'close') {
					diagnosticLog('[index] iframe关闭，开始取消消息总线订阅', { messageBusSubscriptionCount });
					iframeMessageTask?.cancel?.();
					iframeMessageTask = null;
					if (messageBusSubscriptionCount > 0) {
						messageBusSubscriptionCount--;
					}
					eda.sys_MessageBus.publishPublic(IFRAME_MESSAGE_TOPIC, { action: 'close' });
					diagnosticLog('[index] iframe关闭，取消订阅完成', { messageBusSubscriptionCount });
					resetStoredState();
				}
			},
		});
	}
	finally {
		fillRunning = false;
	}
}
